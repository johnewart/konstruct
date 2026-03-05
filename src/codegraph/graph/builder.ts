/* eslint-disable import/extensions -- .ts for Node/worker ESM resolution */
import type { DependencyGraph, DependencyEdge, SymbolDef, SymbolRef } from '../spec/graph.spec.ts';
import { DependencyType, ReferenceContext } from '../spec/graph.spec.ts';

// Maps ReferenceContext to DependencyType
function contextToEdgeType(ctx: ReferenceContext): DependencyType {
  switch (ctx) {
    case ReferenceContext.FUNCTION_CALL:    return DependencyType.CALLS;
    case ReferenceContext.INSTANTIATION:    return DependencyType.INSTANTIATES;
    case ReferenceContext.TYPE_ANNOTATION:  return DependencyType.USES_TYPE;
    case ReferenceContext.IMPORT:           return DependencyType.IMPORTS;
    case ReferenceContext.INHERITANCE:      return DependencyType.INHERITS;
    case ReferenceContext.ASSIGNMENT_SOURCE:return DependencyType.READS;
    case ReferenceContext.ASSIGNMENT_TARGET:return DependencyType.WRITES;
    default:                                return DependencyType.REFERENCES;
  }
}

let refCounter = 0;

function generateRefId(): string {
  return `ref_${refCounter++}`;
}

export interface GraphBuildOptions {
  language?: string;
  files?: string[];
}

export function buildGraph(
  defs: SymbolDef[],
  refs: SymbolRef[],
  options: GraphBuildOptions = {}
): DependencyGraph {
  // Reset ref counter for determinism
  refCounter = 0;

  // 1. Build nodes map
  const nodes = new Map<string, SymbolDef>();
  for (const def of defs) {
    nodes.set(def.id, def);
  }

  // 2. Build name_to_symbol_map
  const name_to_symbol_map = new Map<string, SymbolDef[]>();
  for (const def of defs) {
    const existing = name_to_symbol_map.get(def.name) ?? [];
    existing.push(def);
    name_to_symbol_map.set(def.name, existing);
  }

  // 3. Build edges
  // Edge key: "source|target|edgeType" → DependencyEdge
  const edgeMap = new Map<string, DependencyEdge>();
  const edges: DependencyEdge[] = [];

  for (const ref of refs) {
    const source = ref.scope; // This is the scope_symbol_id
    const target = ref.path;

    // Skip if source equals target (self-loop)
    if (source === target) continue;

    // Skip if source or target not in nodes
    if (!nodes.has(source) || !nodes.has(target)) continue;

    const edgeType = contextToEdgeType(ref.context);
    const key = `${source}|${target}|${edgeType}`;

    const existing = edgeMap.get(key);
    if (existing) {
      existing.count++;
      existing.reference_ids.push(generateRefId());
    } else {
      const edge: DependencyEdge = {
        source_symbol_path: source,
        target_symbol_path: target,
        reference_ids: [generateRefId()],
        edge_type: edgeType,
        count: 1,
      };
      edgeMap.set(key, edge);
      edges.push(edge);
    }
  }

  // 4. Build metadata
  const metadata = new Map<string, any>([
    ['language', options.language ?? 'unknown'],
    ['files', options.files ?? []],
    ['node_count', nodes.size],
    ['edge_count', edges.length],
  ]);

  return {
    nodes,
    edges,
    name_to_symbol_map,
    metadata,
  };
}
