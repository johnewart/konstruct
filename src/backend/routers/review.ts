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
import { reviewSessionManager } from '../services/reviewSession';
import { isGitRepository } from '../git';

const projectToSessionId = new Map<string, string>();

export const reviewRouter = router({
  getOrCreateSession: publicProcedure.query(({ ctx }) => {
    const projectRoot = ctx.projectRoot;
    if (!isGitRepository(projectRoot)) {
      return null;
    }
    const existing = projectToSessionId.get(projectRoot);
    if (existing) {
      const session = reviewSessionManager.getSession(existing);
      if (session) return session;
      projectToSessionId.delete(projectRoot);
    }
    const sessionId = reviewSessionManager.createSession(projectRoot);
    projectToSessionId.set(projectRoot, sessionId);
    return reviewSessionManager.getSession(sessionId) ?? null;
  }),

  /** Start a new review session for the current project (ctx.projectRoot). */
  startReviewSession: publicProcedure.mutation(({ ctx }) => {
    const projectRoot = ctx.projectRoot;
    if (!isGitRepository(projectRoot)) {
      throw new Error('Current project is not a git repository. Cannot start a review session.');
    }
    const sessionId = reviewSessionManager.createSession(projectRoot);
    projectToSessionId.set(projectRoot, sessionId);
    const session = reviewSessionManager.getSession(sessionId);
    if (!session) throw new Error('Failed to create review session');
    return session;
  }),

  getSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      return reviewSessionManager.getSession(input.sessionId) ?? null;
    }),

  addComment: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        fileId: z.string(),
        lineNumber: z.number().int().positive(),
        text: z.string().min(1),
      })
    )
    .mutation(({ input }) => {
      return reviewSessionManager.addComment(
        input.sessionId,
        input.fileId,
        input.lineNumber,
        input.text
      );
    }),

  resolveComment: publicProcedure
    .input(z.object({ sessionId: z.string(), commentId: z.string() }))
    .mutation(({ input }) => {
      return reviewSessionManager.resolveComment(input.sessionId, input.commentId);
    }),

  deleteComment: publicProcedure
    .input(z.object({ sessionId: z.string(), commentId: z.string() }))
    .mutation(({ input }) => {
      return reviewSessionManager.deleteComment(input.sessionId, input.commentId);
    }),
});
