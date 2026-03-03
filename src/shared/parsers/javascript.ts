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
 * JavaScript/TypeScript dependency extraction and outline config.
 * Tree-sitter node types and walk logic are specific to JS/TS.
 */

import * as path from 'path';
import type { ASTNode, ParsedTree, DependencyExtractor, OutlineConfig } from './types';
import type { DependencyGraph } from '../dependencyGraphTypes';

const IMPORT_EXPORT_NODES = new Set([
  'import_statement',
  'import_clause',
  'export_statement',
  'export_clause',
  'export_default_declaration',
  'export_all_declaration',
  'require_expression',
  'module_declaration',
  'call_expression',
  'assignment_expression',
]);

export const extractDependencies: DependencyExtractor = (
  sourceCode: string,
  tree: ParsedTree,
  filePath: string
): DependencyGraph => {
  const graph: DependencyGraph = { nodes: [], edges: [] };

  function collectFirstIdentifier(n: ASTNode | null): string {
    if (!n) return '';
    if (n.type === 'identifier') return sourceCode.slice(n.startIndex, n.endIndex);
    for (let i = 0; i < n.childCount; i++) {
      const s = collectFirstIdentifier(n.child(i));
      if (s) return s;
    }
    return '';
  }

  function collectIdentifiers(n: ASTNode | null): string[] {
    if (!n) return [];
    const out: string[] = [];
    if (n.type === 'identifier') out.push(sourceCode.slice(n.startIndex, n.endIndex));
    for (let i = 0; i < n.childCount; i++) {
      out.push(...collectIdentifiers(n.child(i)));
    }
    return out;
  }

  function walk(node: ASTNode | null) {
    if (!node) return;

    const type = node.type;

    if (IMPORT_EXPORT_NODES.has(type)) {
      if (type === 'import_statement' || type === 'import_clause') {
        let modulePath = '';
        let identifier = '';

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;

          if (child.type === 'string' || child.type === 'string_literal') {
            const pathText = sourceCode.slice(child.startIndex, child.endIndex);
            modulePath = pathText.slice(1, -1);
          } else if (child.type === 'identifier' && modulePath === '') {
            identifier = sourceCode.slice(child.startIndex, child.endIndex);
          }
        }

        if (modulePath) {
          if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
            modulePath = path.resolve(path.dirname(filePath), modulePath);
          }
          const hasNamedImports = (n: ASTNode | null): boolean => {
            if (!n) return false;
            if (n.type === 'named_imports') return true;
            for (let i = 0; i < n.childCount; i++) {
              if (hasNamedImports(n.child(i))) return true;
            }
            return false;
          };
          const hasNamespaceImport = (n: ASTNode | null): boolean => {
            if (!n) return false;
            if (n.type === 'namespace_import') return true;
            for (let i = 0; i < n.childCount; i++) {
              if (hasNamespaceImport(n.child(i))) return true;
            }
            return false;
          };
          if (!identifier && (hasNamedImports(node) || !hasNamespaceImport(node))) identifier = collectFirstIdentifier(node);
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

          if (child.type === 'string' || child.type === 'string_literal') {
            const pathText = sourceCode.slice(child.startIndex, child.endIndex);
            modulePath = pathText.slice(1, -1);
          } else if (child.type === 'identifier') {
            identifier = sourceCode.slice(child.startIndex, child.endIndex);
          }
        }

        if (modulePath) {
          if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
            modulePath = path.resolve(path.dirname(filePath), modulePath);
          }
          if (!identifier) identifier = collectFirstIdentifier(node);
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
        } else {
          const ids = collectIdentifiers(node);
          for (const id of ids) {
            if (id) {
              graph.edges.push({
                source: filePath,
                target: filePath,
                type: 'export',
                identifier: id,
              });
            }
          }
        }
      } else if (type === 'export_default_declaration') {
        let identifier = '';
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;
          if (child.type === 'identifier') identifier = sourceCode.slice(child.startIndex, child.endIndex);
        }
        if (identifier) {
          graph.edges.push({
            source: filePath,
            target: filePath,
            type: 'export',
            identifier,
          });
        }
      } else if (type === 'require_expression') {
        let modulePath = '';
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;
          if (child.type === 'string' || child.type === 'string_literal') {
            const pathText = sourceCode.slice(child.startIndex, child.endIndex);
            modulePath = pathText.slice(1, -1);
            break;
          }
        }
        if (modulePath) {
          if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
            modulePath = path.resolve(path.dirname(filePath), modulePath);
          }
          graph.edges.push({ source: filePath, target: modulePath, type: 'require' });
          if (!graph.nodes.some((n) => n.path === modulePath)) {
            graph.nodes.push({ path: modulePath, name: path.basename(modulePath), type: 'module' });
          }
        }
      } else if (type === 'call_expression') {
        let callee: ASTNode | null = null;
        let args: ASTNode | null = null;
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (!c) continue;
          if (c.type === 'identifier') callee = c;
          else if (c.type === 'arguments') args = c;
        }
        if (callee && sourceCode.slice(callee.startIndex, callee.endIndex) === 'require' && args) {
          let modulePath = '';
          for (let i = 0; i < args.childCount; i++) {
            const a = args.child(i);
            if (a && (a.type === 'string' || a.type === 'string_literal')) {
              const pathText = sourceCode.slice(a.startIndex, a.endIndex);
              modulePath = pathText.slice(1, -1);
              break;
            }
          }
          if (modulePath) {
            graph.edges.push({ source: filePath, target: modulePath, type: 'require' });
            if (!graph.nodes.some((n) => n.path === modulePath)) {
              graph.nodes.push({ path: modulePath, name: path.basename(modulePath), type: 'module' });
            }
          }
        }
      } else if (type === 'assignment_expression') {
        const left = node.child(0);
        if (left?.type === 'member_expression') {
          let obj = '';
          let prop = '';
          for (let i = 0; i < left.childCount; i++) {
            const c = left.child(i);
            if (c && (c.type === 'identifier' || c.type === 'property_identifier')) {
              const text = sourceCode.slice(c.startIndex, c.endIndex);
              if (!obj) obj = text;
              else prop = text;
            }
          }
          if (obj === 'module' && prop === 'exports') {
            graph.edges.push({ source: filePath, target: filePath, type: 'export' });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
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
    'function_declaration',
    'function_definition',
    'method_definition',
    'arrow_function',
    'class_declaration',
    'class_definition',
    'interface_declaration',
    'type_alias_declaration',
  ]),
  indentBlockTypes: new Set(['class_body', 'statement_block']),
};
