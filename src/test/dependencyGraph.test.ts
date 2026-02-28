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

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildDependencyGraph } from '../shared/dependencyGraph';

// Helper function to read test files
function readTestFile(filename: string): string {
  const filePath = path.join(__dirname, 'fixtures', filename);
  return fs.readFileSync(filePath, 'utf-8');
}

describe('Dependency Graph', () => {
  describe('buildDependencyGraph', () => {
    it('should extract dependencies from JavaScript file', () => {
      const sourceCode = readTestFile('sample.js');
      const filePath = '/test/sample.js';
      const graph = buildDependencyGraph(sourceCode, 'js', filePath);

      expect(graph).toHaveProperty('nodes');
      expect(graph).toHaveProperty('edges');

      // Check that we have at least one node (the file itself)
      expect(graph.nodes.length).toBeGreaterThan(0);

      // Check for expected node types
      const fileNodes = graph.nodes.filter((node) => node.type === 'file');
      expect(fileNodes.length).toBeGreaterThan(0);

      // Check for import/export edges
      const importEdges = graph.edges.filter((edge) => edge.type === 'import');
      expect(importEdges.length).toBeGreaterThanOrEqual(2);

      const exportEdges = graph.edges.filter((edge) => edge.type === 'export');
      expect(exportEdges.length).toBeGreaterThanOrEqual(2);

      // Check for specific import patterns
      const importedFunctionEdge = graph.edges.find(
        (edge) => edge.type === 'import' && edge.identifier === 'someFunction'
      );
      expect(importedFunctionEdge).toBeDefined();

      const defaultImportEdge = graph.edges.find(
        (edge) => edge.type === 'import' && edge.identifier === 'defaultImport'
      );
      expect(defaultImportEdge).toBeDefined();

      // Check for re-export
      const reexportEdge = graph.edges.find(
        (edge) =>
          edge.type === 'export' && edge.target.includes('reexportModule')
      );
      expect(reexportEdge).toBeDefined();

      // Check for named export
      const namedExportEdge = graph.edges.find(
        (edge) => edge.type === 'export' && edge.identifier === 'something'
      );
      expect(namedExportEdge).toBeDefined();
    });

    it('should extract dependencies from TypeScript file', () => {
      const sourceCode = readTestFile('sample.ts');
      const filePath = '/test/sample.ts';
      const graph = buildDependencyGraph(sourceCode, 'ts', filePath);

      expect(graph).toHaveProperty('nodes');
      expect(graph).toHaveProperty('edges');

      // Check that we have at least one node (the file itself)
      expect(graph.nodes.length).toBeGreaterThan(0);

      // Check for import/export edges
      const importEdges = graph.edges.filter((edge) => edge.type === 'import');
      expect(importEdges.length).toBeGreaterThanOrEqual(2);

      const exportEdges = graph.edges.filter((edge) => edge.type === 'export');
      expect(exportEdges.length).toBeGreaterThanOrEqual(2);

      // Check for specific import patterns
      const importedFunctionEdge = graph.edges.find(
        (edge) => edge.type === 'import' && edge.identifier === 'someFunction'
      );
      expect(importedFunctionEdge).toBeDefined();

      const defaultImportEdge = graph.edges.find(
        (edge) => edge.type === 'import' && edge.identifier === 'defaultImport'
      );
      expect(defaultImportEdge).toBeDefined();

      // Check for re-export
      const reexportEdge = graph.edges.find(
        (edge) =>
          edge.type === 'export' && edge.target.includes('reexportModule')
      );
      expect(reexportEdge).toBeDefined();

      // Check for named export
      const namedExportEdge = graph.edges.find(
        (edge) => edge.type === 'export' && edge.identifier === 'something'
      );
      expect(namedExportEdge).toBeDefined();
    });

    it('should handle empty files', () => {
      const sourceCode = '';
      const filePath = '/test/empty.js';
      const graph = buildDependencyGraph(sourceCode, 'js', filePath);

      // The dependency graph should return empty arrays for empty files
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });

    it('should handle files with only comments', () => {
      const sourceCode = '// This is a comment\n/* This is also a comment */\n';
      const filePath = '/test/comments.js';
      const graph = buildDependencyGraph(sourceCode, 'js', filePath);

      // The dependency graph should return empty arrays for files with only comments
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });

    it('should handle files with only whitespace', () => {
      const sourceCode = '  \n  \n  \n';
      const filePath = '/test/whitespace.js';
      const graph = buildDependencyGraph(sourceCode, 'js', filePath);

      // The dependency graph should return empty arrays for files with only whitespace
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });
  });
});
