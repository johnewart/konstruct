/* eslint-disable import/extensions -- .ts for Node/worker ESM resolution */
import type { SymbolDef } from '../spec/graph.spec.ts';
import { SymbolKind } from '../spec/graph.spec.ts';

/**
 * Builds a comprehensive lookup structure from all known symbol definitions.
 */
export class SymbolResolver {
  private idMap: Map<string, SymbolDef>;
  private nameMap: Map<string, SymbolDef[]>;

  constructor(defs: SymbolDef[]) {
    this.idMap = new Map();
    this.nameMap = new Map();

    for (const def of defs) {
      this.idMap.set(def.id, def);
      const existing = this.nameMap.get(def.name) ?? [];
      existing.push(def);
      this.nameMap.set(def.name, existing);
    }
  }

  /**
   * Look up a symbol by its full ID path.
   */
  getById(id: string): SymbolDef | null {
    return this.idMap.get(id) ?? null;
  }

  /**
   * Look up all symbols with a given name.
   */
  getByName(name: string): SymbolDef[] {
    return this.nameMap.get(name) ?? [];
  }

  /**
   * Resolve a local name to a symbol path.
   * Looks in:
   * 1. The provided importTable (name → resolved path) first
   * 2. The current file by qualified name
   * 3. Global symbol lookup by name
   */
  resolve(
    name: string,
    currentFile: string,
    importTable: Map<string, string>,
    currentScope?: string
  ): SymbolDef | null {
    // 1. Check import table
    const imported = importTable.get(name);
    if (imported) {
      return this.idMap.get(imported) ?? null;
    }

    // 2. Check current file with current scope (for method references)
    if (currentScope) {
      const qualifiedInScope = `file://${currentFile}::${currentScope}.${name}`;
      const scopedDef = this.idMap.get(qualifiedInScope);
      if (scopedDef) return scopedDef;
    }

    // 3. Check current file directly
    const directPath = `file://${currentFile}::${name}`;
    const directDef = this.idMap.get(directPath);
    if (directDef) return directDef;

    // 4. Global lookup by name (first match)
    const byName = this.nameMap.get(name);
    if (byName && byName.length > 0) return byName[0];

    return null;
  }

  /**
   * Resolve a type name to its full symbol path (returns the path string or null).
   */
  resolveTypePath(
    typeName: string,
    currentFile: string,
    importTable: Map<string, string>
  ): string | null {
    const def = this.resolve(typeName, currentFile, importTable);
    return def ? def.id : null;
  }

  /**
   * Given a resolved type path (e.g., "file://models.py::UserRepository") and a method name,
   * find the method symbol.
   */
  findMethod(typePath: string, methodName: string): SymbolDef | null {
    const methodId = `${typePath}.${methodName}`;
    return this.idMap.get(methodId) ?? null;
  }
}
