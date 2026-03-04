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
 * Agent worker process: runs the LLM + tool loop in a separate process.
 * Pushes progress to the web server over WebSocket for real-time UI updates.
 * Set AGENT_PORT (default 3002), SERVER_URL (e.g. http://localhost:3001) for the server to connect to.
 */
import 'dotenv/config';
import http from 'node:http';
import WebSocket from 'ws';
import { runAgentLoop, type RunProgressStore } from './runLoop';
import { createLogger } from '../shared/logger';

const log = createLogger('agent-worker');

const PORT = parseInt(process.env.AGENT_PORT ?? '3002', 10);
const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
const SERVER_WS_URL =
  (process.env.SERVER_URL ?? 'http://localhost:3001').replace(/^http/, 'ws') +
  '/agent-stream';

const progressBySession = new Map<
  string,
  {
    type: 'status' | 'tool';
    description?: string;
    toolName?: string;
    resultSummary?: string;
    pending?: boolean;
  }[]
>();
const runningBySession = new Map<string, boolean>();

function getProgress(sessionId: string) {
  return progressBySession.get(sessionId) ?? [];
}
function isRunning(sessionId: string) {
  return runningBySession.get(sessionId) === true;
}

function createProgressStore(
  sendProgress: (
    sessionId: string,
    payload: { entries: unknown[]; running: boolean; done?: boolean }
  ) => void
): RunProgressStore {
  return {
    clearProgress(sessionId: string) {
      progressBySession.delete(sessionId);
      runningBySession.delete(sessionId);
    },
    setRunning(sessionId: string, running: boolean) {
      if (running) runningBySession.set(sessionId, true);
      else runningBySession.delete(sessionId);
      sendProgress(sessionId, {
        entries: getProgress(sessionId),
        running: isRunning(sessionId),
      });
    },
    pushProgress(
      sessionId: string,
      entry: {
        type: 'status' | 'tool';
        description?: string;
        toolName?: string;
        resultSummary?: string;
        pending?: boolean;
      }
    ) {
      let list = progressBySession.get(sessionId);
      if (!list) {
        list = [];
        progressBySession.set(sessionId, list);
      }
      list.push(entry);
      sendProgress(sessionId, {
        entries: getProgress(sessionId),
        running: isRunning(sessionId),
      });
    },
    updateLastResult(sessionId: string, resultSummary: string) {
      const list = progressBySession.get(sessionId);
      if (!list?.length) return;
      const last = list[list.length - 1];
      last.resultSummary = resultSummary;
      last.pending = false;
      sendProgress(sessionId, {
        entries: getProgress(sessionId),
        running: isRunning(sessionId),
      });
    },
  };
}

let streamSocket: WebSocket | null = null;

function connectStreamSocket() {
  if (streamSocket?.readyState === WebSocket.OPEN) return;
  try {
    const ws = new WebSocket(SERVER_WS_URL);
    ws.onopen = () => {
      ws.send(JSON.stringify({ role: 'worker' }));
    };
    ws.onclose = () => {
      streamSocket = null;
      setTimeout(connectStreamSocket, 2000);
    };
    ws.onerror = () => {
      streamSocket = null;
    };
    streamSocket = ws;
  } catch (e) {
    log.warn('stream socket connect failed', e);
    setTimeout(connectStreamSocket, 2000);
  }
}

function sendProgressToServer(
  sessionId: string,
  payload: { entries: unknown[]; running: boolean; done?: boolean }
) {
  if (streamSocket?.readyState !== WebSocket.OPEN) return;
  try {
    streamSocket.send(JSON.stringify({ sessionId, ...payload }));
  } catch {
    // ignore
  }
}

connectStreamSocket();

const abortControllersBySession = new Map<string, AbortController>();

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  try {
    if (req.method === 'POST' && url.pathname === '/run') {
      const raw = await parseBody(req);
      const body = JSON.parse(raw) as {
        sessionId: string;
        content: string;
        modeId?: string;
        providerId?: string;
        model?: string;
        projectRoot?: string;
        prContextText?: string;
      };
      if (!body?.sessionId || !body?.content) {
        sendJson(res, 400, { error: 'sessionId and content required' });
        return;
      }
      const sessionId = body.sessionId;
      const runProjectRoot =
        typeof body.projectRoot === 'string' && body.projectRoot.trim()
          ? body.projectRoot.trim()
          : projectRoot;
      abortControllersBySession.get(sessionId)?.abort();
      const controller = new AbortController();
      abortControllersBySession.set(sessionId, controller);
      sendProgressToServer(sessionId, { entries: [], running: true });
      const progressStore = createProgressStore((sid, payload) =>
        sendProgressToServer(sid, payload)
      );
      void runAgentLoop({
        projectRoot: runProjectRoot,
        sessionId,
        content: body.content,
        modeId: body.modeId,
        providerId: body.providerId,
        model: body.model,
        progressStore,
        signal: controller.signal,
        ...(body.prContextText ? { prContextText: body.prContextText } : {}),
      })
        .then(() => {
          abortControllersBySession.delete(sessionId);
          sendProgressToServer(sessionId, {
            entries: getProgress(sessionId),
            running: false,
            done: true,
          });
        })
        .catch((err) => {
          abortControllersBySession.delete(sessionId);
          if (err?.name !== 'AbortError') log.error('runLoop error', err);
          sendProgressToServer(sessionId, {
            entries: getProgress(sessionId),
            running: false,
            done: true,
          });
        });
      sendJson(res, 200, { accepted: true });
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/abort/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/abort/'.length));
      const controller = abortControllersBySession.get(sessionId);
      if (controller) {
        controller.abort();
        abortControllersBySession.delete(sessionId);
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/progress/')) {
      const sessionId = decodeURIComponent(
        url.pathname.slice('/progress/'.length)
      );
      sendJson(res, 200, {
        entries: getProgress(sessionId),
        running: isRunning(sessionId),
      });
      return;
    }
    res.writeHead(404);
    res.end('Not Found');
  } catch (e) {
    log.error('request error', e);
    sendJson(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  log.info('listening', `http://localhost:${PORT}`, 'projectRoot:', projectRoot);
});
