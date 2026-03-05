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

import { loadConfig, getProviderById, resolveProviderSecret } from './config';
import { getOpenAIEnvAsync, getRunpodEnvAsync, getOllamaEnv, getContextWindowForModel, getClaudeSdkPath } from './providers';
import * as anthropic from './anthropic';
import * as bedrock from './bedrock';
import { runSdkQuery, type McpProgressStore } from '../agent/claude-sdk-agent';
import * as fs from 'node:fs';
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

const DEBUG_LLM_TRUNCATE = 1000;

function isDebugLlm(): boolean {
  const v = process.env.DEBUG_LLM;
  return v === '1' || v === 'true' || v === 'full';
}

function isDebugLlmFull(): boolean {
  return process.env.DEBUG_LLM === 'full';
}

function debugLlmTruncate(s: string | undefined): string {
  if (s == null) return '';
  if (isDebugLlmFull()) return s;
  if (s.length <= DEBUG_LLM_TRUNCATE) return s;
  return s.slice(0, DEBUG_LLM_TRUNCATE) + '\n... [truncated ' + (s.length - DEBUG_LLM_TRUNCATE) + ' chars]';
}

let _debugLlmLoggedOnce = false;
function debugLlmLogRequest(messages: ChatMessage[], opts: { providerId: string; model?: string; projectRoot?: string; sessionId?: string }): void {
  if (!isDebugLlm()) return;
  if (!_debugLlmLoggedOnce) {
    _debugLlmLoggedOnce = true;
    console.log('[DEBUG_LLM] enabled (DEBUG_LLM=' + process.env.DEBUG_LLM + ')');
  }
  console.log('[DEBUG_LLM] request', opts);
  messages.forEach((m, i) => {
    console.log(`[DEBUG_LLM] message ${i} role=${m.role}`, {
      contentLength: m.content?.length,
      content: debugLlmTruncate(m.content),
      toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      toolCallId: m.toolCallId,
    });
  });
}

function debugLlmLogResponse(res: { content?: string; toolCalls?: unknown; toolCallHistory?: unknown }): void {
  if (!isDebugLlm()) return;
  console.log('[DEBUG_LLM] response', {
    contentLength: res.content?.length,
    content: debugLlmTruncate(res.content),
    toolCalls: res.toolCalls,
    toolCallHistory: res.toolCallHistory,
  });
}

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
    /** When set with sessionId, MCP tool use (claude_sdk) is pushed here for the UI. */
    progressStore?: McpProgressStore;
    /** SDK request timeout in ms. 0 = no timeout. Override via KONSTRUCT_SDK_TIMEOUT_MS env. */
    timeoutMs?: number;
    /** Called after each MCP tool result so the run loop can persist to the transcript immediately. */
    onMcpToolComplete?: (toolCallHistory: Array<{ id: string; name: string; arguments: string; result: string }>) => void;
  }
): Promise<{
  content: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  /** When set (e.g. claude_sdk MCP), persist as assistant + tool messages for the work log. */
  toolCallHistory?: Array<{ id: string; name: string; arguments: string; result: string }>;
}> {
  const providerId = options?.providerId ?? 'openai';
  const projectRoot = options?.projectRoot ?? '';

  let provider: { type?: string } | undefined;
  try {
    const config = projectRoot ? loadConfig(projectRoot) : { providers: [] as Array<{ id?: string; type?: string }> };
    provider = providerId ? getProviderById(config, providerId) : undefined;
  } catch (e) {
    log.warn('Could not load config for provider lookup', e);
  }
  const isBedrock = (provider?.type?.toLowerCase() === 'bedrock') || (providerId === 'bedrock');
  const isClaudeSdk = (provider?.type?.toLowerCase() === 'claude_sdk') || (providerId === 'claude_sdk');

  debugLlmLogRequest(messages, {
    providerId,
    model: options?.model,
    projectRoot: projectRoot || undefined,
    sessionId: options?.sessionId,
  });

  if (isClaudeSdk) {
    const prompt = messages
      .map((m) => {
        if (m.role === 'system') return `[System]\n${m.content}`;
        if (m.role === 'user') return `[User]\n${m.content}`;
        if (m.role === 'assistant') return `[Assistant]\n${m.content}`;
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
    const apiKey =
      (await resolveProviderSecret(projectRoot, providerId)) ??
      (typeof process !== 'undefined' && process.env?.ANTHROPIC_API_KEY) ??
      '';
    const env = { ...process.env } as Record<string, string | undefined>;
    if (!apiKey) delete env.ANTHROPIC_API_KEY;
    else env.ANTHROPIC_API_KEY = apiKey;
    const sdkPath = getClaudeSdkPath(projectRoot, providerId);
    const defaultModel = (provider as { default_model?: string } | undefined)?.default_model;
    const requestedModel = options?.model ?? defaultModel;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedModel ?? '');
    const model = !requestedModel || requestedModel === 'default' || isUuid ? undefined : requestedModel;
    const cwd = projectRoot || undefined;
    const mcpBaseUrl =
      (typeof process !== 'undefined' && process.env?.KONSTRUCT_MCP_BASE_URL) ?? 'http://localhost:3001';
    const mcpServers: Record<string, { type: 'sse'; url: string }> =
      cwd
        ? {
            konstruct: {
              type: 'sse',
              url: `${mcpBaseUrl.replace(/\/$/, '')}/mcp?projectRoot=${encodeURIComponent(cwd)}&mode=implementation${options?.sessionId ? `&konstructSessionId=${encodeURIComponent(options.sessionId)}` : ''}`,
            },
          }
        : {};
    const sdkTimeoutMs =
      options?.timeoutMs ??
      (typeof process !== 'undefined' && process.env.KONSTRUCT_SDK_TIMEOUT_MS
        ? parseInt(process.env.KONSTRUCT_SDK_TIMEOUT_MS, 10)
        : 0);
    const { result, toolCallHistory } = await runSdkQuery(prompt, {
      cwd,
      model,
      env,
      signal: options?.signal,
      pathToClaudeCodeExecutable: sdkPath,
      timeoutMs: Number.isNaN(sdkTimeoutMs) ? 0 : sdkTimeoutMs,
      mcpServers: Object.keys(mcpServers).length ? mcpServers : undefined,
      bypassPermissions: Object.keys(mcpServers).length > 0,
      sessionId: options?.sessionId,
      progressStore: options?.progressStore,
      onMcpToolComplete: options?.onMcpToolComplete,
    });
    const sdkRes = { content: result, toolCalls: undefined, toolCallHistory };
    debugLlmLogResponse(sdkRes);
    return sdkRes;
  }

  if (providerId === 'anthropic') {
    const anthropicRes = await anthropic.chat(messages, {
      model: options?.model,
      tools: options?.tools,
      projectRoot,
      providerId,
      signal: options?.signal,
      sessionId: options?.sessionId,
    });
    debugLlmLogResponse(anthropicRes);
    return anthropicRes;
  }
  if (isBedrock) {
    const bedrockRes = await bedrock.chat(messages, {
      model: options?.model,
      tools: options?.tools,
      projectRoot,
      providerId,
      signal: options?.signal,
      sessionId: options?.sessionId,
    });
    debugLlmLogResponse(bedrockRes);
    return bedrockRes;
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

  const openaiRes = {
    content: msg.content ?? '',
    toolCalls: msg.tool_calls?.map((tc) => ({
      id: tc.id,
      type: tc.type,
      function: tc.function,
    })),
  };
  debugLlmLogResponse(openaiRes);
  return openaiRes;
}
