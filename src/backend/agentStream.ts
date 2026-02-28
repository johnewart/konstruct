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
 * In-memory state for agent-stream WebSocket: which clients are subscribed to which session,
 * and the worker connection. Used by the WebSocket handler to broadcast progress.
 */
export interface AgentStreamSocket {
  send(payload: string): void;
  readyState: number;
}

const subscribersBySessionId = new Map<string, Set<AgentStreamSocket>>();
let workerSocket: AgentStreamSocket | null = null;

export function addSubscriber(sessionId: string, ws: AgentStreamSocket): void {
  let set = subscribersBySessionId.get(sessionId);
  if (!set) {
    set = new Set();
    subscribersBySessionId.set(sessionId, set);
  }
  set.add(ws);
}

export function removeSubscriber(
  sessionId: string,
  ws: AgentStreamSocket
): void {
  const set = subscribersBySessionId.get(sessionId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) subscribersBySessionId.delete(sessionId);
  }
}

export function setWorker(ws: AgentStreamSocket): void {
  workerSocket = ws;
}

export function clearWorker(ws: AgentStreamSocket): void {
  if (workerSocket === ws) workerSocket = null;
}

export function broadcastToSession(sessionId: string, payload: string): void {
  const set = subscribersBySessionId.get(sessionId);
  if (!set) return;
  for (const ws of set) {
    try {
      if (ws.readyState === 1) ws.send(payload);
    } catch {
      // ignore
    }
  }
}
