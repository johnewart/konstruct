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
 * Python dependency extraction and outline config.
 * Tree-sitter-python: import_statement, import_from_statement.
 */

import * as path from 'path';
import type { ASTNode, ParsedTree, DependencyExtractor, OutlineConfig } from './types';
import type { DependencyGraph } from '../dependencyGraphTypes';

/** Get full text of a node (for dotted_name we get e.g. "foo.bar"). */
function nodeText(sourceCode: string, n: ASTNode): string {
  return sourceCode.slice(n.startIndex, n.endIndex).trim();
}

/** Resolve Python module path to file path (e.g. ./foo/bar for from .foo import bar). */
function resolveModulePath(filePath: string, modulePath: string): string {
  if (modulePath.startsWith('.')) {
    const dir = path.dirname(filePath);
    const relative = modulePath.replace(/^\.+/, '').replace(/\./g, path.sep);
    return path.resolve(dir, relative.startsWith(path.sep) ? relative.slice(1) : relative);
  }
  return modulePath.replace(/\./g, path.sep);
}

export const extractDependencies: DependencyExtractor = (
  sourceCode: string,
  tree: ParsedTree,
  filePath: string
): DependencyGraph => {
  const graph: DependencyGraph = { nodes: [], edges: [] };

  function walk(node: ASTNode | null) {
    if (!node) return;

    if (node.type === 'import_statement') {
      // import foo, import foo.bar
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        if (child.type === 'dotted_name') {
          const modulePath = nodeText(sourceCode, child);
          if (modulePath) {
            const target = resolveModulePath(filePath, modulePath);
            graph.edges.push({
              source: filePath,
              target,
              type: 'import',
            });
            if (!graph.nodes.some((n) => n.path === target)) {
              graph.nodes.push({ path: target, name: path.basename(target), type: 'module' });
            }
          }
        } else if (child.type === 'aliased_import') {
          const dotted = findFirstChild(child, 'dotted_name');
          if (dotted) {
            const modulePath = nodeText(sourceCode, dotted);
            if (modulePath) {
              const target = resolveModulePath(filePath, modulePath);
              graph.edges.push({ source: filePath, target, type: 'import' });
              if (!graph.nodes.some((n) => n.path === target)) {
                graph.nodes.push({ path: target, name: path.basename(target), type: 'module' });
              }
            }
          }
        }
      }
    } else if (node.type === 'import_from_statement') {
      // from foo.bar import ...
      let moduleName: ASTNode | null = null;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        if (child.type === 'dotted_name' || child.type === 'relative_import') {
          moduleName = child;
          break;
        }
      }
      if (moduleName) {
        const modulePath = nodeText(sourceCode, moduleName);
        if (modulePath) {
          const target = resolveModulePath(filePath, modulePath);
          graph.edges.push({
            source: filePath,
            target,
            type: 'import',
          });
          if (!graph.nodes.some((n) => n.path === target)) {
            graph.nodes.push({ path: target, name: path.basename(target), type: 'module' });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  function findFirstChild(n: ASTNode, type: string): ASTNode | null {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c && c.type === type) return c;
    }
    return null;
  }

  walk(tree.rootNode);

  if (graph.edges.length > 0 && !graph.nodes.some((n) => n.path === filePath)) {
    graph.nodes.push({
      path: filePath,
      name: path.basename(filePath),
      type: 'file',
    });
  }

  return graph;
};

export const outlineConfig: OutlineConfig = {
  declarationNodeTypes: new Set([
    'function_definition',
    'class_definition',
  ]),
  indentBlockTypes: new Set(['block', 'class_definition']),
};
