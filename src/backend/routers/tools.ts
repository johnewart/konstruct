/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use it except in compliance with the License.
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
import { getToolsForMode } from '../../agent/toolDefinitions';
import { MODE_IDS } from '../../agent/modes';
import { getDisabledToolsForProject, setDisabledToolsForProject } from '../../shared/config';

export const toolsRouter = router({
  /** List all known tools (same source as MCP: getToolsForMode per mode, merged). */
  listAll: publicProcedure.query(() => {
    const seen = new Set<string>();
    const tools: { name: string; description: string }[] = [];
    for (const modeId of Object.values(MODE_IDS)) {
      const defs = getToolsForMode(modeId);
      for (const t of defs) {
        const name = t.function.name;
        if (seen.has(name)) continue;
        seen.add(name);
        tools.push({
          name,
          description: t.function.description ?? '',
        });
      }
    }
    tools.sort((a, b) => a.name.localeCompare(b.name));
    return { tools };
  }),

  /** Get the list of disabled tool names for a project. */
  getDisabledTools: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(({ input }) => {
      const disabled = getDisabledToolsForProject(input.projectId);
      return { projectId: input.projectId, disabled };
    }),

  /** Set (replace) the disabled tool names for a project. Pass empty array to clear. */
  setDisabledTools: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        disabled: z.array(z.string()),
      })
    )
    .mutation(({ input }) => {
      setDisabledToolsForProject(input.projectId, input.disabled);
      return { ok: true };
    }),
});
