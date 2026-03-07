#!/usr/bin/env node
/**
 * MCP stdio bridge: speaks MCP over stdin/stdout and forwards to Konstruct's HTTP MCP server.
 * Reads KONSTRUCT_SESSION_ID from env (set when Konstruct spawns the Cursor agent) and adds
 * konstructSessionId to the initial request so session-scoped tools work. No proxy or curl required.
 */
import * as readline from 'node:readline';
import { createInterface } from 'node:readline';

const MCP_BASE = process.env.KONSTRUCT_MCP_BASE_URL || 'http://localhost.:3001';
const baseUrl = MCP_BASE.replace(/\/$/, '');
const mcpUrl = `${baseUrl}/mcp`;
const projectRoot = process.cwd();
const sessionId = process.env.KONSTRUCT_SESSION_ID || '';

function log(...args) {
  if (process.env.KONSTRUCT_MCP_BRIDGE_DEBUG) {
    console.error('[konstruct-mcp-bridge]', ...args);
  }
}

/**
 * Parse SSE stream: collect events (event type + data) until we have endpoint and any message responses.
 */
async function parseSseUntilEndpointAndMessages(reader) {
  let buffer = '';
  let currentEvent = null;
  let currentData = [];
  const messages = [];
  let messagesUrl = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += typeof value === 'string' ? value : new TextDecoder().decode(value);
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        if (currentEvent === 'message' && currentData.length) {
          try {
            messages.push(JSON.parse(currentData.join('\n')));
          } catch (_) {}
        }
        currentEvent = line.slice(6).trim();
        currentData = [];
      } else if (line.startsWith('data:')) {
        currentData.push(line.slice(5));
      } else if (line === '' && currentEvent) {
        if (currentEvent === 'endpoint' && currentData.length) {
          messagesUrl = currentData.join('\n').trim();
        } else if (currentEvent === 'message' && currentData.length) {
          try {
            messages.push(JSON.parse(currentData.join('\n')));
          } catch (_) {}
        }
        currentEvent = null;
        currentData = [];
      }
    }
    if (messagesUrl) break;
  }
  if (currentEvent === 'message' && currentData.length) {
    try {
      messages.push(JSON.parse(currentData.join('\n')));
    } catch (_) {}
  }
  return { messagesUrl, messages };
}

/**
 * Open session: POST to /mcp with optional body (e.g. initialize). Returns messagesUrl and any SSE message responses.
 * Passes konstructSessionId from env so the server can tie this session to the chat.
 */
async function openSession(initialBody) {
  const params = new URLSearchParams({ projectRoot, mode: 'implementation' });
  if (sessionId) params.set('konstructSessionId', sessionId);
  const url = `${mcpUrl}?${params.toString()}`;
  log('POST', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: initialBody ? JSON.stringify(initialBody) : undefined,
  });
  if (!res.ok) {
    throw new Error(`MCP open failed: ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const { messagesUrl, messages } = await parseSseUntilEndpointAndMessages(reader);
  reader.releaseLock();
  if (!messagesUrl) throw new Error('No endpoint in MCP response');
  return { messagesUrl, messages };
}

/**
 * Send one JSON-RPC request to the messages endpoint.
 */
async function sendMessage(messagesUrl, body) {
  log('POST', messagesUrl.slice(0, 80) + '...');
  const res = await fetch(messagesUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`MCP message failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeOut(obj) {
  console.log(JSON.stringify(obj));
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  let messagesUrl = null;
  let first = true;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (first) {
      first = false;
      try {
        const { messagesUrl: url, messages } = await openSession(msg);
        messagesUrl = url;
        for (const m of messages) {
          writeOut(m);
        }
        // If server already responded via SSE (e.g. initialize), we're done for this message
        if (messages.length > 0) continue;
        // Otherwise send this first message to the messages endpoint
        const response = await sendMessage(messagesUrl, msg);
        if (response) writeOut(response);
        continue;
      } catch (err) {
        log(err);
        writeOut({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err.message) } });
        continue;
      }
    }

    if (!messagesUrl) {
      writeOut({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'No MCP session' } });
      continue;
    }

    try {
      const response = await sendMessage(messagesUrl, msg);
      if (response) writeOut(response);
    } catch (err) {
      log(err);
      writeOut({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err.message) } });
    }
  }
}

main().catch((err) => {
  console.error('[konstruct-mcp-bridge]', err);
  process.exit(1);
});
