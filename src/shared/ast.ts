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
 * Tree-sitter AST: parser factory and TSNode type.
 * Extracted so codebaseOutline and dependencyGraph can share the parser
 * without a circular dependency.
 */

export type TSNode = {
  type: string;
  startPosition: { row: number };
  startIndex: number;
  endIndex: number;
  childCount: number;
  child: (i: number) => TSNode | null;
};

const EXT_TO_LOADER: Record<string, () => unknown> = {
  js: () => require('tree-sitter-javascript'),
  jsx: () => require('tree-sitter-javascript'),
  ts: () => require('tree-sitter-typescript').typescript,
  tsx: () => require('tree-sitter-typescript').tsx,
  py: () => require('tree-sitter-python'),
};

/** File extensions we can parse (for filtering in outline/collect). */
export const SUPPORTED_EXTENSIONS = new Set<string>(Object.keys(EXT_TO_LOADER));

let ParserClass: {
  new (): {
    setLanguage: (lang: unknown) => void;
    parse: (src: string) => { rootNode: TSNode };
  };
} | null = null;
let loadError: Error | null = null;
const parserCache: Record<
  string,
  {
    setLanguage: (lang: unknown) => void;
    parse: (src: string) => { rootNode: TSNode };
  }
> = {};

export function getParser(
  ext: string
): { parse: (src: string) => { rootNode: TSNode } } | null {
  const load = EXT_TO_LOADER[ext];
  if (!load) return null;
  if (!ParserClass) {
    try {
      ParserClass = require('tree-sitter');
    } catch (e) {
      loadError = e instanceof Error ? e : new Error(String(e));
      return null;
    }
  }
  if (loadError) return null;
  if (!parserCache[ext]) {
    try {
      const p = new ParserClass!();
      p.setLanguage(load());
      parserCache[ext] = p;
    } catch {
      return null;
    }
  }
  return parserCache[ext];
}

export function getOutlineLoadError(): Error | null {
  return loadError;
}
