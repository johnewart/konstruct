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

import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import * as sessionStore from '../../shared/sessionStore';
import { createLogger } from '../../shared/logger';

const log = createLogger('sessions');

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        function: z.object({ name: z.string(), arguments: z.string() }),
      })
    )
    .optional(),
  toolCallId: z.string().optional(),
});

export const sessionsRouter = router({
  list: publicProcedure.query(() => {
    if (process.env.AGENT_WORKER_URL) sessionStore.reloadSessions();
    const list = sessionStore.listSessions();
    log.debug('list', list.length, 'sessions');
    return list;
  }),

  create: publicProcedure
    .input(z.object({ title: z.string().optional() }))
    .mutation(({ input }) => sessionStore.createSession(input.title ?? 'Chat')),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      if (process.env.AGENT_WORKER_URL) sessionStore.forceReloadSessions();
      const session = sessionStore.getSession(input.id);
      if (!session) throw new Error('Session not found');
      return session;
    }),

  updateMessages: publicProcedure
    .input(
      z.object({
        id: z.string(),
        messages: z.array(messageSchema),
      })
    )
    .mutation(({ input }) => {
      const session = sessionStore.updateSessionMessages(
        input.id,
        input.messages
      );
      if (!session) throw new Error('Session not found');
      return session;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => sessionStore.deleteSession(input.id)),

  listTodos: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => sessionStore.listTodos(input.sessionId)),

  addTodo: publicProcedure
    .input(z.object({ sessionId: z.string(), description: z.string() }))
    .mutation(({ input }) => {
      const item = sessionStore.addTodo(input.sessionId, input.description);
      if (!item) throw new Error('Session not found');
      return item;
    }),

  updateTodo: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        todoId: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
      })
    )
    .mutation(({ input }) => {
      const ok = sessionStore.updateTodo(
        input.sessionId,
        input.todoId,
        input.status
      );
      if (!ok) throw new Error('Todo not found');
      return { ok: true };
    }),

  removeTodo: publicProcedure
    .input(z.object({ sessionId: z.string(), todoId: z.string() }))
    .mutation(({ input }) => {
      const ok = sessionStore.removeTodo(input.sessionId, input.todoId);
      if (!ok) throw new Error('Todo not found');
      return { ok: true };
    }),

  updateTitle: publicProcedure
    .input(z.object({ id: z.string(), title: z.string() }))
    .mutation(({ input }) => {
      const session = sessionStore.updateSessionTitle(input.id, input.title);
      if (!session) throw new Error('Session not found');
      return session;
    }),
});
