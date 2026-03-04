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
 * In-memory store for live run progress (tool calls during sendMessage).
 * Cleared when the run finishes. Frontend polls getRunProgress while sending.
 */

export interface RunProgressEntry {
  type: 'status' | 'tool';
  description?: string;
  toolName?: string;
  resultSummary?: string;
  pending?: boolean;
}

const progressBySession = new Map<string, RunProgressEntry[]>();
const runningBySession = new Map<string, boolean>();

export function setRunning(sessionId: string, running: boolean): void {
  if (running) runningBySession.set(sessionId, true);
  else runningBySession.delete(sessionId);
}

export function isRunning(sessionId: string): boolean {
  return runningBySession.get(sessionId) === true;
}

export function clearProgress(sessionId: string): void {
  progressBySession.delete(sessionId);
  runningBySession.delete(sessionId);
}

export function getProgress(sessionId: string): RunProgressEntry[] {
  return progressBySession.get(sessionId) ?? [];
}

export function pushProgress(sessionId: string, entry: RunProgressEntry): void {
  let list = progressBySession.get(sessionId);
  if (!list) {
    list = [];
    progressBySession.set(sessionId, list);
  }
  list.push(entry);
}

export function updateLastResult(
  sessionId: string,
  resultSummary: string
): void {
  const list = progressBySession.get(sessionId);
  if (!list?.length) return;
  const last = list[list.length - 1];
  last.resultSummary = resultSummary;
  last.pending = false;
}

/** Update the most recent entry with type 'status' (e.g. streaming thinking). Leaves tool entries unchanged. */
export function updateLastStatusResult(
  sessionId: string,
  resultSummary: string
): void {
  const list = progressBySession.get(sessionId);
  if (!list?.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === 'status') {
      list[i].resultSummary = resultSummary;
      return;
    }
  }
}

const STREAMING_THINKING_TOOL_NAME = 'Thinking';

/** Update the most recent entry with toolName 'Thinking' (streaming assistant text). Used so thinking appears like a tool in the UI. */
export function updateLastThinkingEntry(
  sessionId: string,
  description: string,
  resultSummary: string
): void {
  const list = progressBySession.get(sessionId);
  if (!list?.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.type === 'tool' && e.toolName === STREAMING_THINKING_TOOL_NAME) {
      e.description = description;
      e.resultSummary = resultSummary;
      return;
    }
  }
}
