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
 * Dependency graph generator for codebase analysis.
 * Uses language-specific extractors from shared/parsers (JS/TS, Python, etc.).
 * Edge targets are normalized to actual file paths (with extension) so that
 * UI logic matching edge.target === activeFile (e.g. inbound edges) works.
 */

import * as path from 'path';
import { getParser, SUPPORTED_EXTENSIONS } from './ast';
import { getDependencyExtractor } from './parsers';
import type { DependencyGraph } from './dependencyGraphTypes';

export type { DependencyNode, DependencyEdge, DependencyGraph } from './dependencyGraphTypes';

const EXTENSIONS_FOR_RESOLUTION = [...SUPPORTED_EXTENSIONS].sort();

function normalizePath(p: string): string {
  return path.normalize(p).replace(/\\/g, '/');
}

/**
 * Normalize edge targets to known file paths (with extension) so inbound/outbound
 * matching works: edge.target must equal the active file path (repo-relative with extension).
 * Tries exact match, then target + extension (.ts, .tsx, .js, .jsx, .py), then index files.
 */
export function normalizeEdgeTargetsToKnownFiles(
  edges: Array<{ source: string; target: string; type: string }>,
  knownFilePaths: Set<string>
): Array<{ source: string; target: string; type: string }> {
  const normalizedSet = new Set<string>();
  for (const fp of knownFilePaths) {
    normalizedSet.add(normalizePath(fp));
  }
  function findCanonical(norm: string): string | null {
    for (const fp of knownFilePaths) {
      if (normalizePath(fp) === norm) return fp;
    }
    return null;
  }

  return edges.map((e) => {
    const targetNorm = normalizePath(e.target);
    const exact = findCanonical(targetNorm);
    if (exact) return { ...e, target: exact };
    for (const ext of EXTENSIONS_FOR_RESOLUTION) {
      const withExt = targetNorm + (ext.startsWith('.') ? ext : '.' + ext);
      if (normalizedSet.has(withExt)) {
        const canonical = findCanonical(withExt);
        return { ...e, target: canonical ?? withExt };
      }
    }
    for (const ext of EXTENSIONS_FOR_RESOLUTION) {
      const suffix = ext.startsWith('.') ? ext : '.' + ext;
      const indexPath = targetNorm + '/index' + suffix;
      if (normalizedSet.has(indexPath)) {
        const canonical = findCanonical(indexPath);
        return { ...e, target: canonical ?? indexPath };
      }
    }
    return e;
  });
}

/**
 * Extract dependency graph from source code.
 * Dispatches to the registered extractor for the given file extension.
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
