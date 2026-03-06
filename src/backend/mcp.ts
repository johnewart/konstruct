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
 *   mode         - Konstruct mode whose toolset to expose (default: implementation = all tools). Use mode=minimal for read-only tools, mode=full for all tools; when X-Agent-Name is not resolved (e.g. Cursor sends literal "${env:...}"), the server applies the preset from mode so tool restriction works without env vars.
 *   allowedTools - optional comma-separated list of tool names; when set, only these tools from the mode are exposed (e.g. for limiting Claude to a subset)
 *
 * Headers on GET /mcp (e.g. from Cursor .cursor/mcp.json):
 *   X-Allowed-Tools         - comma-separated tool names; when set, only these tools are exposed (overrides X-Agent-Name if both present).
 *   X-Agent-Name            - agent preset name; when set, only tools for that preset are exposed. Presets: "minimal" (read-only), "full" (all tools). Cursor often sends the literal "${env:VAR}"; we resolve server-side from the Konstruct backend process env.
 *   X-Konstruct-Session-Id  - Konstruct chat session id; when set, session-scoped tools (list_todos, add_todo, etc.) use this session. Use "${env:KONSTRUCT_SESSION_ID}" in mcp.json; we resolve it server-side (Cursor does not resolve env vars in headers). Set KONSTRUCT_SESSION_ID in the environment where the Konstruct server runs (e.g. same shell as `npm run dev`).
 *
 * Session -> mode map: many clients (e.g. Cursor) send sessionId (and optionally mode/agentName) in JSON-RPC params. We keep a map sessionId -> { modeId, allowedTools } and restrict tools/list and tools/call by it, so tool restriction can be driven per session without relying on headers.
 */

import { getToolsForMode } from '../agent/toolDefinitions.ts';
import type { ToolDefinition } from '../shared/llm.ts';
import { isBackendTool } from '../shared/toolClassification.ts';
import { runBackendTool } from './mcp/backendTools.ts';
import { getWorkspaceByProjectRoot } from './workspace/resolver.ts';
import { getProjectIdForRoot, getDisabledToolsForProject } from '../shared/config.ts';
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
  /** Client session id from Cursor (params.sessionId); used to look up session -> mode. */
  clientSessionId?: string;
}

const sessions = new Map<string, McpSession>();

/** Client session id -> { modeId, allowedTools }. Cursor sends sessionId (and optionally mode) in params; we restrict tools by this. */
const sessionModeMap = new Map<string, { modeId: string; allowedTools?: Set<string> }>();

/** If value is "${env:VAR}" (or quoted), return process.env[VAR] (server's env); otherwise return value. Cursor often sends the literal "${env:...}" without resolving; we resolve server-side so the Konstruct backend's env (e.g. KONSTRUCT_SESSION_ID) is used. */
function interpolateEnvHeader(value: string | undefined): string | undefined {
  if (value == null || value.length === 0) return value;
  const trimmed = value.trim().replace(/^["']|["']$/g, '');
  const m = trimmed.match(/^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (m) {
    const envName = m[1];
    const resolved = process.env[envName];
    log.debug('mcp env header', envName, resolved != null ? 'resolved' : 'unset (set in env where Konstruct server runs)');
    return resolved ?? undefined;
  }
  return value;
}

/** Preset tool lists by agent name; used when X-Agent-Name header is set. */
const AGENT_NAME_TOOLS: Record<string, string[]> = {
  minimal: ['list_files', 'read_file_region', 'grep', 'glob', 'codebase_outline', 'search_code'],
  full: [], // empty = no filter = all tools
};

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

/** Effective mode and allowed tools for this request; prefers session-mode map (from params.sessionId + params.mode) over connection headers. */
function getEffectiveSessionConfig(session: McpSession): { modeId: string; allowedTools?: Set<string> } {
  if (session.clientSessionId) {
    const entry = sessionModeMap.get(session.clientSessionId);
    if (entry) return entry;
  }
  return { modeId: session.modeId, allowedTools: session.allowedTools };
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatcher
// ---------------------------------------------------------------------------

async function dispatchRequest(
  body: { jsonrpc?: string; id?: unknown; method: string; params?: unknown },
  session: McpSession
): Promise<void> {
  const id = (body.id as string | number | null) ?? null;
  const params = body.params as { sessionId?: string; mode?: string; agentName?: string; [k: string]: unknown } | undefined;

  // Cursor (and other clients) often send sessionId in params; use it for session -> mode mapping.
  if (params?.sessionId != null && typeof params.sessionId === 'string') {
    session.clientSessionId = params.sessionId;
    const modeOrAgent = (params.mode ?? params.agentName) as string | undefined;
    if (modeOrAgent?.trim()) {
      const modeId = modeOrAgent.trim().toLowerCase();
      const preset = AGENT_NAME_TOOLS[modeId];
      const allowedTools = preset !== undefined
        ? (preset.length ? new Set(preset) : undefined)
        : undefined;
      sessionModeMap.set(params.sessionId, {
        modeId: preset !== undefined ? session.modeId : modeOrAgent.trim(),
        allowedTools,
      });
      log.debug('mcp session mode map', params.sessionId, '->', modeOrAgent, allowedTools ? `(${allowedTools.size} tools)` : 'all');
    }
  }

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
      const { modeId: effectiveModeId, allowedTools: effectiveAllowedTools } = getEffectiveSessionConfig(session);
      let list = getToolsForMode(effectiveModeId);
      if (effectiveAllowedTools?.size) {
        list = list.filter((t) => effectiveAllowedTools.has(t.function.name));
      }
      const projectIdForList = getProjectIdForRoot(session.projectRoot);
      if (projectIdForList) {
        const disabledForList = new Set(getDisabledToolsForProject(projectIdForList));
        if (disabledForList.size) {
          list = list.filter((t) => !disabledForList.has(t.function.name));
        }
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
      const { allowedTools: effectiveAllowedTools } = getEffectiveSessionConfig(session);
      if (effectiveAllowedTools?.size && !effectiveAllowedTools.has(p.name)) {
        respondError(-32602, `Tool "${p.name}" is not allowed in this session`);
        return;
      }
      const projectIdForCall = getProjectIdForRoot(session.projectRoot);
      if (projectIdForCall) {
        const disabledForCall = new Set(getDisabledToolsForProject(projectIdForCall));
        if (disabledForCall.has(p.name)) {
          respondError(-32602, `Tool "${p.name}" is disabled for this project`);
          return;
        }
      }
      log.debug('mcp tools/call', p.name, 'project:', session.projectRoot, 'backend:', isBackendTool(p.name));
      try {
        if (isBackendTool(p.name)) {
          const result = await runBackendTool(p.name, p.arguments ?? {}, {
            projectRoot: session.projectRoot,
            sessionId: session.konstructSessionId,
          });
          const text = result.error ?? result.result ?? '';
          respond({ content: [{ type: 'text', text }], isError: !!result.error });
        } else {
          const workspace = getWorkspaceByProjectRoot(session.projectRoot);
          const conn = await workspace.getOrSpawnAgent();
          const result = await conn.executeTool(p.name, p.arguments ?? {});
          const text = result.error ?? result.result ?? '';
          respond({ content: [{ type: 'text', text }], isError: !!result.error });
        }
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
  const xSessionHeader = Array.isArray(req.headers['x-konstruct-session-id']) ? req.headers['x-konstruct-session-id'][0] : req.headers['x-konstruct-session-id'];
  const konstructSessionId = url.searchParams.get('konstructSessionId') ?? interpolateEnvHeader(xSessionHeader) ?? undefined;
  const resolvedAgent = interpolateEnvHeader(Array.isArray(req.headers['x-agent-name']) ? req.headers['x-agent-name'][0] : req.headers['x-agent-name']);
  log.debug('mcp SSE: query', Object.fromEntries(url.searchParams.entries()), 'x-agent-name (resolved)', resolvedAgent ?? '(not set — set KONSTRUCT_AGENT_NAME where the Konstruct server runs, e.g. npm run dev)', 'konstructSessionId', konstructSessionId ?? '(none — set X-Konstruct-Session-Id or KONSTRUCT_SESSION_ID for session-scoped tools)');
  let allowedTools: Set<string> | undefined;
  const allowedToolsParam = url.searchParams.get('allowedTools');
  if (allowedToolsParam?.length) {
    allowedTools = new Set(allowedToolsParam.split(',').map((s) => s.trim()).filter(Boolean));
  } else {
    const xAllowed = req.headers['x-allowed-tools'];
    const allowedRaw = Array.isArray(xAllowed) ? xAllowed[0] : xAllowed;
    const allowedHeader = interpolateEnvHeader(allowedRaw);
    if (allowedHeader?.length) {
      allowedTools = new Set(allowedHeader.split(',').map((s) => s.trim()).filter(Boolean));
    } else {
      const xAgent = req.headers['x-agent-name'];
      const agentRaw = Array.isArray(xAgent) ? xAgent[0] : xAgent;
      const agentHeader = interpolateEnvHeader(agentRaw);
      if (agentHeader?.length) {
        const preset = AGENT_NAME_TOOLS[agentHeader.trim().toLowerCase()];
        if (preset !== undefined) allowedTools = preset.length ? new Set(preset) : undefined;
      }
    }
    // When client does not resolve env vars (e.g. Cursor), restrict by mode from URL so user can pick mode without env
    if (allowedTools === undefined) {
      const modePreset = AGENT_NAME_TOOLS[modeId.toLowerCase()];
      if (modePreset !== undefined) {
        allowedTools = modePreset.length ? new Set(modePreset) : undefined;
        log.debug('mcp tool preset from mode param', modeId, allowedTools ? `${allowedTools.size} tools` : 'all');
      }
    }
  }
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
  log.debug('mcp SSE: sending endpoint', messagesUrl);
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

  log.info('mcp session opened', mcpSessionId, 'project:', projectRoot, 'mode:', modeId);
  const knownSessionIds = Array.from(sessions.keys());
  const knownSessionModes = Array.from(sessionModeMap.entries()).map(([id, cfg]) => ({ sessionId: id, modeId: cfg.modeId, allowedTools: cfg.allowedTools ? Array.from(cfg.allowedTools) : undefined }));
  log.debug('mcp known sessions', { sessionIds: knownSessionIds, sessionModes: knownSessionModes });
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
    log.warn('mcp messages: session not found', { sessionId, activeSessions: sessions.size });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MCP session not found', sessionId: sessionId ?? null }));
    return;
  }
  log.debug('mcp messages: session found', sessionId);

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  let body: { jsonrpc?: string; id?: unknown; method: string; params?: unknown };
  try {
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch (err) {
    log.warn('mcp messages: invalid JSON', err);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }
  log.debug('mcp messages: method', body.method);

  // Acknowledge immediately; response travels via SSE
  res.writeHead(202);
  res.end();

  dispatchRequest(body, session).catch((err) => {
    log.error('mcp dispatch error', err);
  });
}
