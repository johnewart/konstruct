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
import { getGlobalConfigDir, getProjectIdForRoot } from './config';
import { createLogger } from './logger';

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
}

export interface TodoItem {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface Session {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
  todos: TodoItem[];
}

/**
 * Project root for the current run. Used to resolve which project's session
 * dir to use under ~/.config/konstruct/projects/<project-id>/.
 */
let projectRootForRun: string | null = null;
let lastLoadedProjectId: string | null = null;

/**
 * Set the project root for the current run (e.g. active project path).
 * Call at the start of each request/run so sessions load/save under that project's dir.
 * Loads that project's sessions from disk when switching to a different project.
 */
export function setProjectRootForRun(root: string | null): void {
  projectRootForRun = root;
  const id = getCurrentProjectId();
  if (id !== lastLoadedProjectId) {
    lastLoadedProjectId = id;
    loadSessions();
  }
}

/** Project id used for session storage (known project id or '_default'). */
function getCurrentProjectId(): string {
  const id = getProjectIdForRoot(projectRootForRun ?? '');
  return id ?? '_default';
}

/** Sessions path: ~/.config/konstruct/projects/<project-id>/sessions.json */
function getSessionsPath(): string {
  return path.join(
    getGlobalConfigDir(),
    'projects',
    getCurrentProjectId(),
    'sessions.json'
  );
}

/** Per-project in-memory session cache. */
const sessionsByProjectId = new Map<string, Map<string, Session>>();

function getCurrentSessionsMap(): Map<string, Session> {
  const id = getCurrentProjectId();
  let map = sessionsByProjectId.get(id);
  if (!map) {
    map = new Map();
    sessionsByProjectId.set(id, map);
  }
  return map;
}

/** Session shape for JSON (dates as ISO strings). */
type SessionSerialized = Omit<Session, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

function serialize(s: Session): SessionSerialized {
  return {
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function deserialize(raw: SessionSerialized): Session {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  };
}

function loadSessions(): void {
  const filePath = getSessionsPath();
  const map = getCurrentSessionsMap();
  try {
    if (!fs.existsSync(filePath)) return;
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data) as SessionSerialized[];
    if (!Array.isArray(parsed)) return;
    map.clear();
    for (const raw of parsed) {
      if (raw?.id) {
        try {
          map.set(raw.id, deserialize(raw));
        } catch {
          // skip malformed entry
        }
      }
    }
    log.debug('loadSessions', getCurrentProjectId(), map.size, 'sessions');
  } catch (err) {
    log.warn('loadSessions failed', err);
  }
}

function saveSessions(): void {
  const filePath = getSessionsPath();
  const map = getCurrentSessionsMap();
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const array = Array.from(map.values()).map(serialize);
    fs.writeFileSync(filePath, JSON.stringify(array, null, 2), 'utf-8');
  } catch (err) {
    log.warn('saveSessions failed', err);
  }
}

// Load from disk on module init
loadSessions();

const RELOAD_THROTTLE_MS = 1500;
let lastReloadTime = 0;

/** Reload sessions from disk. Throttled so repeated get/list calls (e.g. polling) don't hammer the disk. */
export function reloadSessions(): void {
  const now = Date.now();
  if (now - lastReloadTime < RELOAD_THROTTLE_MS) return;
  lastReloadTime = now;
  loadSessions();
}

/** Reload from disk without throttle. Use when we must see the latest (e.g. after agent run completes). */
export function forceReloadSessions(): void {
  lastReloadTime = Date.now();
  loadSessions();
}

export function createSession(title: string): Session {
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
  getCurrentSessionsMap().set(id, session);
  log.info('createSession', id, session.title);
  saveSessions();
  return session;
}

export function getSession(id: string): Session | undefined {
  const session = getCurrentSessionsMap().get(id);
  if (session && !Array.isArray(session.todos)) session.todos = [];
  return session;
}

export function listSessions(): Session[] {
  return Array.from(getCurrentSessionsMap().values()).sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  );
}

export function updateSessionMessages(
  id: string,
  messages: ChatMessage[]
): Session | undefined {
  const session = getCurrentSessionsMap().get(id);
  if (!session) return undefined;
  session.messages = messages;
  session.updatedAt = new Date();
  log.debug('updateSessionMessages', id, 'messages:', messages.length);
  saveSessions();
  return session;
}

export function updateSessionTitle(
  id: string,
  title: string
): Session | undefined {
  const session = getCurrentSessionsMap().get(id);
  if (!session) return undefined;
  session.title = title.trim() || 'Chat';
  session.updatedAt = new Date();
  saveSessions();
  return session;
}

export function deleteSession(id: string): boolean {
  const ok = getCurrentSessionsMap().delete(id);
  if (ok) saveSessions();
  return ok;
}

export function listTodos(sessionId: string): TodoItem[] {
  const session = getCurrentSessionsMap().get(sessionId);
  if (!session?.todos) return [];
  return session.todos;
}

export function addTodo(
  sessionId: string,
  description: string
): TodoItem | undefined {
  const session = getCurrentSessionsMap().get(sessionId);
  if (!session) return undefined;
  if (!session.todos) session.todos = [];
  const item: TodoItem = {
    id: crypto.randomUUID(),
    description,
    status: 'pending',
  };
  session.todos.push(item);
  session.updatedAt = new Date();
  saveSessions();
  return item;
}

export function updateTodo(
  sessionId: string,
  todoId: string,
  status: TodoItem['status']
): boolean {
  const session = getCurrentSessionsMap().get(sessionId);
  if (!session?.todos) return false;
  const t = session.todos.find((x) => x.id === todoId);
  if (!t) return false;
  t.status = status;
  session.updatedAt = new Date();
  saveSessions();
  return true;
}

export function removeTodo(sessionId: string, todoId: string): boolean {
  const session = getCurrentSessionsMap().get(sessionId);
  if (!session?.todos) return false;
  const i = session.todos.findIndex((x) => x.id === todoId);
  if (i < 0) return false;
  session.todos.splice(i, 1);
  session.updatedAt = new Date();
  saveSessions();
  return true;
}
