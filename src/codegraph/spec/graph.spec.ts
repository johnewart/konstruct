// AST Data (const objects avoid TypeScript enum for Node strip-only / worker compatibility)

export const ASTNodeType = {
  CALL: 0,
  FUNCTION_DEFINITION: 1,
  ASSIGNMENT: 2,
  CLASS_DEFINITION: 3,
  ANNOTATION: 4,
} as const;
export type ASTNodeType = (typeof ASTNodeType)[keyof typeof ASTNodeType];

export type ASTNode = {
  id: string                    // Unique identifier within this AST
  type: ASTNodeType                  // "FunctionDef", "ClassDef", "Assign", "Call", etc.
  value: string | null          // Optional: the literal value (e.g., identifier name)
  line: number                      // Source line number (1-indexed)
  column: number                    // Source column number (0-indexed)
  children: Array<ASTNode>        // Child nodes
  parent: ASTNode | null         // Reference to parent (optional, for convenience)
  metadata: Map<string, any>     // Language-specific metadata
}

export type SymbolDef = {
  id: string                     // Unique identifier
  name: string                   // Symbol name (e.g., "my_function")
  kind: SymbolKind               // "function", "class", "variable", "import", "parameter", etc.
  scope: string                  // Fully qualified scope (e.g., "module.MyClass.method")
  location: SourceLocation       // Where it's defined
  ast_node_id: string            // Reference to defining AST node
  metadata: Map<string, any>     // Language-specific (e.g., is_exported, is_async)
}

export const SymbolKind = {
  FUNCTION: 0,
  CLASS: 1,
  VARIABLE: 2,
  CONSTANT: 3,
  IMPORT: 4,
  PARAMETER: 5,
  TYPE_ALIAS: 6,
  ENUM: 7,
  INTERFACE: 8,
  MODULE: 9,
} as const;
export type SymbolKind = (typeof SymbolKind)[keyof typeof SymbolKind];

export interface SourceLocation {
  file: string                   // Filename or module path
  line: number                      // 1-indexed
  column: number                    // 0-indexed
  end_line: number                  // 1-indexed
  end_column: number                // 0-indexed
}


export interface SymbolRef {
  path: string                   // Unique identifier - this is the path to the symbol being referenced
  location: SourceLocation       // Where the reference occurs
  context: ReferenceContext      // Context of reference (e.g., "function_call", "type_annotation", "assignment_target")
  scope: string                  // Scope in which reference occurs
  ast_node_id: string            // Reference to referencing AST node
}



export const ReferenceContext = {
  FUNCTION_CALL: 0,
  TYPE_ANNOTATION: 1,
  ASSIGNMENT_TARGET: 2,
  ASSIGNMENT_SOURCE: 3,
  IMPORT: 4,
  ATTRIBUTE_ACCESS: 5,
  INHERITANCE: 6,
  INSTANTIATION: 7,
  OTHER: 8,
} as const;
export type ReferenceContext = (typeof ReferenceContext)[keyof typeof ReferenceContext];

export type DependencyGraph  = {
  nodes: Map<string, SymbolDef>        // Symbol path (file:// or lib://) → SymbolDef
  edges: Array<DependencyEdge>          // List of all dependencies
  name_to_symbol_map: Map<string, Array<SymbolDef>>  // For name resolution
  metadata: Map<string, any>           // Graph-level metadata (e.g., languages, files)
}

export type DependencyEdge = {
  source_symbol_path: string             // file:// or lib:// ID of symbol of the dependent
  target_symbol_path: string             // file:// or lib:// ID of symbol of the dependency
  reference_ids: Array<string>          // References that create this edge
  edge_type: DependencyType             // Type of dependency
  count: number                           // Number of references
}

export const DependencyType = {
  CALLS: 0,         // Function A calls function B
  INHERITS: 1,      // Class A inherits from class B
  USES_TYPE: 2,     // Variable/param has type B
  INSTANTIATES: 3,  // Code instantiates class B
  IMPORTS: 4,       // Module imports symbol B
  REFERENCES: 5,    // Generic reference (fallback)
  READS: 6,         // Reads variable B
  WRITES: 7,        // Writes to variable B
} as const;
export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType];

/** Reverse map for display (replaces enum key lookup DependencyType[value]) */
export const DependencyTypeName: Record<DependencyType, string> = {
  [DependencyType.CALLS]: 'CALLS',
  [DependencyType.INHERITS]: 'INHERITS',
  [DependencyType.USES_TYPE]: 'USES_TYPE',
  [DependencyType.INSTANTIATES]: 'INSTANTIATES',
  [DependencyType.IMPORTS]: 'IMPORTS',
  [DependencyType.REFERENCES]: 'REFERENCES',
  [DependencyType.READS]: 'READS',
  [DependencyType.WRITES]: 'WRITES',
};








interface Parser {
  /// Parse source code numbero an AST
  /// @param source_code: Raw source code string
  /// @param filename: Optional, for error messages and metadata
  /// @return: Root AST node
  parse(source_code: string, filename: string): ASTNode

  /// Parse from file
  /// @param file_path: Path to source file
  /// @return: Root AST node
  parse_file(file_path: string): ASTNode
}


interface SymbolExtractor {
  /// Extract symbols from AST
  /// @param ast: Root AST node
  /// @param filename: For source location metadata
  /// @return: Tuple of (symbol_definitions, symbol_references)
  extract(ast: ASTNode, filename: string):
    [Array<SymbolDef>, Array<SymbolRef>]
}

interface GraphBuilder {
  /// Build dependency graph from symbols
  /// @param symbol_defs: All symbol definitions
  /// @param symbol_refs: All symbol references
  /// @return: Dependency graph
  build_graph(symbol_defs: Array<SymbolDef>, symbol_refs: Array<SymbolRef>):
    DependencyGraph

  /// Add symbols and references to existing graph
  add_symbols(graph: DependencyGraph, symbol_defs: Array<SymbolDef>,
              symbol_refs: Array<SymbolRef>): DependencyGraph
}


export interface DependencyGraphBuilder {
  /// Parse and extract symbols from source code
  /// @param source_code: Source code string
  /// @param language: Language identifier (e.g., "python", "javascript")
  /// @param filename: Optional filename for location
  /// @return: Dependency graph
  analyze(source_code: string, language: string, filename: string):
    DependencyGraph

  /// Analyze multiple files
  /// @param file_paths: List of source file paths
  /// @param language: Language identifier
  /// @return: Unified dependency graph across all files
  analyze_files(file_paths: Array<string>, language: string):
    DependencyGraph

  /// Analyze directory recursively
  /// @param directory_path: Path to directory
  /// @param language: Language identifier
  /// @param pattern: Optional glob pattern for file filtering
  /// @return: Unified dependency graph
  analyze_directory(directory_path: string, language: string,
                    pattern: string):
    DependencyGraph
}

interface DependencyGraphQuery {
  /// Get all direct dependencies of a symbol
  /// @param graph: Dependency graph
  /// @param symbol_id: Symbol identifier
  /// @return: List of symbols this symbol depends on
  get_dependencies(graph: DependencyGraph, symbol_id: string):
    Array<SymbolDef>

  /// Get all symbols that depend on this symbol (reverse dependencies)
  /// @param graph: Dependency graph
  /// @param symbol_id: Symbol identifier
  /// @return: List of symbols that depend on this one
  get_dependents(graph: DependencyGraph, symbol_id: string):
    Array<SymbolDef>

  /// Get all transitive dependencies (recursive)
  /// @param graph: Dependency graph
  /// @param symbol_id: Symbol identifier
  /// @param max_depth: Optional max recursion depth (-1 for unlimited)
  /// @return: Set of all transitively depended-on symbols
  get_transitive_dependencies(graph: DependencyGraph, symbol_id: string,
                              max_depth: number):
    Set<SymbolDef>

 /// Get all transitive dependents (reverse transitive)
  /// @param graph: Dependency graph
  /// @param symbol_id: Symbol identifier
  /// @return: Set of all symbols transitively depending on this one
  get_transitive_dependents(graph: DependencyGraph, symbol_id: string):
    Set<SymbolDef>

  /// Find circular dependencies
  /// @param graph: Dependency graph
  /// @return: List of cycles (each cycle is a list of symbol IDs)
  find_cycles(graph: DependencyGraph):
    Array<Array<string>>

  /// Find symbols by name
  /// @param graph: Dependency graph
  /// @param name: Symbol name (partial match supported if prefix_match=true)
  /// @param prefix_match: If true, match names starting with this string
  /// @return: List of matching symbols
  find_symbols(graph: DependencyGraph, name: string, prefix_match: boolean):
    Array<SymbolDef>

  /// Get symbols in a specific scope
  /// @param graph: Dependency graph
  /// @param scope: Scope identifier (e.g., "module.ClassName")
  /// @return: List of symbols in that scope
  get_symbols_in_scope(graph: DependencyGraph, scope: string):
    Array<SymbolDef>
}

