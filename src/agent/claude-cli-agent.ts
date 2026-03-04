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
 * Wrapper API to invoke the Claude Code CLI as an agent (non-interactive).
 * Spawns the installed `claude` binary with --print and optional agent/model/settings.
 *
 * @example
 * ```ts
 * import { runAgent, invokeClaudeAgent } from './claude-cli-agent';
 *
 * const reply = await runAgent('Explain recursion in one sentence.', { model: 'sonnet' });
 *
 * const result = await invokeClaudeAgent('List files in this dir.', { cwd: '/tmp', agent: 'coder' });
 * console.log(result.stdout);
 * ```
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const DEFAULT_CLAUDE_PATH =
  process.env.CLAUDE_CLI_PATH ??
  (process.env.NVM_BIN ? `${process.env.NVM_BIN}/claude` : 'claude');

export interface ClaudeAgentOptions {
  /** Path to the claude CLI binary. Default: CLAUDE_CLI_PATH env or "claude". */
  claudePath?: string;
  /** Working directory for the agent (e.g. project root for tool access). */
  cwd?: string;
  /** Agent name (--agent). Use a configured agent for the session. */
  agent?: string;
  /** Model override (--model), e.g. "sonnet", "opus", or full model id. */
  model?: string;
  /** System prompt (--system-prompt). */
  systemPrompt?: string;
  /** Extra system prompt appended (--append-system-prompt). */
  appendSystemPrompt?: string;
  /** Effort level: low, medium, high (--effort). */
  effort?: 'low' | 'medium' | 'high';
  /** Additional dirs the agent can access (--add-dir). */
  addDir?: string[];
  /** Allowed tools (--allowed-tools). */
  allowedTools?: string[];
  /** Disallowed tools (--disallowed-tools). */
  disallowedTools?: string[];
  /** Permission mode (--permission-mode). */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'plan';
  /** Max budget in USD (--max-budget-usd). */
  maxBudgetUsd?: number;
  /** Request timeout in ms. No timeout if not set. */
  timeoutMs?: number;
  /** Environment overrides (merged with process.env). */
  env?: NodeJS.ProcessEnv;
  /**
   * Path to an MCP config JSON file (--mcp-config).
   * Use createKonstruktMcpConfig() to generate one that exposes Konstruct tools.
   */
  mcpConfigPath?: string;
}

export interface ClaudeAgentResult {
  /** Full combined stdout. */
  stdout: string;
  /** Full stderr. */
  stderr: string;
  /** Exit code of the claude process. */
  exitCode: number | null;
  /** Whether the process was killed by timeout. */
  timedOut?: boolean;
}

/**
 * Build argv for the claude CLI (--print mode plus optional flags).
 */
function buildArgs(options: ClaudeAgentOptions, promptFromArg?: string): string[] {
  const args: string[] = ['--print', '--no-session-persistence'];

  if (options.agent) args.push('--agent', options.agent);
  if (options.model) args.push('--model', options.model);
  if (options.systemPrompt) args.push('--system-prompt', options.systemPrompt);
  if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt);
  if (options.effort) args.push('--effort', options.effort);
  if (options.permissionMode) args.push('--permission-mode', options.permissionMode);
  if (options.maxBudgetUsd != null) args.push('--max-budget-usd', String(options.maxBudgetUsd));

  if (options.addDir?.length) {
    args.push('--add-dir', ...options.addDir);
  }
  if (options.allowedTools?.length) {
    args.push('--allowed-tools', ...options.allowedTools);
  }
  if (options.disallowedTools?.length) {
    args.push('--disallowed-tools', ...options.disallowedTools);
  }
  if (options.mcpConfigPath) {
    args.push('--mcp-config', options.mcpConfigPath);
  }

  if (promptFromArg) args.push(promptFromArg);

  return args;
}

/**
 * Invoke the Claude CLI as an agent with the given prompt and options.
 * The prompt is passed as the final CLI argument; the process runs with --print and exits with the reply on stdout.
 *
 * @param prompt - User prompt for the agent
 * @param options - Agent and process options (cwd, agent, model, timeout, etc.)
 * @returns Result with stdout, stderr, exitCode (and timedOut if killed by timeout)
 */
export function invokeClaudeAgent(
  prompt: string,
  options: ClaudeAgentOptions = {}
): Promise<ClaudeAgentResult> {
  const claudePath = options.claudePath ?? DEFAULT_CLAUDE_PATH;
  const env = { ...process.env, ...options.env };
  // CLI uses its own auth (e.g. from `claude auth`); do not pass API key so it doesn't try external key mode
  delete env.ANTHROPIC_API_KEY;
  const spawnOpts: SpawnOptions = {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  // Pass prompt via stdin so the CLI receives it (many CLIs read from stdin; avoid ARG_MAX for long prompts)
  const args = buildArgs(options, undefined);
  const promptText = prompt.trim();
  console.log('[claude-cli] spawning:', claudePath, args.map(a => JSON.stringify(a)).join(' '));
  const child = spawn(claudePath, args, spawnOpts);

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    console.log('[claude-cli] stderr:', text.trimEnd());
  });

  // Feed prompt on stdin, then end so the process doesn't wait for more input
  if (promptText && child.stdin?.writable) {
    child.stdin.write(promptText, 'utf8', () => {
      child.stdin?.end();
    });
  } else {
    child.stdin?.end();
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs != null && options.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);
  }

  return new Promise<ClaudeAgentResult>((resolve) => {
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
 * Convenience: run the agent and return only the assistant reply text.
 * Throws if exit code is non-zero or the process errors.
 */
export async function runAgent(
  prompt: string,
  options: ClaudeAgentOptions = {}
): Promise<string> {
  const result = await invokeClaudeAgent(prompt, options);
  if (result.exitCode !== 0) {
    const err = new Error(
      `Claude CLI exited with code ${result.exitCode}${result.stderr ? `: ${result.stderr}` : ''}`
    ) as Error & { result: ClaudeAgentResult };
    err.result = result;
    throw err;
  }
  return result.stdout;
}

/**
 * Write a temporary MCP config JSON that points to Konstruct's MCP server.
 * Pass the returned path as mcpConfigPath in ClaudeAgentOptions so the claude
 * CLI loads Konstruct's tools (read_file, grep, AST outline, etc.).
 *
 * The caller is responsible for deleting the temp file when done.
 *
 * @param projectRoot  Project root passed to the MCP server for path resolution.
 * @param options.mode Konstruct mode whose toolset to expose (default: "ask").
 *                     Use "implementation" to include write/run tools.
 * @param options.serverName  MCP server name in the config (default: "konstruct").
 * @returns Absolute path to the temp config file.
 *
 * @example
 * ```ts
 * const mcpConfig = createKonstruktMcpConfig('/my/project', { mode: 'ask' });
 * try {
 *   const reply = await runAgent('Summarize the auth module', {
 *     cwd: '/my/project',
 *     mcpConfigPath: mcpConfig,
 *     permissionMode: 'bypassPermissions',
 *   });
 *   console.log(reply);
 * } finally {
 *   fs.unlinkSync(mcpConfig);
 * }
 * ```
 */
export function createKonstruktMcpConfig(
  projectRoot: string,
  options?: { mode?: string; serverName?: string; serverUrl?: string }
): string {
  const serverName = options?.serverName ?? 'konstruct';
  const mode = options?.mode ?? 'ask';
  const serverUrl = (options?.serverUrl ?? 'http://localhost:3001').replace(/\/$/, '');

  const mcpUrl = `${serverUrl}/mcp?projectRoot=${encodeURIComponent(projectRoot)}&mode=${encodeURIComponent(mode)}`;

  const config = {
    mcpServers: {
      [serverName]: { url: mcpUrl },
    },
  };

  const tmpFile = path.join(os.tmpdir(), `konstruct-mcp-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2), 'utf-8');
  return tmpFile;
}

export default {
  invokeClaudeAgent,
  runAgent,
  buildArgs,
  createKonstruktMcpConfig,
  DEFAULT_CLAUDE_PATH,
};
