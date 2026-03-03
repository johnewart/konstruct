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

import 'dotenv/config';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { WebSocketServer } from 'ws';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from './trpc/router';
import { createContext } from './trpc/context';
import * as documentStore from '../shared/documentStore';
import * as agentStream from './agentStream';
import { createLogger } from '../shared/logger';

const log = createLogger('server');

const PORT = 3001;
const distPath = path.join(process.cwd(), 'dist');
const TRPC_ENDPOINT = '/trpc';

async function trpcHandler(request: Request, params: { '*'?: string }) {
  const procedurePath = params['*'] ?? '';
  const url = new URL(request.url);
  url.pathname = procedurePath
    ? `${TRPC_ENDPOINT}/${procedurePath}`
    : TRPC_ENDPOINT;
  const reqWithFullPath = new Request(url.toString(), request);
  return fetchRequestHandler({
    router: appRouter,
    req: reqWithFullPath,
    endpoint: TRPC_ENDPOINT,
    createContext,
    allowMethodOverride: true,
  });
}

/** Build a web Request from Node's IncomingMessage. */
function toRequest(req: http.IncomingMessage, url: string): Request {
  const method = req.method ?? 'GET';
  const body =
    method !== 'GET' && method !== 'HEAD' && req.readable
      ? (Readable.toWeb(req) as ReadableStream<Uint8Array>)
      : undefined;
  return new Request(url, {
    method,
    headers: req.headers as HeadersInit,
    body,
    duplex: 'half',
  });
}

/** Write a web Response to Node's ServerResponse. */
function writeResponse(res: http.ServerResponse, response: Response): void {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
    nodeStream.pipe(res);
  } else {
    res.end();
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<void> {
  const pathname = url.pathname;

  if (!pathname.startsWith('/trpc')) log.debug(req.method, pathname);

  // tRPC
  if (pathname.startsWith(TRPC_ENDPOINT) && (req.method === 'GET' || req.method === 'POST')) {
    const procedurePath = pathname.slice(TRPC_ENDPOINT.length).replace(/^\//, '') || undefined;
    const request = toRequest(req, url.toString());
    const response = await trpcHandler(request, { '*': procedurePath });
    writeResponse(res, response);
    return;
  }

  // POST /api/doc
  if (pathname === '/api/doc' && req.method === 'POST') {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const b = JSON.parse(Buffer.concat(chunks).toString()) as {
        title?: string;
        content?: string;
        type?: string;
      };
      if (!b?.title || !b?.content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Title and content are required' }));
        return;
      }
      const doc = documentStore.addDocument({
        title: b.title,
        content: b.content,
        type: (b.type as 'plan' | 'design' | 'generic') || 'generic',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, id: doc.id, url: `/doc/${doc.id}` }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
    return;
  }

  // GET /api/docs
  if (pathname === '/api/docs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(documentStore.listDocuments()));
    return;
  }

  // GET /assets/*
  if (pathname.startsWith('/assets/') && req.method === 'GET') {
    const assetPath = pathname.slice('/assets/'.length);
    const filePath = path.join(distPath, 'assets', assetPath);
    const resolved = path.resolve(filePath);
    const assetsDir = path.resolve(path.join(distPath, 'assets'));
    if (resolved.startsWith(assetsDir) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const content = fs.readFileSync(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const types: Record<string, string> = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
      };
      res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
      res.end(content);
    } else {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // SPA fallback: GET * (exclude /trpc, /api)
  if (req.method === 'GET' && !pathname.startsWith('/trpc') && !pathname.startsWith('/api')) {
    const indexHtml = path.join(distPath, 'index.html');
    if (fs.existsSync(indexHtml)) {
      const html = fs.readFileSync(indexHtml, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  res.writeHead(404);
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  handleRequest(req, res, url).catch((err) => {
    log.error('request error', err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end();
    }
  });
});

// WebSocket /agent-stream
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', `http://localhost:${PORT}`).pathname;
  if (pathname !== '/agent-stream') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    (ws as unknown as { data?: { role?: string; sessionId?: string } }).data = {};
    wss.emit('connection', ws, request);

    ws.on('message', (raw: Buffer | string) => {
      const rawObj = ws as unknown as {
        data?: { role?: string; sessionId?: string };
        send: (s: string) => void;
        readyState: number;
      };
      let data: unknown;
      try {
        data = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!data || typeof data !== 'object') return;
      const obj = data as Record<string, unknown>;
      if (obj.role === 'worker') {
        rawObj.data = rawObj.data ?? {};
        rawObj.data.role = 'worker';
        agentStream.setWorker(rawObj);
        return;
      }
      if (obj.type === 'subscribe' && typeof obj.sessionId === 'string') {
        rawObj.data = rawObj.data ?? {};
        rawObj.data.sessionId = obj.sessionId;
        agentStream.addSubscriber(obj.sessionId, rawObj);
        return;
      }
      if (rawObj.data?.role === 'worker' && typeof obj.sessionId === 'string') {
        agentStream.broadcastToSession(obj.sessionId, JSON.stringify(obj));
      }
    });

    ws.on('close', () => {
      const rawObj = ws as unknown as {
        data?: { role?: string; sessionId?: string };
        send: (s: string) => void;
        readyState: number;
      };
      agentStream.clearWorker(rawObj);
      if (rawObj.data?.sessionId) {
        agentStream.removeSubscriber(rawObj.data.sessionId, rawObj);
      }
    });
  });
});

server.listen(PORT, () => {
  log.info('Server running', `http://localhost:${PORT}`);
});
