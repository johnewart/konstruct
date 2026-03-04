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
}

/**
 * Run a single prompt through the Claude Agent SDK and return the final text result.
 * Consumes the query async generator until a result message is received.
 *
 * @param prompt - User prompt (and optionally conversation history as formatted text).
 * @param options - cwd, model, env (omit ANTHROPIC_API_KEY for keyless), signal, pathToClaudeCodeExecutable, timeoutMs.
 * @returns The assistant reply text on success.
 */
export async function runSdkQuery(
  prompt: string,
  options: ClaudeSdkAgentOptions = {}
): Promise<string> {
  const abortController = new AbortController();
  const timeoutMs = options.timeoutMs ?? 300_000;

  const timeoutId =
    timeoutMs > 0
      ? setTimeout(() => abortController.abort(), timeoutMs)
      : undefined;

  if (options.signal) {
    options.signal.addEventListener('abort', () => abortController.abort());
  }

  const sdkOptions: Parameters<typeof query>[0]['options'] = {
    cwd: options.cwd ?? process.cwd(),
    model: options.model,
    env: options.env ?? process.env,
    abortController,
    pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
  };

  const q = query({ prompt, options: sdkOptions });

  try {
    for await (const msg of q) {
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          return msg.result;
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
