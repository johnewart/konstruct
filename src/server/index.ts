import 'dotenv/config';
import { Elysia } from 'elysia';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import path from 'path';
import { existsSync } from 'fs';
import { appRouter } from './trpc/router';
import { createContext } from './trpc/context';
import * as documentStore from './services/documentStore';
import * as agentStream from './agentStream';
import { createLogger } from './logger';

const log = createLogger('server');

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

const app = new Elysia()
  .onRequest(({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith('/trpc')) log.debug(request.method, pathname);
  })
  .get(`${TRPC_ENDPOINT}/*`, async ({ request, params }) =>
    trpcHandler(request, params)
  )
  .post(`${TRPC_ENDPOINT}/*`, async ({ request, params }) =>
    trpcHandler(request, params)
  )
  .post('/api/doc', async ({ request, set }) => {
    try {
      const b = (await request.json()) as {
        title?: string;
        content?: string;
        type?: string;
      };
      if (!b?.title || !b?.content) {
        set.status = 400;
        return { error: 'Title and content are required' };
      }
      const doc = documentStore.addDocument({
        title: b.title,
        content: b.content,
        type: (b.type as 'plan' | 'design' | 'generic') || 'generic',
      });
      set.status = 200;
      return { success: true, id: doc.id, url: `/doc/${doc.id}` };
    } catch (e) {
      set.status = 400;
      return { error: 'Invalid JSON' };
    }
  })
  .get('/api/docs', () => documentStore.listDocuments())
  .get('/assets/*', ({ params }) => {
    const filePath = path.join(distPath, 'assets', params['*'] ?? '');
    if (existsSync(filePath)) {
      return Bun.file(filePath);
    }
    return new Response('Not Found', { status: 404 });
  })
  .ws('/agent-stream', {
    open(ws) {
      (ws.raw as { data?: { role?: string; sessionId?: string } }).data = {};
    },
    message(ws, message) {
      const raw = ws.raw as {
        data?: { role?: string; sessionId?: string };
        send: (s: string) => void;
        readyState: number;
      };
      let data: unknown;
      try {
        data = typeof message === 'string' ? JSON.parse(message) : message;
      } catch {
        return;
      }
      if (!data || typeof data !== 'object') return;
      const obj = data as Record<string, unknown>;
      if (obj.role === 'worker') {
        raw.data = raw.data ?? {};
        raw.data.role = 'worker';
        agentStream.setWorker(raw);
        return;
      }
      if (obj.type === 'subscribe' && typeof obj.sessionId === 'string') {
        raw.data = raw.data ?? {};
        raw.data.sessionId = obj.sessionId;
        agentStream.addSubscriber(obj.sessionId, raw);
        return;
      }
      if (raw.data?.role === 'worker' && typeof obj.sessionId === 'string') {
        agentStream.broadcastToSession(obj.sessionId, JSON.stringify(obj));
      }
    },
    close(ws) {
      const raw = ws.raw as {
        data?: { role?: string; sessionId?: string };
        send: (s: string) => void;
        readyState: number;
      };
      agentStream.clearWorker(raw);
      if (raw.data?.sessionId) {
        agentStream.removeSubscriber(raw.data.sessionId, raw);
      }
    },
  })
  .get('*', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/trpc') || url.pathname.startsWith('/api')) {
      return new Response('Not Found', { status: 404 });
    }
    const indexHtml = path.join(distPath, 'index.html');
    if (existsSync(indexHtml)) {
      return new Response(Bun.file(indexHtml), {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    return new Response('Not Found', { status: 404 });
  })
  .listen(3001);

log.info('Server running', `http://localhost:${app.server?.port}`);
