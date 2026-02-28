/**
 * Tree-sitter based codebase outline: compact, LLM-friendly representation
 * of file structure (declarations only) regardless of language.
 * Tree-sitter is loaded lazily so the server starts even if native modules are missing.
 * Extended to generate dependency graphs alongside AST.
 */

import * as fs from 'fs';
import * as path from 'path';

const EXT_TO_LOADER: Record<string, () => unknown> = {
  js: () => require('tree-sitter-javascript'),
  jsx: () => require('tree-sitter-javascript'),
  ts: () => require('tree-sitter-typescript').typescript,
  tsx: () => require('tree-sitter-typescript').tsx,
  py: () => require('tree-sitter-python'),
};

/** Node types we treat as top-level declarations (signature only). */
const DECL_NODES = new Set([
  'function_declaration',
  'function_definition',
  'method_definition',
  'arrow_function',
  'class_declaration',
  'class_definition',
  'interface_declaration',
  'type_alias_declaration',
]);

const MAX_OUTLINE_BYTES = 48 * 1024;
const MAX_FILES = 200;
const MAX_SIGNATURE_CHARS = 120;

type TSNode = {
  type: string;
  startPosition: { row: number };
  startIndex: number;
  endIndex: number;
  childCount: number;
  child: (i: number) => TSNode | null;
};

let ParserClass: {
  new (): {
    setLanguage: (lang: unknown) => void;
    parse: (src: string) => { rootNode: TSNode };
  };
} | null = null;
let loadError: Error | null = null;
const parserCache: Record<
  string,
  {
    setLanguage: (lang: unknown) => void;
    parse: (src: string) => { rootNode: TSNode };
  }
> = {};

export function getParser(
  ext: string
): { parse: (src: string) => { rootNode: TSNode } } | null {
  const load = EXT_TO_LOADER[ext];
  if (!load) return null;
  if (!ParserClass) {
    try {
      ParserClass = require('tree-sitter');
    } catch (e) {
      loadError = e instanceof Error ? e : new Error(String(e));
      return null;
    }
  }
  if (loadError) return null;
  if (!parserCache[ext]) {
    try {
      const p = new ParserClass!();
      p.setLanguage(load());
      parserCache[ext] = p;
    } catch {
      return null;
    }
  }
  return parserCache[ext];
}

export function getOutlineLoadError(): Error | null {
  return loadError;
}

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

export interface DependencyNode {
  path: string;
  name: string;
  type: 'file' | 'module';
}

export interface DependencyEdge {
  source: string;
  target: string;
  type: 'import' | 'export' | 'require';
  identifier?: string;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

/**
 * Generate AST from source code
 * @param sourceCode Source code to analyze
 * @param ext File extension (js, ts, tsx, py, etc.)
 * @returns Array of AST entries (declarations)
 */
export function outlineFile(sourceCode: string, ext: string): OutlineEntry[] {
  const parser = getParser(ext);
  if (!parser) return [];

  const tree = parser.parse(sourceCode);
  const entries: OutlineEntry[] = [];

  function walk(node: TSNode | null, depth: number) {
    if (!node) return;
    const type = node.type;
    if (DECL_NODES.has(type)) {
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
        DECL_NODES.has(childType) ||
        childType === 'class_body' ||
        childType === 'statement_block'
          ? depth + 1
          : depth;
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

const SKIP_DIRS = new Set([
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

function collectFiles(
  dir: string,
  baseDir: string,
  globPattern: string | null,
  list: string[]
): void {
  if (list.length >= MAX_FILES) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
        collectFiles(full, baseDir, globPattern, list);
      continue;
    }
    const ext = path.extname(e.name).slice(1).toLowerCase();
    if (!EXT_TO_LOADER[ext]) continue;
    if (globPattern) {
      const base = path.basename(e.name);
      const parts = globPattern
        .split('*')
        .map((p) => p.replace(/\[.+^${}()|\[\]\]/g, '\\$&'));
      const re = new RegExp('^' + parts.join('.*') + '$');
      if (!re.test(base)) continue;
    }
    list.push(full);
  }
}

// Import dependency graph functionality
import { buildDependencyGraph, DependencyGraph } from './dependencyGraph';

/**
 * Generate AST and dependency graph for a file or directory
 * @param projectRoot Project root directory
 * @param pathArg File or directory path to analyze
 * @param globPattern Optional glob pattern to filter files
 * @returns Object containing AST outline and dependency graph
 */
export function outlinePath(
  projectRoot: string,
  pathArg: string,
  globPattern?: string | null
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

  const files: string[] = [];
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    const ext = path.extname(resolved).slice(1).toLowerCase();
    if (EXT_TO_LOADER[ext]) files.push(resolved);
  } else {
    collectFiles(resolved, projectRoot, globPattern ?? null, files);
  }

  const parts: string[] = [];
  let totalBytes = 0;
  let truncated = false;
  let dependencyGraph: DependencyGraph | undefined = undefined;

  // Build dependency graph for the entire codebase
  const allEdges: DependencyEdge[] = [];
  const allNodes: DependencyNode[] = [];
  const processedFiles = new Set<string>();

  for (const fullPath of files) {
    if (totalBytes >= MAX_OUTLINE_BYTES) {
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
        MAX_OUTLINE_BYTES
      ) {
        parts.push(
          block.slice(0, MAX_OUTLINE_BYTES - totalBytes - 20) + '\n(truncated)'
        );
        truncated = true;
        break;
      }
      parts.push(block);
      totalBytes += Buffer.byteLength(block, 'utf-8') + 2;

      // Build dependency graph for this file
      if (!processedFiles.has(fullPath)) {
        processedFiles.add(fullPath);
        const fileGraph = buildDependencyGraph(source, ext, fullPath);

        // Add nodes and edges to the overall graph
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
  }

  // If we have any dependencies, create the graph
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
