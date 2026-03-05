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
 * Dependency graph types.
 *
 * Design goals — the graph must be rich enough to answer:
 *   - What files does file X depend on?           → edges where source=X, type=import|require
 *   - What symbols does file X depend on?         → edges where source=X, collect edge.symbols[]
 *   - What files does symbol S depend on?         → edges where source=S.filePath (file-level approx)
 *   - What symbols does symbol S depend on?       → edges where source=S.filePath, collect edge.symbols[]
 *   - What symbols are tests?                     → node.symbols[].isTest === true
 *   - What files/symbols does a test depend on?   → combine the above for the test symbol's file
 *
 * Paths in the graph are repo-relative after stripping in the codebase router.
 */

/** Granularity of a symbol declaration. */
export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'variable'
  | 'type'
  | 'interface';

/**
 * A named symbol declared within a source file.
 * Methods are nested under their parent class via `parent`.
 */
export interface SymbolInfo {
  /** Symbol name as it appears in source (e.g. "MyComponent", "test_login"). */
  name: string;
  kind: SymbolKind;
  /** 1-based line number of the declaration. */
  line: number;
  /**
   * True when this symbol is a test entity:
   *   - Python: function names starting with `test_`, class names starting with `Test`
   *   - JS/TS:  string argument of `describe(...)`, `test(...)`, `it(...)` call expressions
   */
  isTest: boolean;
  /** True when the symbol is exported from the file. */
  isExported: boolean;
  /** For methods: the name of the containing class. */
  parent?: string;
}

/**
 * Node in the dependency graph.
 * type='file'   → a source file we parsed; carries declared symbols.
 * type='module' → an external package or an unresolved import target.
 */
export interface DependencyNode {
  /** File path (absolute during extraction; repo-relative after stripping). */
  path: string;
  /** basename of the path. */
  name: string;
  type: 'file' | 'module';
  /**
   * Symbols declared in this file.
   * Populated for type='file'; absent for type='module'.
   */
  symbols?: SymbolInfo[];
  /**
   * True when the file follows test naming conventions:
   *   - JS/TS: *.test.{js,ts,jsx,tsx}, *.spec.{js,ts,jsx,tsx}, files inside __tests__/
   *   - Python: test_*.py, *_test.py
   */
  isTestFile?: boolean;
}

/**
 * A directed dependency edge (import / re-export / require) between two nodes.
 * `source` always refers to the file that declares the dependency.
 * `target` is the module or file being depended on.
 *
 * After normalisation by `normalizeEdgeTargetsToKnownFiles`, `target` should
 * equal an actual file path (with extension) so that
 *   edge.target === activeFilePath
 * works for inbound/outbound matching in the UI and PR-review logic.
 */
export interface DependencyEdge {
  source: string;
  target: string;
  type: 'import' | 'export' | 'require';
  /**
   * The first (or default) identifier imported — kept for backward compatibility
   * with consumers that only need a single name (e.g. UI tooltip).
   */
  identifier?: string;
  /**
   * All named symbols imported / re-exported via this edge.
   * Examples:
   *   `import { useState, useEffect } from 'react'`  → ['useState', 'useEffect']
   *   `from utils import log, warn`                  → ['log', 'warn']
   *   `import * as ns from './foo'`                  → ['*']
   *   `import defaultExport from './bar'`            → ['defaultExport']
   * Empty / absent means the full module is imported (side-effect or namespace import).
   */
  symbols?: string[];
}

/** Full dependency graph returned by an extractor or built over a set of files. */
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}
