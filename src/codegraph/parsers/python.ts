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
 *
 * Import handling:
 *   `import foo`               → absolute module  (foo → foo/foo.py approx)
 *   `import foo.bar`           → dotted module    (foo.bar → foo/bar.py)
 *   `import foo as bar`        → same, aliased
 *   `from foo import a, b`     → dotted module + named symbols [a, b]
 *   `from . import a, b`       → relative (current package) + named symbols
 *   `from .. import a`         → relative (parent package) + named symbols
 *   `from .sub import a`       → relative (sibling) + named symbols
 *   `from ..pkg import a`      → relative (parent's child package) + named symbols
 *
 * Relative import resolution:
 *   Python dots encode how many directory levels to go up from the current
 *   file's directory before appending the module path.
 *   e.g. `from ..sub import x`  in  /a/b/c.py  →  /a/b/../sub  →  /a/sub
 *
 * Symbol extraction:
 *   Top-level function_definition and class_definition are recorded.
 *   Methods inside class bodies are recorded with `parent` set to the class name.
 *   Test symbols:
 *     - Function names starting with `test_` → isTest: true
 *     - Class names starting with `Test`     → isTest: true (pytest convention)
 *
 * Test file detection:
 *   test_*.py  or  *_test.py
 *
 * Tree-sitter-python node types used:
 *   import_statement, import_from_statement, aliased_import, dotted_name,
 *   relative_import, wildcard_import, import_prefix (the dots in relative import),
 *   function_definition, class_definition, decorated_definition, block,
 *   identifier.
 */

import * as path from 'path';
import type { ASTNode, ParsedTree, DependencyExtractor, OutlineConfig } from './types';
import type {
  DependencyGraph,
  DependencyEdge,
  DependencyNode,
  SymbolInfo,
  SymbolKind,
} from '../dependencyGraphTypes';

// ---------------------------------------------------------------------------
// Test file detection
// ---------------------------------------------------------------------------

/** True when the file follows pytest naming conventions. */
export function isTestFilePath(filePath: string): boolean {
  const base = path.basename(filePath);
  if (!base.endsWith('.py')) return false;
  const stem = base.slice(0, -3);
  return stem.startsWith('test_') || stem.endsWith('_test');
}

// ---------------------------------------------------------------------------
// Compat: getTestEntries — adapter over extractDependencies for callers that
// still use the legacy function signature.
// ---------------------------------------------------------------------------

/** Legacy shape returned by getTestEntries. */
export interface PythonTestEntry {
  filePath: string;
  line: number;
  name: string;
  kind: 'test_function' | 'test_class';
}

/**
 * Extract test functions and test classes from a Python file.
 *
 * @deprecated Use `extractDependencies` and inspect `SymbolInfo.isTest` instead.
 *   This function is kept for backwards compatibility.
 */
export function getTestEntries(
  sourceCode: string,
  tree: import('./types').ParsedTree,
  filePath: string
): PythonTestEntry[] {
  const graph = extractDependencies(sourceCode, tree, filePath);
  const fileNode = graph.nodes.find((n) => n.path === filePath && n.type === 'file');
  if (!fileNode?.symbols) return [];
  return fileNode.symbols
    .filter((s) => s.isTest)
    .map((s) => ({
      filePath,
      line: s.line,
      name: s.name,
      kind: (s.kind === 'class' ? 'test_class' : 'test_function') as 'test_function' | 'test_class',
    }));
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/** First direct child whose type matches `t`. */
function childByType(n: ASTNode, t: string): ASTNode | null {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c?.type === t) return c;
  }
  return null;
}

/** All direct children whose type matches `t`. */
function childrenByType(n: ASTNode, t: string): ASTNode[] {
  const result: ASTNode[] = [];
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c?.type === t) result.push(c);
  }
  return result;
}

/** Raw source text of a node. */
function nodeText(sourceCode: string, n: ASTNode): string {
  return sourceCode.slice(n.startIndex, n.endIndex).trim();
}

/** Get the declared name (identifier) of a function_definition or class_definition. */
function getDeclName(sourceCode: string, node: ASTNode): string {
  const id = childByType(node, 'identifier');
  return id ? nodeText(sourceCode, id) : '';
}

// ---------------------------------------------------------------------------
// Relative import resolution
//
// Python's relative import syntax:
//   `from . import foo`    → 1 dot  → look in the current package directory
//   `from .. import foo`   → 2 dots → go up 1 level (parent package)
//   `from ... import foo`  → 3 dots → go up 2 levels
//   `from .sub import foo` → 1 dot + "sub" → look in current package's sub/
//   `from ..pkg import foo`→ 2 dots + "pkg" → go up 1 level then into pkg/
//
// The tree-sitter-python `relative_import` node contains:
//   import_prefix  (the dots, e.g. ".." text)
//   dotted_name    (optional module path after the dots, e.g. "sub" or "pkg.mod")
//
// Algorithm:
//   1. Count the number of leading dots (level).
//   2. Start from the directory containing `filePath`.
//   3. Walk up (level - 1) times (1 dot = current package dir, no going up).
//   4. Append the optional module path converted from dots to path separators.
// ---------------------------------------------------------------------------

function countLeadingDots(text: string): number {
  let count = 0;
  while (count < text.length && text[count] === '.') count++;
  return count;
}

/**
 * Resolve a Python module reference to an approximate file-system path.
 *
 * @param filePath   Absolute path of the file containing the import.
 * @param moduleName Dotted module name (may be empty string for bare `from . import x`).
 * @param level      Number of leading dots (0 = absolute, 1 = current pkg, 2 = parent pkg, ...).
 */
function resolveModulePath(filePath: string, moduleName: string, level: number): string {
  if (level === 0) {
    // Absolute import: `import foo.bar` or `from foo.bar import x`
    return moduleName.replace(/\./g, path.sep);
  }

  // Relative import: start at the file's directory and ascend (level-1) times.
  // level=1 → current package  (stay in dirname)
  // level=2 → parent package   (go up 1 from dirname)
  // level=3 → grandparent      (go up 2)
  let base = path.dirname(filePath);
  for (let i = 1; i < level; i++) {
    base = path.dirname(base);
  }

  if (!moduleName) {
    // `from . import foo` — the package itself (its __init__.py)
    return base;
  }

  // Append the module path
  return path.join(base, moduleName.replace(/\./g, path.sep));
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export const extractDependencies: DependencyExtractor = (
  sourceCode: string,
  tree: ParsedTree,
  filePath: string
): DependencyGraph => {
  const edges: DependencyEdge[] = [];
  const symbols: SymbolInfo[] = [];
  const extraNodes: DependencyNode[] = [];
  const testFile = isTestFilePath(filePath);

  function text(n: ASTNode): string {
    return nodeText(sourceCode, n);
  }

  function ensureModuleNode(targetPath: string): void {
    if (!extraNodes.some((n) => n.path === targetPath)) {
      extraNodes.push({ path: targetPath, name: path.basename(targetPath), type: 'module' });
    }
  }

  function addEdge(target: string, importedSymbols: string[]): void {
    edges.push({
      source: filePath,
      target,
      type: 'import',
      identifier: importedSymbols[0],
      symbols: importedSymbols.length > 0 ? importedSymbols : undefined,
    });
    ensureModuleNode(target);
  }

  function addSymbol(
    name: string,
    kind: SymbolKind,
    line: number,
    isExported: boolean,
    isTest: boolean,
    parent?: string,
  ): void {
    if (!name) return;
    symbols.push({ name, kind, line, isTest, isExported, parent });
  }

  // -------------------------------------------------------------------------
  // Collect imported symbol names from an import_from_statement's import list.
  //
  // After the module name in `from X import ...`, the remaining children are:
  //   identifier nodes (plain names like `import a, b`)
  //   aliased_import  (`import a as b` — local name is inside it)
  //   wildcard_import (`import *`)
  // -------------------------------------------------------------------------
  function collectImportedNames(importFromNode: ASTNode): string[] {
    const names: string[] = [];
    let pastImport = false;
    for (let i = 0; i < importFromNode.childCount; i++) {
      const c = importFromNode.child(i);
      if (!c) continue;
      // Only collect names that appear after the 'import' keyword.
      if (c.type === 'import') { pastImport = true; continue; }
      if (!pastImport) continue;
      if (c.type === 'identifier') {
        names.push(text(c));
      } else if (c.type === 'dotted_name') {
        // Single-word imported names often appear as dotted_name nodes
        // (e.g. `from .pkg import API_BASE` → dotted_name child for API_BASE).
        names.push(text(c));
      } else if (c.type === 'aliased_import') {
        // `foo as bar` — record the SOURCE name (the name exported by the module)
        // so it can be matched against the exporting file's symbol table.
        // In tree-sitter-python: aliased_import → dotted_name|identifier "as" identifier
        const first = c.child(0);
        if (first) names.push(text(first));
      } else if (c.type === 'wildcard_import') {
        names.push('*');
      }
    }
    return names;
  }

  // -------------------------------------------------------------------------
  // Main walk: collect imports and symbols
  // -------------------------------------------------------------------------

  function walk(node: ASTNode | null): void {
    if (!node) return;

    // ── import foo  /  import foo.bar  /  import foo as bar ─────────────────
    if (node.type === 'import_statement') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === 'dotted_name') {
          // import foo.bar
          const modulePath = text(child);
          const target = resolveModulePath(filePath, modulePath, 0);
          addEdge(target, []);
        } else if (child.type === 'aliased_import') {
          // import foo.bar as baz — module path is the dotted_name child
          const dotted = childByType(child, 'dotted_name');
          if (dotted) {
            const modulePath = text(dotted);
            const target = resolveModulePath(filePath, modulePath, 0);
            addEdge(target, []);
          }
        }
      }
      return; // no recursion needed for import_statement
    }

    // ── from X import a, b  /  from . import a  /  from ..pkg import a ──────
    if (node.type === 'import_from_statement') {
      let moduleName = '';
      let level = 0;

      // Scan children ONLY up to (not including) the 'import' keyword to find
      // the module reference.  Children after 'import' are the imported names
      // and must not be treated as module specifiers.
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        // Stop once we reach the 'import' keyword.
        if (child.type === 'import') break;

        if (child.type === 'relative_import') {
          // relative_import node holds the leading dots and optional dotted_name
          // tree-sitter-python structure:
          //   relative_import
          //     import_prefix  (the dots: "." or ".." etc.)
          //     dotted_name    (optional: the module path after the dots)
          const prefix = childByType(child, 'import_prefix');
          if (prefix) {
            level = countLeadingDots(text(prefix));
          } else {
            // Some tree-sitter versions expose the dots differently; fall back
            // to counting leading dots in the full relative_import text.
            const fullText = text(child);
            level = countLeadingDots(fullText);
          }
          const dotted = childByType(child, 'dotted_name');
          if (dotted) moduleName = text(dotted);
        } else if (child.type === 'dotted_name') {
          // Absolute: from foo.bar import ...
          moduleName = text(child);
        }
      }

      // Collect the symbols being imported (after the module reference)
      const importedSymbols = collectImportedNames(node);

      if (level > 0 || moduleName) {
        const target = resolveModulePath(filePath, moduleName, level);
        addEdge(target, importedSymbols);
      }

      return; // no recursion needed
    }

    // ── function_definition: def foo(...): ──────────────────────────────────
    if (node.type === 'function_definition') {
      const name = getDeclName(sourceCode, node);
      const isTest = name.startsWith('test_') || name.startsWith('Test');
      addSymbol(name, 'function', node.startPosition.row + 1, false, isTest);
      // Recurse into body so nested functions/classes are captured
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }
      return;
    }

    // ── class_definition: class Foo: ─────────────────────────────────────────
    if (node.type === 'class_definition') {
      const name = getDeclName(sourceCode, node);
      const isTest = name.startsWith('Test');
      addSymbol(name, 'class', node.startPosition.row + 1, false, isTest);
      // Walk the class body to extract method definitions
      extractClassBody(node, name);
      return;
    }

    // ── decorated_definition: @decorator  def/class ... ─────────────────────
    if (node.type === 'decorated_definition') {
      // The actual declaration is the last meaningful child
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        if (child.type === 'function_definition' || child.type === 'class_definition') {
          walk(child);
          break;
        }
      }
      return;
    }

    // Recurse into all other nodes
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  /**
   * Extract method definitions from the body of a class.
   * Only direct children of the class's `block` are captured as methods;
   * nested classes or functions inside methods are not elevated to the
   * class method level.
   */
  function extractClassBody(classNode: ASTNode, className: string): void {
    const body = childByType(classNode, 'block');
    if (!body) return;
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      if (child.type === 'function_definition') {
        const mName = getDeclName(sourceCode, child);
        if (mName && mName !== '__init__') {
          const isTest = mName.startsWith('test_');
          addSymbol(mName, 'method', child.startPosition.row + 1, false, isTest, className);
        }
      } else if (child.type === 'decorated_definition') {
        // @decorator  def method(...)
        for (let j = 0; j < child.childCount; j++) {
          const inner = child.child(j);
          if (inner?.type === 'function_definition') {
            const mName = getDeclName(sourceCode, inner);
            if (mName && mName !== '__init__') {
              const isTest = mName.startsWith('test_');
              addSymbol(mName, 'method', inner.startPosition.row + 1, false, isTest, className);
            }
            break;
          }
        }
      } else if (child.type === 'class_definition') {
        // Nested class inside a class — record as a symbol but don't recurse
        // (inner classes are rare and usually not top-level query targets)
        const innerName = getDeclName(sourceCode, child);
        if (innerName) {
          addSymbol(innerName, 'class', child.startPosition.row + 1, false, false, className);
        }
      }
    }
  }

  walk(tree.rootNode);

  // -------------------------------------------------------------------------
  // Assemble final graph
  // -------------------------------------------------------------------------

  const nodes: DependencyNode[] = [];

  if (edges.length > 0 || symbols.length > 0) {
    nodes.push({
      path: filePath,
      name: path.basename(filePath),
      type: 'file',
      symbols,
      isTestFile: testFile,
    });
  }

  nodes.push(...extraNodes);

  return { nodes, edges };
};

// ---------------------------------------------------------------------------
// Outline config
// ---------------------------------------------------------------------------

export const outlineConfig: OutlineConfig = {
  declarationNodeTypes: new Set([
    'function_definition',
    'class_definition',
    'decorated_definition', // @decorator def/class — shows the decorator line
  ]),
  // `block` is the body of functions and classes; children inside it are
  // indented one level deeper in the outline.
  // `class_definition` is NOT in indentBlockTypes — it is already in
  // declarationNodeTypes, and the OR condition in outlineFile means it would
  // redundantly bump the depth counter.
  indentBlockTypes: new Set(['block']),
};
