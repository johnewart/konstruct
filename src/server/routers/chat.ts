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

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import * as sessionStore from '../services/sessionStore';
import * as runProgressStore from '../services/runProgressStore';
import { getAllModes, getMode } from '../services/modes';
import { getAllProviders } from '../services/providers';
import { getCombinedRules, runAgentLoop } from '../agent/runLoop';

const PLANS_DIR = '.konstruct/plans';
const RULES_DIR = '.konstruct/rules';
const AGENT_WORKER_URL = process.env.AGENT_WORKER_URL;

/** Safe rule filename: alphanumeric, dash, underscore, dot. */
function isSafeRuleName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 120 &&
    /^[a-zA-Z0-9_.-]+$/.test(name) &&
    !name.includes('..')
  );
}

export const chatRouter = router({
  listModes: publicProcedure.query(() => getAllModes()),

  listProviders: publicProcedure.query(({ ctx }) =>
    getAllProviders(ctx.projectRoot)
  ),

  listPlans: publicProcedure.query(({ ctx }) => {
    const dir = path.join(ctx.projectRoot, PLANS_DIR);
    if (!fs.existsSync(dir)) return [];
    const names = fs.readdirSync(dir, { withFileTypes: true });
    return names
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: `${PLANS_DIR}/${e.name}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  getPlanContent: publicProcedure
    .input(
      z.object({
        name: z
          .string()
          .refine((n) => !n.includes('..') && !path.isAbsolute(n)),
      })
    )
    .query(({ ctx, input }) => {
      const dir = path.resolve(ctx.projectRoot, PLANS_DIR);
      const fullPath = path.join(dir, input.name);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(dir) || !fs.existsSync(resolved))
        throw new Error('Plan not found');
      return fs.readFileSync(resolved, 'utf-8');
    }),

  listRules: publicProcedure.query(({ ctx }) => {
    const dir = path.join(ctx.projectRoot, RULES_DIR);
    if (!fs.existsSync(dir)) return [];
    const names = fs.readdirSync(dir, { withFileTypes: true });
    return names
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  getRuleContent: publicProcedure
    .input(z.object({ name: z.string().refine(isSafeRuleName) }))
    .query(({ ctx, input }) => {
      const dir = path.resolve(ctx.projectRoot, RULES_DIR);
      const fullPath = path.join(dir, input.name);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(dir) || !fs.existsSync(resolved))
        throw new Error('Rule file not found');
      return fs.readFileSync(resolved, 'utf-8');
    }),

  saveRule: publicProcedure
    .input(
      z.object({ name: z.string().refine(isSafeRuleName), content: z.string() })
    )
    .mutation(({ ctx, input }) => {
      const dir = path.resolve(ctx.projectRoot, RULES_DIR);
      const fullPath = path.join(dir, input.name);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(dir)) throw new Error('Invalid path');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, input.content, 'utf-8');
      return { ok: true };
    }),

  getRunProgress: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      if (AGENT_WORKER_URL) {
        try {
          const res = await fetch(
            `${AGENT_WORKER_URL.replace(/\/$/, '')}/progress/${encodeURIComponent(input.sessionId)}`
          );
          if (!res.ok) return { entries: [], running: false };
          return (await res.json()) as {
            entries: {
              type: 'status' | 'tool';
              description?: string;
              toolName?: string;
              resultSummary?: string;
              pending?: boolean;
            }[];
            running: boolean;
          };
        } catch {
          return { entries: [], running: false };
        }
      }
      return {
        entries: runProgressStore.getProgress(input.sessionId),
        running: runProgressStore.isRunning(input.sessionId),
      };
    }),

  getContext: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        modeId: z.string().optional(),
      })
    )
    .query(({ input, ctx }) => {
      const session = sessionStore.getSession(input.sessionId);
      if (!session) throw new Error('Session not found');
      const modeId = input.modeId ?? 'implementation';
      const mode = getMode(modeId);
      let systemPrompt =
        mode?.systemPrompt ?? getMode('implementation')!.systemPrompt;
      const combinedRules = getCombinedRules(ctx.projectRoot);
      if (combinedRules) systemPrompt = systemPrompt + '\n\n' + combinedRules;
      const messages = session.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls?.length && { toolCalls: m.toolCalls }),
        ...(m.toolCallId != null && { toolCallId: m.toolCallId }),
      }));
      return {
        systemPrompt,
        modeId,
        modeName: mode?.name ?? 'Implementer',
        messages,
      };
    }),

  abortRun: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      if (AGENT_WORKER_URL) {
        try {
          const res = await fetch(
            `${AGENT_WORKER_URL.replace(/\/$/, '')}/abort/${encodeURIComponent(input.sessionId)}`,
            {
              method: 'POST',
            }
          );
          if (!res.ok) return { ok: false };
          return { ok: true };
        } catch {
          return { ok: false };
        }
      }
      return { ok: false };
    }),

  sendMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        content: z.string().min(1),
        modeId: z.string().optional(),
        providerId: z.string().optional(),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (AGENT_WORKER_URL) {
        const res = await fetch(`${AGENT_WORKER_URL.replace(/\/$/, '')}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: input.sessionId,
            content: input.content,
            modeId: input.modeId,
            providerId: input.providerId,
            model: input.model,
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Agent worker unavailable: ${res.status} ${err}`);
        }
        // Return current session so client has something; it will refetch when run completes
        const session = sessionStore.getSession(input.sessionId);
        if (!session) throw new Error('Session not found');
        return session;
      }

      return runAgentLoop({
        projectRoot: ctx.projectRoot,
        sessionId: input.sessionId,
        content: input.content,
        modeId: input.modeId,
        providerId: input.providerId,
        model: input.model,
        progressStore: runProgressStore,
      });
    }),
});
