/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Anthropic Messages API adapter (aligned with Go internal/llm/anthropic.go).
 * POST to https://api.anthropic.com/v1/messages, x-api-key header, anthropic-version.
 */

import type { ChatMessage, ToolDefinition } from './llm';
import { getAnthropicEnvAsync, getContextWindowForModel } from './providers';
import { createLogger } from './logger';

const log = createLogger('anthropic');
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicMessage = { role: string; content: AnthropicContentBlock[] };

function convertToAnthropic(messages: ChatMessage[]): {
  system: string;
  messages: AnthropicMessage[];
} {
  let system = '';
  const out: AnthropicMessage[] = [];
  const pendingToolResults: AnthropicContentBlock[] = [];
  const seenToolIds = new Set<string>();

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      out.push({ role: 'user', content: [...pendingToolResults] });
      pendingToolResults.length = 0;
      seenToolIds.clear();
    }
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
      continue;
    }
    if (msg.role === 'tool') {
      if (msg.toolCallId && !seenToolIds.has(msg.toolCallId)) {
        seenToolIds.add(msg.toolCallId);
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content,
        });
      }
      continue;
    }
    flushToolResults();

    const content: AnthropicContentBlock[] = [];
    if (msg.toolCalls?.length) {
      for (const tc of msg.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = {};
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      const text = (msg.content || '').trim();
      if (text) content.unshift({ type: 'text', text });
    } else {
      const text = (msg.content || '').trim() || '\u200b';
      content.push({ type: 'text', text });
    }
    out.push({ role: msg.role, content });
  }
  flushToolResults();
  return { system, messages: out };
}

function anthropicToolDefs(tools: ToolDefinition[]): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: (t.function.parameters as Record<string, unknown>) || {
      type: 'object',
      properties: {},
    },
  }));
}

export async function chat(
  messages: ChatMessage[],
  options?: {
    model?: string;
    tools?: ToolDefinition[];
    projectRoot?: string;
    providerId?: string;
    signal?: AbortSignal;
    sessionId?: string;
  }
): Promise<{
  content: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}> {
  const projectRoot = options?.projectRoot ?? '';
  const providerId = options?.providerId;
  const sessionId = options?.sessionId;
  const { apiKey, model: defaultModel } = await getAnthropicEnvAsync(
    projectRoot,
    providerId
  );
  const model = options?.model ?? defaultModel;
  const maxTokens =
    (providerId && getContextWindowForModel(projectRoot, providerId, model)) ?? 4096;
  const { system, messages: anthropicMessages } = convertToAnthropic(messages);

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: system || undefined,
    messages: anthropicMessages,
  };
  if (options?.tools?.length) {
    body.tools = anthropicToolDefs(options.tools);
  }

  log.debug(
    'chat request',
    ...(sessionId ? ['sessionId:', sessionId] : []),
    'url:',
    ANTHROPIC_API_URL,
    'model:',
    model,
    'messages:',
    messages.length,
    'body (truncated):',
    JSON.stringify(body).slice(0, 400)
  );

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  const resText = await res.text();
  log.debug(
    'chat response status',
    ...(sessionId ? ['sessionId:', sessionId] : []),
    res.status,
    'body length:',
    resText.length,
    'preview:',
    resText.slice(0, 300)
  );

  if (!res.ok) {
    log.debug('chat response error body', ...(sessionId ? ['sessionId:', sessionId] : []), resText.slice(0, 1000));
    throw new Error(`Anthropic API error ${res.status}: ${resText}`);
  }

  let data: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
  };
  try {
    data = JSON.parse(resText) as typeof data;
  } catch (parseErr) {
    log.debug(
      'chat response JSON parse failed',
      ...(sessionId ? ['sessionId:', sessionId] : []),
      parseErr,
      'raw (truncated):',
      resText.slice(0, 1000)
    );
    throw new Error(`Anthropic response was not valid JSON: ${String(parseErr)}`);
  }

  const contentBlocks = data.content ?? [];
  let content = '';
  const toolCalls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }> = [];

  for (const block of contentBlocks) {
    if (block.type === 'text' && block.text) content += block.text;
    if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments:
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input ?? {}),
        },
      });
    }
  }

  log.debug(
    'chat response',
    ...(sessionId ? ['sessionId:', sessionId] : []),
    'content length:',
    content.length,
    'toolCalls:',
    toolCalls.length,
    'content preview:',
    content.slice(0, 200)
  );
  return { content, toolCalls: toolCalls.length ? toolCalls : undefined };
}
