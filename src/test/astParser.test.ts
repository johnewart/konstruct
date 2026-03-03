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
import { outlineFile } from '../shared/codebaseOutline';

// Helper function to read test files
function readTestFile(filename: string): string {
  const filePath = path.join(__dirname, 'fixtures', filename);
  return fs.readFileSync(filePath, 'utf-8');
}

describe('AST Parser (codebaseOutline)', () => {
  describe('outlineFile', () => {
    it('should extract AST from JavaScript file', () => {
      const sourceCode = readTestFile('sample.js');
      const ast = outlineFile(sourceCode, 'js');

      expect(Array.isArray(ast)).toBe(true);
      expect(ast.length).toBeGreaterThan(0);

      // outlineFile returns OutlineEntry[] with { line, indent, text } (no type field)
      const texts = ast.map((e) => e.text);

      // Should find function and class names from sample.js
      expect(texts.some((t) => t.includes('helloWorld'))).toBe(true);
      expect(texts.some((t) => t.includes('MyClass'))).toBe(true);
      expect(texts.some((t) => t.includes('exportedFunction') || t.includes('ExportedClass'))).toBe(true);
    });

    it('should extract AST from TypeScript file', () => {
      const sourceCode = readTestFile('sample.ts');
      const ast = outlineFile(sourceCode, 'ts');

      expect(Array.isArray(ast)).toBe(true);
      expect(ast.length).toBeGreaterThan(0);

      // outlineFile returns OutlineEntry[] with { line, indent, text }
      const texts = ast.map((e) => e.text);
      // Should find interface/type or function/class from sample.ts
      expect(
        texts.some(
          (t) =>
            t.includes('interface') ||
            t.includes('type ') ||
            t.includes('function') ||
            t.includes('class')
        )
      ).toBe(true);
    });

    it('should handle empty files', () => {
      const sourceCode = '';
      const ast = outlineFile(sourceCode, 'js');

      expect(ast).toEqual([]);
    });

    it('should handle files with only comments', () => {
      const sourceCode = '// This is a comment\n/* This is also a comment */\n';
      const ast = outlineFile(sourceCode, 'js');

      expect(ast).toEqual([]);
    });
  });
});
