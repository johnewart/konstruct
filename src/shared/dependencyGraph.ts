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
 */

import { getParser } from './ast';
import { getDependencyExtractor } from './parsers';
import type { DependencyGraph } from './dependencyGraphTypes';

export type { DependencyNode, DependencyEdge, DependencyGraph } from './dependencyGraphTypes';

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
