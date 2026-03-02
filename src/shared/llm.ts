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

import { getOpenAIEnvAsync, getRunpodEnvAsync, getOllamaEnv, getContextWindowForModel } from './providers';
import * as anthropic from './anthropic';
import * as bedrock from './bedrock';
import { createLogger } from './logger';

const log = createLogger('llm');

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function getUrl(baseURL: string, segment: string): string {
  const base = baseURL.replace(/\/$/, '');
  const p = segment.startsWith('/') ? segment : `/${segment}`;
  return `${base}${p}`;
}

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
};

export async function chat(
  messages: ChatMessage[],
  options?: {
    model?: string;
    tools?: ToolDefinition[];
    providerId?: string;
    projectRoot?: string;
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
  const providerId = options?.providerId ?? 'openai';
  const projectRoot = options?.projectRoot ?? '';

  if (providerId === 'anthropic') {
    return anthropic.chat(messages, {
      model: options?.model,
      tools: options?.tools,
      projectRoot,
      providerId,
      signal: options?.signal,
      sessionId: options?.sessionId,
    });
  }
  if (providerId === 'bedrock') {
    return bedrock.chat(messages, {
      model: options?.model,
      tools: options?.tools,
      projectRoot,
      providerId,
      signal: options?.signal,
      sessionId: options?.sessionId,
    });
  }

  const isOllama = providerId === 'ollama';
  const isRunpod = providerId === 'runpod';
  const env = isOllama
    ? getOllamaEnv(projectRoot)
    : isRunpod
      ? await getRunpodEnvAsync(projectRoot, providerId)
      : await getOpenAIEnvAsync(projectRoot, providerId);
  const baseUrl = env.baseUrl;
  const apiKey = 'apiKey' in env ? (env as { apiKey: string }).apiKey : '';
  const defaultModel = env.model;
  if (!baseUrl) {
    throw new Error(
      isRunpod
        ? 'RunPod: no default pod set for this project. Set one on the RunPod page.'
        : 'OpenAI: no base URL configured.'
    );
  }
  const model = options?.model ?? defaultModel;
  const maxTokens = getContextWindowForModel(projectRoot, providerId, model);
  const body: Record<string, unknown> = {
    model,
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    messages: messages.map((m) => {
      const msg: Record<string, unknown> = {
        role: m.role,
        content: m.content || ' ',
      };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        }));
      }
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      return msg;
    }),
  };
  if (options?.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }

  const requestUrl = getUrl(baseUrl, '/chat/completions');
  const sessionId = options?.sessionId;
  log.debug(
    'chat request',
    ...(sessionId ? ['sessionId:', sessionId] : []),
    'url:',
    requestUrl,
    'provider:',
    providerId,
    'model:',
    model,
    'messages:',
    messages.length,
    'body (truncated):',
    JSON.stringify(body).slice(0, 500)
  );
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(requestUrl, {
    method: 'POST',
    headers,
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
    resText.slice(0, 400)
  );

  if (!res.ok) {
    log.debug('chat response error body', ...(sessionId ? ['sessionId:', sessionId] : []), resText.slice(0, 1000));
    throw new Error(`LLM request failed: ${res.status} ${resText}`);
  }

  let data: OpenAIChatResponse;
  try {
    data = JSON.parse(resText) as OpenAIChatResponse;
  } catch (parseErr) {
    log.debug(
      'chat response JSON parse failed',
      ...(sessionId ? ['sessionId:', sessionId] : []),
      parseErr,
      'raw (truncated):',
      resText.slice(0, 1500)
    );
    throw new Error(`LLM response was not valid JSON: ${String(parseErr)}`);
  }

  log.debug(
    'chat response parsed',
    ...(sessionId ? ['sessionId:', sessionId] : []),
    'choices length:',
    data.choices?.length ?? 0,
    'top-level keys:',
    Object.keys(data)
  );

  const choice = data.choices?.[0];
  const msg = choice?.message;
  if (!msg) {
    log.debug(
      'chat response missing message',
      ...(sessionId ? ['sessionId:', sessionId] : []),
      'choice:',
      choice,
      'data:',
      JSON.stringify(data).slice(0, 800)
    );
    throw new Error('No message in LLM response');
  }

  const tcCount = msg.tool_calls?.length ?? 0;
  const contentPreview = typeof msg.content === 'string' ? msg.content.slice(0, 200) : String(msg.content);
  log.debug(
    'chat response',
    ...(sessionId ? ['sessionId:', sessionId] : []),
    'content length:',
    typeof msg.content === 'string' ? msg.content.length : 0,
    'content preview:',
    contentPreview,
    'toolCalls:',
    tcCount,
    tcCount ? msg.tool_calls!.map((tc) => tc.function.name).join(', ') : ''
  );

  return {
    content: msg.content ?? '',
    toolCalls: msg.tool_calls?.map((tc) => ({
      id: tc.id,
      type: tc.type,
      function: tc.function,
    })),
  };
}
