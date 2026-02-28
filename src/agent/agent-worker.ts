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

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (req.method === 'POST' && url.pathname === '/run') {
        const body = (await req.json()) as {
          sessionId: string;
          content: string;
          modeId?: string;
          providerId?: string;
          model?: string;
        };
        if (!body?.sessionId || !body?.content) {
          return new Response(
            JSON.stringify({ error: 'sessionId and content required' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
        const sessionId = body.sessionId;
        abortControllersBySession.get(sessionId)?.abort();
        const controller = new AbortController();
        abortControllersBySession.set(sessionId, controller);
        sendProgressToServer(sessionId, { entries: [], running: true });
        const progressStore = createProgressStore((sid, payload) =>
          sendProgressToServer(sid, payload)
        );
        void runAgentLoop({
          projectRoot,
          sessionId,
          content: body.content,
          modeId: body.modeId,
          providerId: body.providerId,
          model: body.model,
          progressStore,
          signal: controller.signal,
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
        return new Response(JSON.stringify({ accepted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/abort/')) {
        const sessionId = decodeURIComponent(
          url.pathname.slice('/abort/'.length)
        );
        const controller = abortControllersBySession.get(sessionId);
        if (controller) {
          controller.abort();
          abortControllersBySession.delete(sessionId);
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/progress/')) {
        const sessionId = decodeURIComponent(
          url.pathname.slice('/progress/'.length)
        );
        return new Response(
          JSON.stringify({
            entries: getProgress(sessionId),
            running: isRunning(sessionId),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      log.error('request error', e);
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
});

log.info(
  'listening',
  `http://localhost:${server.port}`,
  'projectRoot:',
  projectRoot
);
