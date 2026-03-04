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
import * as codebaseOutline from '../../shared/codebaseOutline';

export const codebaseRouter = router({
  /** Get dependency graph for a path (default: project root). Uses tree-sitter; may be empty if tree-sitter is unavailable. */
  getDependencyGraph: publicProcedure
    .input(
      z
        .object({
          path: z.string().optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => {
      const pathArg = input?.path?.trim() || '.';
      try {
        const { dependencyGraph, truncated } = codebaseOutline.outlinePath(
          ctx.projectRoot,
          pathArg,
          null
        );
        const loadErr = codebaseOutline.getOutlineLoadError();
        if (loadErr) {
          const hint =
            'Rebuild with the same Node version you run with: npm rebuild tree-sitter tree-sitter-javascript tree-sitter-python tree-sitter-typescript';
          return {
            error: `Tree-sitter failed to load: ${loadErr.message}. ${hint}`,
            nodes: [],
            edges: [],
            truncated: false,
          };
        }
        return {
          error: null,
          nodes: dependencyGraph?.nodes ?? [],
          edges: dependencyGraph?.edges ?? [],
          truncated: truncated ?? false,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          error: message,
          nodes: [],
          edges: [],
          truncated: false,
        };
      }
    }),
});
