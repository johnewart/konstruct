/**
 * Shared path helpers for codegraph: symbol id paths and import specifier resolution.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Path segment for symbol ids: relative path from common root when multiple files,
 * else basename. Ensures same basename in different dirs (e.g. a/foo.py vs b/foo.js) stay distinct.
 */
export function getPathForIds(filename: string, allFilePaths?: string[]): string {
  if (!allFilePaths || allFilePaths.length <= 1) {
    return path.basename(filename);
  }
  const root = computeCommonRoot(allFilePaths);
  const resolved = path.resolve(filename);
  const rel = path.relative(root, resolved);
  const normalized = rel.replace(/\\/g, '/') || path.basename(filename);
  return normalized;
}

/**
 * Longest common directory prefix of the given resolved paths.
 */
export function computeCommonRoot(filePaths: string[]): string {
  if (filePaths.length === 0) return '';
  const normalized = filePaths.map((p) => path.resolve(p).replace(/\\/g, '/'));
  let prefix = normalized[0];
  for (let i = 1; i < normalized.length; i++) {
    const p = normalized[i];
    while (prefix.length > 0 && !(p === prefix || p.startsWith(prefix + '/'))) {
      prefix = path.dirname(prefix).replace(/\\/g, '/');
    }
  }
  return prefix || '/';
}

/** Extensions to try when resolving extensionless specifiers (JS/TS). */
const RESOLVE_EXTENSIONS = ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs'];

/**
 * Resolve an import specifier to an absolute file path.
 * Handles relative specifiers (./ and ../) and extensionless specifiers by trying
 * common extensions and index files. Returns the first path that exists in
 * allFilePaths or on disk, or null if none match.
 */
export function resolveSpecifier(
  importerPath: string,
  specifier: string,
  allFilePaths: string[],
): string | null {
  if (!specifier.startsWith('.') || specifier === '.') {
    return null;
  }
  const dir = path.dirname(importerPath);
  const resolvedBase = path.resolve(dir, specifier);
  const normalizedPaths = new Set(allFilePaths.map((p) => path.resolve(p).replace(/\\/g, '/')));
  const resolvedBaseNorm = path.resolve(resolvedBase).replace(/\\/g, '/');

  // 1. Exact match (specifier already has extension)
  if (normalizedPaths.has(resolvedBaseNorm)) {
    return path.resolve(resolvedBase);
  }
  if (fs.existsSync(resolvedBase) && fs.statSync(resolvedBase).isFile()) {
    return path.resolve(resolvedBase);
  }

  // 2. Specifier + extension
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = resolvedBaseNorm + ext;
    if (normalizedPaths.has(withExt)) {
      return path.resolve(resolvedBase + ext);
    }
    const fullWithExt = path.resolve(resolvedBase + ext);
    if (fs.existsSync(fullWithExt) && fs.statSync(fullWithExt).isFile()) {
      return fullWithExt;
    }
  }

  // 3. Specifier as directory + index.*
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexPath = path.join(resolvedBase, 'index' + ext);
    const indexNorm = path.resolve(indexPath).replace(/\\/g, '/');
    if (normalizedPaths.has(indexNorm)) {
      return path.resolve(indexPath);
    }
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return path.resolve(indexPath);
    }
  }

  return null;
}
