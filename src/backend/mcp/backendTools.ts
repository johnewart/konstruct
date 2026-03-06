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
 * Backend tool execution: session store, progress, and future external APIs (GitHub, Jira).
 * These run in the Konstruct server; MCP routes backend tools here and agent tools to the agent process.
 */

import * as sessionStore from '../../shared/sessionStore';
import { isBackendTool } from '../../shared/toolClassification';

/** Minimal progress store interface to avoid importing from runLoop (circular). */
export interface BackendToolProgressStore {
  pushProgress(sessionId: string, entry: { type: 'status' | 'tool'; description?: string }): void;
  updateLastResult(sessionId: string, resultSummary: string): void;
}

export interface BackendToolContext {
  projectRoot: string;
  sessionId?: string;
  progressStore?: BackendToolProgressStore;
}

export interface BackendToolResult {
  result?: string;
  error?: string;
  retryable?: boolean;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function ensureSessionLoaded(sessionId: string, projectRoot: string): string | null {
  const projectId = sessionStore.resolveProjectId(projectRoot);
  const session = sessionStore.getSession(sessionId, projectId);
  return session ? projectId : null;
}

export function runBackendTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BackendToolContext
): BackendToolResult {
  if (!isBackendTool(name)) {
    return { error: `"${name}" is not a backend tool` };
  }

  const sessionId = ctx.sessionId;
  const projectRoot = ctx.projectRoot?.trim() ?? '';
  const progressStore = ctx.progressStore;

  switch (name) {
    case 'set_status': {
      const desc = str(args.description);
      if (!desc) return { error: 'missing description argument' };
      if (progressStore && sessionId) {
        progressStore.pushProgress(sessionId, { type: 'status', description: desc });
      }
      return { result: JSON.stringify({ ok: true, description: desc }) };
    }

    case 'list_todos': {
      if (!sessionId) {
        return { result: '[]\n(no session — todo list empty)' };
      }
      const projectId = sessionStore.resolveProjectId(projectRoot);
      sessionStore.getSession(sessionId, projectId);
      const todos = sessionStore.listTodos(sessionId);
      return { result: JSON.stringify(todos, null, 2) };
    }

    case 'add_todo': {
      const description = str(args.description);
      if (!description) return { error: 'missing description argument' };
      if (!sessionId) return { error: 'no session — cannot add todo' };
      if (!ensureSessionLoaded(sessionId, projectRoot)) return { error: 'session not found' };
      const item = sessionStore.addTodo(sessionId, description);
      if (!item) return { error: 'session not found' };
      return { result: JSON.stringify(item, null, 2) };
    }

    case 'update_todo': {
      const id = str(args.id);
      const status = str(args.status);
      if (!id) return { error: 'missing id argument' };
      if (!status) return { error: 'missing status argument' };
      const valid = ['pending', 'in_progress', 'completed'];
      if (!valid.includes(status)) {
        return { error: `status must be one of: ${valid.join(', ')}` };
      }
      if (!sessionId) return { error: 'no session — cannot update todo' };
      if (!ensureSessionLoaded(sessionId, projectRoot)) return { error: 'session not found' };
      const ok = sessionStore.updateTodo(
        sessionId,
        id,
        status as 'pending' | 'in_progress' | 'completed'
      );
      if (!ok) return { error: 'todo not found' };
      return { result: `Updated todo ${id} to ${status}` };
    }

    case 'update_session_title': {
      const title = str(args.title);
      if (!title || !title.trim()) return { error: 'missing or empty title argument' };
      if (!sessionId) return { error: 'no session — cannot update title' };
      if (!ensureSessionLoaded(sessionId, projectRoot)) return { error: 'session not found' };
      const session = sessionStore.updateSessionTitle(sessionId, title.trim());
      if (!session) return { error: 'session not found' };
      return { result: `Session title updated to: ${session.title}` };
    }

    case 'suggest_relevant_file': {
      const filePath = str(args.path);
      if (!filePath?.trim()) return { error: 'missing path argument' };
      if (!sessionId) return { error: 'no session — cannot suggest file' };
      const session = sessionStore.addSuggestedFile(sessionId, projectRoot, filePath.trim());
      if (!session) return { error: 'session not found' };
      return { result: `Added "${filePath.trim()}" to assistant suggestions.` };
    }

    case 'suggest_improvement': {
      const filePath = str(args.file_path);
      const suggestion = str(args.suggestion);
      if (!filePath?.trim()) return { error: 'missing file_path argument' };
      if (!suggestion?.trim()) return { error: 'missing suggestion argument' };
      if (!sessionId) return { error: 'no session — cannot suggest improvement' };
      const rawLine = args.line_number != null ? Number(args.line_number) : undefined;
      const lineNumber =
        typeof rawLine === 'number' && Number.isFinite(rawLine) && rawLine > 0 ? rawLine : undefined;
      const snippet = args.snippet != null ? str(args.snippet) : undefined;
      const session = sessionStore.addSuggestedImprovement(sessionId, projectRoot, {
        filePath: filePath.trim(),
        lineNumber,
        suggestion: suggestion.trim(),
        snippet: snippet?.trim(),
      });
      if (!session) return { error: 'session not found' };
      return { result: 'Added improvement suggestion for the user.' };
    }

    default:
      return { error: `unknown backend tool: ${name}` };
  }
}
