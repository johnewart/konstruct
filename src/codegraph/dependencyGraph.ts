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
 * Dependency graph builder and query helpers.
 *
 * Building
 * --------
 * `buildDependencyGraph(source, ext, filePath)` parses source code and
 * returns a `DependencyGraph` containing:
 *   - A file node with all declared symbols (functions, classes, methods, …)
 *     including `isTest` and `isTestFile` flags.
 *   - Module nodes for every import target.
 *   - Edges with `symbols: string[]` listing every named import/re-export.
 *
 * Normalization
 * -------------
 * `normalizeEdgeTargetsToKnownFiles` resolves bare/extensionless edge targets
 * to actual file paths (with extension) so that UI matching works correctly.
 *
 * Query helpers
 * -------------
 * The graph contains enough data to answer:
 *
 *   Q1. What files does file X depend on?
 *       → `fileDependsOnFiles(graph, X)`
 *
 *   Q2. What symbols does file X depend on (named imports)?
 *       → `fileDependsOnSymbols(graph, X)`
 *
 *   Q3. What files does symbol S depend on?
 *       → `symbolDependsOnFiles(graph, filePath, symbolName)`
 *         (file-level approximation: the file containing S imports these files)
 *
 *   Q4. What named symbols does symbol S depend on?
 *       → `symbolDependsOnSymbols(graph, filePath, symbolName)`
 *         (file-level approximation: all named imports in the containing file)
 *
 *   Q5. What symbols are tests?
 *       → `allTestSymbols(graph)`
 *
 *   Q6. What files and symbols does a specific test depend on?
 *       → `testDependencies(graph, testFilePath, testSymbolName)`
 */

import * as path from 'path';
import { getParser, SUPPORTED_EXTENSIONS } from './ast';
import { getDependencyExtractor } from './parsers';
import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  SymbolInfo,
} from './dependencyGraphTypes';

export type { DependencyNode, DependencyEdge, DependencyGraph, SymbolInfo } from './dependencyGraphTypes';

const EXTENSIONS_FOR_RESOLUTION = [...SUPPORTED_EXTENSIONS].sort();

function normalizePath(p: string): string {
  return path.normalize(p).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

/**
 * Parse `sourceCode` (of the given file extension) and return its dependency
 * graph including symbol declarations and named import tracking on edges.
 */
export function buildDependencyGraph(
  sourceCode: string,
  ext: string,
  filePath: string
): DependencyGraph {
  const parser = getParser(ext);
  const extractor = getDependencyExtractor(ext);
  if (!parser || !extractor) return { nodes: [], edges: [] };

  const tree = parser.parse(sourceCode);
  return extractor(
    sourceCode,
    { rootNode: tree.rootNode as import('./parsers/types').ASTNode },
    filePath
  );
}

// ---------------------------------------------------------------------------
// Edge target normalization
// ---------------------------------------------------------------------------

/**
 * Normalize edge targets to actual file paths (with extension) so that
 * `edge.target === activeFilePath` works for inbound/outbound matching in
 * the UI and PR-review logic.
 *
 * Resolution order:
 *   1. Exact match in `knownFilePaths`.
 *   2. Target + each supported extension (.ts, .tsx, .js, .jsx, .py, …).
 *   3. Target + /index + each supported extension.
 *
 * Edges whose targets cannot be resolved are returned unchanged (they point
 * to external packages and should remain as package names).
 */
export function normalizeEdgeTargetsToKnownFiles(
  edges: Array<{ source: string; target: string; type: string }>,
  knownFilePaths: Set<string>
): Array<{ source: string; target: string; type: string }> {
  const normalizedSet = new Map<string, string>(); // normalized → canonical
  for (const fp of knownFilePaths) {
    normalizedSet.set(normalizePath(fp), fp);
  }

  function resolve(targetNorm: string): string | null {
    const exact = normalizedSet.get(targetNorm);
    if (exact) return exact;
    for (const ext of EXTENSIONS_FOR_RESOLUTION) {
      const withExt = targetNorm + '.' + ext;
      const match = normalizedSet.get(withExt);
      if (match) return match;
    }
    // Python package convention: <pkg>/__init__.py
    const initPy = targetNorm + '/__init__.py';
    const initPyMatch = normalizedSet.get(initPy);
    if (initPyMatch) return initPyMatch;
    // JS/TS package convention: <pkg>/index.<ext>
    for (const ext of EXTENSIONS_FOR_RESOLUTION) {
      const indexPath = targetNorm + '/index.' + ext;
      const match = normalizedSet.get(indexPath);
      if (match) return match;
    }
    return null;
  }

  return edges.map((e) => {
    const targetNorm = normalizePath(e.target);
    const canonical = resolve(targetNorm);
    return canonical ? { ...e, target: canonical } : e;
  });
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Q1 — Files that `filePath` depends on (via import / require edges).
 * Returns deduplicated list of target paths.
 */
export function fileDependsOnFiles(graph: DependencyGraph, filePath: string): string[] {
  const targets = new Set<string>();
  for (const e of graph.edges) {
    if (e.source === filePath && (e.type === 'import' || e.type === 'require')) {
      if (e.target !== filePath) targets.add(e.target);
    }
  }
  return [...targets];
}

/**
 * Q2 — Named symbols that `filePath` imports from other files.
 * Returns objects with `{ symbol, from }` so callers know which file each
 * symbol comes from.
 */
export function fileDependsOnSymbols(
  graph: DependencyGraph,
  filePath: string
): Array<{ symbol: string; from: string }> {
  const result: Array<{ symbol: string; from: string }> = [];
  for (const e of graph.edges) {
    if (e.source !== filePath) continue;
    if (e.type !== 'import' && e.type !== 'require') continue;
    for (const sym of e.symbols ?? []) {
      result.push({ symbol: sym, from: e.target });
    }
  }
  return result;
}

/**
 * Q3 — Files that the file containing `symbolName` depends on.
 *
 * This is a file-level approximation: we report all files that the containing
 * file imports.  True symbol-level call-graph analysis (which imports a
 * specific function body uses) would require scope resolution beyond what
 * tree-sitter gives us statically.
 */
export function symbolDependsOnFiles(
  graph: DependencyGraph,
  containingFilePath: string,
  _symbolName: string
): string[] {
  return fileDependsOnFiles(graph, containingFilePath);
}

/**
 * Q4 — Named symbols that the file containing `symbolName` imports.
 *
 * Same file-level approximation as Q3.
 */
export function symbolDependsOnSymbols(
  graph: DependencyGraph,
  containingFilePath: string,
  _symbolName: string
): Array<{ symbol: string; from: string }> {
  return fileDependsOnSymbols(graph, containingFilePath);
}

/**
 * Q5 — All test symbols across the entire graph.
 * Returns objects with the symbol and the file it lives in.
 */
export function allTestSymbols(
  graph: DependencyGraph
): Array<{ symbol: SymbolInfo; filePath: string }> {
  const result: Array<{ symbol: SymbolInfo; filePath: string }> = [];
  for (const node of graph.nodes) {
    if (node.type !== 'file' || !node.symbols) continue;
    for (const sym of node.symbols) {
      if (sym.isTest) result.push({ symbol: sym, filePath: node.path });
    }
  }
  return result;
}

/**
 * Q6 — Full dependency picture for a test symbol.
 *
 * Returns:
 *   - `testSymbol`   : the SymbolInfo for the test (if found)
 *   - `filesImported`: files that the test's containing file imports
 *   - `symbolsImported`: named symbols imported in the test's containing file
 *   - `isTestFile`   : whether the file is a test file by naming convention
 */
export function testDependencies(
  graph: DependencyGraph,
  testFilePath: string,
  testSymbolName: string
): {
  testSymbol: SymbolInfo | null;
  filesImported: string[];
  symbolsImported: Array<{ symbol: string; from: string }>;
  isTestFile: boolean;
} {
  const fileNode = graph.nodes.find(
    (n) => n.type === 'file' && n.path === testFilePath
  );
  const testSymbol =
    fileNode?.symbols?.find((s) => s.name === testSymbolName && s.isTest) ?? null;

  return {
    testSymbol,
    filesImported: fileDependsOnFiles(graph, testFilePath),
    symbolsImported: fileDependsOnSymbols(graph, testFilePath),
    isTestFile: fileNode?.isTestFile ?? false,
  };
}
