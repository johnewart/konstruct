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
 * Shared dependency-graph scan: file discovery + codegraph analysis + file-level graph.
 * Used by the backend worker (worker_threads) and the workspace agent (in-process).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { analyzer } from '../codegraph/analyzer';
import type { DependencyGraph } from '../codegraph/spec/graph.spec';
import { DependencyType } from '../codegraph/spec/graph.spec';

export const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  python: ['.py'],
  javascript: ['.js', '.mjs', '.cjs', '.jsx'],
  typescript: ['.ts', '.tsx'],
};

export const SKIP_DIRS: string[] = [
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

export const ALL_PARSABLE_EXTENSIONS: string[] = Object.values(LANGUAGE_EXTENSIONS).flat();

export const DEFAULT_MAX_FILES = 5000;

export type NodeResult = { id: string; path: string };
export type EdgeResult = { source: string; target: string; type: string };

export type ScanProgress =
  | { kind: 'dir'; dir: string; filesFound: number; directoriesScannedSoFar?: number }
  | { kind: 'discovery_complete'; directories: string[]; fileCount: number }
  | { kind: 'progress'; phase: 'defs' | 'refs'; filesProcessed: number; totalFiles: number }
  | { kind: 'error'; message: string };

export type ScanOptions = {
  languageExtensions?: Record<string, string[]>;
  extensions?: string[];
  maxFiles?: number;
  skipDirs?: string[];
  onProgress?: (update: ScanProgress) => void;
};

function edgeTypeToString(type: DependencyType): string {
  switch (type) {
    case DependencyType.CALLS: return 'calls';
    case DependencyType.INHERITS: return 'inherits';
    case DependencyType.USES_TYPE: return 'uses_type';
    case DependencyType.INSTANTIATES: return 'instantiates';
    case DependencyType.IMPORTS: return 'import';
    case DependencyType.REFERENCES: return 'references';
    case DependencyType.READS: return 'reads';
    case DependencyType.WRITES: return 'writes';
    default: return 'references';
  }
}

function graphToFileLevel(
  graph: DependencyGraph,
  stripPrefix: string,
  targetDir: string,
): { nodes: NodeResult[]; edges: EdgeResult[] } {
  const stripPrefixNorm = stripPrefix.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  const targetDirNorm = path.resolve(targetDir).replace(/\\/g, '/');
  const targetDirWithSlash = targetDirNorm.endsWith('/') ? targetDirNorm : targetDirNorm + '/';

  const symbolToRelPath = new Map<string, string>();
  for (const [symbolId, def] of graph.nodes.entries()) {
    const filePath = def.location.file;
    const absPath = path.isAbsolute(filePath)
      ? path.resolve(filePath).replace(/\\/g, '/')
      : path.resolve(targetDirNorm, filePath).replace(/\\/g, '/');
    if (!absPath.startsWith(targetDirWithSlash) && absPath !== targetDirNorm) continue;
    const relPath = absPath.startsWith(stripPrefixNorm)
      ? absPath.slice(stripPrefixNorm.length)
      : path.relative(stripPrefixNorm.slice(0, -1), absPath).replace(/\\/g, '/');
    if (relPath.startsWith('..')) continue;
    symbolToRelPath.set(symbolId, relPath);
  }

  const fileNodesMap = new Map<string, NodeResult>();
  for (const relPath of symbolToRelPath.values()) {
    const id = `file://${relPath}`;
    if (!fileNodesMap.has(id)) fileNodesMap.set(id, { id, path: relPath });
  }

  const fileEdgesMap = new Map<string, EdgeResult>();
  for (const edge of graph.edges) {
    const srcRel = symbolToRelPath.get(edge.source_symbol_path);
    const tgtRel = symbolToRelPath.get(edge.target_symbol_path);
    if (!srcRel || !tgtRel) continue;
    const srcId = `file://${srcRel}`;
    const tgtId = `file://${tgtRel}`;
    if (srcId === tgtId) continue;
    const typeStr = edgeTypeToString(edge.edge_type);
    const key = `${srcId}→${tgtId}→${typeStr}`;
    if (!fileEdgesMap.has(key)) {
      fileEdgesMap.set(key, { source: srcId, target: tgtId, type: typeStr });
    }
  }

  return {
    nodes: Array.from(fileNodesMap.values()),
    edges: Array.from(fileEdgesMap.values()),
  };
}

async function collectFiles(
  dir: string,
  targetDir: string,
  extensions: Set<string>,
  maxFiles: number,
  skipDirs: Set<string>,
  onProgress: (p: ScanProgress) => void,
): Promise<{ files: string[]; truncated: boolean; directories: string[] }> {
  const files: string[] = [];
  const directories: string[] = [];

  async function walk(current: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const relDir = path.relative(targetDir, current) || '.';
    directories.push(relDir);
    onProgress({ kind: 'dir', dir: relDir, filesFound: files.length, directoriesScannedSoFar: directories.length });
    await Promise.resolve(); // yield so WebSocket progress can flush (avoids "stuck at Scanning…")

    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(current, { withFileTypes: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (current === path.resolve(dir)) throw new Error(`Cannot read target directory: ${msg}`);
      return;
    }

    for (const entry of entries) {
      if (skipDirs.has(entry.name)) continue;
      if (entry.isDirectory() && entry.name.startsWith('.')) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (extensions.has(path.extname(entry.name))) {
        files.push(fullPath);
        if (files.length >= maxFiles) return;
      }
    }
  }

  await walk(dir);
  const resolvedDir = path.resolve(dir);
  const normalizedDir = resolvedDir.endsWith(path.sep) ? resolvedDir : resolvedDir + path.sep;
  const filesInScope = files.filter((f) => {
    const resolved = path.resolve(f);
    return resolved === resolvedDir || resolved.startsWith(normalizedDir);
  });
  return { files: filesInScope, truncated: files.length >= maxFiles, directories };
}

function extensionToLanguage(languageExtensions: Record<string, string[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [lang, exts] of Object.entries(languageExtensions)) {
    for (const ext of exts) map.set(ext, lang);
  }
  return map;
}

function partitionFilesByLanguage(
  files: string[],
  extToLang: Map<string, string>,
): Map<string, string[]> {
  const byLang = new Map<string, string[]>();
  for (const file of files) {
    const ext = path.extname(file);
    const lang = extToLang.get(ext) ?? 'javascript';
    const list = byLang.get(lang) ?? [];
    list.push(file);
    byLang.set(lang, list);
  }
  return byLang;
}

function mergeGraphs(graphs: DependencyGraph[]): DependencyGraph {
  if (graphs.length === 0) {
    const metadata = new Map<string, unknown>();
    metadata.set('language', 'none');
    metadata.set('files', []);
    metadata.set('node_count', 0);
    metadata.set('edge_count', 0);
    return {
      nodes: new Map(),
      edges: [],
      name_to_symbol_map: new Map(),
      metadata,
    };
  }
  if (graphs.length === 1) return graphs[0];

  const nodes = new Map<string, import('../codegraph/spec/graph.spec').SymbolDef>();
  const edges: import('../codegraph/spec/graph.spec').DependencyEdge[] = [];
  const name_to_symbol_map = new Map<string, import('../codegraph/spec/graph.spec').SymbolDef[]>();
  const allFiles: string[] = [];

  for (const g of graphs) {
    for (const [id, def] of g.nodes) nodes.set(id, def);
    edges.push(...g.edges);
    const files = g.metadata.get('files');
    if (Array.isArray(files)) allFiles.push(...files);
    for (const [name, defs] of g.name_to_symbol_map) {
      const existing = name_to_symbol_map.get(name) ?? [];
      name_to_symbol_map.set(name, [...existing, ...defs]);
    }
  }

  const metadata = new Map<string, unknown>([
    ['language', graphs.length > 1 ? 'mixed' : graphs[0].metadata.get('language') ?? 'unknown'],
    ['files', allFiles],
    ['node_count', nodes.size],
    ['edge_count', edges.length],
  ]);

  return { nodes, edges, name_to_symbol_map, metadata };
}

export interface ScanResult {
  nodes: NodeResult[];
  edges: EdgeResult[];
  truncated: boolean;
}

/**
 * Run the full dependency-graph scan (discovery + analysis + file-level graph).
 * Calls onProgress for each progress event so the caller can stream to the backend or worker parent.
 * Discovery is async so progress can flush (avoids UI stuck at "Scanning…").
 */
export async function runDependencyGraphScan(
  targetDir: string,
  stripPrefix: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const languageExtensions = options.languageExtensions ?? LANGUAGE_EXTENSIONS;
  const extensions = new Set(options.extensions ?? ALL_PARSABLE_EXTENSIONS);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const skipDirs = new Set(options.skipDirs ?? SKIP_DIRS);
  const onProgress = options.onProgress ?? (() => {});

  const targetDirResolved = path.resolve(targetDir);
  if (!fs.existsSync(targetDirResolved)) {
    throw new Error(`Target directory does not exist: ${targetDirResolved}`);
  }
  const stat = fs.statSync(targetDirResolved);
  if (!stat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetDirResolved}`);
  }

  const extToLang = extensionToLanguage(languageExtensions);

  const { files, truncated, directories } = await collectFiles(
    targetDirResolved,
    targetDirResolved,
    extensions,
    maxFiles,
    skipDirs,
    onProgress,
  );

  onProgress({ kind: 'discovery_complete', directories, fileCount: files.length });
  onProgress({ kind: 'progress', phase: 'defs', filesProcessed: 0, totalFiles: files.length });

  if (files.length === 0) {
    return { nodes: [], edges: [], truncated: false };
  }

  const byLang = partitionFilesByLanguage(files, extToLang);
  const graphs: DependencyGraph[] = [];
  let progressOffset = 0;

  for (const [language, langFiles] of byLang) {
    if (langFiles.length === 0) continue;
    const graph = analyzer.analyze_files(
      langFiles,
      language,
      (filesProcessed, _totalFiles, phase) => {
        onProgress({
          kind: 'progress',
          phase,
          filesProcessed: progressOffset + filesProcessed,
          totalFiles: files.length,
        });
      },
    );
    graphs.push(graph);
    progressOffset += langFiles.length;
  }

  const graph = mergeGraphs(graphs);
  const { nodes, edges } = graphToFileLevel(graph, stripPrefix, targetDirResolved);
  return { nodes, edges, truncated };
}
