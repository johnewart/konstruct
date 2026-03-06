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
 * Workspace abstraction: local path, VM, or container. All workspace-bound operations
 * (git, files, dependency graph, agent tools) go through the workspace's agent.
 */

export interface ToolResult {
  result?: string;
  error?: string;
  retryable?: boolean;
}

/** Connection to a workspace agent; used to run tools and git/codebase operations. */
export interface AgentConnection {
  executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** Optional: close/release the connection. */
  close?(): void;
}

export type WorkspaceType = 'local' | 'vm' | 'container';

export interface Workspace {
  readonly id: string;
  readonly type: WorkspaceType;

  /** Resolve an agent connection: spawn if needed (local), or attach to existing (vm/container). */
  getOrSpawnAgent(): Promise<AgentConnection>;

  /** Local path when type === 'local'; null for remote workspaces. */
  getLocalPath(): string | null;
}
