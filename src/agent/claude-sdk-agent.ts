/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use it except in compliance with the License.
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
 * Wrapper for the Claude Agent SDK (V1) query() API. Runs the Claude Code agent
 * in-process via the SDK instead of spawning the CLI. Supports keyless auth
 * (Claude Code's own auth, e.g. from `claude auth`) when ANTHROPIC_API_KEY is
 * not passed in env.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

/** MCP server config for the SDK (e.g. SSE or HTTP). */
export type McpServerConfig =
  | { type: 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> };

/** Minimal progress store so MCP tool use and streaming status can be shown in the UI (same shape as runProgressStore). */
export interface McpProgressStore {
  pushProgress(
    sessionId: string,
    entry: {
      type: 'status' | 'tool';
      description?: string;
      toolName?: string;
      resultSummary?: string;
      pending?: boolean;
    }
  ): void;
  updateLastResult(sessionId: string, resultSummary: string): void;
  /** When set, updates only the most recent status entry (for streaming). Avoids overwriting tool entries. */
  updateLastStatusResult?(sessionId: string, resultSummary: string): void;
  /** When set, updates the most recent "Thinking" tool entry so streaming appears like a tool call. */
  updateLastThinkingEntry?(sessionId: string, description: string, resultSummary: string): void;
}

function shortToolDescription(toolName: string, toolInput: unknown): string {
  if (toolInput == null) return toolName;
  try {
    const obj = typeof toolInput === 'object' ? toolInput as Record<string, unknown> : { value: toolInput };
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (parts.length >= 2) break;
      if (v === undefined || v === null) continue;
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      parts.push(`${k}=${s.length > 30 ? s.slice(0, 27) + '…' : s}`);
    }
    return parts.length ? `${toolName}(${parts.join(', ')})` : toolName;
  } catch {
    return toolName;
  }
}

function toolResponseToSummary(toolResponse: unknown): string {
  if (toolResponse == null) return '';
  try {
    const o = toolResponse as Record<string, unknown>;
    const content = o.content as Array<{ type?: string; text?: string }> | undefined;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0];
      if (first?.type === 'text' && typeof first.text === 'string') {
        const t = first.text;
        return t.length > 80 ? t.slice(0, 77) + '…' : t;
      }
    }
    const s = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  } catch {
    return '';
  }
}

/** Extract streaming text from an SDK stream event (e.g. content_block_delta with text). */
function textFromStreamEvent(event: unknown): string {
  if (event == null || typeof event !== 'object') return '';
  const e = event as Record<string, unknown>;
  if (e.type === 'content_block_delta' && e.delta && typeof e.delta === 'object') {
    const delta = e.delta as Record<string, unknown>;
    if (delta.type === 'text_delta' && typeof delta.text === 'string') return delta.text;
    if (delta.type === 'text' && typeof delta.text === 'string') return delta.text;
  }
  return '';
}

/** Full result text for storing in session (tool message content). */
function toolResponseToResultString(toolResponse: unknown): string {
  if (toolResponse == null) return '';
  try {
    const o = toolResponse as Record<string, unknown>;
    const content = o.content as Array<{ type?: string; text?: string }> | undefined;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0];
      if (first?.type === 'text' && typeof first.text === 'string') return first.text;
    }
    return typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);
  } catch {
    return '';
  }
}

export type ToolCallHistoryEntry = {
  id: string;
  name: string;
  arguments: string;
  result: string;
};

export interface ClaudeSdkAgentOptions {
  /** Working directory for the agent (e.g. project root). */
  cwd?: string;
  /** Model override (e.g. claude-sonnet-4-5-20250929). */
  model?: string;
  /** Environment variables. Omit ANTHROPIC_API_KEY to use Claude Code's own auth. */
  env?: Record<string, string | undefined>;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Path to Claude Code executable; uses SDK default if unset. */
  pathToClaudeCodeExecutable?: string;
  /** Request timeout in ms. Kills the query if exceeded. */
  timeoutMs?: number;
  /** MCP servers to attach (e.g. Konstruct backend for read_file, grep, etc.). */
  mcpServers?: Record<string, McpServerConfig>;
  /** When true, set permissionMode to bypassPermissions so MCP tools run without prompting. Use when attaching trusted servers (e.g. Konstruct). */
  bypassPermissions?: boolean;
  /** When set with sessionId, PreToolUse/PostToolUse hooks push MCP tool use into this store so the UI can show them. */
  sessionId?: string;
  progressStore?: McpProgressStore;
}

/**
 * Run a single prompt through the Claude Agent SDK and return the final text result.
 * Consumes the query async generator until a result message is received.
 * When progressStore/sessionId are set, also returns toolCallHistory for persisting in the work log.
 *
 * @param prompt - User prompt (and optionally conversation history as formatted text).
 * @param options - cwd, model, env (omit ANTHROPIC_API_KEY for keyless), signal, pathToClaudeCodeExecutable, timeoutMs, sessionId, progressStore.
 * @returns The assistant reply and optional tool call history.
 */
export async function runSdkQuery(
  prompt: string,
  options: ClaudeSdkAgentOptions = {}
): Promise<{ result: string; toolCallHistory?: ToolCallHistoryEntry[] }> {
  const abortController = new AbortController();
  const timeoutMs = options.timeoutMs ?? 300_000;

  const timeoutId =
    timeoutMs > 0
      ? setTimeout(() => abortController.abort(), timeoutMs)
      : undefined;

  if (options.signal) {
    options.signal.addEventListener('abort', () => abortController.abort());
  }

  const { sessionId, progressStore } = options;
  const useProgress = sessionId && progressStore;
  const toolCallHistory: ToolCallHistoryEntry[] = [];

  const sdkOptions: Parameters<typeof query>[0]['options'] = {
    cwd: options.cwd ?? process.cwd(),
    model: options.model,
    env: options.env ?? process.env,
    abortController,
    pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
    mcpServers: options.mcpServers,
    /** Allow only WebFetch and WebSearch; all other built-in tools (Read, Edit, Bash, etc.) are disabled. Konstruct MCP tools are unchanged. */
    tools: ['WebFetch', 'WebSearch'],
    /** Emit partial assistant messages so we can stream status to the UI. */
    ...(useProgress ? { includePartialMessages: true } : {}),
    ...(options.bypassPermissions
      ? {
          permissionMode: 'bypassPermissions' as const,
          allowDangerouslySkipPermissions: true,
        }
      : {}),
    ...(useProgress
      ? {
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async (input: {
                    hook_event_name?: string;
                    tool_name?: string;
                    tool_input?: unknown;
                    tool_use_id?: string;
                  }) => {
                    if (input.hook_event_name === 'PreToolUse' && input.tool_name && sessionId && progressStore) {
                      const desc = shortToolDescription(input.tool_name, input.tool_input);
                      progressStore.pushProgress(sessionId, {
                        type: 'tool',
                        toolName: input.tool_name,
                        description: desc,
                        pending: true,
                      });
                    }
                    if (input.hook_event_name === 'PreToolUse' && input.tool_name && input.tool_use_id) {
                      toolCallHistory.push({
                        id: input.tool_use_id,
                        name: input.tool_name,
                        arguments: JSON.stringify(input.tool_input ?? {}),
                        result: '',
                      });
                    }
                    return { continue: true };
                  },
                ],
              },
            ],
            PostToolUse: [
              {
                hooks: [
                  async (input: {
                    hook_event_name?: string;
                    tool_name?: string;
                    tool_response?: unknown;
                    tool_use_id?: string;
                  }) => {
                    if (
                      input.hook_event_name === 'PostToolUse' &&
                      sessionId &&
                      progressStore
                    ) {
                      const summary = toolResponseToSummary(input.tool_response);
                      if (summary) progressStore.updateLastResult(sessionId, summary);
                    }
                    if (input.hook_event_name === 'PostToolUse' && input.tool_use_id) {
                      const entry = toolCallHistory.find((e) => e.id === input.tool_use_id);
                      if (entry) entry.result = toolResponseToResultString(input.tool_response);
                    }
                    return { continue: true };
                  },
                ],
              },
            ],
          },
        }
      : {}),
  };

  const q = query({ prompt, options: sdkOptions });

  let streamedText = '';
  let streamStatusPushed = false;

  try {
    for await (const msg of q) {
      if (msg.type === 'stream_event') {
        const text = textFromStreamEvent((msg as { event?: unknown }).event);
        if (text && sessionId && progressStore) {
          if (!streamStatusPushed) {
            progressStore.pushProgress(sessionId, {
              type: 'tool',
              toolName: 'Thinking',
              description: '',
              pending: true,
            });
            streamStatusPushed = true;
          }
          streamedText += text;
          const full = streamedText.trim();
          const oneLine = full.replace(/\s+/g, ' ').trim().slice(0, 120);
          const description = oneLine ? `text=${oneLine}${oneLine.length >= 120 ? '…' : ''}` : '';
          if (progressStore.updateLastThinkingEntry) {
            progressStore.updateLastThinkingEntry(sessionId, description, full);
          } else if (progressStore.updateLastStatusResult) {
            progressStore.updateLastStatusResult(sessionId, full.slice(-2000));
          } else {
            progressStore.updateLastResult(sessionId, full.slice(-2000));
          }
        }
        continue;
      }
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          return {
            result: msg.result,
            toolCallHistory: useProgress && toolCallHistory.length > 0 ? toolCallHistory : undefined,
          };
        }
        const errors = 'errors' in msg ? msg.errors : [];
        throw new Error(errors.length ? errors.join('; ') : 'Query failed');
      }
    }
    throw new Error('No result from query');
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (typeof (q as { close?: () => void }).close === 'function') {
      (q as { close: () => void }).close();
    }
  }
}
