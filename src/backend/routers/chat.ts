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
import * as sessionStore from '../../shared/sessionStore';
import * as runProgressStore from '../../agent/runProgressStore';
import { getAllModes, getMode } from '../../agent/modes';
import { getAllModeInstructions, getModeInstructions, setModeInstructions, getProjectModel } from '../../shared/config';
import { getAllProviders } from '../../shared/providers';
import { getCombinedRules, runAgentLoop } from '../../agent/runLoop';
import * as agentStream from '../agentStream';

const PLANS_DIR = '.konstruct/plans';
const RULES_DIR = '.konstruct/rules';
const AGENT_WORKER_URL = process.env.AGENT_WORKER_URL;

/** When running the agent in-process (no worker), allow cancel to abort the run. */
const inProcessAbortControllers = new Map<string, AbortController>();

function isSafeRuleName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 120 &&
    /^[a-zA-Z0-9_.-]+$/.test(name) &&
    !name.includes('..')
  );
}

/**
 * Convert a filename to a title-cased label
 * If the file has an H1 header, use that (removing "Plan:" prefix)
 * Otherwise, title-case the filename without extension
 */
export function getPlanDisplayLabel(name: string, content?: string): string {
  // Remove file extension if present
  const baseName = name.replace(/\.(md|markdown|plan|konstruct)$/, '');
  
  // Try to extract H1 header from content if provided
  if (content) {
    const h1Match = content.match(/^#\s+(.*)$/m);
    if (h1Match) {
      let title = h1Match[1].trim();
      // Remove "Plan:" or "Plan" prefix
      title = title.replace(/^Plan:\s*/i, '').replace(/^Plan\s+/i, '');
      return title;
    }
  }
  
  // Title-case the filename
  return titleCase(baseName);
}

/**
 * Convert a string to title case
 * Handles common acronyms like CLI, API, etc.
 */
export function titleCase(str: string): string {
  const acronyms = ['cli', 'api', 'ui', 'id', 'url', 'html', 'css', 'json', 'xml'];
  
  return str
    .split(/[\s_-]+/)  // Split by spaces, underscores, or hyphens
    .filter(word => word.length > 0)
    .map(word => {
      const lowerWord = word.toLowerCase();
      // If it's a known acronym, keep it uppercase
      if (acronyms.includes(lowerWord)) {
        return word.toUpperCase();
      }
      // Otherwise title-case the word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export const chatRouter = router({
  listModes: publicProcedure.query(() => getAllModes()),

  getModeInstructions: publicProcedure.query(() => getAllModeInstructions()),

  setModeInstructions: publicProcedure
    .input(z.object({ modeId: z.string(), instructions: z.string() }))
    .mutation(({ input }) => {
      setModeInstructions(input.modeId, input.instructions);
    }),

  listProviders: publicProcedure.query(({ ctx }) =>
    getAllProviders(ctx.workspace.getLocalPath() ?? '')
  ),

  setDefaultProvider: publicProcedure
    .input(z.object({ providerId: z.string() }))
    .mutation(({ ctx, input }) => {
      // Validate provider exists
      const providers = getAllProviders(ctx.workspace.getLocalPath() ?? '');
      const provider = providers.providers.find((p) => p.id === input.providerId);
      
      if (!provider) {
        throw new Error(`Provider "${input.providerId}" not found`);
      }
      
      if (!provider.configured) {
        console.warn(`Provider "${input.providerId}" is not configured`);
      }
      
      // Store the provider selection in project config
      // For now, we'll just validate and return success
      // The CLI will manage this locally since there's no persistent config yet
      
      return {
        success: true,
        provider: {
          id: provider.id,
          name: provider.name,
          configured: provider.configured,
        },
      };
    }),

  listPlans: publicProcedure.query(({ ctx }) => {
    const dir = path.join(ctx.workspace.getLocalPath() ?? '', PLANS_DIR);
    if (!fs.existsSync(dir)) return [];
    const names = fs.readdirSync(dir, { withFileTypes: true });
    const filtered = names.filter((e) => e.isFile() && !e.name.startsWith('.'));
    
    // Map to include both name and display label
    return filtered
      .map((e) => {
        const planPath = path.join(dir, e.name);
        let content;
        try {
          content = fs.readFileSync(planPath, 'utf-8');
        } catch {
          content = undefined;
        }
        
        return {
          name: e.name,
          path: `${PLANS_DIR}/${e.name}`,
          label: getPlanDisplayLabel(e.name, content)
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
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
      const dir = path.resolve(ctx.workspace.getLocalPath() ?? '', PLANS_DIR);
      const fullPath = path.join(dir, input.name);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(dir) || !fs.existsSync(resolved))
        throw new Error('Plan not found');
      return fs.readFileSync(resolved, 'utf-8');
    }),

  listRules: publicProcedure.query(({ ctx }) => {
    const dir = path.join(ctx.workspace.getLocalPath() ?? '', RULES_DIR);
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
      const dir = path.resolve(ctx.workspace.getLocalPath() ?? '', RULES_DIR);
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
      const dir = path.resolve(ctx.workspace.getLocalPath() ?? '', RULES_DIR);
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
      const projectId = ctx.workspace.id;
      const session = sessionStore.getSession(input.sessionId, projectId);
      if (!session) throw new Error('Session not found');
      const modeId = input.modeId ?? 'implementation';
      const mode = getMode(modeId);
      let systemPrompt =
        mode?.systemPrompt ?? getMode('implementation')!.systemPrompt;
      const combinedRules = getCombinedRules(ctx.workspace.getLocalPath() ?? '');
      if (combinedRules) systemPrompt = systemPrompt + '\n\n' + combinedRules;
      const extendedInstructions = getModeInstructions(modeId);
      if (extendedInstructions) systemPrompt = systemPrompt + '\n\n' + extendedInstructions;
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
      const controller = inProcessAbortControllers.get(input.sessionId);
      if (controller) {
        controller.abort();
        inProcessAbortControllers.delete(input.sessionId);
        return { ok: true };
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
        /** When set, PR title/body/diff are fetched and added to agent context (for PR page chat). */
        prContext: z.object({ pullNumber: z.number().int().positive() }).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let prContextText: string | undefined;
      if (input.prContext) {
        const { getPRContextForAgent } = await import('./github');
        try {
          prContextText = await getPRContextForAgent(ctx.workspace.getLocalPath() ?? '', input.prContext.pullNumber);
        } catch (err) {
          console.warn('[chat] getPRContextForAgent failed for PR', input.prContext.pullNumber, err);
          prContextText = '';
        }
      }

      const projectId = ctx.workspace.id;
      const storedProjectModel = projectId ? getProjectModel(projectId) : undefined;
      const effectiveProviderId = input.providerId ?? storedProjectModel?.providerId;
      const effectiveModelId = input.model ?? storedProjectModel?.modelId;

      if (AGENT_WORKER_URL) {
        const res = await fetch(`${AGENT_WORKER_URL.replace(/\/$/, '')}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: input.sessionId,
            content: input.content,
            modeId: input.modeId,
            providerId: effectiveProviderId,
            model: effectiveModelId,
            projectRoot: ctx.workspace.getLocalPath() ?? '',
            ...(prContextText ? { prContextText } : {}),
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Agent worker unavailable: ${res.status} ${err}`);
        }
        const session = sessionStore.getSession(input.sessionId, projectId);
        if (!session) throw new Error('Session not found');
        return session;
      }

      const controller = new AbortController();
      inProcessAbortControllers.set(input.sessionId, controller);
      try {
        const session = await runAgentLoop({
          workspace: ctx.workspace,
          sessionId: input.sessionId,
          content: input.content,
          modeId: input.modeId,
          providerId: effectiveProviderId,
          model: effectiveModelId,
          progressStore: runProgressStore,
          signal: controller.signal,
          ...(prContextText ? { prContextText } : {}),
        });
        agentStream.broadcastToSession(
          input.sessionId,
          JSON.stringify({ sessionId: input.sessionId, done: true })
        );
        return session;
      } finally {
        inProcessAbortControllers.delete(input.sessionId);
      }
    }),
});
