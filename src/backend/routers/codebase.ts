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

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import * as codebaseOutline from '../../shared/codebaseOutline';
import { buildDependencyGraph } from '../../shared/dependencyGraph';

/** Higher limits for background full-graph build (Code Explorer). */
const CODE_EXPLORER_MAX_FILES = 5000;
const PARSING_BATCH_SIZE = 25;
/** Delay (ms) between chunks so the event loop can run and CPU doesn't peg. */
const CHUNK_YIELD_MS = 8;

type CachedGraph = {
  nodes: Array<{ path: string }>;
  edges: Array<{ source: string; target: string; type: string }>;
  truncated: boolean;
};

type BuildState =
  | {
      phase: 'discovering' | 'parsing';
      filesProcessed: number;
      totalFiles: number;
      currentDir?: string;
    }
  | { phase: 'error'; error: string };

const graphCache = new Map<string, CachedGraph>();
const buildStateMap = new Map<string, BuildState>();

function cacheKey(projectRoot: string, pathArg: string): string {
  return `${projectRoot}|${pathArg}`;
}

/** Root path (projectRoot + pathArg) with trailing slash, normalized. Strip this from all node/edge paths before caching. */
function getPathStripPrefix(projectRoot: string, pathArg: string): string {
  let p = path.join(projectRoot, pathArg).replace(/\\/g, '/');
  if (!p.endsWith('/')) p += '/';
  return p;
}

/** Strip the root prefix from a path so the frontend only sees paths under the explored dir. */
function stripRootFromPath(fullPath: string, rootPrefix: string): string {
  const n = fullPath.replace(/\\/g, '/');
  if (!rootPrefix || !n.startsWith(rootPrefix)) return n;
  const rest = n.slice(rootPrefix.length).replace(/^\//, '');
  return rest || n;
}

export const codebaseRouter = router({
  /** Get dependency graph for a path (default: project root). Uses tree-sitter; may be empty if tree-sitter is unavailable.
   * When no cached result exists, starts a background build and returns building + progress; poll until building is false. */
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
      const key = cacheKey(ctx.projectRoot, pathArg);
      let pathStripPrefix = path.join(ctx.projectRoot, pathArg).replace(/\\/g, '/');
      if (!pathStripPrefix.endsWith('/')) pathStripPrefix += '/';

      const loadErr = codebaseOutline.getOutlineLoadError();
      if (loadErr) {
        const hint =
          'Rebuild with the same Node version you run with: npm rebuild tree-sitter tree-sitter-javascript tree-sitter-python tree-sitter-typescript';
        return {
          error: `Tree-sitter failed to load: ${loadErr.message}. ${hint}`,
          nodes: [],
          edges: [],
          truncated: false,
          building: false,
          filesProcessed: 0,
          totalFiles: 0,
          pathStripPrefix,
        };
      }

      const cached = graphCache.get(key);
      if (cached) {
        return {
          error: null,
          nodes: cached.nodes,
          edges: cached.edges,
          truncated: cached.truncated,
          building: false,
          filesProcessed: cached.nodes.length,
          totalFiles: cached.nodes.length,
          pathStripPrefix,
        };
      }

      const building = buildStateMap.get(key);
      if (building) {
        if (building.phase === 'error') {
          buildStateMap.delete(key);
          return {
            error: building.error,
            nodes: [],
            edges: [],
            truncated: false,
            building: false,
            phase: undefined,
            filesProcessed: 0,
            totalFiles: 0,
            currentDir: undefined,
            pathStripPrefix,
          };
        }
        return {
          error: null,
          nodes: [],
          edges: [],
          truncated: false,
          building: true,
          phase: building.phase,
          filesProcessed: building.filesProcessed,
          totalFiles: building.totalFiles,
          currentDir: building.currentDir ?? undefined,
          pathStripPrefix,
        };
      }

      const init = codebaseOutline.getDiscoveryInitialState(ctx.projectRoot, pathArg);
      if (!init.ok) {
        return {
          error: init.error,
          nodes: [],
          edges: [],
          truncated: false,
          building: false,
          phase: undefined,
          filesProcessed: 0,
          totalFiles: 0,
          currentDir: undefined,
          pathStripPrefix,
        };
      }

      let queue = [...init.queue];
      let list = [...init.list];

      buildStateMap.set(key, {
        phase: 'discovering',
        filesProcessed: list.length,
        totalFiles: 0,
        currentDir: list.length > 0 ? path.relative(ctx.projectRoot, path.dirname(list[0])) || '.' : pathArg,
      });

      if (queue.length === 0) {
        console.log(`[codebase] Discovery done: ${list.length} file(s) (single file or empty)`);
      }

      setImmediate(function runDiscovery() {
        const step = codebaseOutline.collectFilesStep(
          queue,
          list,
          ctx.projectRoot,
          null,
          CODE_EXPLORER_MAX_FILES,
          (currentDir, filesFound) => {
            const rel = path.relative(ctx.projectRoot, currentDir) || '.';
            buildStateMap.set(key, {
              phase: 'discovering',
              filesProcessed: filesFound,
              totalFiles: 0,
              currentDir: rel,
            });
          }
        );

        if (step) {
          const rel = path.relative(ctx.projectRoot, step.lastDir) || '.';
          console.log(`[codebase] Scanning directory: ${rel} (${list.length} files found so far)`);
          setTimeout(runDiscovery, CHUNK_YIELD_MS);
          return;
        }

        console.log(`[codebase] Discovery done: ${list.length} files to parse`);
        buildStateMap.set(key, {
          phase: 'parsing',
          filesProcessed: 0,
          totalFiles: list.length,
          currentDir: undefined,
        });

        const allNodes: Array<{ path: string }> = [];
        const allEdges: Array<{ source: string; target: string; type: string }> = [];
        const projectRoot = ctx.projectRoot;

        function parseBatch(startIndex: number) {
          const end = Math.min(startIndex + PARSING_BATCH_SIZE, list.length);
          for (let i = startIndex; i < end; i++) {
            const fullPath = list[i];
            try {
              const source = fs.readFileSync(fullPath, 'utf-8');
              const ext = path.extname(fullPath).slice(1).toLowerCase();
              const graph = buildDependencyGraph(source, ext, fullPath);
              for (const node of graph.nodes) {
                if (!allNodes.some((n) => n.path === node.path))
                  allNodes.push({ path: node.path });
              }
              for (const edge of graph.edges)
                allEdges.push({ source: edge.source, target: edge.target, type: edge.type });
            } catch {
              // skip unreadable files
            }
          }
          buildStateMap.set(key, {
            phase: 'parsing',
            filesProcessed: end,
            totalFiles: list.length,
            currentDir: undefined,
          });
          if (end % 100 === 0 || end === list.length) {
            console.log(`[codebase] Parsing: ${end}/${list.length} files (${allNodes.length} nodes, ${allEdges.length} edges)`);
          }
          if (end < list.length) {
            setTimeout(() => parseBatch(end), CHUNK_YIELD_MS);
            return;
          }
          console.log(`[codebase] Dependency graph built: ${allNodes.length} nodes, ${allEdges.length} edges`);
          const rootPrefix = getPathStripPrefix(projectRoot, pathArg);
          const strippedNodes = allNodes.map((n) => ({ path: stripRootFromPath(n.path, rootPrefix) }));
          const strippedEdges = allEdges.map((e) => ({
            source: stripRootFromPath(e.source, rootPrefix),
            target: stripRootFromPath(e.target, rootPrefix),
            type: e.type,
          }));
          graphCache.set(key, { nodes: strippedNodes, edges: strippedEdges, truncated: false });
          buildStateMap.delete(key);
        }

        parseBatch(0);
      });

      return {
        error: null,
        nodes: [],
        edges: [],
        truncated: false,
        building: true,
        phase: 'discovering',
        filesProcessed: list.length,
        totalFiles: 0,
        currentDir: list.length > 0 ? path.relative(ctx.projectRoot, path.dirname(list[0])) || '.' : pathArg,
        pathStripPrefix,
      };
    }),

  /** Clear cached dependency graph for a path so the next getDependencyGraph will rebuild. */
  invalidateDependencyGraph: publicProcedure
    .input(
      z.object({
        path: z.string().optional(),
      }).optional()
    )
    .mutation(({ ctx, input }) => {
      const pathArg = input?.path?.trim() ?? '.';
      const key = cacheKey(ctx.projectRoot, pathArg);
      graphCache.delete(key);
      buildStateMap.delete(key);
      return { invalidated: true };
    }),
});
