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
 * Parser plugin registry. Register dependency extractors and outline configs
 * per file extension so new languages (Python, Go, etc.) can be added
 * without changing core dependency or outline logic.
 *
 * To add a new language (e.g. Go):
 * 1. Add the tree-sitter language to ast.ts (EXT_TO_LOADER: go: () => require('tree-sitter-go')).
 * 2. Create parsers/go.ts with extractDependencies(sourceCode, tree, filePath) and outlineConfig.
 * 3. Register in this file: dependencyExtractors.go = extractGo, outlineConfigs.go = outlineGo.
 */

import type { DependencyExtractor, OutlineConfig } from './types';
import { extractDependencies as extractJS, outlineConfig as outlineJS } from './javascript';
import { extractDependencies as extractPython, outlineConfig as outlinePython } from './python';

const dependencyExtractors: Record<string, DependencyExtractor> = {
  js: extractJS,
  jsx: extractJS,
  ts: extractJS,
  tsx: extractJS,
  py: extractPython,
};

const outlineConfigs: Record<string, OutlineConfig> = {
  js: outlineJS,
  jsx: outlineJS,
  ts: outlineJS,
  tsx: outlineJS,
  py: outlinePython,
};

export function getDependencyExtractor(ext: string): DependencyExtractor | null {
  return dependencyExtractors[ext] ?? null;
}

export function getOutlineConfig(ext: string): OutlineConfig | null {
  return outlineConfigs[ext] ?? null;
}

/** Extensions that have a registered parser plugin (for outline/deps). */
export function getRegisteredExtensions(): Set<string> {
  return new Set([
    ...Object.keys(dependencyExtractors),
    ...Object.keys(outlineConfigs),
  ]);
}

export type { DependencyExtractor, OutlineConfig, ASTNode, ParsedTree } from './types';
