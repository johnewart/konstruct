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
 * Wrapper for the Claude Agent SDK V2 API (unstable_v2_createSession / unstable_v2_resumeSession).
 * Uses native SDK session persistence so each turn only sends the new user message instead of
 * re-sending full history.
 *
 * Note: The current SDK SessionImpl does not pass mcpServers or hooks into the transport,
 * so V2 sessions do not get Konstruct MCP tools. Use claude_sdk (V1 query) when you need MCP.
 */

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
} from '@anthropic-ai/claude-agent-sdk';

export interface ClaudeSdkV2AgentOptions {
  /** Model id (required for V2). */
  model: string;
  /** Working directory (used by Claude Code process). */
  cwd?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  pathToClaudeCodeExecutable?: string;
  /** Existing SDK session id to resume; omit to create a new session. */
  resumeSessionId?: string;
}

export interface ClaudeSdkV2TurnResult {
  result: string;
  /** SDK session id (store for next turn resume). */
  sdkSessionId: string;
}

/**
 * Send one user message on a new or resumed V2 session and return the assistant result.
 */
export async function runSdkV2Turn(
  userMessage: string,
  options: ClaudeSdkV2AgentOptions
): Promise<ClaudeSdkV2TurnResult> {
  const abortController = new AbortController();
  if (options.signal) {
    options.signal.addEventListener('abort', () => abortController.abort());
  }

  const sessionOptions = {
    model: options.model,
    env: options.env ?? process.env,
    pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
  };

  const session = options.resumeSessionId?.trim()
    ? unstable_v2_resumeSession(options.resumeSessionId.trim(), sessionOptions)
    : unstable_v2_createSession(sessionOptions);

  try {
    await session.send(userMessage);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          return {
            result: msg.result,
            sdkSessionId: session.sessionId,
          };
        }
        const errors = 'errors' in msg ? (msg as { errors?: string[] }).errors : [];
        throw new Error(errors?.length ? errors.join('; ') : 'Query failed');
      }
    }
    throw new Error('Session ended without result');
  } finally {
    try {
      session.close();
    } catch {
      // ignore
    }
  }
}
