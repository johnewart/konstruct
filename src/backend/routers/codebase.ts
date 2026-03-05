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
import { buildDependencyGraph, normalizeEdgeTargetsToKnownFiles } from '../../shared/dependencyGraph';
import { getGitRepoPath } from '../git';

/** Higher limits for background full-graph build (Code Explorer). */
const CODE_EXPLORER_MAX_FILES = 5000;
const PARSING_BATCH_SIZE = 25;
/** Process this many files per tick so we yield often and can respond to progress polls. */
const PARSING_YIELD_EVERY = 5;
/** Delay (ms) between chunks so the event loop can run and CPU doesn't peg. */
const CHUNK_YIELD_MS = 8;
/** Cache TTL: dependency graph entries expire after 1 hour. */
const CACHE_TTL_MS = 60 * 60 * 1000;

type CachedGraph = {
  nodes: Array<{ path: string }>;
  edges: Array<{ source: string; target: string; type: string }>;
  truncated: boolean;
  cachedAt: number;
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
/** Only one dependency graph build at a time (any key). Prevents multiple rebuilds from racing. */
let currentBuildKey: string | null = null;
/** Keys invalidated while a build was in progress; when that build completes it must not overwrite the cache. */
const invalidatedKeys = new Set<string>();

function cacheKey(projectRoot: string, pathArg: string): string {
  return `${projectRoot}|${pathArg}`;
}

/** Return cached dependency graph for a path if present and not expired. Used by PR overview to get inbound deps. */
export function getCachedDependencyGraph(
  projectRoot: string,
  pathArg: string = '.'
): { nodes: Array<{ path: string }>; edges: Array<{ source: string; target: string; type: string }> } | null {
  const key = cacheKey(projectRoot, pathArg);
  const cached = graphCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > CACHE_TTL_MS) return null;
  return { nodes: cached.nodes, edges: cached.edges };
}

/** Root path (projectRoot + pathArg) with trailing slash, normalized. Used as fallback when not in a git repo. */
function getPathStripPrefix(projectRoot: string, pathArg: string): string {
  let p = path.join(projectRoot, pathArg).replace(/\\/g, '/');
  if (!p.endsWith('/')) p += '/';
  return p;
}

/** Prefer git repo root so all dependency graph paths are relative to the same root as .git. */
function getStripPrefixForGraph(projectRoot: string, pathArg: string): string {
  const gitRoot = getGitRepoPath(projectRoot);
  if (gitRoot) {
    let p = path.join(gitRoot, '').replace(/\\/g, '/');
    if (!p.endsWith('/')) p += '/';
    return p;
  }
  return getPathStripPrefix(projectRoot, pathArg);
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
      const pathStripPrefix = getStripPrefixForGraph(ctx.projectRoot, pathArg);

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
        const age = Date.now() - cached.cachedAt;
        if (age <= CACHE_TTL_MS) {
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
        graphCache.delete(key);
      }

      const building = buildStateMap.get(key);
      if (building) {
        if (building.phase === 'error') {
          buildStateMap.delete(key);
          if (currentBuildKey === key) currentBuildKey = null;
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

      if (currentBuildKey !== null) {
        if (currentBuildKey === key) {
          return {
            error: null,
            nodes: [],
            edges: [],
            truncated: false,
            building: true,
            phase: 'parsing',
            filesProcessed: 0,
            totalFiles: 0,
            currentDir: undefined,
            pathStripPrefix,
          };
        }
        const otherState = buildStateMap.get(currentBuildKey);
        if (otherState && otherState.phase !== 'error') {
          return {
            error: null,
            nodes: [],
            edges: [],
            truncated: false,
            building: true,
            phase: otherState.phase,
            filesProcessed: otherState.filesProcessed,
            totalFiles: otherState.totalFiles,
            currentDir: otherState.currentDir ?? undefined,
            pathStripPrefix,
          };
        }
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

      currentBuildKey = key;
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
        try {
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
          const batchEnd = Math.min(startIndex + PARSING_BATCH_SIZE, list.length);
          const yieldEnd = Math.min(startIndex + PARSING_YIELD_EVERY, batchEnd);
          for (let i = startIndex; i < yieldEnd; i++) {
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
          const end = yieldEnd;
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
            const nextStart = end;
            setTimeout(() => parseBatch(nextStart), CHUNK_YIELD_MS);
            return;
          }
          console.log(`[codebase] Dependency graph built: ${allNodes.length} nodes, ${allEdges.length} edges`);
          if (!invalidatedKeys.has(key)) {
            const knownFiles = new Set(list);
            const normalizedEdges = normalizeEdgeTargetsToKnownFiles(allEdges, knownFiles);
            const rootPrefix = getStripPrefixForGraph(projectRoot, pathArg);
            const strippedNodes = allNodes.map((n) => ({ path: stripRootFromPath(n.path, rootPrefix) }));
            const strippedEdges = normalizedEdges.map((e) => ({
              source: stripRootFromPath(e.source, rootPrefix),
              target: stripRootFromPath(e.target, rootPrefix),
              type: e.type,
            }));
            graphCache.set(key, {
              nodes: strippedNodes,
              edges: strippedEdges,
              truncated: false,
              cachedAt: Date.now(),
            });
          }
          invalidatedKeys.delete(key);
          buildStateMap.delete(key);
          if (currentBuildKey === key) currentBuildKey = null;
        }

        parseBatch(0);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          buildStateMap.set(key, { phase: 'error', error: msg });
          if (currentBuildKey === key) currentBuildKey = null;
        }
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

  /** Clear cached dependency graph for a path so the next getDependencyGraph will rebuild.
   * If a build for this key is currently running, we do not clear its state or allow a new build
   * to start; we only clear the cache and mark the key invalidated so when the current build
   * completes it will not cache, and the next request will start a fresh build. */
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
      invalidatedKeys.add(key);
      if (currentBuildKey !== key) {
        buildStateMap.delete(key);
      }
      return { invalidated: true };
    }),

  /** Clear all in-memory dependency graph caches (all paths, all projects). Use from Config to force fresh builds. */
  clearAllDependencyGraphCaches: publicProcedure.mutation(() => {
    const count = graphCache.size;
    graphCache.clear();
    buildStateMap.clear();
    invalidatedKeys.clear();
    currentBuildKey = null;
    return { cleared: count };
  }),
});
