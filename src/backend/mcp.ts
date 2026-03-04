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
 * MCP (Model Context Protocol) HTTP+SSE transport for the Konstruct backend.
 *
 * Exposes Konstruct's tool implementations as MCP tools so the Claude CLI can
 * call them during a --print run.
 *
 * Transport: HTTP + Server-Sent Events (MCP spec 2024-11-05)
 *   GET  /mcp                          - establishes SSE session
 *   POST /mcp/messages?sessionId=<id>  - receives JSON-RPC requests from Claude
 *
 * Query params on GET /mcp:
 *   projectRoot  - absolute path for tool path resolution (default: cwd)
 *   mode         - Konstruct mode whose toolset to expose (default: ask)
 */

import '../agent/tools/runners.ts'; // register all tool implementations
import { executeTool } from '../agent/tools/executor.ts';
import { getToolsForMode } from '../agent/toolDefinitions.ts';
import type { ToolDefinition } from '../shared/llm.ts';
import * as http from 'node:http';
import { createLogger } from '../shared/logger.ts';

const log = createLogger('mcp');

// Tools that only make sense inside a Konstruct session — omit from MCP.
const SESSION_TOOLS = new Set(['list_todos', 'add_todo', 'update_todo', 'update_session_title']);

interface McpSession {
  res: http.ServerResponse;
  projectRoot: string;
  modeId: string;
}

const sessions = new Map<string, McpSession>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendSseEvent(session: McpSession, event: string, data: string): void {
  try {
    session.res.write(`event: ${event}\ndata: ${data}\n\n`);
  } catch {
    // Connection already closed — ignore
  }
}

function toMcpTool(t: ToolDefinition) {
  return {
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters,
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatcher
// ---------------------------------------------------------------------------

async function dispatchRequest(
  body: { jsonrpc?: string; id?: unknown; method: string; params?: unknown },
  session: McpSession
): Promise<void> {
  const id = (body.id as string | number | null) ?? null;

  const respond = (result: unknown) =>
    sendSseEvent(session, 'message', JSON.stringify({ jsonrpc: '2.0', id, result }));

  const respondError = (code: number, message: string) =>
    sendSseEvent(session, 'message', JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));

  switch (body.method) {
    case 'initialize':
      respond({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'konstruct', version: '1.0.0' },
      });
      break;

    case 'notifications/initialized':
      // Notification — no response needed
      break;

    case 'tools/list': {
      const tools = getToolsForMode(session.modeId)
        .filter((t) => !SESSION_TOOLS.has(t.function.name))
        .map(toMcpTool);
      respond({ tools });
      break;
    }

    case 'tools/call': {
      const p = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!p?.name) {
        respondError(-32602, 'Missing tool name');
        return;
      }
      log.debug('mcp tools/call', p.name, 'project:', session.projectRoot);
      try {
        const result = await executeTool(p.name, p.arguments ?? {}, {
          projectRoot: session.projectRoot,
        });
        const text = result.error ?? result.result ?? '';
        respond({ content: [{ type: 'text', text }], isError: !!result.error });
      } catch (err) {
        respond({ content: [{ type: 'text', text: String(err) }], isError: true });
      }
      break;
    }

    default:
      if (body.id != null) {
        respondError(-32601, `Method not found: ${body.method}`);
      }
  }
}

// ---------------------------------------------------------------------------
// Route handlers (called from index.ts)
// ---------------------------------------------------------------------------

/**
 * GET /mcp — open an SSE session.
 * Claude connects here; we send back the messages endpoint URL.
 */
export function handleMcpSse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): void {
  const sessionId = crypto.randomUUID();
  const projectRoot = url.searchParams.get('projectRoot') ?? process.cwd();
  const modeId = url.searchParams.get('mode') ?? 'ask';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const session: McpSession = { res, projectRoot, modeId };
  sessions.set(sessionId, session);

  // Tell Claude where to POST JSON-RPC messages
  sendSseEvent(session, 'endpoint', `/mcp/messages?sessionId=${sessionId}`);

  // Keep-alive pings every 15 s to prevent proxy timeouts
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 15_000);

  req.on('close', () => {
    clearInterval(ping);
    sessions.delete(sessionId);
    log.debug('mcp session closed', sessionId);
  });

  log.debug('mcp session opened', sessionId, 'project:', projectRoot, 'mode:', modeId);
}

/**
 * POST /mcp/messages?sessionId=<id> — receive a JSON-RPC request from Claude.
 * Returns 202 immediately; the actual JSON-RPC response is pushed via SSE.
 */
export async function handleMcpMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<void> {
  const sessionId = url.searchParams.get('sessionId');
  const session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MCP session not found' }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  let body: { jsonrpc?: string; id?: unknown; method: string; params?: unknown };
  try {
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  // Acknowledge immediately; response travels via SSE
  res.writeHead(202);
  res.end();

  dispatchRequest(body, session).catch((err) => {
    log.error('mcp dispatch error', err);
  });
}
