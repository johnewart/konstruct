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
 *   mode         - Konstruct mode whose toolset to expose (default: implementation = all tools)
 *   allowedTools - optional comma-separated list of tool names; when set, only these tools from the mode are exposed (e.g. for limiting Claude to a subset)
 */

import '../agent/tools/runners.ts'; // register all tool implementations
import { executeTool } from '../agent/tools/executor.ts';
import { getToolsForMode } from '../agent/toolDefinitions.ts';
import type { ToolDefinition } from '../shared/llm.ts';
import * as http from 'node:http';
import { createLogger } from '../shared/logger.ts';

const log = createLogger('mcp');

interface McpSession {
  res: http.ServerResponse;
  projectRoot: string;
  modeId: string;
  /** Konstruct chat session id (optional); when set, session-scoped tools (list_todos, add_todo, etc.) work. */
  konstructSessionId?: string;
  /** When set, only these tool names from the mode are exposed (e.g. read_file_region,grep). */
  allowedTools?: Set<string>;
}

const sessions = new Map<string, McpSession>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send an SSE event. Multi-line data is sent as multiple "data: " lines per the SSE spec. */
function sendSseEvent(session: McpSession, event: string, data: string): void {
  try {
    session.res.write(`event: ${event}\n`);
    for (const line of data.split('\n')) {
      session.res.write(`data: ${line}\n`);
    }
    session.res.write('\n');
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
      let list = getToolsForMode(session.modeId);
      if (session.allowedTools?.size) {
        list = list.filter((t) => session.allowedTools!.has(t.function.name));
      }
      respond({ tools: list.map(toMcpTool) });
      break;
    }

    case 'tools/call': {
      const p = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!p?.name) {
        respondError(-32602, 'Missing tool name');
        return;
      }
      if (session.allowedTools?.size && !session.allowedTools.has(p.name)) {
        respondError(-32602, `Tool "${p.name}" is not allowed in this session`);
        return;
      }
      log.debug('mcp tools/call', p.name, 'project:', session.projectRoot);
      try {
        const result = await executeTool(p.name, p.arguments ?? {}, {
          projectRoot: session.projectRoot,
          sessionId: session.konstructSessionId,
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
 * Build the base URL for this request (scheme + host) so the client can POST to absolute URLs.
 */
function getBaseUrl(req: http.IncomingMessage): string {
  const host = req.headers.host ?? 'localhost:3001';
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ?? 'http';
  return `${proto}://${host}`;
}

/**
 * GET /mcp — open an SSE session.
 * Claude connects here; we send back the messages endpoint as a full URL so the client can POST.
 */
export function handleMcpSse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): void {
  const mcpSessionId = crypto.randomUUID();
  const projectRoot = url.searchParams.get('projectRoot') ?? process.cwd();
  const modeId = url.searchParams.get('mode') ?? 'implementation';
  const konstructSessionId = url.searchParams.get('konstructSessionId') ?? undefined;
  const allowedToolsParam = url.searchParams.get('allowedTools');
  const allowedTools =
    allowedToolsParam?.length
      ? new Set(allowedToolsParam.split(',').map((s) => s.trim()).filter(Boolean))
      : undefined;
  const baseUrl = getBaseUrl(req);
  const messagesUrl = `${baseUrl}/mcp/messages?sessionId=${mcpSessionId}`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const session: McpSession = { res, projectRoot, modeId, konstructSessionId, allowedTools };
  sessions.set(mcpSessionId, session);

  // Send full URL so Claude (or any MCP client) can POST without knowing the server origin
  sendSseEvent(session, 'endpoint', messagesUrl);

  // Keep-alive pings every 15 s to prevent proxy timeouts
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 15_000);

  req.on('close', () => {
    clearInterval(ping);
    sessions.delete(mcpSessionId);
    log.debug('mcp session closed', mcpSessionId);
  });

  log.debug('mcp session opened', mcpSessionId, 'project:', projectRoot, 'mode:', modeId);
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
