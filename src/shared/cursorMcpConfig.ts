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
 * Ensures .cursor/mcp.json in the project root contains a Konstruct MCP server entry
 * so Cursor can connect to Konstruct's MCP endpoint. Uses "${env:VAR}" placeholders;
 * Cursor does not resolve these—the Konstruct backend resolves them server-side from
 * its process env. Set KONSTRUCT_SESSION_ID / KONSTRUCT_AGENT_NAME where the server runs (e.g. same shell as npm run dev).
 *
 * Node-only: uses require/createRequire for fs/path at runtime so shared bundle stays safe
 * in non-Node (e.g. browser). Works in both Node CJS and Node ESM.
 */

import { createLogger } from './logger';

const log = createLogger('cursor-mcp');
const SERVER_NAME = 'konstruct';

function getMcpUrl(mode?: string): string {
  const base =
    (typeof process !== 'undefined' && process.env?.KONSTRUCT_MCP_BASE_URL) ?? 'http://localhost:3001';
  const path = base.replace(/\/$/, '') + '/mcp';
  return mode ? `${path}?mode=${encodeURIComponent(mode)}` : path;
}

export async function ensureCursorMcpConfig(projectRoot: string): Promise<void> {
  if (!projectRoot?.trim()) {
    log.debug('ensureCursorMcpConfig skipped: no projectRoot');
    return;
  }
  const isNode = typeof process !== 'undefined' && process.versions?.node;
  if (!isNode) {
    log.debug('ensureCursorMcpConfig skipped: not in Node (e.g. browser)');
    return;
  }
  let req: NodeRequire;
  try {
    if (typeof require !== 'undefined') {
      req = require;
    } else {
      const { createRequire } = await import('node:module');
      req = createRequire(import.meta.url);
    }
  } catch {
    log.debug('ensureCursorMcpConfig skipped: could not get require (non-Node?)');
    return;
  }
  try {
    const fs = req('node:fs') as typeof import('node:fs');
    const path = req('node:path') as typeof import('node:path');
    const cursorDir = path.join(projectRoot, '.cursor');
    const mcpPath = path.join(cursorDir, 'mcp.json');
    log.debug('ensureCursorMcpConfig projectRoot:', projectRoot, 'mcp.json path:', mcpPath);
    if (!fs.existsSync(cursorDir)) {
      fs.mkdirSync(cursorDir, { recursive: true });
      log.debug('ensureCursorMcpConfig created .cursor dir:', cursorDir);
    }
    let existing: { mcpServers?: Record<string, unknown> } = {};
    if (fs.existsSync(mcpPath)) {
      try {
        const raw = fs.readFileSync(mcpPath, 'utf-8');
        existing = (JSON.parse(raw) as { mcpServers?: Record<string, unknown> }) ?? {};
      } catch {
        // Invalid or empty; overwrite with merged config
      }
    }
    const mcpServers = (existing.mcpServers && typeof existing.mcpServers === 'object'
      ? { ...existing.mcpServers }
      : {}) as Record<string, { url?: string; headers?: Record<string, string> }>;

    const baseHeaders = {
      'X-Konstruct-Session-Id': '${env:KONSTRUCT_SESSION_ID}',
      API_KEY: '${env:KONSTRUCT_API_KEY}',
    };
    // Default: all tools (no mode param)
    mcpServers[SERVER_NAME] = { url: getMcpUrl(), headers: { 'X-Agent-Name': '${env:KONSTRUCT_AGENT_NAME}', ...baseHeaders } };
    // Minimal: read-only tools via ?mode=minimal (no env needed; Cursor does not resolve ${env:...})
    mcpServers['konstruct-minimal'] = { url: getMcpUrl('minimal'), headers: baseHeaders };
    // Full: all tools via ?mode=full (explicit; no env needed)
    mcpServers['konstruct-full'] = { url: getMcpUrl('full'), headers: baseHeaders };

    const out = JSON.stringify({ mcpServers }, null, 2);
    fs.writeFileSync(mcpPath, out + '\n', 'utf-8');
    log.debug('ensureCursorMcpConfig wrote konstruct entry to', mcpPath);
  } catch (err) {
    log.warn('ensureCursorMcpConfig failed', err);
  }
}
