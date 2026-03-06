/*
 * Worker thread: runs the codegraph analyzer off the main event loop.
 *
 * Receives `workerData`:
 *   - targetDir:          string   — root directory to scan
 *   - languageExtensions: Record<string, string[]> — e.g. { python: ['.py'], javascript: ['.js', ...] }
 *   - extensions:        string[] — all file extensions to collect (flat)
 *   - maxFiles:           number
 *   - skipDirs:           string[] — directory names to skip
 *   - stripPrefix:        string   — path prefix to strip for relative node IDs
 *
 * Discovers files matching any extension, partitions by language, runs the analyzer
 * per language, merges the graphs, and returns a file-level graph.
 *
 * Posts messages to parent:
 *   { type: 'dir',               dir: string, filesFound: number }
 *   { type: 'discovery_complete', directories: string[], fileCount: number }
 *   { type: 'progress', phase: 'defs'|'refs', filesProcessed: number, totalFiles: number }
 *   { type: 'done',     nodes: NodeResult[], edges: EdgeResult[], truncated: boolean }
 *   { type: 'error',    message: string }
 */

import * as fs from 'fs';
import * as path from 'path';
import { workerData, parentPort } from 'worker_threads';
/* eslint-disable import/extensions -- .ts required for Node/worker ESM resolution */
import { analyzer } from '../../codegraph/analyzer.ts';
import type { DependencyGraph } from '../../codegraph/spec/graph.spec.ts';
import { DependencyType } from '../../codegraph/spec/graph.spec.ts';

// ─── Types (mirrored from codebase router) ───────────────────────────────────

interface NodeResult { id: string; path: string }
interface EdgeResult { source: string; target: string; type: string }

interface WorkerInput {
  targetDir: string;
  languageExtensions: Record<string, string[]>;
  extensions: string[];
  maxFiles: number;
  skipDirs: string[];
  stripPrefix: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function edgeTypeToString(type: DependencyType): string {
  switch (type) {
    case DependencyType.CALLS:        return 'calls';
    case DependencyType.INHERITS:     return 'inherits';
    case DependencyType.USES_TYPE:    return 'uses_type';
    case DependencyType.INSTANTIATES: return 'instantiates';
    case DependencyType.IMPORTS:      return 'import';
    case DependencyType.REFERENCES:   return 'references';
    case DependencyType.READS:        return 'reads';
    case DependencyType.WRITES:       return 'writes';
    default:                          return 'references';
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
    // location.file may be relative (from getPathForIds) or absolute; resolve against targetDir when relative
    const filePath = def.location.file;
    const absPath = path.isAbsolute(filePath)
      ? path.resolve(filePath).replace(/\\/g, '/')
      : path.resolve(targetDirNorm, filePath).replace(/\\/g, '/');
    // Only include symbols from files under targetDir (never from sibling dirs like ../konstruct)
    if (!absPath.startsWith(targetDirWithSlash) && absPath !== targetDirNorm) continue;
    const relPath = absPath.startsWith(stripPrefixNorm)
      ? absPath.slice(stripPrefixNorm.length)
      : path.relative(stripPrefixNorm.slice(0, -1), absPath).replace(/\\/g, '/');
    if (relPath.startsWith('..')) continue; // skip paths outside project
    symbolToRelPath.set(symbolId, relPath);
  }

  const fileNodesMap = new Map<string, NodeResult>();
  for (const relPath of symbolToRelPath.values()) {
    const id = `file://${relPath}`;
    if (!fileNodesMap.has(id)) {
      fileNodesMap.set(id, { id, path: relPath });
    }
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

function collectFiles(
  dir: string,
  targetDir: string,
  extensions: Set<string>,
  maxFiles: number,
  skipDirs: Set<string>,
): { files: string[]; truncated: boolean; directories: string[] } {
  const files: string[] = [];
  const directories: string[] = [];

  function walk(current: string): void {
    if (files.length >= maxFiles) return;
    const relDir = path.relative(targetDir, current) || '.';
    directories.push(relDir);
    parentPort?.postMessage({ type: 'dir', dir: relDir, filesFound: files.length, directoriesScannedSoFar: directories.length });

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[codebase] Failed to read directory ${current}: ${msg}`);
      if (current === path.resolve(dir)) {
        throw new Error(`Cannot read target directory: ${msg}`);
      }
      return;
    }

    for (const entry of entries) {
      if (skipDirs.has(entry.name)) continue;
      // Skip dot-directories (.nox, .cursor, .github, .idea, etc.) so we only scan source trees
      if (entry.isDirectory() && entry.name.startsWith('.')) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (extensions.has(path.extname(entry.name))) {
        files.push(fullPath);
        if (files.length >= maxFiles) return;
      }
    }
  }

  walk(dir);
  // Ensure we only return files under dir (guard against symlinks / path escape)
  const resolvedDir = path.resolve(dir);
  const normalizedDir = resolvedDir.endsWith(path.sep) ? resolvedDir : resolvedDir + path.sep;
  const filesInScope = files.filter((f) => {
    const resolved = path.resolve(f);
    return resolved === resolvedDir || resolved.startsWith(normalizedDir);
  });
  return { files: filesInScope, truncated: files.length >= maxFiles, directories };
}

/** Build extension -> language map from languageExtensions. */
function extensionToLanguage(
  languageExtensions: Record<string, string[]>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [lang, exts] of Object.entries(languageExtensions)) {
    for (const ext of exts) {
      map.set(ext, lang);
    }
  }
  return map;
}

/** Partition file paths by language (by extension). */
function partitionFilesByLanguage(
  files: string[],
  extToLang: Map<string, string>,
): Map<string, string[]> {
  const byLang = new Map<string, string[]>();
  for (const file of files) {
    const ext = path.extname(file);
    const lang = extToLang.get(ext) ?? 'javascript'; // .js/.ts default
    const list = byLang.get(lang) ?? [];
    list.push(file);
    byLang.set(lang, list);
  }
  return byLang;
}

/** Merge multiple dependency graphs into one (combined nodes, edges, name map). */
function mergeGraphs(graphs: DependencyGraph[]): DependencyGraph {
  if (graphs.length === 0) {
    return {
      nodes: new Map(),
      edges: [],
      name_to_symbol_map: new Map(),
      metadata: new Map([['language', 'none'], ['files', []], ['node_count', 0], ['edge_count', 0]]),
    };
  }
  if (graphs.length === 1) return graphs[0];

  const nodes = new Map<string, import('../../codegraph/spec/graph.spec.ts').SymbolDef>();
  const edges: import('../../codegraph/spec/graph.spec.ts').DependencyEdge[] = [];
  const name_to_symbol_map = new Map<string, import('../../codegraph/spec/graph.spec.ts').SymbolDef[]>();
  const allFiles: string[] = [];

  for (const g of graphs) {
    for (const [id, def] of g.nodes) {
      nodes.set(id, def);
    }
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

// ─── Main ────────────────────────────────────────────────────────────────────

const input = workerData as WorkerInput;

try {
  const targetDirResolved = path.resolve(input.targetDir);
  const extToLang = extensionToLanguage(input.languageExtensions);
  console.log(`[codebase] Starting scan: targetDir=${targetDirResolved}, stripPrefix=${input.stripPrefix}, extensions=${input.extensions.join(', ')}`);

  if (!fs.existsSync(targetDirResolved)) {
    throw new Error(`Target directory does not exist: ${targetDirResolved}`);
  }
  const stat = fs.statSync(targetDirResolved);
  if (!stat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetDirResolved}`);
  }

  const extensions = new Set(input.extensions);
  const skipDirs   = new Set(input.skipDirs);

  // Phase 1: discover files (only under targetDir)
  const { files, truncated, directories } = collectFiles(
    targetDirResolved,
    targetDirResolved,
    extensions,
    input.maxFiles,
    skipDirs,
  );

  console.log(`[codebase] Discovery complete: ${files.length} file(s) in ${directories.length} directories`);
  parentPort?.postMessage({ type: 'discovery_complete', directories, fileCount: files.length });
  parentPort?.postMessage({
    type: 'progress',
    phase: 'defs',
    filesProcessed: 0,
    totalFiles: files.length,
  });

  if (files.length === 0) {
    parentPort?.postMessage({ type: 'done', nodes: [], edges: [], truncated: false });
    process.exit(0);
  }

  // Phase 2: partition by language and analyze each group; merge graphs
  const byLang = partitionFilesByLanguage(files, extToLang);
  const graphs: DependencyGraph[] = [];
  let progressOffset = 0;

  for (const [language, langFiles] of byLang) {
    if (langFiles.length === 0) continue;
    const graph = analyzer.analyze_files(
      langFiles,
      language,
      (filesProcessed, _totalFiles, phase) => {
        parentPort?.postMessage({
          type: 'progress',
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
  console.log(
    `[codebase] Analysis complete: ${graph.nodes.size} symbols, ${graph.edges.length} edges`,
  );

  // Phase 3: convert to file-level graph; only include nodes under targetDir (exclude ../konstruct etc.)
  const { nodes, edges } = graphToFileLevel(graph, input.stripPrefix, targetDirResolved);

  console.log(`[codebase] File-level graph: ${nodes.length} files, ${edges.length} edges`);

  parentPort?.postMessage({ type: 'done', nodes, edges, truncated });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[codebase] Worker error: ${message}`);
  parentPort?.postMessage({ type: 'error', message });
  process.exit(1);
}
