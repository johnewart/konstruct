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
 * Tree-sitter based codebase outline: compact, LLM-friendly representation
 * of file structure (declarations only) regardless of language.
 * Tree-sitter is loaded lazily so the server starts even if native modules are missing.
 * Extended to generate dependency graphs alongside AST.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getParser, getOutlineLoadError, SUPPORTED_EXTENSIONS } from './ast';
import type { TSNode } from './ast';
import { getOutlineConfig } from './parsers';
import {
  buildDependencyGraph,
  type DependencyGraph,
  type DependencyNode,
  type DependencyEdge,
} from './dependencyGraph';

export { getOutlineLoadError };
export type { TSNode } from './ast';

const MAX_OUTLINE_BYTES = 48 * 1024;
const MAX_FILES = 200;
const MAX_SIGNATURE_CHARS = 120;

function firstLineSignature(nodeText: string): string {
  const firstLine = nodeText.split('\n')[0].trim();
  let sig = firstLine;
  const open = firstLine.indexOf('{');
  const colon = firstLine.indexOf(':');
  if (open !== -1 && (colon === -1 || open < colon))
    sig = firstLine.slice(0, open).trim();
  else if (colon !== -1) sig = firstLine.slice(0, colon).trim();
  if (sig.length > MAX_SIGNATURE_CHARS)
    sig = sig.slice(0, MAX_SIGNATURE_CHARS - 2) + '…';
  return sig;
}

export interface OutlineEntry {
  line: number;
  indent: number;
  text: string;
}

export type { DependencyNode, DependencyEdge } from './dependencyGraph';

/**
 * Generate AST from source code
 * @param sourceCode Source code to analyze
 * @param ext File extension (js, ts, tsx, py, etc.)
 * @returns Array of AST entries (declarations)
 */
export function outlineFile(sourceCode: string, ext: string): OutlineEntry[] {
  const parser = getParser(ext);
  const config = getOutlineConfig(ext);
  if (!parser || !config) return [];

  const tree = parser.parse(sourceCode);
  const entries: OutlineEntry[] = [];
  const declNodes = config.declarationNodeTypes;
  const indentBlocks = config.indentBlockTypes ?? new Set<string>();

  function walk(node: TSNode | null, depth: number) {
    if (!node) return;
    const type = node.type;
    if (declNodes.has(type)) {
      const text = sourceCode.slice(node.startIndex, node.endIndex);
      const line = node.startPosition.row + 1;
      const sig = firstLineSignature(text);
      entries.push({ line, indent: depth, text: sig });
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      const childType = child.type;
      const nextDepth =
        declNodes.has(childType) || indentBlocks.has(childType) ? depth + 1 : depth;
      walk(child, nextDepth);
    }
  }

  walk(tree.rootNode as TSNode, 0);
  return entries.sort((a, b) => a.line - b.line);
}

function formatOutline(relPath: string, entries: OutlineEntry[]): string {
  const lines: string[] = [`${relPath}:`];
  for (const e of entries) {
    const indent = '  '.repeat(e.indent);
    lines.push(`  L${e.line}  ${indent}${e.text}`);
  }
  return lines.join('\n');
}

export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '.git',
]);

/**
 * Get initial state for incremental discovery. Validates path and returns queue + list.
 * If path is a file: list = [path], queue = []. If directory: queue = [resolved], list = [].
 */
export function getDiscoveryInitialState(
  projectRoot: string,
  pathArg: string
): { ok: true; queue: string[]; list: string[] } | { ok: false; error: string } {
  const resolved = path.resolve(projectRoot, pathArg);
  const root = path.resolve(projectRoot);
  const sep = path.sep;
  if (root && resolved !== root && !resolved.startsWith(root + sep)) {
    return { ok: false, error: '(path outside project root)' };
  }
  const relResolved = path.relative(projectRoot, resolved);
  const topDir = relResolved.split(path.sep)[0];
  if (SKIP_DIRS.has(topDir)) {
    return { ok: false, error: `(path is under ${topDir}/; try e.g. src/)` };
  }
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    const ext = path.extname(resolved).slice(1).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext)) {
      return { ok: true, queue: [], list: [resolved] };
    }
    return { ok: true, queue: [], list: [] };
  }
  return { ok: true, queue: [resolved], list: [] };
}

/**
 * Process one directory in the discovery queue. Mutates queue and list.
 * Returns the directory that was processed, or null if queue was empty (discovery done).
 */
export function collectFilesStep(
  queue: string[],
  list: string[],
  projectRoot: string,
  globPattern: string | null,
  maxFiles: number,
  onFileFound?: (currentDir: string, filesFound: number) => void
): { lastDir: string } | null {
  if (list.length >= maxFiles) return null;
  const dir = queue.shift();
  if (dir === undefined) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) queue.push(full);
      continue;
    }
    const ext = path.extname(e.name).slice(1).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    if (globPattern) {
      const base = path.basename(e.name);
      const parts = globPattern
        .split('*')
        .map((p) => p.replace(/\[.+^${}()|\[\]\]/g, '\\$&'));
      const re = new RegExp('^' + parts.join('.*') + '$');
      if (!re.test(base)) continue;
    }
    list.push(full);
    onFileFound?.(dir, list.length);
  }
  return { lastDir: dir };
}

function collectFiles(
  dir: string,
  baseDir: string,
  globPattern: string | null,
  list: string[],
  maxFiles: number = MAX_FILES,
  onFileFound?: (currentDir: string, filesFound: number) => void
): void {
  if (list.length >= maxFiles) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
        collectFiles(full, baseDir, globPattern, list, maxFiles, onFileFound);
      continue;
    }
    const ext = path.extname(e.name).slice(1).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    if (globPattern) {
      const base = path.basename(e.name);
      const parts = globPattern
        .split('*')
        .map((p) => p.replace(/\[.+^${}()|\[\]\]/g, '\\$&'));
      const re = new RegExp('^' + parts.join('.*') + '$');
      if (!re.test(base)) continue;
    }
    list.push(full);
    onFileFound?.(dir, list.length);
  }
}

/**
 * Generate AST and dependency graph for a file or directory
 * @param projectRoot Project root directory
 * @param pathArg File or directory path to analyze
 * @param globPattern Optional glob pattern to filter files
 * @param options Optional: maxFiles, maxOutlineBytes, onProgress(processed, total)
 * @returns Object containing AST outline and dependency graph
 */
export interface OutlinePathOptions {
  maxFiles?: number;
  maxOutlineBytes?: number;
  onProgress?: (processed: number, total: number) => void;
  /** Called during file discovery with the directory currently being scanned and total files found so far. */
  onDiscovering?: (currentDir: string, filesFound: number) => void;
}

export function outlinePath(
  projectRoot: string,
  pathArg: string,
  globPattern?: string | null,
  options?: OutlinePathOptions
): { outline: string; truncated: boolean; dependencyGraph?: DependencyGraph } {
  getParser('js');
  const err = getOutlineLoadError();
  if (err) {
    return {
      outline: [
        '(Tree-sitter unavailable: native module failed to load.',
        'Use list_files and read_file_region to explore the codebase.',
        'To enable codebase_outline: run the server with Node (not Bun), or run `npm rebuild tree-sitter tree-sitter-javascript tree-sitter-python tree-sitter-typescript` and restart.)',
      ].join(' '),
      truncated: false,
    };
  }
  const resolved = path.resolve(projectRoot, pathArg);
  const root = path.resolve(projectRoot);
  const sep = path.sep;
  if (root && resolved !== root && !resolved.startsWith(root + sep)) {
    return { outline: '(path outside project root)', truncated: false };
  }

  const relResolved = path.relative(projectRoot, resolved);
  const topDir = relResolved.split(path.sep)[0];
  if (SKIP_DIRS.has(topDir)) {
    return {
      outline: `(path is under ${topDir}/; outline source code instead, e.g. src/)`,
      truncated: false,
    };
  }

  const maxFilesOpt = options?.maxFiles ?? MAX_FILES;
  const maxBytesOpt = options?.maxOutlineBytes ?? MAX_OUTLINE_BYTES;

  const files: string[] = [];
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    const ext = path.extname(resolved).slice(1).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext)) {
      files.push(resolved);
      options?.onDiscovering?.(path.dirname(resolved), 1);
    }
  } else {
    collectFiles(
      resolved,
      projectRoot,
      globPattern ?? null,
      files,
      maxFilesOpt,
      (currentDir, count) => options?.onDiscovering?.(currentDir, count)
    );
  }

  options?.onProgress?.(0, files.length);

  const parts: string[] = [];
  let totalBytes = 0;
  let truncated = false;
  let dependencyGraph: DependencyGraph | undefined = undefined;

  const allEdges: DependencyEdge[] = [];
  const allNodes: DependencyNode[] = [];
  const processedFiles = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    const fullPath = files[i];
    if (totalBytes >= maxBytesOpt) {
      truncated = true;
      break;
    }
    let rel: string = path.relative(projectRoot, fullPath);
    if (path.sep !== '/') rel = rel.split(path.sep).join('/');
    const ext = path.extname(fullPath).slice(1).toLowerCase();
    try {
      const source = fs.readFileSync(fullPath, 'utf-8');
      const entries = outlineFile(source, ext);
      const block = formatOutline(rel, entries);
      if (
        totalBytes + Buffer.byteLength(block, 'utf-8') + 2 >
        maxBytesOpt
      ) {
        parts.push(
          block.slice(0, maxBytesOpt - totalBytes - 20) + '\n(truncated)'
        );
        truncated = true;
        break;
      }
      parts.push(block);
      totalBytes += Buffer.byteLength(block, 'utf-8') + 2;

      if (!processedFiles.has(fullPath)) {
        processedFiles.add(fullPath);
        const fileGraph = buildDependencyGraph(source, ext, fullPath);

        for (const node of fileGraph.nodes) {
          if (!allNodes.some((n) => n.path === node.path)) {
            allNodes.push(node);
          }
        }

        for (const edge of fileGraph.edges) {
          allEdges.push(edge);
        }
      }
    } catch {
      parts.push(`${rel}: (parse/read error)`);
    }
    options?.onProgress?.(i + 1, files.length);
  }

  if (allEdges.length > 0 || allNodes.length > 0) {
    dependencyGraph = {
      nodes: allNodes,
      edges: allEdges,
    };
  }

  const outline = parts.join('\n\n');
  return {
    outline: outline || '(no supported files found)',
    truncated,
    dependencyGraph,
  };
}
