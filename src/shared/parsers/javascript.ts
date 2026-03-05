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
 * JavaScript / TypeScript dependency extraction and outline config.
 *
 * Dependency extraction uses two focused passes over the AST:
 *
 *   Pass 1 – import/export/require:
 *     Traverses the full AST.  When `import_statement` or `export_statement`
 *     is encountered it is processed and recursion into that subtree stops.
 *     This prevents double-processing child nodes like `import_clause` or
 *     `export_clause` which are component parts, not standalone statements.
 *     `call_expression` is checked for require() and dynamic import().
 *
 *   Pass 2 – symbol declarations:
 *     Iterates only the direct children of the program root to capture
 *     top-level declarations (functions, classes, interfaces, types, named
 *     arrow-function constants).  Class bodies are descended one level to
 *     extract method definitions.  `export_statement` wrappers are unwrapped
 *     to mark the inner declaration as exported.
 *     Test symbols (describe / test / it calls) are detected inside
 *     expression_statements and their callback bodies.
 *
 * Tree-sitter node types referenced (tree-sitter-javascript / -typescript):
 *   import_statement, import_clause, named_imports, import_specifier,
 *   namespace_import, export_statement, export_clause, export_specifier,
 *   call_expression, arguments, function_declaration,
 *   generator_function_declaration, class_declaration, class_body,
 *   method_definition, interface_declaration (TS), type_alias_declaration (TS),
 *   enum_declaration (TS), lexical_declaration, variable_declaration,
 *   variable_declarator, arrow_function, function, generator_function,
 *   string, template_string, expression_statement, statement_block.
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

/** True when the file follows JS/TS test naming conventions. */
export function isTestFilePath(filePath: string): boolean {
  const base = path.basename(filePath);
  if (/\.(test|spec)\.[jt]sx?$/.test(base)) return true;
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('/__tests__/');
}

/** Call expressions whose string argument names a test suite or test case. */
const TEST_CALL_NAMES = new Set([
  'describe', 'it', 'test', 'suite', 'context', 'specify',
  'xdescribe', 'xit', 'xtest', 'fdescribe', 'fit',
]);

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
  const extraNodes: DependencyNode[] = []; // external/module nodes only
  const testFile = isTestFilePath(filePath);

  // -------------------------------------------------------------------------
  // Shared AST helpers (used by both passes)
  // -------------------------------------------------------------------------

  function nodeText(n: ASTNode): string {
    return sourceCode.slice(n.startIndex, n.endIndex);
  }

  function isStringLiteral(n: ASTNode): boolean {
    return n.type === 'string' || n.type === 'string_literal' || n.type === 'template_string';
  }

  /** Strip surrounding quote characters from a string-literal node. */
  function stringValue(n: ASTNode): string {
    const raw = nodeText(n);
    // single/double/backtick quoted
    return raw.length >= 2 ? raw.slice(1, -1) : raw;
  }

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

  /** First direct child that is any string literal. */
  function firstStringChild(n: ASTNode): ASTNode | null {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c && isStringLiteral(c)) return c;
    }
    return null;
  }

  /** Recursively find the first descendant (or self) whose type matches `t`. */
  function findFirst(n: ASTNode, t: string): ASTNode | null {
    if (n.type === t) return n;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) {
        const found = findFirst(c, t);
        if (found) return found;
      }
    }
    return null;
  }

  /** Resolve a module specifier to an absolute path when it is relative. */
  function resolveTarget(spec: string): string {
    if (spec.startsWith('./') || spec.startsWith('../')) {
      return path.resolve(path.dirname(filePath), spec);
    }
    return spec; // external package — keep as-is
  }

  /** Add a module node to extraNodes if it does not already exist. */
  function ensureModuleNode(targetPath: string): void {
    if (!extraNodes.some((n) => n.path === targetPath)) {
      extraNodes.push({ path: targetPath, name: path.basename(targetPath), type: 'module' });
    }
  }

  // -------------------------------------------------------------------------
  // Named-import extraction from an import_clause node
  //
  // import_clause grammar (tree-sitter-javascript):
  //   identifier                       → default import (e.g. import React)
  //   named_imports                    → { foo, bar as baz }
  //   namespace_import                 → * as ns
  //   identifier , named_imports       → React, { useState }
  //   identifier , namespace_import    → React, * as ns
  // -------------------------------------------------------------------------
  function extractImportClauseSymbols(importClause: ASTNode): string[] {
    const names: string[] = [];

    for (let i = 0; i < importClause.childCount; i++) {
      const c = importClause.child(i);
      if (!c) continue;

      if (c.type === 'identifier') {
        // Default import name (e.g. `React` in `import React, { foo } from '...'`)
        names.push(nodeText(c));
      } else if (c.type === 'named_imports') {
        // { foo, bar as baz }
        for (let j = 0; j < c.childCount; j++) {
          const spec = c.child(j);
          if (spec?.type === 'import_specifier') {
            // import_specifier: "foo"  or  "origName as localName"
            // The local (binding) name is the LAST identifier in the specifier.
            let lastName = '';
            for (let k = 0; k < spec.childCount; k++) {
              const id = spec.child(k);
              if (id?.type === 'identifier') lastName = nodeText(id);
            }
            if (lastName) names.push(lastName);
          }
        }
      } else if (c.type === 'namespace_import') {
        // import * as ns — no specific symbol name to record; this is a
        // full-namespace import.  Intentionally not adding to names so that
        // edge.identifier stays undefined (namespace imports don't name a
        // single source symbol).
      }
    }

    return names;
  }

  // -------------------------------------------------------------------------
  // Pass 1: Import / export / require dependency extraction
  //
  // Rules:
  //   import_statement  → process, then STOP recursing (do not enter import_clause etc.)
  //   export_statement  → process, then STOP recursing
  //   call_expression   → check for require()/import(), then recurse normally
  //   everything else   → recurse normally
  // -------------------------------------------------------------------------

  /**
   * Extract the exported name from a direct export statement (no `from`).
   * Returns:
   *   - the name string if a named declaration was found
   *   - '' (empty string) for anonymous default exports (caller should use 'default')
   *   - null if this export_statement should not generate a self-referential edge
   *     (e.g. it's a re-export that was already handled, or not recognised)
   */
  function collectDirectExportDeclName(exportStmt: ASTNode): string | null {
    let hasDefault = false;
    for (let i = 0; i < exportStmt.childCount; i++) {
      const child = exportStmt.child(i);
      if (!child) continue;
      if (child.type === 'export') continue;
      if (child.type === ';') continue;
      // export_clause and string literals are handled elsewhere
      if (child.type === 'export_clause' || isStringLiteral(child)) return null;

      if (child.type === 'default') {
        hasDefault = true;
        continue;
      }

      if (hasDefault) {
        // export default <something>
        if (child.type === 'identifier') return nodeText(child); // export default Foo
        const name = getDeclName(child); // export default function foo() {}
        return name; // '' for anonymous, non-empty for named
      } else {
        // export function foo() {} / export class Foo {} / export const x = ...
        const name = getDeclName(child);
        if (name) return name;
        // Fallback for variable/lexical declarations where getDeclName may look too deep
        if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
          for (let j = 0; j < child.childCount; j++) {
            const decl = child.child(j);
            if (decl?.type === 'variable_declarator') {
              const id = childByType(decl, 'identifier');
              if (id) return nodeText(id);
            }
          }
        }
      }
    }
    return null;
  }

  function walkImports(node: ASTNode | null): void {
    if (!node) return;

    // ── Static import ───────────────────────────────────────────────────────
    if (node.type === 'import_statement') {
      // Module path is a string that is a direct child of import_statement.
      const strNode = firstStringChild(node);
      if (strNode) {
        const spec = stringValue(strNode);
        const resolved = resolveTarget(spec);
        const importClause = childByType(node, 'import_clause');
        const importedSymbols = importClause ? extractImportClauseSymbols(importClause) : [];
        edges.push({
          source: filePath,
          target: resolved,
          type: 'import',
          identifier: importedSymbols[0],
          symbols: importedSymbols.length > 0 ? importedSymbols : undefined,
        });
        ensureModuleNode(resolved);
      }
      return; // ← do NOT recurse into import_statement children
    }

    // ── Export statement ─────────────────────────────────────────────────────
    if (node.type === 'export_statement') {
      let reexportSpec: string | null = null;
      const reexportNames: string[] = [];

      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c) continue;

        if (isStringLiteral(c)) {
          // export { foo } from './mod'  or  export * from './mod'
          reexportSpec = stringValue(c);
        } else if (c.type === 'export_clause') {
          // export { foo, bar as baz }
          for (let j = 0; j < c.childCount; j++) {
            const spec = c.child(j);
            if (spec?.type === 'export_specifier') {
              // For dependency tracking we want the SOURCE name (the name as it
              // appears in the target module), which is always the FIRST identifier
              // in the specifier.  For `export { original as alias }` this is
              // `original`; for `export { something }` it is `something`.
              const firstId = spec.child(0);
              const sourceName = firstId?.type === 'identifier' ? nodeText(firstId) : '';
              if (sourceName) reexportNames.push(sourceName);
            }
          }
        }
        // Declarations inside export_statement are handled in Pass 2.
      }

      if (reexportSpec) {
        // Re-export to another module: export { X } from './mod' or export * from './mod'
        const resolved = resolveTarget(reexportSpec);
        edges.push({
          source: filePath,
          target: resolved,
          type: 'export',
          identifier: reexportNames.length > 0 ? reexportNames[0] : undefined,
          symbols: reexportNames.length > 0 ? reexportNames : undefined,
        });
        ensureModuleNode(resolved);
      } else {
        // Direct export (self-referential edge) — records what this file exports.
        // This covers:
        //   export function foo() {}   → identifier: 'foo'
        //   export class Bar {}        → identifier: 'Bar'
        //   export const x = ...       → identifier: 'x'
        //   export default MainClass   → identifier: 'MainClass'
        //   export default function(){}→ identifier: 'default'
        //   export { foo, bar }        → identifiers: 'foo', 'bar'
        if (reexportNames.length > 0) {
          // export { foo, bar } without 'from'
          for (const name of reexportNames) {
            edges.push({ source: filePath, target: filePath, type: 'export', identifier: name });
          }
        } else {
          // export <declaration>  or  export default <expr>
          const name = collectDirectExportDeclName(node);
          if (name !== null) {
            edges.push({
              source: filePath,
              target: filePath,
              type: 'export',
              identifier: name || 'default', // '' for anonymous default → 'default'
            });
          }
        }
      }
      return; // ← do NOT recurse into export_statement children
    }

    // ── Call expressions: require() and dynamic import() ───────────────────
    if (node.type === 'call_expression') {
      const callee = node.child(0); // first child is always the callee
      const argsNode = childByType(node, 'arguments');

      if (callee && argsNode) {
        if (callee.type === 'identifier' && nodeText(callee) === 'require') {
          // require('./module') — keep the raw specifier without path resolution
          // so that the target matches exactly what is written in source.
          const strArg = firstStringChild(argsNode);
          if (strArg) {
            const rawTarget = stringValue(strArg);
            edges.push({ source: filePath, target: rawTarget, type: 'require' });
            ensureModuleNode(rawTarget);
          }
        } else if (callee.type === 'import') {
          // Dynamic import: import('./module')
          const strArg = firstStringChild(argsNode);
          if (strArg) {
            const resolved = resolveTarget(stringValue(strArg));
            edges.push({ source: filePath, target: resolved, type: 'import' });
            ensureModuleNode(resolved);
          }
        }
      }

      // Always recurse — require/import() can appear at any nesting depth
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walkImports(child);
      }
      return;
    }

    // ── CommonJS module.exports = ... ────────────────────────────────────────
    if (node.type === 'assignment_expression') {
      const left = node.child(0);
      if (left?.type === 'member_expression') {
        let obj = '';
        let prop = '';
        for (let i = 0; i < left.childCount; i++) {
          const c = left.child(i);
          if (c && (c.type === 'identifier' || c.type === 'property_identifier')) {
            if (!obj) obj = nodeText(c);
            else prop = nodeText(c);
          }
        }
        if (obj === 'module' && prop === 'exports') {
          edges.push({ source: filePath, target: filePath, type: 'export' });
        }
      }
    }

    // Default: recurse into all children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walkImports(child);
    }
  }

  // -------------------------------------------------------------------------
  // Pass 2: Symbol extraction
  //
  // Only iterates direct children of the program root so we do not confuse
  // inner functions with top-level declarations.  Class bodies are descended
  // one additional level for method_definition nodes.
  // -------------------------------------------------------------------------

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

  function isFunctionLike(n: ASTNode): boolean {
    return n.type === 'arrow_function' || n.type === 'function' || n.type === 'generator_function';
  }

  /** Get the declaration name by finding the first `identifier` in the subtree. */
  function getDeclName(n: ASTNode): string {
    // Direct child check is faster than a full recursive search for common cases
    const directId = childByType(n, 'identifier');
    if (directId) return nodeText(directId);
    const deep = findFirst(n, 'identifier');
    return deep ? nodeText(deep) : '';
  }

  /** Extract method_definition symbols from a class body. */
  function extractClassMethods(classNode: ASTNode, className: string, isExported: boolean): void {
    const body = childByType(classNode, 'class_body');
    if (!body) return;
    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i);
      if (!member) continue;
      if (member.type === 'method_definition') {
        const mName = getDeclName(member);
        // Skip the constructor — it is implied by the class symbol
        if (mName && mName !== 'constructor') {
          addSymbol(mName, 'method', member.startPosition.row + 1, isExported, false, className);
        }
      }
    }
  }

  /**
   * Detect Jest/Vitest/Mocha/Jasmine test-block call expressions and record
   * the test name (first string argument) as a test symbol.
   * Recurses into the callback body so nested describe() blocks are captured.
   */
  function extractTestCalls(callNode: ASTNode): void {
    const callee = callNode.child(0);
    if (!callee) return;
    if (callee.type !== 'identifier') return;
    if (!TEST_CALL_NAMES.has(nodeText(callee))) return;

    const argsNode = childByType(callNode, 'arguments');
    if (!argsNode) return;

    // First string argument is the test/suite name
    const strArg = firstStringChild(argsNode);
    if (strArg) {
      addSymbol(stringValue(strArg), 'function', callNode.startPosition.row + 1, false, true);
    }

    // Recurse into the callback body to capture nested describe/it/test
    for (let i = 0; i < argsNode.childCount; i++) {
      const arg = argsNode.child(i);
      if (!arg || !isFunctionLike(arg)) continue;
      const body =
        findFirst(arg, 'statement_block') ??
        childByType(arg, 'block'); // some parsers use 'block'
      if (!body) continue;
      for (let j = 0; j < body.childCount; j++) {
        const innerStmt = body.child(j);
        if (innerStmt?.type === 'expression_statement') {
          // First meaningful child of expression_statement is the expression
          for (let k = 0; k < innerStmt.childCount; k++) {
            const expr = innerStmt.child(k);
            if (expr?.type === 'call_expression') {
              extractTestCalls(expr);
              break;
            }
          }
        }
      }
      break; // only the first function argument is the callback
    }
  }

  /**
   * Process a top-level statement (or a declaration inside an export_statement).
   * `isExported` is true when the statement is wrapped in an `export` keyword.
   */
  function processTopLevelStatement(stmt: ASTNode, isExported: boolean): void {
    switch (stmt.type) {
      case 'function_declaration':
      case 'generator_function_declaration': {
        const name = getDeclName(stmt);
        addSymbol(name, 'function', stmt.startPosition.row + 1, isExported, false);
        break;
      }

      case 'class_declaration': {
        const name = getDeclName(stmt);
        addSymbol(name, 'class', stmt.startPosition.row + 1, isExported, false);
        extractClassMethods(stmt, name, isExported);
        break;
      }

      case 'interface_declaration': {
        // TypeScript: interface Foo { ... }
        const name = getDeclName(stmt);
        addSymbol(name, 'interface', stmt.startPosition.row + 1, isExported, false);
        break;
      }

      case 'type_alias_declaration': {
        // TypeScript: type Foo = ...
        const name = getDeclName(stmt);
        addSymbol(name, 'type', stmt.startPosition.row + 1, isExported, false);
        break;
      }

      case 'enum_declaration': {
        // TypeScript: enum Direction { ... }
        const name = getDeclName(stmt);
        addSymbol(name, 'type', stmt.startPosition.row + 1, isExported, false);
        break;
      }

      case 'lexical_declaration':
      case 'variable_declaration': {
        // const foo = () => {} / const Foo = class { ... } / var x = function() {}
        for (const decl of childrenByType(stmt, 'variable_declarator')) {
          const idNode = childByType(decl, 'identifier');
          if (!idNode) continue;
          const name = nodeText(idNode);
          // The value (right-hand side) is the last child of variable_declarator
          const valNode = decl.child(decl.childCount - 1);
          if (!valNode) continue;
          if (isFunctionLike(valNode)) {
            addSymbol(name, 'function', decl.startPosition.row + 1, isExported, false);
          } else if (valNode.type === 'class') {
            addSymbol(name, 'class', decl.startPosition.row + 1, isExported, false);
            extractClassMethods(valNode, name, isExported);
          }
        }
        break;
      }

      case 'export_statement': {
        // export function foo() {} / export class Foo / export default ...
        // Unwrap to get the inner declaration, marking it as exported.
        for (let i = 0; i < stmt.childCount; i++) {
          const child = stmt.child(i);
          if (!child) continue;
          // Skip keywords and re-export parts (handled in Pass 1)
          if (
            child.type === 'export' ||
            child.type === 'default' ||
            child.type === 'export_clause' ||
            isStringLiteral(child)
          ) continue;
          processTopLevelStatement(child, true);
        }
        break;
      }

      case 'expression_statement': {
        // Top-level expression: detect describe/test/it calls for test symbols
        for (let i = 0; i < stmt.childCount; i++) {
          const expr = stmt.child(i);
          if (expr?.type === 'call_expression') {
            extractTestCalls(expr);
            break;
          }
        }
        break;
      }

      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Execute both passes
  // -------------------------------------------------------------------------

  // Pass 2: top-level symbols (function declarations, classes, test blocks, ...)
  const programRoot = tree.rootNode;
  for (let i = 0; i < programRoot.childCount; i++) {
    const stmt = programRoot.child(i);
    if (stmt) processTopLevelStatement(stmt, false);
  }

  // Pass 1: import/export/require edges (full tree walk)
  walkImports(tree.rootNode);

  // -------------------------------------------------------------------------
  // Assemble the final graph
  // -------------------------------------------------------------------------

  const nodes: DependencyNode[] = [];

  // Source file node — present whenever we found anything worth recording
  if (edges.length > 0 || symbols.length > 0) {
    nodes.push({
      path: filePath,
      name: path.basename(filePath),
      type: 'file',
      symbols,
      isTestFile: testFile,
    });
  }

  // Module nodes for all import targets
  nodes.push(...extraNodes);

  return { nodes, edges };
};

// ---------------------------------------------------------------------------
// Outline config
// ---------------------------------------------------------------------------

/**
 * Outline config for JS/TS.
 *
 * `declarationNodeTypes` — node types that produce an outline entry.
 *   `arrow_function` is intentionally excluded: it matches every callback and
 *   inline lambda.  Named arrow functions (const foo = () => {}) are captured
 *   via their parent `variable_declarator`'s first line in the outline text.
 *
 * `indentBlockTypes` — node types that increase depth for their children.
 *   Only `class_body` is needed so that methods appear one level deeper than
 *   their class.  `statement_block` is too broad (every function body).
 */
export const outlineConfig: OutlineConfig = {
  declarationNodeTypes: new Set([
    'function_declaration',
    'generator_function_declaration',
    'method_definition',
    'class_declaration',
    'interface_declaration',    // TypeScript
    'type_alias_declaration',   // TypeScript
    'enum_declaration',         // TypeScript
  ]),
  indentBlockTypes: new Set(['class_body']),
};
