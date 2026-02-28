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
 * Dependency graph generator for codebase analysis
 * Parses import/export statements to build a graph of module dependencies
 */

import * as path from 'path';
import { getParser } from './ast';
import type { TSNode } from './ast';

/** Node types for imports/exports */
export const IMPORT_EXPORT_NODES = new Set([
  'import_statement',
  'import_clause',
  'export_statement',
  'export_clause',
  'export_default_declaration',
  'export_all_declaration',
  'require_expression',
  'module_declaration',
]);

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
 * Extract dependency graph from source code using Tree-sitter
 * @param sourceCode Source code to analyze
 * @param ext File extension (js, ts, tsx, py, etc.)
 * @param filePath Path of the file being analyzed (for resolving relative imports)
 * @returns Dependency graph with nodes and edges
 */
export function buildDependencyGraph(
  sourceCode: string,
  ext: string,
  filePath: string
): DependencyGraph {
  const parser = getParser(ext);
  if (!parser) return { nodes: [], edges: [] };

  const tree = parser.parse(sourceCode);
  const graph: DependencyGraph = { nodes: [], edges: [] };

  graph.nodes.push({
    path: filePath,
    name: path.basename(filePath),
    type: 'file',
  });

  function walk(node: TSNode | null) {
    if (!node) return;

    const type = node.type;

    if (IMPORT_EXPORT_NODES.has(type)) {
      if (type === 'import_statement' || type === 'import_clause') {
        let modulePath = '';
        let identifier = '';

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;

          if (child.type === 'string_literal') {
            const pathText = sourceCode.slice(child.startIndex, child.endIndex);
            modulePath = pathText.slice(1, -1);
          } else if (child.type === 'identifier' && modulePath === '') {
            identifier = sourceCode.slice(child.startIndex, child.endIndex);
          }
        }

        if (modulePath) {
          if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
            const resolvedPath = path.resolve(
              path.dirname(filePath),
              modulePath
            );
            modulePath = resolvedPath;
          }

          graph.edges.push({
            source: filePath,
            target: modulePath,
            type: 'import',
            identifier: identifier || undefined,
          });

          if (!graph.nodes.some((n) => n.path === modulePath)) {
            graph.nodes.push({
              path: modulePath,
              name: path.basename(modulePath),
              type: 'module',
            });
          }
        }
      } else if (type === 'export_statement' || type === 'export_clause') {
        let identifier = '';
        let modulePath = '';

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;

          if (child.type === 'string_literal') {
            const pathText = sourceCode.slice(child.startIndex, child.endIndex);
            modulePath = pathText.slice(1, -1);
          } else if (child.type === 'identifier') {
            identifier = sourceCode.slice(child.startIndex, child.endIndex);
          }
        }

        if (modulePath) {
          if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
            const resolvedPath = path.resolve(
              path.dirname(filePath),
              modulePath
            );
            modulePath = resolvedPath;
          }

          graph.edges.push({
            source: filePath,
            target: modulePath,
            type: 'export',
            identifier: identifier || undefined,
          });

          if (!graph.nodes.some((n) => n.path === modulePath)) {
            graph.nodes.push({
              path: modulePath,
              name: path.basename(modulePath),
              type: 'module',
            });
          }
        }
      } else if (type === 'export_default_declaration') {
        let identifier = '';

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;

          if (child.type === 'identifier') {
            identifier = sourceCode.slice(child.startIndex, child.endIndex);
          }
        }

        if (identifier) {
          graph.edges.push({
            source: filePath,
            target: filePath,
            type: 'export',
            identifier: identifier,
          });
        }
      } else if (type === 'require_expression') {
        let modulePath = '';

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;

          if (child.type === 'string_literal') {
            const pathText = sourceCode.slice(child.startIndex, child.endIndex);
            modulePath = pathText.slice(1, -1);
          }
        }

        if (modulePath) {
          if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
            const resolvedPath = path.resolve(
              path.dirname(filePath),
              modulePath
            );
            modulePath = resolvedPath;
          }

          graph.edges.push({
            source: filePath,
            target: modulePath,
            type: 'require',
          });

          if (!graph.nodes.some((n) => n.path === modulePath)) {
            graph.nodes.push({
              path: modulePath,
              name: path.basename(modulePath),
              type: 'module',
            });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(tree.rootNode as TSNode);
  return graph;
}
