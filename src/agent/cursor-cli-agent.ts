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
 * Invoke the Cursor CLI agent (agent --print) for a single prompt.
 * Spawns the installed `agent` (or `cursor agent`) binary with --print --trust.
 */

import { spawn, type SpawnOptions } from 'node:child_process';

const DEFAULT_CURSOR_AGENT_PATH =
  process.env.CURSOR_AGENT_PATH ?? 'agent';

export interface CursorAgentOptions {
  /** Path to the agent CLI binary. Default: CURSOR_AGENT_PATH env or "agent". */
  cursorPath?: string;
  /** Working directory / workspace for the agent. */
  cwd?: string;
  /** Model override (--model). */
  model?: string;
  /** Run in read-only Q&A mode (--mode ask). */
  modeAsk?: boolean;
  /** Request timeout in ms. No timeout if not set. */
  timeoutMs?: number;
  /** Environment overrides (e.g. CURSOR_API_KEY from secret_ref). */
  env?: NodeJS.ProcessEnv;
}

export interface CursorAgentResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut?: boolean;
}

function buildArgs(options: CursorAgentOptions, prompt: string): string[] {
  const args: string[] = ['--print', '--trust'];
  if (options.cwd?.trim()) {
    args.push('--workspace', options.cwd.trim());
  }
  if (options.model?.trim()) {
    args.push('--model', options.model.trim());
  }
  if (options.modeAsk) {
    args.push('--mode', 'ask');
  }
  if (prompt.trim()) {
    args.push(prompt.trim());
  }
  return args;
}

/**
 * Invoke the Cursor CLI agent with the given prompt.
 * Uses --print --trust; prompt is passed as the final argument.
 */
export function invokeCursorAgent(
  prompt: string,
  options: CursorAgentOptions = {}
): Promise<CursorAgentResult> {
  const agentPath = options.cursorPath ?? DEFAULT_CURSOR_AGENT_PATH;
  const env = { ...process.env, ...options.env };
  const spawnOpts: SpawnOptions = {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  const args = buildArgs(options, prompt);
  const child = spawn(agentPath, args, spawnOpts);

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs != null && options.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);
  }

  return new Promise<CursorAgentResult>((resolve) => {
    child.on('close', (code, signal) => {
      if (timeoutId) clearTimeout(timeoutId);
      const timedOut = signal === 'SIGTERM' && options.timeoutMs != null;
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        timedOut: timedOut || undefined,
      });
    });
    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      stderr += (err?.message ?? String(err)) + '\n';
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: null,
      });
    });
  });
}

/**
 * Run the Cursor agent and return only the assistant reply text.
 * Throws if exit code is non-zero or the process errors.
 */
export async function runCursorAgent(
  prompt: string,
  options: CursorAgentOptions = {}
): Promise<string> {
  const result = await invokeCursorAgent(prompt, options);
  if (result.exitCode !== 0) {
    const err = new Error(
      `Cursor agent exited with code ${result.exitCode}${result.stderr ? `: ${result.stderr}` : ''}`
    ) as Error & { result: CursorAgentResult };
    (err as Error & { result: CursorAgentResult }).result = result;
    throw err;
  }
  return result.stdout;
}
