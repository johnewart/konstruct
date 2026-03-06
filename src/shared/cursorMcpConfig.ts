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
 * so Cursor can connect to Konstruct's MCP endpoint. Uses "${env:VAR}" placeholders
 * so Cursor expands them when connecting (e.g. KONSTRUCT_AGENT_NAME to limit tools).
 *
 * Node-only: uses require('fs')/require('path') at runtime so shared bundle stays safe.
 */

import { createLogger } from './logger';

const log = createLogger('cursor-mcp');
const SERVER_NAME = 'konstruct';

function getMcpUrl(): string {
  const base =
    (typeof process !== 'undefined' && process.env?.KONSTRUCT_MCP_BASE_URL) ?? 'http://localhost:3001';
  return base.replace(/\/$/, '') + '/mcp';
}

export function ensureCursorMcpConfig(projectRoot: string): void {
  if (!projectRoot?.trim()) {
    log.debug('ensureCursorMcpConfig skipped: no projectRoot');
    return;
  }
  const g = typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : undefined;
  const req = typeof require !== 'undefined' ? require : (g as { require?: NodeRequire })?.require;
  if (!req) {
    log.debug('ensureCursorMcpConfig skipped: require not available (non-Node?)');
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

    mcpServers[SERVER_NAME] = {
      url: getMcpUrl(),
      headers: {
        'X-Agent-Name': '${env:KONSTRUCT_AGENT_NAME}',
        API_KEY: '${env:KONSTRUCT_API_KEY}',
      },
    };

    const out = JSON.stringify({ mcpServers }, null, 2);
    fs.writeFileSync(mcpPath, out + '\n', 'utf-8');
    log.debug('ensureCursorMcpConfig wrote konstruct entry to', mcpPath);
  } catch (err) {
    log.warn('ensureCursorMcpConfig failed', err);
  }
}
