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
import {
  buildDependencyGraph,
  normalizeEdgeTargetsToKnownFiles,
} from './dependencyGraph';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Helper function to read test files
function readTestFile(filename: string): string {
  const filePath = path.join(FIXTURES_DIR, filename);
  return fs.readFileSync(filePath, 'utf-8');
}

/** Build merged dependency graph from a fixture dir: discover files by ext, parse each, merge and normalize. */
function buildMergedGraphFromFixtureDir(
  dirName: string,
  ext: string
): { nodes: Array<{ path: string }>; edges: Array<{ source: string; target: string; type: string }>; list: string[] } {
  const dir = path.join(FIXTURES_DIR, dirName);
  const names = fs.readdirSync(dir).filter((n) => path.extname(n).slice(1).toLowerCase() === ext);
  const list = names.map((n) => path.join(dir, n)).sort();
  const allNodes: Array<{ path: string }> = [];
  const allEdges: Array<{ source: string; target: string; type: string }> = [];
  for (const fullPath of list) {
    const source = fs.readFileSync(fullPath, 'utf-8');
    const graph = buildDependencyGraph(source, ext, fullPath);
    for (const node of graph.nodes) {
      if (!allNodes.some((n) => n.path === node.path)) allNodes.push({ path: node.path });
    }
    for (const edge of graph.edges) allEdges.push({ source: edge.source, target: edge.target, type: edge.type });
  }
  const normalizedEdges = normalizeEdgeTargetsToKnownFiles(allEdges, new Set(list));
  return { nodes: allNodes, edges: normalizedEdges, list };
}

function basename(p: string): string {
  return path.basename(p.replace(/\\/g, '/'));
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

  describe('normalizeEdgeTargetsToKnownFiles', () => {
    it('leaves edge target unchanged when already in known-file set (with extension)', () => {
      const known = new Set(['/repo/src/foo.ts', '/repo/src/bar.ts']);
      const edges = [
        { source: '/repo/src/foo.ts', target: '/repo/src/bar.ts', type: 'import' },
      ];
      const out = normalizeEdgeTargetsToKnownFiles(edges, known);
      expect(out).toHaveLength(1);
      expect(out[0].target).toBe('/repo/src/bar.ts');
    });

    it('updates target to path with extension when target has no extension', () => {
      const known = new Set(['/repo/src/foo.ts', '/repo/src/utils.ts']);
      const edges = [
        { source: '/repo/src/foo.ts', target: '/repo/src/utils', type: 'import' },
      ];
      const out = normalizeEdgeTargetsToKnownFiles(edges, known);
      expect(out).toHaveLength(1);
      expect(out[0].target).toBe('/repo/src/utils.ts');
    });

    it('resolves target to index file when only index exists', () => {
      const known = new Set(['/repo/src/foo.ts', '/repo/src/utils/index.ts']);
      const edges = [
        { source: '/repo/src/foo.ts', target: '/repo/src/utils', type: 'import' },
      ];
      const out = normalizeEdgeTargetsToKnownFiles(edges, known);
      expect(out).toHaveLength(1);
      expect(out[0].target).toBe('/repo/src/utils/index.ts');
    });

    it('leaves target unchanged when no matching file in set', () => {
      const known = new Set(['/repo/src/foo.ts']);
      const edges = [
        { source: '/repo/src/foo.ts', target: '/repo/src/external', type: 'import' },
      ];
      const out = normalizeEdgeTargetsToKnownFiles(edges, known);
      expect(out).toHaveLength(1);
      expect(out[0].target).toBe('/repo/src/external');
    });

    it('resolves Python package directory target to __init__.py', () => {
      const known = new Set(['/repo/mypackage/__init__.py', '/repo/main.py']);
      const edges = [
        { source: '/repo/main.py', target: '/repo/mypackage', type: 'import' },
      ];
      const out = normalizeEdgeTargetsToKnownFiles(edges, known);
      expect(out).toHaveLength(1);
      expect(out[0].target).toBe('/repo/mypackage/__init__.py');
    });

    it('prefers __init__.py over index.<ext> when both exist (Python package wins)', () => {
      const known = new Set([
        '/repo/mypkg/__init__.py',
        '/repo/mypkg/index.ts',
        '/repo/main.py',
      ]);
      const edges = [
        { source: '/repo/main.py', target: '/repo/mypkg', type: 'import' },
      ];
      const out = normalizeEdgeTargetsToKnownFiles(edges, known);
      expect(out).toHaveLength(1);
      expect(out[0].target).toBe('/repo/mypkg/__init__.py');
    });

    it('normalizes path separators so backslash and forward slash match', () => {
      const known = new Set([path.join('/repo', 'src', 'bar.ts')]);
      const edges = [
        { source: '/repo/src/foo.ts', target: '/repo/src/bar', type: 'import' },
      ];
      const out = normalizeEdgeTargetsToKnownFiles(edges, known);
      expect(out).toHaveLength(1);
      expect(out[0].target).toBe(path.join('/repo', 'src', 'bar.ts'));
    });
  });

  describe('inbound edges regression', () => {
    it('produces edge with target equal to imported file path (with extension) after normalize', () => {
      const fixturesDir = path.join(__dirname, 'fixtures');
      const pathA = path.join(fixturesDir, 'inbound-a.ts');
      const pathB = path.join(fixturesDir, 'inbound-b.ts');
      const list = [pathA, pathB];
      const knownFiles = new Set(list);

      const sourceA = fs.readFileSync(pathA, 'utf-8');
      const graphA = buildDependencyGraph(sourceA, 'ts', pathA);
      const allEdges = [...graphA.edges];

      const normalized = normalizeEdgeTargetsToKnownFiles(allEdges, knownFiles);
      const inboundToB = normalized.filter((e) => e.target === pathB || e.target.endsWith('inbound-b.ts'));

      expect(normalized.length).toBeGreaterThan(0);
      expect(inboundToB.length).toBeGreaterThanOrEqual(1);
      expect(inboundToB[0].source).toBe(pathA);
      expect(inboundToB[0].target).toBe(pathB);
    });
  });

  describe('per-language multi-file parsing', () => {
    it('parses lang-js fixture and returns expected nodes and edges', () => {
      const { nodes, edges, list } = buildMergedGraphFromFixtureDir('lang-js', 'js');
      expect(list.length).toBe(3);
      expect(nodes.length).toBeGreaterThanOrEqual(3);
      const mainPath = list.find((p) => basename(p) === 'main.js')!;
      const utilsPath = list.find((p) => basename(p) === 'utils.js')!;
      const constantsPath = list.find((p) => basename(p) === 'constants.js')!;
      expect(mainPath).toBeDefined();
      expect(utilsPath).toBeDefined();
      expect(constantsPath).toBeDefined();
      const mainImportsUtils = edges.some((e) => e.source === mainPath && e.target === utilsPath);
      const mainImportsConstants = edges.some((e) => e.source === mainPath && e.target === constantsPath);
      const utilsImportsConstants = edges.some((e) => e.source === utilsPath && e.target === constantsPath);
      expect(mainImportsUtils).toBe(true);
      expect(mainImportsConstants).toBe(true);
      expect(utilsImportsConstants).toBe(true);
      const inboundToConstants = edges.filter((e) => e.target === constantsPath);
      expect(inboundToConstants.length).toBeGreaterThanOrEqual(2);
    });

    it('parses lang-ts fixture and returns expected nodes and edges', () => {
      const { nodes, edges, list } = buildMergedGraphFromFixtureDir('lang-ts', 'ts');
      expect(list.length).toBe(4);
      expect(nodes.length).toBeGreaterThanOrEqual(4);
      const mainPath = list.find((p) => basename(p) === 'main.ts')!;
      const utilsPath = list.find((p) => basename(p) === 'utils.ts')!;
      const typesPath = list.find((p) => basename(p) === 'types.ts')!;
      const constantsPath = list.find((p) => basename(p) === 'constants.ts')!;
      expect(edges.some((e) => e.source === mainPath && e.target === utilsPath)).toBe(true);
      expect(edges.some((e) => e.source === mainPath && e.target === typesPath)).toBe(true);
      expect(edges.some((e) => e.source === mainPath && e.target === constantsPath)).toBe(true);
      expect(edges.some((e) => e.source === utilsPath && e.target === constantsPath)).toBe(true);
      expect(edges.some((e) => e.source === utilsPath && e.target === typesPath)).toBe(true);
      const inboundToTypes = edges.filter((e) => e.target === typesPath);
      expect(inboundToTypes.length).toBeGreaterThanOrEqual(1);
    });

    it('parses lang-jsx fixture and returns expected nodes and edges', () => {
      const { nodes, edges, list } = buildMergedGraphFromFixtureDir('lang-jsx', 'jsx');
      expect(list.length).toBe(3);
      expect(nodes.length).toBeGreaterThanOrEqual(3);
      const appPath = list.find((p) => basename(p) === 'App.jsx')!;
      const componentPath = list.find((p) => basename(p) === 'Component.jsx')!;
      const buttonPath = list.find((p) => basename(p) === 'Button.jsx')!;
      expect(edges.some((e) => e.source === appPath && e.target === componentPath)).toBe(true);
      expect(edges.some((e) => e.source === appPath && e.target === buttonPath)).toBe(true);
      expect(edges.some((e) => e.source === componentPath && e.target === buttonPath)).toBe(true);
      const inboundToButton = edges.filter((e) => e.target === buttonPath);
      expect(inboundToButton.length).toBeGreaterThanOrEqual(2);
    });

    it('parses lang-tsx fixture and returns expected nodes and edges', () => {
      const { nodes, edges, list } = buildMergedGraphFromFixtureDir('lang-tsx', 'tsx');
      expect(list.length).toBe(3);
      expect(nodes.length).toBeGreaterThanOrEqual(3);
      const appPath = list.find((p) => basename(p) === 'App.tsx')!;
      const componentPath = list.find((p) => basename(p) === 'Component.tsx')!;
      const buttonPath = list.find((p) => basename(p) === 'Button.tsx')!;
      expect(edges.some((e) => e.source === appPath && e.target === componentPath)).toBe(true);
      expect(edges.some((e) => e.source === appPath && e.target === buttonPath)).toBe(true);
      expect(edges.some((e) => e.source === componentPath && e.target === buttonPath)).toBe(true);
      const inboundToButton = edges.filter((e) => e.target === buttonPath);
      expect(inboundToButton.length).toBeGreaterThanOrEqual(2);
    });

    it('resolves Python package __init__.py via normalizeEdgeTargetsToKnownFiles (integration)', () => {
      // Scenario: mypackage/submod.py does `from . import api`.
      //   resolveModulePath(submodPy, '', 1) returns dirname(submodPy) = <pkgDir>/mypackage.
      //   After normalizeEdgeTargetsToKnownFiles, that bare directory path should resolve
      //   to mypackage/__init__.py because __init__.py is present in the known-files set.
      const pkgDir = path.join(FIXTURES_DIR, 'lang-py-pkg');
      const initPy = path.join(pkgDir, 'mypackage', '__init__.py');
      const submodPy = path.join(pkgDir, 'mypackage', 'submod.py');
      const knownFiles = new Set([initPy, submodPy]);

      const submodSource = fs.readFileSync(submodPy, 'utf-8');
      const graph = buildDependencyGraph(submodSource, 'py', submodPy);

      // Verify the parser produced at least one import edge from submod.py
      const importEdges = graph.edges.filter((e) => e.source === submodPy && e.type === 'import');
      expect(importEdges.length).toBeGreaterThanOrEqual(1);

      const normalized = normalizeEdgeTargetsToKnownFiles(graph.edges, knownFiles);

      // The edge whose target was the bare mypackage/ directory must resolve to __init__.py
      const toInit = normalized.find((e) => e.source === submodPy && e.target === initPy);
      expect(toInit).toBeDefined();
    });

    it('parses lang-py fixture and returns expected nodes and edges', () => {
      const { nodes, edges, list } = buildMergedGraphFromFixtureDir('lang-py', 'py');
      expect(list.length).toBe(4);
      expect(nodes.length).toBeGreaterThanOrEqual(4);
      const mainPath = list.find((p) => basename(p) === 'main.py')!;
      const utilsPath = list.find((p) => basename(p) === 'utils.py')!;
      const constantsPath = list.find((p) => basename(p) === 'constants.py')!;
      const modelsPath = list.find((p) => basename(p) === 'models.py')!;
      expect(edges.some((e) => e.source === mainPath && e.target === constantsPath)).toBe(true);
      expect(edges.some((e) => e.source === mainPath && e.target === modelsPath)).toBe(true);
      expect(edges.some((e) => e.source === mainPath && e.target === utilsPath)).toBe(true);
      expect(edges.some((e) => e.source === utilsPath && e.target === constantsPath)).toBe(true);
      const inboundToConstants = edges.filter((e) => e.target === constantsPath);
      expect(inboundToConstants.length).toBeGreaterThanOrEqual(2);
    });
  });
});
