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

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Workspace, AgentConnection } from '../../shared/workspace';
import * as registry from '../workspaceAgentRegistry';
import { createLogger } from '../../shared/logger';

const log = createLogger('LocalWorkspace');

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';
const WAIT_MS = 15_000;

/** Pending spawn promise per workspace id so concurrent getOrSpawnAgent() calls only spawn once. */
const spawnByWorkspaceId = new Map<string, Promise<AgentConnection>>();

export class LocalWorkspace implements Workspace {
  readonly id: string;
  readonly type = 'local' as const;
  private readonly path: string;

  constructor(id: string, projectPath: string) {
    this.id = id;
    this.path = path.resolve(projectPath);
  }

  getLocalPath(): string | null {
    return this.path;
  }

  async getOrSpawnAgent(): Promise<AgentConnection> {
    const existing = registry.get(this.id);
    if (existing) return existing;

    const pending = spawnByWorkspaceId.get(this.id);
    if (pending) return pending;

    const promise = this.spawnAgent();
    spawnByWorkspaceId.set(this.id, promise);
    try {
      const conn = await promise;
      return conn;
    } finally {
      spawnByWorkspaceId.delete(this.id);
    }
  }

  private spawnAgent(): Promise<AgentConnection> {
    const cwd = process.cwd();
    const bundlePath = path.join(cwd, 'dist', 'workspace-agent.js');
    const sourcePath = path.join(cwd, 'src', 'agent', 'workspace-agent.ts');
    const devMode = process.env.KONSTRUCT_WORKSPACE_AGENT_DEV === '1' || process.env.KONSTRUCT_WORKSPACE_AGENT_DEV === 'true';
    const useBundle = !devMode && fs.existsSync(bundlePath);

    const scriptPath = useBundle ? bundlePath : sourcePath;
    const node = process.execPath;
    const args = useBundle ? [scriptPath] : ['--import', 'tsx', scriptPath];

    const child = spawn(
      node,
      args,
      {
        env: {
          ...process.env,
          WORKSPACE_ID: this.id,
          PROJECT_ROOT: this.path,
          SERVER_URL: SERVER_URL,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    return new Promise<AgentConnection>((resolve, reject) => {
      const failTimeout = setTimeout(() => {
        clearInterval(interval);
        if (!registry.get(this.id)) {
          child.kill();
          registry.unregister(this.id);
          reject(new Error(`Workspace agent for ${this.id} did not register within ${WAIT_MS}ms`));
        }
      }, WAIT_MS);

      const interval = setInterval(() => {
        const conn = registry.get(this.id);
        if (conn) {
          clearInterval(interval);
          clearTimeout(failTimeout);
          resolve(conn);
        }
      }, 100);

      child.on('error', (err) => {
        clearInterval(interval);
        clearTimeout(failTimeout);
        reject(err);
      });
      child.on('exit', (code) => {
        clearInterval(interval);
        if (code !== 0 && !registry.get(this.id)) {
          clearTimeout(failTimeout);
          reject(new Error(`Workspace agent exited ${code}: ${stderr}`));
        }
      });
    });
  }
}
