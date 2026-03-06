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
import { Worker } from 'worker_threads';
import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import { getGitRepoPath } from '../git';

/** Cache TTL: dependency graph entries expire after 1 hour. */
const CACHE_TTL_MS = 60 * 60 * 1000;
/** Max files to include in a single graph build. */
const CODE_EXPLORER_MAX_FILES = 5000;
/** Map of supported languages to their file extensions. */
const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  python: ['.py'],
  javascript: ['.js', '.mjs', '.cjs', '.jsx'],
  typescript: ['.ts', '.tsx'],
};
/** All extensions the analyzer can currently handle. */
const ALL_PARSABLE_EXTENSIONS: string[] = Object.values(LANGUAGE_EXTENSIONS).flat();
/** Directories to skip during file discovery. */
const SKIP_DIRS: string[] = [
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.env',
  'build',
  'dist',
  '.git',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'coverage',
];

// ─── Types ───────────────────────────────────────────────────────────────────

type NodeResult = { id: string; path: string };
type EdgeResult = { source: string; target: string; type: string };

type CachedGraph = {
  nodes: NodeResult[];
  edges: EdgeResult[];
  truncated: boolean;
  cachedAt: number;
};

type BuildState =
  | {
      phase: 'discovering' | 'parsing_defs' | 'parsing_refs';
      filesProcessed: number;
      totalFiles: number;
      currentDir?: string;
      directoriesScanned?: string[];
      directoryCount?: number;
    }
  | { phase: 'error'; error: string };

// Worker message types
type WorkerMessage =
  | { type: 'dir'; dir: string; filesFound: number; directoriesScannedSoFar?: number }
  | { type: 'discovery_complete'; directories: string[]; fileCount: number }
  | { type: 'progress'; phase: 'defs' | 'refs'; filesProcessed: number; totalFiles: number }
  | { type: 'done'; nodes: NodeResult[]; edges: EdgeResult[]; truncated: boolean }
  | { type: 'error'; message: string };

// ─── In-memory state ─────────────────────────────────────────────────────────

const graphCache   = new Map<string, CachedGraph>();
const buildStateMap = new Map<string, BuildState>();
/** Key of the currently running build (only one at a time). */
let currentBuildKey: string | null = null;
/** Keys invalidated while a build was in-flight; that build must not overwrite the cache. */
const invalidatedKeys = new Set<string>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cacheKey(projectRoot: string, pathArg: string): string {
  return `${projectRoot}|${pathArg}`;
}

/**
 * Get the path prefix to strip from absolute paths so the frontend only sees
 * paths relative to the git repo root (or the project root if not in a git repo).
 */
function getStripPrefix(projectRoot: string): string {
  const gitRoot = getGitRepoPath(projectRoot);
  let p = path.join(gitRoot ?? projectRoot, '').replace(/\\/g, '/');
  if (!p.endsWith('/')) p += '/';
  return p;
}

/** Canonical `file://`-prefixed ID for a relative path (e.g. `"src/models.py"`). */
function fileId(relPath: string): string {
  return `file://${relPath.replace(/\\/g, '/').trim().replace(/^\.\/+/, '')}`;
}

/** Key for the full-project graph (scanner always builds this; path is only for filtering). */
function fullGraphKey(projectRoot: string): string {
  return cacheKey(projectRoot, '.');
}

const DEPENDENCY_GRAPH_CACHE_FILENAME = 'dependency-graph.json';

function getGraphCachePath(projectRoot: string): string {
  return path.join(projectRoot, '.konstruct', DEPENDENCY_GRAPH_CACHE_FILENAME);
}

/** Load the dependency graph from disk if present. Does not check in-memory cache. */
function loadGraphCacheFromDisk(projectRoot: string): CachedGraph | null {
  const filePath = getGraphCachePath(projectRoot);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as { nodes: NodeResult[]; edges: EdgeResult[]; truncated: boolean; cachedAt?: number };
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges) || typeof data.truncated !== 'boolean') {
      return null;
    }
    return {
      nodes: data.nodes,
      edges: data.edges,
      truncated: data.truncated,
      cachedAt: typeof data.cachedAt === 'number' ? data.cachedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

/** Persist the dependency graph to disk so it survives restarts. */
function saveGraphCacheToDisk(projectRoot: string, data: CachedGraph): void {
  const dir = path.join(projectRoot, '.konstruct');
  const filePath = getGraphCachePath(projectRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ nodes: data.nodes, edges: data.edges, truncated: data.truncated, cachedAt: data.cachedAt }), 'utf-8');
  } catch (err) {
    console.error(`[codebase] Failed to write graph cache to ${filePath}:`, err);
  }
}

/** Remove the persisted graph cache so the next load will trigger a rebuild. */
function deleteGraphCacheFromDisk(projectRoot: string): void {
  const filePath = getGraphCachePath(projectRoot);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

/**
 * Filter nodes and edges to those under `pathPrefix` (e.g. '.' = all, 'src' = src/ and below).
 * Path prefix is normalized (no leading ./).
 */
function filterGraphByPath(
  nodes: NodeResult[],
  edges: EdgeResult[],
  pathPrefix: string,
): { nodes: NodeResult[]; edges: EdgeResult[] } {
  if (!pathPrefix || pathPrefix === '.') {
    return { nodes, edges };
  }
  const prefix = pathPrefix.replace(/\\/g, '/').trim().replace(/^\.\/+/, '');
  const prefixWithSlash = prefix.endsWith('/') ? prefix : prefix + '/';
  const nodeMatches = (p: string): boolean =>
    p === prefix || p.startsWith(prefixWithSlash);
  const filteredNodes = nodes.filter((n) => nodeMatches(n.path));
  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );
  return { nodes: filteredNodes, edges: filteredEdges };
}

/**
 * Spawn a worker thread that discovers + analyzes files, posting progress
 * messages back.  Updates `buildStateMap` and `graphCache` as messages arrive.
 */
function spawnAnalysisWorker(
  key: string,
  targetDir: string,
  stripPrefix: string,
): void {
  const workerPath = new URL(
    '../workers/codebaseAnalyzer.worker.ts',
    import.meta.url,
  );

  const worker = new Worker(workerPath, {
    // Use the same tsx loader the main process uses so .ts imports resolve.
    execArgv: ['--import', 'tsx'],
    workerData: {
      targetDir,
      languageExtensions: LANGUAGE_EXTENSIONS,
      extensions:         ALL_PARSABLE_EXTENSIONS,
      maxFiles:           CODE_EXPLORER_MAX_FILES,
      skipDirs:           SKIP_DIRS,
      stripPrefix,
    },
  });

  worker.on('message', (msg: WorkerMessage) => {
    switch (msg.type) {
      case 'dir':
        // A new directory was entered during discovery — update progress and log (main process so it appears in server output)
        console.log(`[codebase] Scanning directory: ${msg.dir}`);
        {
          const prev = buildStateMap.get(key);
          const state = prev ?? { phase: 'discovering' as const, filesProcessed: 0, totalFiles: 0 };
          if (state.phase !== 'error') {
            buildStateMap.set(key, {
              ...state,
              phase: 'discovering',
              filesProcessed: msg.filesFound,
              totalFiles: state.totalFiles,
              currentDir: msg.dir,
              directoryCount: msg.directoriesScannedSoFar ?? state.directoryCount,
            });
          }
        }
        break;

      case 'discovery_complete':
        {
          const prev = buildStateMap.get(key);
          const state = prev ?? { phase: 'discovering' as const, filesProcessed: 0, totalFiles: 0 };
          if (state.phase !== 'error') {
            buildStateMap.set(key, {
              ...state,
              phase: 'discovering',
              filesProcessed: msg.fileCount,
              totalFiles: msg.fileCount,
              currentDir: undefined,
              directoriesScanned: msg.directories,
              directoryCount: msg.directories.length,
            });
          }
        }
        break;

      case 'progress':
        {
          const prev = buildStateMap.get(key);
          buildStateMap.set(key, {
            ...prev,
            phase:          msg.phase === 'defs' ? 'parsing_defs' : 'parsing_refs',
            filesProcessed: msg.filesProcessed,
            totalFiles:     msg.totalFiles,
          });
        }
        break;

      case 'done':
        if (!invalidatedKeys.has(key)) {
          const cachedAt = Date.now();
          const graphData: CachedGraph = {
            nodes:    msg.nodes,
            edges:    msg.edges,
            truncated: msg.truncated,
            cachedAt,
          };
          graphCache.set(key, graphData);
          const projectRoot = key.replace(/\|\.$/, '');
          saveGraphCacheToDisk(projectRoot, graphData);
        }
        invalidatedKeys.delete(key);
        buildStateMap.delete(key);
        if (currentBuildKey === key) currentBuildKey = null;
        break;

      case 'error':
        console.error(`[codebase] Worker reported error: ${msg.message}`);
        buildStateMap.set(key, { phase: 'error', error: msg.message });
        if (currentBuildKey === key) currentBuildKey = null;
        break;
    }
  });

  worker.on('error', (err) => {
    console.error(`[codebase] Worker thread error:`, err);
    buildStateMap.set(key, {
      phase: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
    if (currentBuildKey === key) currentBuildKey = null;
  });

  worker.on('exit', (code) => {
    if (code !== 0 && currentBuildKey === key) {
      console.error(`[codebase] Worker exited with code ${code}`);
      if (!buildStateMap.has(key) || (buildStateMap.get(key) as BuildState).phase !== 'error') {
        buildStateMap.set(key, { phase: 'error', error: `Worker exited with code ${code}` });
      }
      currentBuildKey = null;
    }
  });
}

/**
 * Return the cached dependency graph, optionally filtered by path. Used by other
 * routers (e.g. PR overview). Tries in-memory first, then disk (persisted cache).
 */
export function getCachedDependencyGraph(
  projectRoot: string,
  pathArg = '.',
): { nodes: NodeResult[]; edges: EdgeResult[] } | null {
  const key = fullGraphKey(projectRoot);
  let cached = graphCache.get(key);
  if (!cached || Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    const diskCache = loadGraphCacheFromDisk(projectRoot);
    if (diskCache) {
      cached = { ...diskCache, cachedAt: Date.now() };
      graphCache.set(key, cached);
    } else {
      return null;
    }
  }
  const { nodes, edges } = filterGraphByPath(cached.nodes, cached.edges, pathArg);
  return { nodes, edges };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const codebaseRouter = router({
  /**
   * Get (or start building) the dependency graph for `path` under the active project.
   *
   * On the first call (no cache) a worker thread is spawned and the response
   * includes `building: true` + progress counters.  The client should poll
   * until `building` is `false`.
   */
  getDependencyGraph: publicProcedure
    .input(z.object({ path: z.string().optional() }).optional())
    .query(({ ctx, input }) => {
      const pathArg = input?.path?.trim() || '.';
      const key = fullGraphKey(ctx.projectRoot);
      const stripPrefix = getStripPrefix(ctx.projectRoot);

      // ── Serve from cache if fresh (path is only for filtering the view) ──
      const cached = graphCache.get(key);
      if (cached && Date.now() - cached.cachedAt <= CACHE_TTL_MS) {
        const { nodes, edges } = filterGraphByPath(cached.nodes, cached.edges, pathArg);
        return {
          error: null,
          nodes,
          edges,
          truncated: cached.truncated,
          building: false,
          filesProcessed: nodes.length,
          totalFiles: nodes.length,
          phase:      undefined as string | undefined,
          currentDir: undefined as string | undefined,
          directoriesScanned: undefined as string[] | undefined,
          pathStripPrefix: stripPrefix,
        };
      }
      if (cached) graphCache.delete(key);

      // ── Load from disk (persisted cache) so we don't re-process unless user clicked Rebuild ──
      const diskCache = loadGraphCacheFromDisk(ctx.projectRoot);
      if (diskCache) {
        const restored: CachedGraph = { ...diskCache, cachedAt: Date.now() };
        graphCache.set(key, restored);
        const { nodes, edges } = filterGraphByPath(restored.nodes, restored.edges, pathArg);
        return {
          error: null,
          nodes,
          edges,
          truncated: restored.truncated,
          building: false,
          filesProcessed: nodes.length,
          totalFiles:     nodes.length,
          phase:      undefined as string | undefined,
          currentDir: undefined as string | undefined,
          directoriesScanned: undefined as string[] | undefined,
          pathStripPrefix: stripPrefix,
        };
      }

      // ── Report in-progress build state ──
      const building = buildStateMap.get(key);
      if (building) {
        if (building.phase === 'error') {
          buildStateMap.delete(key);
          if (currentBuildKey === key) currentBuildKey = null;
          return {
            error: building.error,
            nodes: [] as NodeResult[],
            edges: [] as EdgeResult[],
            truncated: false,
            building: false,
            filesProcessed: 0,
            totalFiles:     0,
            phase:      undefined as string | undefined,
            currentDir: undefined as string | undefined,
            pathStripPrefix: stripPrefix,
          };
        }
        return {
          error: null,
          nodes: [] as NodeResult[],
          edges: [] as EdgeResult[],
          truncated: false,
          building: true,
          phase:          building.phase as string,
          filesProcessed: building.filesProcessed,
          totalFiles:       building.totalFiles,
          currentDir:       building.currentDir,
          directoryCount:   building.directoryCount ?? building.directoriesScanned?.length ?? 0,
          pathStripPrefix:  stripPrefix,
        };
      }

      // ── Another build is already running ──
      if (currentBuildKey !== null) {
        return {
          error: null,
          nodes: [] as NodeResult[],
          edges: [] as EdgeResult[],
          truncated: false,
          building: true,
          phase:          'discovering' as string,
          filesProcessed: 0,
          totalFiles:     0,
          currentDir:     undefined as string | undefined,
          pathStripPrefix: stripPrefix,
        };
      }

      // ── Kick off a new build: always scan full project root (path is only for filtering) ──
      currentBuildKey = key;
      buildStateMap.set(key, {
        phase:          'discovering',
        filesProcessed: 0,
        totalFiles:     0,
        currentDir:     undefined,
      });

      spawnAnalysisWorker(key, ctx.projectRoot, stripPrefix);

      return {
        error: null,
        nodes: [] as NodeResult[],
        edges: [] as EdgeResult[],
        truncated: false,
        building: true,
        phase:          'discovering' as string,
        filesProcessed: 0,
        totalFiles:     0,
        currentDir:     undefined as string | undefined,
        pathStripPrefix: stripPrefix,
      };
    }),

  /**
   * Invalidate the cached full-project graph so the next `getDependencyGraph`
   * call triggers a fresh build. Path is ignored (there is only one graph per project).
   */
  invalidateDependencyGraph: publicProcedure
    .input(z.object({ path: z.string().optional() }).optional())
    .mutation(({ ctx }) => {
      const key = fullGraphKey(ctx.projectRoot);
      graphCache.delete(key);
      invalidatedKeys.add(key);
      deleteGraphCacheFromDisk(ctx.projectRoot);
      if (currentBuildKey !== key) {
        buildStateMap.delete(key);
      }
      return { invalidated: true };
    }),

  /**
   * Return direct dependencies (outbound) and reverse-dependencies (inbound)
   * for a single file.  `path` must match the canonical relative path returned
   * by `getDependencyGraph` nodes.
   */
  getFileDependencies: publicProcedure
    .input(
      z.object({
        path:      z.string(),
        graphPath: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const key = fullGraphKey(ctx.projectRoot);
      const cached = graphCache.get(key);
      if (!cached || Date.now() - cached.cachedAt > CACHE_TTL_MS) {
        return { dependsOn: [] as string[], dependedOnBy: [] as string[], notReady: true };
      }

      const relPath = input.path.replace(/\\/g, '/').trim().replace(/^\.\/+/, '');
      const nodeId  = fileId(relPath);

      const dependsOn = [
        ...new Set(
          cached.edges
            .filter((e) => e.source === nodeId && e.target !== nodeId)
            .map((e) => e.target),
        ),
      ];
      const dependedOnBy = [
        ...new Set(
          cached.edges
            .filter((e) => e.target === nodeId && e.source !== nodeId)
            .map((e) => e.source),
        ),
      ];

      return { dependsOn, dependedOnBy, notReady: false };
    }),

  /**
   * Return the raw file content for a path relative to the project root.
   * Used by the code explorer to show source. Path must be under project root.
   */
  getFileContent: publicProcedure
    .input(z.object({ path: z.string() }))
    .query(({ ctx, input }) => {
      const relPath = input.path.replace(/\\/g, '/').trim().replace(/^\.\/+/, '');
      if (!relPath || relPath.startsWith('..')) {
        return { content: null, error: 'Invalid path' };
      }
      const fullPath = path.resolve(ctx.projectRoot, relPath);
      const projectRootNorm = path.resolve(ctx.projectRoot);
      if (!fullPath.startsWith(projectRootNorm + path.sep) && fullPath !== projectRootNorm) {
        return { content: null, error: 'Path is outside project' };
      }
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) {
          return { content: null, error: 'Not a file' };
        }
        const content = fs.readFileSync(fullPath, 'utf-8');
        return { content, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: null, error: message };
      }
    }),

  /** Clear all in-memory caches across all projects and paths. */
  clearAllDependencyGraphCaches: publicProcedure.mutation(() => {
    const count = graphCache.size;
    graphCache.clear();
    buildStateMap.clear();
    invalidatedKeys.clear();
    currentBuildKey = null;
    return { cleared: count };
  }),
});
