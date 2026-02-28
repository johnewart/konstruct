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
import { outlineFile, outlinePath } from '../server/services/codebaseOutline';
import {
  DependencyGraph,
  buildDependencyGraph,
} from '../server/services/dependencyGraph';

// Helper function to read test files
function readTestFile(filename: string): string {
  const filePath = path.join(__dirname, 'fixtures', filename);
  return fs.readFileSync(filePath, 'utf-8');
}

describe('codebaseOutline', () => {
  describe('outlineFile', () => {
    it('should extract AST from JavaScript file', () => {
      const sourceCode = readTestFile('sample.js');
      const ast = outlineFile(sourceCode, 'js');

      expect(ast).toBeArray();
      expect(ast.length).toBeGreaterThan(0);

      // Check that we have expected function declarations
      const functionDecls = ast.filter((entry) =>
        entry.text.includes('function')
      );
      expect(functionDecls.length).toBeGreaterThan(0);

      // Check that we have expected class declarations
      const classDecls = ast.filter((entry) => entry.text.includes('class'));
      expect(classDecls.length).toBeGreaterThan(0);
    });

    it('should extract AST from TypeScript file', () => {
      const sourceCode = readTestFile('sample.ts');
      const ast = outlineFile(sourceCode, 'ts');

      expect(ast).toBeArray();
      expect(ast.length).toBeGreaterThan(0);

      // Check for TypeScript-specific declarations
      const interfaceDecls = ast.filter((entry) =>
        entry.text.includes('interface')
      );
      expect(interfaceDecls.length).toBeGreaterThan(0);

      const typeAliasDecls = ast.filter((entry) => entry.text.includes('type'));
      expect(typeAliasDecls.length).toBeGreaterThan(0);
    });

    it('should handle empty files', () => {
      const sourceCode = '';
      const ast = outlineFile(sourceCode, 'js');

      expect(ast).toEqual([]);
    });

    it('should handle files with no declarations', () => {
      const sourceCode = 'const x = 1;\nlet y = 2;\nconsole.log("hello");';
      const ast = outlineFile(sourceCode, 'js');

      // Only declarations (functions, classes, interfaces, etc.) should be included
      // Simple variable declarations should not be in the AST
      expect(ast).toEqual([]);
    });
  });

  describe('outlinePath', () => {
    it('should return AST and dependency graph for a directory', async () => {
      // Create a temporary test directory with sample files
      const testDir = path.join(__dirname, 'fixtures', 'test-project');

      // Check if test directory exists
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });

        // Create sample files
        fs.writeFileSync(
          path.join(testDir, 'main.js'),
          `\n// Main file with imports and declarations\nimport { helper } from './utils';\nimport { another } from './another';\n\nexport function mainFunction() {\n  return helper();\n}\n\nclass MainClass {\n  constructor() {\n    this.value = 1;\n  }\n}\n\nexport default MainClass;`,
          'utf-8'
        );

        fs.writeFileSync(
          path.join(testDir, 'utils.js'),
          `\n// Utility file\nexport function helper() {\n  return 'helper value';\n}\n\nexport const utilityVar = 'value';`,
          'utf-8'
        );

        fs.writeFileSync(
          path.join(testDir, 'another.js'),
          `\n// Another file\nexport function another() {\n  return 'another value';\n}\n\nexport class AnotherClass {\n  method() {\n    return 'method';\n  }\n}\n\nexport default AnotherClass;`,
          'utf-8'
        );
      }

      const result = outlinePath(__dirname, 'test/fixtures/test-project');

      expect(result).toHaveProperty('outline');
      expect(result).toHaveProperty('truncated');
      expect(result).toHaveProperty('dependencyGraph');

      // Check that we have dependency graph
      const depGraph = result.dependencyGraph as DependencyGraph;
      expect(depGraph).toBeDefined();
      expect(depGraph.nodes).toBeArray();
      expect(depGraph.edges).toBeArray();

      // Should have at least 3 nodes (main.js, utils.js, another.js)
      expect(depGraph.nodes.length).toBeGreaterThanOrEqual(3);

      // Should have import edges
      const importEdges = depGraph.edges.filter(
        (edge) => edge.type === 'import'
      );
      expect(importEdges.length).toBeGreaterThanOrEqual(2);

      // Check that we have the expected import relationships
      const hasMainToUtils = importEdges.some(
        (edge) =>
          edge.source.includes('main.js') && edge.target.includes('utils.js')
      );
      expect(hasMainToUtils).toBe(true);

      const hasMainToAnother = importEdges.some(
        (edge) =>
          edge.source.includes('main.js') && edge.target.includes('another.js')
      );
      expect(hasMainToAnother).toBe(true);

      // Check that we have export default edges
      const exportDefaultEdges = depGraph.edges.filter(
        (edge) => edge.type === 'export' && edge.identifier
      );
      expect(exportDefaultEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('should return AST and dependency graph for a single file', async () => {
      // Create a temporary test file
      const testFile = path.join(__dirname, 'fixtures', 'single-file.js');

      if (!fs.existsSync(path.join(__dirname, 'fixtures'))) {
        fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
      }

      fs.writeFileSync(
        testFile,
        `\n// Single file with imports and declarations\nimport { helper } from './utils';\n\nexport function mainFunction() {\n  return helper();\n}\n\nclass MainClass {\n  constructor() {\n    this.value = 1;\n  }\n}\n\nexport default MainClass;`,
        'utf-8'
      );

      const result = outlinePath(__dirname, 'test/fixtures/single-file.js');

      expect(result).toHaveProperty('outline');
      expect(result).toHaveProperty('truncated');
      expect(result).toHaveProperty('dependencyGraph');

      // Check that we have dependency graph
      const depGraph = result.dependencyGraph as DependencyGraph;
      expect(depGraph).toBeDefined();
      expect(depGraph.nodes).toBeArray();
      expect(depGraph.edges).toBeArray();

      // Should have at least 2 nodes (single-file.js and utils.js)
      expect(depGraph.nodes.length).toBeGreaterThanOrEqual(2);

      // Should have one import edge
      const importEdges = depGraph.edges.filter(
        (edge) => edge.type === 'import'
      );
      expect(importEdges.length).toBeGreaterThanOrEqual(1);

      // Check that we have the expected import relationship
      const hasImport = importEdges.some(
        (edge) =>
          edge.source.includes('single-file.js') &&
          edge.target.includes('utils.js')
      );
      expect(hasImport).toBe(true);

      // Should have export default edge
      const exportDefaultEdges = depGraph.edges.filter(
        (edge) => edge.type === 'export' && edge.identifier
      );
      expect(exportDefaultEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle invalid paths', () => {
      const result = outlinePath(__dirname, '/invalid/path');

      expect(result.outline).toBe('(path outside project root)');
      expect(result.truncated).toBe(false);
      expect(result.dependencyGraph).toBeUndefined();
    });

    it('should handle files outside project root', () => {
      // Create a file outside the project root
      const testFile = path.join(__dirname, '..', '..', 'outside.js');

      // Make sure we're outside the project root
      if (!fs.existsSync(path.join(__dirname, '..', '..'))) {
        fs.mkdirSync(path.join(__dirname, '..', '..'), { recursive: true });
      }

      fs.writeFileSync(testFile, 'export function test() {}', 'utf-8');

      const result = outlinePath(__dirname, testFile);

      expect(result.outline).toBe('(path outside project root)');
      expect(result.truncated).toBe(false);
      expect(result.dependencyGraph).toBeUndefined();
    });
  });

  describe('dependencyGraph', () => {
    it('should handle ES6 imports', () => {
      const sourceCode = `\nimport { func1 } from './module1';\nimport * as module2 from './module2';\nimport module3 from './module3';\nimport './module4';\n\nexport function test() {\n  return func1();\n}`;

      const graph = buildDependencyGraph(sourceCode, 'js', '/test/main.js');

      expect(graph.edges.length).toBe(4);

      // Check each import type
      const importFunc1 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === './module1' &&
          e.type === 'import'
      );
      expect(importFunc1).toBeDefined();
      expect(importFunc1?.identifier).toBe('func1');

      const importModule2 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === './module2' &&
          e.type === 'import'
      );
      expect(importModule2).toBeDefined();
      expect(importModule2?.identifier).toBeUndefined();

      const importModule3 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === './module3' &&
          e.type === 'import'
      );
      expect(importModule3).toBeDefined();
      expect(importModule3?.identifier).toBeUndefined();

      const importModule4 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === './module4' &&
          e.type === 'import'
      );
      expect(importModule4).toBeDefined();
      expect(importModule4?.identifier).toBeUndefined();
    });

    it('should handle ES6 exports', () => {
      const sourceCode = `\nexport function func1() {}\nexport const const1 = 'value';\nexport class Class1 {}\nexport { func1 as renamedFunc } from './module';\nexport * from './module2';\n\nexport default function() {}`;

      const graph = buildDependencyGraph(sourceCode, 'js', '/test/main.js');

      // Should have 5 edges: 3 direct exports, 1 re-export, 1 star export, 1 default export
      expect(graph.edges.length).toBeGreaterThanOrEqual(6);

      // Check direct exports
      const exportFunc1 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === '/test/main.js' &&
          e.type === 'export' &&
          e.identifier === 'func1'
      );
      expect(exportFunc1).toBeDefined();

      const exportConst1 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === '/test/main.js' &&
          e.type === 'export' &&
          e.identifier === 'const1'
      );
      expect(exportConst1).toBeDefined();

      const exportClass1 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === '/test/main.js' &&
          e.type === 'export' &&
          e.identifier === 'Class1'
      );
      expect(exportClass1).toBeDefined();

      // Check re-export
      const reExport = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === './module' &&
          e.type === 'export'
      );
      expect(reExport).toBeDefined();
      expect(reExport?.identifier).toBe('func1');

      // Check star export
      const starExport = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === './module2' &&
          e.type === 'export'
      );
      expect(starExport).toBeDefined();

      // Check default export
      const defaultExport = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === '/test/main.js' &&
          e.type === 'export' &&
          e.identifier
      );
      expect(defaultExport).toBeDefined();
    });

    it('should handle CommonJS requires', () => {
      const sourceCode = `\nconst module1 = require('./module1');\nconst { func1 } = require('./module2');\nconst module3 = require('external-module');\n\nmodule.exports = {\n  func: function() {}\n};`;

      const graph = buildDependencyGraph(sourceCode, 'js', '/test/main.js');

      // Should have 3 require edges and 1 export edge
      expect(graph.edges.length).toBeGreaterThanOrEqual(4);

      // Check requires
      const require1 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === './module1' &&
          e.type === 'require'
      );
      expect(require1).toBeDefined();

      const require2 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === './module2' &&
          e.type === 'require'
      );
      expect(require2).toBeDefined();

      const require3 = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === 'external-module' &&
          e.type === 'require'
      );
      expect(require3).toBeDefined();

      // Check module.exports
      const exportEdge = graph.edges.find(
        (e) =>
          e.source === '/test/main.js' &&
          e.target === '/test/main.js' &&
          e.type === 'export'
      );
      expect(exportEdge).toBeDefined();
    });

    it('should handle relative path resolution', () => {
      const sourceCode = `\nimport { func } from './subdir/module';\nimport { other } from '../other-module';`;

      const graph = buildDependencyGraph(
        sourceCode,
        'js',
        '/project/src/main.js'
      );

      // Should resolve relative paths to absolute paths
      const edge1 = graph.edges.find(
        (e) =>
          e.source === '/project/src/main.js' &&
          e.target === '/project/src/subdir/module'
      );
      expect(edge1).toBeDefined();

      const edge2 = graph.edges.find(
        (e) =>
          e.source === '/project/src/main.js' &&
          e.target === '/project/other-module'
      );
      expect(edge2).toBeDefined();
    });

    it('should handle file extensions in absolute paths', () => {
      const sourceCode = `\nimport { func } from './module';\nimport { other } from './other';`;

      const graph = buildDependencyGraph(
        sourceCode,
        'js',
        '/project/src/main.js'
      );

      // Should try to resolve with common extensions
      const edge1 = graph.edges.find(
        (e) =>
          e.source === '/project/src/main.js' &&
          e.target === '/project/src/module'
      );
      expect(edge1).toBeDefined();

      const edge2 = graph.edges.find(
        (e) =>
          e.source === '/project/src/main.js' &&
          e.target === '/project/src/other'
      );
      expect(edge2).toBeDefined();
    });
  });
});

// Create test fixtures directory
const fixturesDir = path.join(__dirname, 'fixtures');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

// Write sample test files
if (!fs.existsSync(path.join(fixturesDir, 'sample.js'))) {
  fs.writeFileSync(
    path.join(fixturesDir, 'sample.js'),
    `\n// Sample JavaScript file for testing\nfunction regularFunction() {\n  return 'hello';\n}\n\nclass TestClass {\n  constructor() {\n    this.value = 1;\n  }\n}\n\nexport const exportedVar = 'value';\n\nexport function exportedFunction() {\n  return 'exported';\n}\n\nexport default TestClass;`,
    'utf-8'
  );
}

if (!fs.existsSync(path.join(fixturesDir, 'sample.ts'))) {
  fs.writeFileSync(
    path.join(fixturesDir, 'sample.ts'),
    `\n// Sample TypeScript file for testing\ninterface TestInterface {\n  property: string;\n}\n\ntype TestType = {\n  value: number;\n};\n\nfunction regularFunction() {\n  return 'hello';\n}\n\nclass TestClass implements TestInterface {\n  constructor(public property: string) {}\n}\n\nexport const exportedVar = 'value';\n\nexport function exportedFunction() {\n  return 'exported';\n}\n\nexport default TestClass;`,
    'utf-8'
  );
}

// Create test project structure if it doesn't exist
const testProjectDir = path.join(fixturesDir, 'test-project');
if (!fs.existsSync(testProjectDir)) {
  fs.mkdirSync(testProjectDir, { recursive: true });
}
