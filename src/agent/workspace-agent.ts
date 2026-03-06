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
 * Workspace agent process: connects to the backend, registers for a workspace id,
 * and handles executeTool and git/codebase requests. Run with WORKSPACE_ID, PROJECT_ROOT, SERVER_URL.
 */

import WebSocket from 'ws';
import { registerTool, executeTool, getProjectRoot } from './tools/executor';
import './tools/runners';
import * as git from '../backend/git';
import * as path from 'path';
import { runDependencyGraphScan, type ScanProgress } from '../shared/codebaseScan';

const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
const workspaceId = process.env.WORKSPACE_ID ?? projectRoot;
const serverUrl = process.env.SERVER_URL ?? 'http://localhost:3001';
const wsUrl = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/workspace-agent';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function createAgentLogger(send: (payload: unknown) => void) {
  return (level: LogLevel, message: string) => {
    send({
      type: 'log',
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  };
}

let agentLog: ReturnType<typeof createAgentLogger> | null = null;

// Register git operations as tools so backend can call executeTool('getGitDiff', {}) etc.
registerTool('getGitDiff', (_args, ctx) => {
  const root = getProjectRoot(ctx);
  const diff = git.getGitDiff(root);
  return { result: JSON.stringify(diff) };
});
registerTool('getChangedFiles', (_args, ctx) => {
  const root = getProjectRoot(ctx);
  const changes = git.getChangedFiles(root);
  return { result: JSON.stringify(changes) };
});
registerTool('getStagedFilePaths', (_args, ctx) => {
  const root = getProjectRoot(ctx);
  const paths = git.getStagedFilePaths(root);
  return { result: JSON.stringify(paths) };
});
registerTool('getComprehensiveDiffStats', (_args, ctx) => {
  const root = getProjectRoot(ctx);
  const stats = git.getComprehensiveDiffStats(root);
  const obj: Record<string, { added: number; removed: number }> = {};
  for (const [k, v] of stats) obj[k] = v;
  return { result: JSON.stringify(obj) };
});

/** Strip prefix for dependency graph node paths (git root or project root). */
function getStripPrefix(projectRoot: string): string {
  const gitRoot = git.getGitRepoPath(projectRoot);
  let p = path.join(gitRoot ?? projectRoot, '').replace(/\\/g, '/');
  if (!p.endsWith('/')) p += '/';
  return p;
}

let dependencyGraphBuildInProgress = false;

function run(): void {
  const ws = new WebSocket(wsUrl);
  const context = { projectRoot };

  const send = (payload: unknown) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  };

  ws.on('open', () => {
    agentLog = createAgentLogger(send);
    send({ type: 'register', workspaceId });
    agentLog('info', `registered workspace ${workspaceId}`);
  });

  ws.on('message', async (raw: Buffer | string) => {
    let data: unknown;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    const obj = data as { type?: string; id?: string; method?: string; params?: unknown };
    if (obj.type !== 'request' || !obj.id) return;

    const sendResponse = (result?: string, error?: string) => {
      ws.send(JSON.stringify({ type: 'response', id: obj.id, result, error }));
    };

    if (obj.method === 'executeTool') {
      const params = obj.params as { name?: string; args?: Record<string, unknown> } | undefined;
      const name = params?.name;
      const args = params?.args ?? {};
      if (!name) {
        agentLog?.('warn', 'executeTool missing tool name');
        sendResponse(undefined, 'missing tool name');
        return;
      }

      if (name === 'buildDependencyGraph') {
        if (dependencyGraphBuildInProgress) {
          sendResponse(undefined, 'Dependency graph build already in progress');
          return;
        }
        dependencyGraphBuildInProgress = true;
        const stripPrefix = (typeof args.stripPrefix === 'string' ? args.stripPrefix : null) ?? getStripPrefix(projectRoot);
        agentLog?.('info', `Building dependency graph for ${projectRoot}, stripPrefix=${stripPrefix}`);
        const onProgress = (update: ScanProgress) => {
          let payload: Record<string, unknown>;
          switch (update.kind) {
            case 'dir':
              agentLog?.('info', `Scanning directory: ${update.dir} (${update.directoriesScannedSoFar ?? 0} dirs, ${update.filesFound} files so far)`);
              payload = { phase: 'discovering', filesProcessed: update.filesFound, totalFiles: 0, currentDir: update.dir, directoryCount: update.directoriesScannedSoFar };
              break;
            case 'discovery_complete':
              agentLog?.('info', `Discovery complete: ${update.fileCount} files in ${update.directories.length} directories`);
              payload = { phase: 'discovering', filesProcessed: update.fileCount, totalFiles: update.fileCount, directoriesScanned: update.directories, directoryCount: update.directories.length };
              break;
            case 'progress':
              if (update.filesProcessed === 0) {
                agentLog?.('info', `Analysis phase: ${update.phase}, ${update.totalFiles} files total`);
              }
              payload = { phase: update.phase === 'defs' ? 'parsing_defs' : 'parsing_refs', filesProcessed: update.filesProcessed, totalFiles: update.totalFiles };
              break;
            case 'error':
              payload = { phase: 'error', error: update.message };
              break;
            default:
              return;
          }
          send({ type: 'codebase_progress', ...payload });
        };
        try {
          const result = await runDependencyGraphScan(projectRoot, stripPrefix, { onProgress });
          agentLog?.('info', `Dependency graph built: ${result.nodes.length} file nodes, ${result.edges.length} edges${result.truncated ? ' (truncated)' : ''}`);
          sendResponse(JSON.stringify({ nodes: result.nodes, edges: result.edges, truncated: result.truncated }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          onProgress({ kind: 'error', message: msg });
          sendResponse(undefined, msg);
        } finally {
          dependencyGraphBuildInProgress = false;
        }
        return;
      }

      // Log only non-routine tools at debug (skip noisy getChangedFiles / getGitDiff etc.)
      const quietTools = ['getChangedFiles', 'getGitDiff', 'getStagedFilePaths', 'getComprehensiveDiffStats'];
      if (!quietTools.includes(name)) agentLog?.('debug', `executeTool ${name}`);
      try {
        const out = await executeTool(name, args, context);
        if (out.error) agentLog?.('warn', `executeTool ${name} error: ${out.error}`);
        sendResponse(out.error ? undefined : out.result, out.error);
      } catch (err) {
        agentLog?.('error', `executeTool ${name} threw: ${err}`);
        sendResponse(undefined, String(err));
      }
      return;
    }

    agentLog?.('warn', `unknown method: ${obj.method}`);
    sendResponse(undefined, `unknown method: ${obj.method}`);
  });

  ws.on('close', () => {
    agentLog?.('info', 'connection closed');
    process.exit(0);
  });
  ws.on('error', (err: unknown) => {
    if (agentLog) agentLog('error', `WebSocket error: ${err}`);
    process.exit(1);
  });
}

run();
