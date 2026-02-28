import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { outlineFile } from '../server/services/codebaseOutline';

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

      // Check for expected function declarations
      const functionDecls = ast.filter(
        (entry) =>
          entry.type === 'function_declaration' ||
          entry.type === 'method_definition'
      );
      expect(functionDecls.length).toBeGreaterThanOrEqual(2);

      // Check for expected class declarations
      const classDecls = ast.filter(
        (entry) =>
          entry.type === 'class_declaration' ||
          entry.type === 'class_definition'
      );
      expect(classDecls.length).toBeGreaterThanOrEqual(2);

      // Check for expected object literal
      const objectDecls = ast.filter(
        (entry) => entry.type === 'object_literal'
      );
      expect(objectDecls.length).toBeGreaterThanOrEqual(1);

      // Check for exported functions
      const exportedFuncs = ast.filter(
        (entry) =>
          entry.type === 'function_declaration' &&
          entry.text.includes('exportedFunction')
      );
      expect(exportedFuncs.length).toBe(1);

      // Check for exported classes
      const exportedClasses = ast.filter(
        (entry) =>
          entry.type === 'class_declaration' &&
          entry.text.includes('ExportedClass')
      );
      expect(exportedClasses.length).toBe(1);
    });

    it('should extract AST from TypeScript file', () => {
      const sourceCode = readTestFile('sample.ts');
      const ast = outlineFile(sourceCode, 'ts');

      expect(Array.isArray(ast)).toBe(true);
      expect(ast.length).toBeGreaterThan(0);

      // Check for TypeScript-specific declarations
      const interfaceDecls = ast.filter(
        (entry) => entry.type === 'interface_declaration'
      );
      expect(interfaceDecls.length).toBe(1);

      const typeAliasDecls = ast.filter(
        (entry) => entry.type === 'type_alias_declaration'
      );
      expect(typeAliasDecls.length).toBe(1);

      // Check for function declarations
      const functionDecls = ast.filter(
        (entry) => entry.type === 'function_declaration'
      );
      expect(functionDecls.length).toBeGreaterThanOrEqual(1);

      // Check for class declarations
      const classDecls = ast.filter(
        (entry) => entry.type === 'class_declaration'
      );
      expect(classDecls.length).toBeGreaterThanOrEqual(1);

      // Check for exported functions
      const exportedFuncs = ast.filter(
        (entry) =>
          entry.type === 'function_declaration' &&
          entry.text.includes('exportedFunction')
      );
      expect(exportedFuncs.length).toBe(1);

      // Check for exported classes
      const exportedClasses = ast.filter(
        (entry) =>
          entry.type === 'class_declaration' &&
          entry.text.includes('ExportedClass')
      );
      expect(exportedClasses.length).toBe(1);
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
