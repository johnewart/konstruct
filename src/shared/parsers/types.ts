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
 * Language-agnostic parser plugin types.
 * Dependency extractors and outline configs are registered per file extension
 * so new languages (e.g. Python, Go) can be added without changing core logic.
 */

import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
} from '../dependencyGraphTypes';

/** Minimal AST node shape (tree-sitter compatible). */
export interface ASTNode {
  type: string;
  startPosition: { row: number };
  startIndex: number;
  endIndex: number;
  childCount: number;
  child: (i: number) => ASTNode | null;
}

/** Parsed tree as returned by a parser (e.g. tree-sitter). */
export interface ParsedTree {
  rootNode: ASTNode;
}

/**
 * Extracts a dependency graph from source + AST.
 * Each language (JS/TS, Python, Go, etc.) provides one.
 */
export type DependencyExtractor = (
  sourceCode: string,
  tree: ParsedTree,
  filePath: string
) => DependencyGraph;

/**
 * Config for outline generation: which node types are declarations
 * and which types increase indent depth in the outline.
 */
export interface OutlineConfig {
  /** Node types treated as top-level declarations (signature shown). */
  declarationNodeTypes: Set<string>;
  /** Node types that start a nested block (indent +1 for children). */
  indentBlockTypes?: Set<string>;
}

export type { DependencyGraph, DependencyNode, DependencyEdge };
