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
 * Spawns the installed `agent` (or `cursor agent`) binary with --print --trust --approve-mcps.
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import { createLogger } from '../shared/logger';

const log = createLogger('cursor-agent');

const DEFAULT_CURSOR_AGENT_PATH =
  process.env.CURSOR_AGENT_PATH ?? 'agent';

/** Cursor API hosts that must not go through HTTP_PROXY (so Cursor's own API calls work). Merge into NO_PROXY when spawning the agent. */
const CURSOR_NO_PROXY_HOSTS = 'api.cursor.sh,api1.cursor.sh,api2.cursor.sh';

function mergeNoProxy(env: NodeJS.ProcessEnv): void {
  const existing = [env.NO_PROXY, env.no_proxy].filter(Boolean).join(',').split(',').map((s) => s.trim()).filter(Boolean);
  const combined = [...new Set([...existing, ...CURSOR_NO_PROXY_HOSTS.split(',')])].join(',');
  env.NO_PROXY = combined;
  env.no_proxy = combined;
}

export interface CursorAgentOptions {
  /** Path to the agent CLI binary. Default: CURSOR_AGENT_PATH env or "agent". */
  cursorPath?: string;
  /** Working directory / workspace for the agent. */
  cwd?: string;
  /** Model override (--model). */
  model?: string;
  /** Session id for --resume so the CLI uses the correct session context. */
  sessionId?: string;
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
  const args: string[] = ['--print', '--trust', '--approve-mcps'];
  if (options.cwd?.trim()) {
    args.push('--workspace', options.cwd.trim());
  }
  if (options.model?.trim()) {
    args.push('--model', options.model.trim());
  }
  if (options.sessionId?.trim()) {
    args.push('--resume', options.sessionId.trim());
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
 * Uses --print --trust --approve-mcps; prompt is passed as the final argument.
 */
export function invokeCursorAgent(
  prompt: string,
  options: CursorAgentOptions = {}
): Promise<CursorAgentResult> {
  const agentPath = options.cursorPath ?? DEFAULT_CURSOR_AGENT_PATH;
  const env = { ...process.env, ...options.env };
  mergeNoProxy(env);
  const spawnOpts: SpawnOptions = {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  const args = buildArgs(options, prompt);
  const cwd = spawnOpts.cwd ?? process.cwd();
  log.debug('cursor agent: binary', agentPath, 'cwd', cwd, 'args', args.slice(0, -1), 'promptLength', typeof prompt === 'string' ? prompt.length : 0);
  if (options.env && Object.keys(options.env).length > 0) {
    const envKeys = Object.keys(options.env).filter((k) => k.startsWith('CURSOR_') || k.startsWith('KONSTRUCT_'));
    if (envKeys.length) log.debug('cursor agent: env overrides', envKeys);
  }
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

export interface CursorModel {
  id: string;
  name: string;
}

/**
 * Run the Cursor CLI with --list-models and parse the output.
 * Returns a list of models; on failure returns empty list and does not throw.
 */
export async function listCursorModels(
  options: CursorAgentOptions & { cursorPath?: string } = {}
): Promise<CursorModel[]> {
  const agentPath = options.cursorPath ?? DEFAULT_CURSOR_AGENT_PATH;
  const env = { ...process.env, ...options.env };
  mergeNoProxy(env);
  const spawnOpts: SpawnOptions = {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  const child = spawn(agentPath, ['--list-models'], spawnOpts);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const result = await new Promise<CursorAgentResult>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      });
    });
    child.on('error', (err) => {
      resolve({
        stdout: stdout.trim(),
        stderr: (err?.message ?? String(err)) + (stderr ? `\n${stderr}` : ''),
        exitCode: null,
      });
    });
  });

  if (result.exitCode !== 0) {
    return [];
  }

  const text = result.stdout;
  if (!text) return [];

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((m): m is { id?: string; name?: string } => m != null && typeof m === 'object')
        .map((m) => ({
          id: String(m.id ?? m.name ?? '').trim() || 'default',
          name: String(m.name ?? m.id ?? '').trim() || 'default',
        }))
        .filter((m) => m.id);
    }
    const obj = parsed as Record<string, unknown>;
    const arr = obj.models ?? obj.list;
    if (Array.isArray(arr)) {
      return arr
        .filter((m): m is string | { id?: string; name?: string } => m != null)
        .map((m) =>
          typeof m === 'string'
            ? { id: m.trim(), name: m.trim() }
            : {
                id: String((m as { id?: string; name?: string }).id ?? (m as { id?: string; name?: string }).name ?? '').trim() || 'default',
                name: String((m as { id?: string; name?: string }).name ?? (m as { id?: string; name?: string }).id ?? '').trim() || 'default',
              }
        )
        .filter((m) => m.id);
    }
  } catch {
    // Not JSON: parse plain-text output (skip header, strip " - display name", filter blank and Tip line)
  }
  const lines = text.split(/\r?\n/);
  const skipLeading = 2;
  const modelLines = lines
    .slice(skipLeading)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('Tip'));
  return modelLines.map((line) => {
    const dashIdx = line.indexOf(' -');
    const id = (dashIdx >= 0 ? line.slice(0, dashIdx) : line).trim();
    const name = (dashIdx >= 0 ? line.slice(dashIdx + 2).trim() : line).trim() || id;
    return { id: id || 'default', name: name || id };
  }).filter((m) => m.id);
}
