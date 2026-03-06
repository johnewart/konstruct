import * as fs from 'fs';
import * as path from 'path';
/* eslint-disable import/extensions -- .ts required for Node/worker ESM resolution when loaded outside Vite */
import type { DependencyGraph, DependencyGraphBuilder, SymbolDef, SymbolRef } from './spec/graph.spec.ts';
import { parsePython, parsePythonFile } from './parsers/python.ts';
import { PythonSymbolExtractor } from './parsers/python_symbol_extractor.ts';
import { parseJavaScript, parseJavaScriptFile } from './parsers/javascript.ts';
import { JavaScriptSymbolExtractor } from './parsers/javascript_symbol_extractor.ts';
import { buildGraph } from './graph/builder.ts';

export class Analyzer implements DependencyGraphBuilder {
  /**
   * Analyze a single source string.
   */
  analyze(source_code: string, language: string, filename: string): DependencyGraph {
    // Normalize: strip leading newline (template literals often start with \n)
    const source = source_code.startsWith('\n') ? source_code.slice(1) : source_code;

    const basename = path.basename(filename);

    if (language === 'python') {
      const rootNode = parsePython(source);
      const extractor = new PythonSymbolExtractor();
      const defs = extractor.extractDefs(rootNode, filename);
      const refs = extractor.extractRefs(rootNode, filename, defs);
      return buildGraph(defs, refs, { language, files: [basename] });
    }

    if (language === 'javascript' || language === 'typescript') {
      const rootNode = parseJavaScript(source);
      const extractor = new JavaScriptSymbolExtractor();
      const defs = extractor.extractDefs(rootNode, filename, [filename]);
      const refs = extractor.extractRefs(rootNode, filename, defs, [filename]);
      return buildGraph(defs, refs, { language, files: [basename] });
    }

    throw new Error(`Unsupported language: ${language}`);
  }

  /**
   * Analyze multiple files from disk.
   *
   * @param onProgress  Optional callback invoked after each file is processed
   *                    in each pass.  `phase` is `'defs'` during the first pass
   *                    (definition extraction) and `'refs'` during the second
   *                    pass (reference extraction).  `filesProcessed` counts
   *                    within the current pass; `totalFiles` is the total file
   *                    count.
   */
  analyze_files(
    file_paths: Array<string>,
    language: string,
    onProgress?: (filesProcessed: number, totalFiles: number, phase: 'defs' | 'refs') => void,
  ): DependencyGraph {
    const allDefs: SymbolDef[] = [];
    const allRefs: SymbolRef[] = [];
    const basenames: string[] = [];
    const total = file_paths.length;

    if (language === 'python') {
      const parsedFiles: Array<{
        filePath: string;
        rootNode: ReturnType<typeof parsePython>;
        basename: string;
      }> = [];

      for (let i = 0; i < file_paths.length; i++) {
        const filePath = file_paths[i];
        const { rootNode } = parsePythonFile(filePath);
        const bn = path.basename(filePath);
        basenames.push(bn);
        parsedFiles.push({ filePath, rootNode, basename: bn });

        const extractor = new PythonSymbolExtractor();
        const defs = extractor.extractDefs(rootNode, filePath, file_paths);
        allDefs.push(...defs);
        onProgress?.(i + 1, total, 'defs');
      }

      for (let i = 0; i < parsedFiles.length; i++) {
        const { filePath, rootNode } = parsedFiles[i];
        const extractor = new PythonSymbolExtractor();
        const refs = extractor.extractRefs(rootNode, filePath, allDefs, file_paths);
        allRefs.push(...refs);
        onProgress?.(i + 1, total, 'refs');
      }

      return buildGraph(allDefs, allRefs, { language, files: basenames });
    }

    if (language === 'javascript' || language === 'typescript') {
      const parsedFiles: Array<{
        filePath: string;
        rootNode: ReturnType<typeof parseJavaScript>;
        basename: string;
      }> = [];

      for (let i = 0; i < file_paths.length; i++) {
        const filePath = file_paths[i];
        const { rootNode } = parseJavaScriptFile(filePath);
        const bn = path.basename(filePath);
        basenames.push(bn);
        parsedFiles.push({ filePath, rootNode, basename: bn });

        const extractor = new JavaScriptSymbolExtractor();
        const defs = extractor.extractDefs(rootNode, filePath, file_paths);
        allDefs.push(...defs);
        onProgress?.(i + 1, total, 'defs');
      }

      for (let i = 0; i < parsedFiles.length; i++) {
        const { filePath, rootNode } = parsedFiles[i];
        const extractor = new JavaScriptSymbolExtractor();
        const refs = extractor.extractRefs(rootNode, filePath, allDefs, file_paths);
        allRefs.push(...refs);
        onProgress?.(i + 1, total, 'refs');
      }

      return buildGraph(allDefs, allRefs, { language, files: basenames });
    }

    throw new Error(`Unsupported language: ${language}`);
  }

  /**
   * Analyze all Python files in a directory matching a pattern.
   */
  analyze_directory(directory_path: string, language: string, pattern: string): DependencyGraph {
    const files = findFiles(directory_path, pattern);
    return this.analyze_files(files, language);
  }
}

/**
 * Find files in a directory matching a glob-like pattern.
 */
function findFiles(dir: string, pattern: string): string[] {
  const results: string[] = [];
  const regex = globToRegex(pattern);

  function walk(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (regex.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

// Named singleton export
export const analyzer = new Analyzer();
