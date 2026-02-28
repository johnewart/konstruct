import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';

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

/** Project root for persistence path (same as executor). */
function getProjectRoot(): string {
  return process.env.PROJECT_ROOT ?? process.cwd();
}

function getSessionsPath(): string {
  return path.join(getProjectRoot(), '.konstruct', 'sessions.json');
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

const sessions = new Map<string, Session>();

function loadSessions(): void {
  const filePath = getSessionsPath();
  try {
    if (!fs.existsSync(filePath)) return;
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data) as SessionSerialized[];
    if (!Array.isArray(parsed)) return;
    sessions.clear();
    for (const raw of parsed) {
      if (raw?.id) {
        try {
          sessions.set(raw.id, deserialize(raw));
        } catch {
          // skip malformed entry
        }
      }
    }
    log.debug('loadSessions', sessions.size, 'sessions');
  } catch (err) {
    log.warn('loadSessions failed', err);
  }
}

function saveSessions(): void {
  const filePath = getSessionsPath();
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const array = Array.from(sessions.values()).map(serialize);
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
  sessions.set(id, session);
  log.info('createSession', id, session.title);
  saveSessions();
  return session;
}

export function getSession(id: string): Session | undefined {
  const session = sessions.get(id);
  if (session && !Array.isArray(session.todos)) session.todos = [];
  return session;
}

export function listSessions(): Session[] {
  return Array.from(sessions.values()).sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  );
}

export function updateSessionMessages(
  id: string,
  messages: ChatMessage[]
): Session | undefined {
  const session = sessions.get(id);
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
  const session = sessions.get(id);
  if (!session) return undefined;
  session.title = title.trim() || 'Chat';
  session.updatedAt = new Date();
  saveSessions();
  return session;
}

export function deleteSession(id: string): boolean {
  const ok = sessions.delete(id);
  if (ok) saveSessions();
  return ok;
}

export function listTodos(sessionId: string): TodoItem[] {
  const session = sessions.get(sessionId);
  if (!session?.todos) return [];
  return session.todos;
}

export function addTodo(
  sessionId: string,
  description: string
): TodoItem | undefined {
  const session = sessions.get(sessionId);
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
  const session = sessions.get(sessionId);
  if (!session?.todos) return false;
  const t = session.todos.find((x) => x.id === todoId);
  if (!t) return false;
  t.status = status;
  session.updatedAt = new Date();
  saveSessions();
  return true;
}

export function removeTodo(sessionId: string, todoId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session?.todos) return false;
  const i = session.todos.findIndex((x) => x.id === todoId);
  if (i < 0) return false;
  session.todos.splice(i, 1);
  session.updatedAt = new Date();
  saveSessions();
  return true;
}
