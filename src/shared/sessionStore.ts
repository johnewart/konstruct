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

import * as fs from 'fs';
import * as path from 'path';
import {
  getGlobalConfigDir,
  getProjectIdForRoot,
  getActiveProjectRoot,
  getActiveProjectId,
} from './config.ts';
import { createLogger } from './logger.ts';

const log = createLogger('sessionStore');

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
  /** Which LLM provider generated this message (set on assistant messages). */
  providerId?: string;
}

export interface TodoItem {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** One improvement suggestion from the review agent (file + optional line + text + optional code snippet). */
export interface SuggestedImprovement {
  filePath: string;
  lineNumber?: number;
  suggestion: string;
  snippet?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
  todos: TodoItem[];
  /** File paths the assistant suggested as relevant to the review (e.g. on PR page). */
  suggestedFiles?: string[];
  /** Improvement suggestions from the review agent (file, line, suggestion text, optional snippet). */
  suggestedImprovements?: SuggestedImprovement[];
  /**
   * Tracks how many messages in `messages[]` have been sent to each provider.
   * Used by sliced providers (claude_sdk, cursor) to avoid re-sending full history.
   * Key: providerId, Value: message count already sent.
   */
  providerMessageCursors?: Record<string, number>;
  /**
   * Provider session id per provider (for resume). Cursor = Konstruct session id; claude_v2 = SDK id.
   */
  providerSessionIds?: Record<string, string>;
  /** @deprecated Use providerSessionIds. Migrated on load. */
  sdkSessionIds?: Record<string, string>;
}

/**
 * Resolve project id from a project root path (for organizing session files).
 * Uses active project id when root matches, else path lookup.
 */
export function resolveProjectId(projectRoot: string): string {
  const root = projectRoot?.trim() || '';
  if (root) {
    const activeRoot = getActiveProjectRoot();
    if (
      activeRoot &&
      path.resolve(root) === path.resolve(activeRoot)
    ) {
      const activeId = getActiveProjectId();
      if (activeId) return activeId;
    }
  }
  return getProjectIdForRoot(root) ?? '_default';
}

/** Global map: session ID -> { session, projectId, ephemeral? }. Ephemeral sessions are never persisted. */
const sessionById = new Map<string, { session: Session; projectId: string; ephemeral?: boolean }>();

function getSessionFilePathForProject(sessionId: string, projectId: string): string {
  return path.join(
    getGlobalConfigDir(),
    'projects',
    projectId,
    'sessions',
    `${sessionId}.json`
  );
}

/** Session shape for JSON (dates as ISO strings). */
type SessionSerialized = Omit<Session, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

function toValidDate(value: unknown): Date {
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function serialize(s: Session): SessionSerialized {
  return {
    ...s,
    createdAt: toValidDate(s.createdAt).toISOString(),
    updatedAt: toValidDate(s.updatedAt).toISOString(),
  };
}

function deserialize(raw: SessionSerialized): Session {
  const ext = raw as SessionSerialized & {
    suggestedFiles?: string[];
    suggestedImprovements?: SuggestedImprovement[];
    sdkSessionIds?: Record<string, string>;
  };
  const suggested = ext.suggestedFiles;
  const improvements = ext.suggestedImprovements;
  const providerSessionIds = ext.providerSessionIds ?? ext.sdkSessionIds;
  return {
    ...raw,
    createdAt: toValidDate(raw.createdAt),
    updatedAt: toValidDate(raw.updatedAt),
    suggestedFiles: Array.isArray(suggested) ? suggested : [],
    suggestedImprovements: Array.isArray(improvements) ? improvements : [],
    providerSessionIds: providerSessionIds && Object.keys(providerSessionIds).length > 0 ? providerSessionIds : undefined,
  };
}

function saveSessionToProject(session: Session, projectId: string): void {
  const filePath = getSessionFilePathForProject(session.id, projectId);
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify(serialize(session), null, 2),
      'utf-8'
    );
  } catch (err) {
    log.warn('saveSession failed', session.id, projectId, err);
  }
}

/** Migrate legacy sessions.json in a project dir to one file per session. */
function migrateLegacyInProject(projectId: string): void {
  const legacyPath = path.join(
    getGlobalConfigDir(),
    'projects',
    projectId,
    'sessions.json'
  );
  if (!fs.existsSync(legacyPath)) return;
  try {
    const data = fs.readFileSync(legacyPath, 'utf-8');
    const parsed = JSON.parse(data) as SessionSerialized[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      fs.unlinkSync(legacyPath);
      return;
    }
    const dir = path.join(getGlobalConfigDir(), 'projects', projectId, 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    for (const raw of parsed) {
      if (raw?.id) {
        try {
          const filePath = path.join(dir, `${raw.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf-8');
        } catch {
          // skip
        }
      }
    }
    fs.unlinkSync(legacyPath);
    log.info('migrated legacy sessions.json to one file per session', projectId, parsed.length);
  } catch (err) {
    log.warn('migrateLegacyInProject failed', projectId, err);
  }
}

/** Load one session from disk into the map. Returns session or undefined. */
function loadSessionFromDisk(sessionId: string, projectId: string): Session | undefined {
  migrateLegacyInProject(projectId);
  const filePath = getSessionFilePathForProject(sessionId, projectId);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const raw = JSON.parse(data) as SessionSerialized;
    if (!raw?.id) return undefined;
    const session = deserialize(raw);
    sessionById.set(sessionId, { session, projectId });
    return session;
  } catch {
    return undefined;
  }
}

/**
 * Get session by ID. When projectId is provided, always try loading from disk first
 * so we return the latest state (e.g. after the agent worker has updated the session).
 * Otherwise in-memory cache can return stale data when the worker runs in a separate process.
 */
export function getSession(
  id: string,
  projectId?: string
): Session | undefined {
  if (projectId) {
    const fromDisk = loadSessionFromDisk(id, projectId);
    if (fromDisk) {
      if (!Array.isArray(fromDisk.todos)) fromDisk.todos = [];
      return fromDisk;
    }
  }
  const entry = sessionById.get(id);
  if (!entry) return undefined;
  const session = entry.session;
  if (session && !Array.isArray(session.todos)) session.todos = [];
  return session;
}

/**
 * List sessions for a project (loads from disk and merges into map). Project ID is for organization only.
 */
export function listSessions(projectId: string): Session[] {
  migrateLegacyInProject(projectId);
  const dir = path.join(getGlobalConfigDir(), 'projects', projectId, 'sessions');
  const out: Session[] = [];
  try {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      const id = e.name.slice(0, -5);
      const filePath = path.join(dir, e.name);
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const raw = JSON.parse(data) as SessionSerialized;
        if (raw?.id) {
          const session = deserialize(raw);
          sessionById.set(id, { session, projectId });
          out.push(session);
        }
      } catch {
        // skip
      }
    }
    out.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    log.debug('listSessions', projectId, out.length);
  } catch (err) {
    log.warn('listSessions failed', projectId, err);
  }
  return out;
}

export function createSession(
  title: string,
  projectId: string,
  options?: { ephemeral?: boolean }
): Session {
  const id = crypto.randomUUID();
  const now = new Date();
  const session: Session = {
    id,
    title: title || 'Chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
    todos: [],
  };
  const ephemeral = options?.ephemeral ?? false;
  sessionById.set(id, { session, projectId, ephemeral });
  log.info('createSession', id, session.title, projectId, ephemeral ? '(ephemeral)' : '');
  if (!ephemeral) saveSessionToProject(session, projectId);
  return session;
}

export function updateSessionMessages(
  id: string,
  messages: ChatMessage[]
): Session | undefined {
  const entry = sessionById.get(id);
  if (!entry) return undefined;
  entry.session.messages = messages;
  entry.session.updatedAt = new Date();
  log.debug('updateSessionMessages', id, 'messages:', messages.length);
  if (!entry.ephemeral) saveSessionToProject(entry.session, entry.projectId);
  return entry.session;
}

/**
 * Update the provider message cursor for a session.
 * After a successful run for a sliced provider (claude_sdk / cursor), call this with the
 * current total non-system message count so the next run only sends new messages.
 */
export function updateProviderMessageCursor(
  sessionId: string,
  providerId: string,
  cursor: number
): void {
  const entry = sessionById.get(sessionId);
  if (!entry) return;
  if (!entry.session.providerMessageCursors) entry.session.providerMessageCursors = {};
  entry.session.providerMessageCursors[providerId] = cursor;
  entry.session.updatedAt = new Date();
  log.debug('updateProviderMessageCursor', sessionId, providerId, cursor);
  if (!entry.ephemeral) saveSessionToProject(entry.session, entry.projectId);
}

/**
 * Set the provider session id for a provider (used for resume / --resume).
 * For cursor this is the Konstruct session id; for claude_v2 this is the SDK-returned id.
 */
export function updateProviderSessionId(
  sessionId: string,
  providerId: string,
  providerSessionId: string
): void {
  const entry = sessionById.get(sessionId);
  if (!entry) return;
  if (!entry.session.providerSessionIds) entry.session.providerSessionIds = {};
  entry.session.providerSessionIds[providerId] = providerSessionId;
  entry.session.updatedAt = new Date();
  log.debug('updateProviderSessionId', sessionId, providerId, providerSessionId.slice(0, 8) + '…');
  if (!entry.ephemeral) saveSessionToProject(entry.session, entry.projectId);
}

/** @deprecated Use updateProviderSessionId. */
export function updateSdkSessionId(
  sessionId: string,
  providerId: string,
  sdkSessionId: string
): void {
  updateProviderSessionId(sessionId, providerId, sdkSessionId);
}

/**
 * Append a single message to a session. Session must already be in memory (e.g. during an active run).
 */
export function addMessage(
  sessionId: string,
  message: ChatMessage
): Session | undefined {
  const entry = sessionById.get(sessionId);
  if (!entry) return undefined;
  entry.session.messages.push(message);
  entry.session.updatedAt = new Date();
  log.debug('addMessage', sessionId, message.role);
  if (!entry.ephemeral) saveSessionToProject(entry.session, entry.projectId);
  return entry.session;
}

export function updateSessionTitle(
  id: string,
  title: string
): Session | undefined {
  const entry = sessionById.get(id);
  if (!entry) return undefined;
  entry.session.title = title.trim() || 'Chat';
  entry.session.updatedAt = new Date();
  if (!entry.ephemeral) saveSessionToProject(entry.session, entry.projectId);
  return entry.session;
}

export function deleteSession(id: string): boolean {
  const entry = sessionById.get(id);
  const ok = sessionById.delete(id);
  if (ok && entry && !entry.ephemeral) {
    try {
      const filePath = getSessionFilePathForProject(id, entry.projectId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      log.warn('deleteSession: failed to remove file', id, err);
    }
  }
  return ok;
}

/**
 * Delete all sessions for a project. Removes from in-memory map and deletes session files from disk.
 * Returns the number of sessions deleted.
 */
export function deleteAllSessions(projectId: string): number {
  const list = listSessions(projectId);
  for (const s of list) {
    sessionById.delete(s.id);
    try {
      const filePath = getSessionFilePathForProject(s.id, projectId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      log.warn('deleteAllSessions: failed to remove file', s.id, err);
    }
  }
  if (list.length > 0) log.info('deleteAllSessions', projectId, list.length, 'sessions cleared');
  return list.length;
}

export function listTodos(sessionId: string): TodoItem[] {
  const entry = sessionById.get(sessionId);
  const session = entry?.session;
  if (!session?.todos) return [];
  return session.todos;
}

/**
 * Add a file path to the session's suggested-files list (for PR review assistant).
 * Loads session from disk if not in memory so the worker can update the same session.
 */
export function addSuggestedFile(
  sessionId: string,
  projectRoot: string,
  filePath: string
): Session | undefined {
  const projectId = resolveProjectId(projectRoot);
  let entry = sessionById.get(sessionId);
  if (!entry) {
    const fromDisk = loadSessionFromDisk(sessionId, projectId);
    if (!fromDisk) return undefined;
    entry = { session: fromDisk, projectId };
    sessionById.set(sessionId, entry);
  }
  const session = entry.session;
  if (!Array.isArray(session.suggestedFiles)) session.suggestedFiles = [];
  const normalized = filePath.trim().replace(/\\/g, '/');
  if (normalized && !session.suggestedFiles.includes(normalized)) {
    session.suggestedFiles.push(normalized);
    session.updatedAt = new Date();
    if (!entry.ephemeral) saveSessionToProject(session, entry.projectId);
  }
  return session;
}

/**
 * Add an improvement suggestion to the session (for review agent).
 * Loads session from disk if not in memory.
 */
export function addSuggestedImprovement(
  sessionId: string,
  projectRoot: string,
  item: SuggestedImprovement
): Session | undefined {
  const projectId = resolveProjectId(projectRoot);
  let entry = sessionById.get(sessionId);
  if (!entry) {
    const fromDisk = loadSessionFromDisk(sessionId, projectId);
    if (!fromDisk) return undefined;
    entry = { session: fromDisk, projectId };
    sessionById.set(sessionId, entry);
  }
  const session = entry.session;
  if (!Array.isArray(session.suggestedImprovements)) session.suggestedImprovements = [];
  session.suggestedImprovements.push({
    filePath: item.filePath.trim().replace(/\\/g, '/'),
    lineNumber: item.lineNumber,
    suggestion: item.suggestion.trim(),
    snippet: item.snippet?.trim(),
  });
  session.updatedAt = new Date();
  if (!entry.ephemeral) saveSessionToProject(session, entry.projectId);
  return session;
}

export function addTodo(
  sessionId: string,
  description: string
): TodoItem | undefined {
  const entry = sessionById.get(sessionId);
  if (!entry) return undefined;
  const session = entry.session;
  if (!session.todos) session.todos = [];
  const item: TodoItem = {
    id: crypto.randomUUID(),
    description,
    status: 'pending',
  };
  session.todos.push(item);
  session.updatedAt = new Date();
  if (!entry.ephemeral) saveSessionToProject(session, entry.projectId);
  return item;
}

export function updateTodo(
  sessionId: string,
  todoId: string,
  status: TodoItem['status']
): boolean {
  const entry = sessionById.get(sessionId);
  if (!entry?.session?.todos) return false;
  const session = entry.session;
  const t = session.todos.find((x) => x.id === todoId);
  if (!t) return false;
  t.status = status;
  session.updatedAt = new Date();
  if (!entry.ephemeral) saveSessionToProject(session, entry.projectId);
  return true;
}

export function removeTodo(sessionId: string, todoId: string): boolean {
  const entry = sessionById.get(sessionId);
  if (!entry?.session?.todos) return false;
  const session = entry.session;
  const i = session.todos.findIndex((x) => x.id === todoId);
  if (i < 0) return false;
  session.todos.splice(i, 1);
  session.updatedAt = new Date();
  if (!entry.ephemeral) saveSessionToProject(session, entry.projectId);
  return true;
}

/** No-op for API compatibility; project is passed per-call now. */
export function setProjectRootForRun(_root: string | null): void {}

/** No-op for API compatibility. */
export function reloadSessions(): void {}

/** No-op for API compatibility. */
export function forceReloadSessions(): void {}
