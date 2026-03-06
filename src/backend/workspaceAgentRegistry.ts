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
 * Registry of workspace agents that have connected via WebSocket.
 * Backend looks up by workspace id to send tool calls and git/codebase requests.
 */

import type { AgentConnection, ToolResult } from '../shared/workspace';
import { createLogger } from '../shared/logger';

const log = createLogger('workspace-agent-registry');

const byWorkspaceId = new Map<string, AgentConnection>();

export function register(workspaceId: string, connection: AgentConnection): void {
  const existing = byWorkspaceId.get(workspaceId);
  if (existing?.close) existing.close();
  byWorkspaceId.set(workspaceId, connection);
  log.debug('workspace agent registered', workspaceId);
}

export function get(workspaceId: string): AgentConnection | undefined {
  return byWorkspaceId.get(workspaceId);
}

export function unregister(workspaceId: string): void {
  if (byWorkspaceId.delete(workspaceId)) {
    log.debug('workspace agent unregistered', workspaceId);
  }
}

/** Create an AgentConnection that sends requests over a WebSocket and waits for responses. */
export function createConnection(send: (payload: unknown) => void): {
  connection: AgentConnection;
  handleMessage: (data: unknown) => void;
} {
  const pending = new Map<string, { resolve: (r: ToolResult) => void }>();
  let closed = false;

  const connection: AgentConnection = {
    async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
      const id = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve) => {
        if (closed) {
          resolve({ error: 'connection closed' });
          return;
        }
        pending.set(id, { resolve });
        send({ type: 'request', id, method: 'executeTool', params: { name, args } });
      });
    },
    close() {
      closed = true;
      for (const { resolve } of pending.values()) {
        resolve({ error: 'connection closed' });
      }
      pending.clear();
    },
  };

  function handleMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const obj = data as { type?: string; id?: string; result?: string; error?: string };
    if (obj.type !== 'response' || !obj.id) return;
    const entry = pending.get(obj.id);
    if (entry) {
      pending.delete(obj.id);
      entry.resolve({ result: obj.result, error: obj.error });
    }
  }

  return { connection, handleMessage };
}
