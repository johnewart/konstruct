/* eslint-disable import/extensions -- .ts for Node/worker ESM resolution */
import { createRequire } from 'module';
import * as fs from 'fs';

const _require = createRequire(import.meta.url);

const TreeSitter = _require('tree-sitter');
const JavaScriptLanguage = _require('tree-sitter-javascript');

const parser = new TreeSitter();
parser.setLanguage(JavaScriptLanguage);

export type SyntaxNode = {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildren: SyntaxNode[];
  childForFieldName(fieldName: string): SyntaxNode | null;
  childrenForFieldName(fieldName: string): SyntaxNode[];
};

export function parseJavaScript(source: string): SyntaxNode {
  const tree = parser.parse(source);
  return tree.rootNode as unknown as SyntaxNode;
}

export function parseJavaScriptFile(filePath: string): { rootNode: SyntaxNode; source: string } {
  const source = fs.readFileSync(filePath, 'utf8');
  return { rootNode: parseJavaScript(source), source };
}
