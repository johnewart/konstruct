import * as fs from 'fs';
import * as path from 'path';
/* eslint-disable import/extensions -- .ts required for Node/worker ESM resolution when loaded outside Vite */
import type { DependencyGraph, DependencyGraphBuilder, SymbolDef, SymbolRef } from './spec/graph.spec.ts';
import { parsePython, parsePythonFile } from './parsers/python.ts';
import { PythonSymbolExtractor } from './parsers/python_symbol_extractor.ts';
import { buildGraph } from './graph/builder.ts';

export class Analyzer implements DependencyGraphBuilder {
  /**
   * Analyze a single source string.
   */
  analyze(source_code: string, language: string, filename: string): DependencyGraph {
    // Normalize: strip leading newline (template literals often start with \n)
    const source = source_code.startsWith('\n') ? source_code.slice(1) : source_code;

    if (language !== 'python') {
      throw new Error(`Unsupported language: ${language}`);
    }

    const basename = path.basename(filename);
    const rootNode = parsePython(source);
    const extractor = new PythonSymbolExtractor();

    // Phase A: extract defs
    const defs = extractor.extractDefs(rootNode, filename);

    // Phase B: extract refs (using local defs as global context)
    const refs = extractor.extractRefs(rootNode, filename, defs);

    return buildGraph(defs, refs, {
      language,
      files: [basename],
    });
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
    if (language !== 'python') {
      throw new Error(`Unsupported language: ${language}`);
    }

    const allDefs: SymbolDef[] = [];
    const allRefs: SymbolRef[] = [];
    const basenames: string[] = [];
    const total = file_paths.length;

    // Cache parsed trees to avoid re-parsing
    const parsedFiles: Array<{
      filePath: string;
      rootNode: ReturnType<typeof parsePython>;
      basename: string;
    }> = [];

    // Pass 1: extract all definitions
    for (let i = 0; i < file_paths.length; i++) {
      const filePath = file_paths[i];
      const { rootNode } = parsePythonFile(filePath);
      const bn = path.basename(filePath);
      basenames.push(bn);
      parsedFiles.push({ filePath, rootNode, basename: bn });

      const extractor = new PythonSymbolExtractor();
      const defs = extractor.extractDefs(rootNode, filePath);
      allDefs.push(...defs);

      onProgress?.(i + 1, total, 'defs');
    }

    // Pass 2: extract all references with the complete global symbol table
    for (let i = 0; i < parsedFiles.length; i++) {
      const { filePath, rootNode } = parsedFiles[i];
      const extractor = new PythonSymbolExtractor();
      const refs = extractor.extractRefs(rootNode, filePath, allDefs);
      allRefs.push(...refs);

      onProgress?.(i + 1, total, 'refs');
    }

    return buildGraph(allDefs, allRefs, {
      language,
      files: basenames,
    });
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
