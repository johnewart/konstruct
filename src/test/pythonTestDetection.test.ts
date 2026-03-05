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
import { getParser } from '../shared/ast';
import { getTestEntries, isTestFilePath } from '../shared/parsers/python';
import type { ParsedTree } from '../shared/parsers/types';

function parsePython(sourceCode: string): ParsedTree | null {
  const parser = getParser('py');
  if (!parser) return null;
  const tree = parser.parse(sourceCode);
  return { rootNode: tree.rootNode as ParsedTree['rootNode'] };
}

describe('Python test detection', () => {
  describe('isTestFilePath', () => {
    it('returns true for test_*.py', () => {
      expect(isTestFilePath('tests/test_foo.py')).toBe(true);
      expect(isTestFilePath('test_bar.py')).toBe(true);
    });
    it('returns true for *_test.py', () => {
      expect(isTestFilePath('foo_test.py')).toBe(true);
      expect(isTestFilePath('src/bar_test.py')).toBe(true);
    });
    it('returns false for non-test Python files', () => {
      expect(isTestFilePath('foo.py')).toBe(false);
      expect(isTestFilePath('main.py')).toBe(false);
      expect(isTestFilePath('test.py')).toBe(false); // exact "test" is not test_
    });
    it('returns false for non-Python paths', () => {
      expect(isTestFilePath('test_foo.txt')).toBe(false);
    });
  });

  describe('getTestEntries', () => {
    it('extracts test functions (name starts with test_)', () => {
      const source = `
def test_something():
    assert True

def helper():
    pass

def test_another():
    pass
`;
      const tree = parsePython(source);
      if (!tree) return;
      const result = getTestEntries(source, tree, '/tests/test_example.py');
      expect(result.length).toBe(2);
      expect(result.map((e) => e.name)).toEqual(['test_something', 'test_another']);
      expect(result.every((e) => e.kind === 'test_function')).toBe(true);
      expect(result.every((e) => e.filePath === '/tests/test_example.py')).toBe(true);
    });

    it('extracts test classes (name starts with Test) and test methods (test_*)', () => {
      const source = `
class TestFoo:
    def test_one(self):
        pass

class Helper:
    pass

class TestBar:
    def test_two(self):
        pass
`;
      const tree = parsePython(source);
      if (!tree) return;
      const result = getTestEntries(source, tree, '/tests/test_example.py');
      expect(result.length).toBe(4);
      const classes = result.filter((e) => e.kind === 'test_class').map((e) => e.name);
      const functions = result.filter((e) => e.kind === 'test_function').map((e) => e.name);
      expect(classes).toEqual(['TestFoo', 'TestBar']);
      expect(functions).toEqual(['test_one', 'test_two']);
    });

    it('ignores functions and classes that do not match', () => {
      const source = `
def helper():
    pass

class MyService:
    def run(self):
        pass
`;
      const tree = parsePython(source);
      if (!tree) return;
      const result = getTestEntries(source, tree, '/app/main.py');
      expect(result).toEqual([]);
    });
  });
});
