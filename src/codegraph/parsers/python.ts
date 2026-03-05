import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';

const _require = createRequire(import.meta.url);

// Load tree-sitter via CJS require (native module)
const TreeSitter = _require('tree-sitter');
const PythonLanguage = _require('tree-sitter-python');

// Singleton parser
const tsParser = new TreeSitter();
tsParser.setLanguage(PythonLanguage);

// Re-export the SyntaxNode type for use in other modules
export type SyntaxNode = {
  id: number;
  type: string;
  text: string;
  isNamed: boolean;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  parent: SyntaxNode | null;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  childCount: number;
  namedChildCount: number;
  firstChild: SyntaxNode | null;
  firstNamedChild: SyntaxNode | null;
  lastChild: SyntaxNode | null;
  lastNamedChild: SyntaxNode | null;
  child(index: number): SyntaxNode | null;
  namedChild(index: number): SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
  childrenForFieldName(fieldName: string): SyntaxNode[];
  toString(): string;
};

/**
 * Parse Python source code and return the root syntax node.
 */
export function parsePython(source: string): SyntaxNode {
  const tree = tsParser.parse(source);
  return tree.rootNode as SyntaxNode;
}

/**
 * Parse a Python file and return the root syntax node.
 */
export function parsePythonFile(filePath: string): { rootNode: SyntaxNode; source: string } {
  const source = fs.readFileSync(filePath, 'utf8');
  const rootNode = parsePython(source);
  return { rootNode, source };
}
