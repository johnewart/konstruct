import { describe, it, expect, beforeAll } from "vitest"; // or swap for "jest"
import type { DependencyGraph, SymbolDef, SymbolRef } from '../../graph.spec';
import {
  DependencyType,
  DependencyTypeName,
  SymbolKind,
  ReferenceContext,
} from '../../graph.spec';


const EXAMPLE_PY = `
# Module-level variable
MAX_RETRIES = 3

class DataProcessor:
    """A class that processes data."""

    def __init__(self, name: str):
        self.name = name
        self.retries = MAX_RETRIES

    def process(self, data: list) -> dict:
        """Process data and return results."""
        result = self._validate(data)
        if result:
            return self._transform(result)
        return {}

    def _validate(self, data: list) -> bool:
        """Validate data."""
        return len(data) > 0

    def _transform(self, data: list) -> dict:
        """Transform data."""
        return {"items": data, "count": len(data)}


def create_processor(name: str) -> DataProcessor:
    """Factory function to create a processor."""
    processor = DataProcessor(name)
    return processor


def main():
    """Main entry point."""
    processor = create_processor("default")
    result = processor.process([1, 2, 3])
    print(result)


if __name__ == "__main__":
    main() 
`


// ─── Symbol Definitions ───────────────────────────────────────────────────────

const symMaxRetries: SymbolDef = {
  id: "file://example.py::MAX_RETRIES",
  name: "MAX_RETRIES",
  kind: SymbolKind.CONSTANT,
  scope: "example",
  location: {
    file: "example.py",
    line: 2,
    column: 0,
    end_line: 2,
    end_column: 16,
  },
  ast_node_id: "ast_assign_1",
  metadata: new Map<string, any>([
    ["is_module_level", true],
    ["value", 3],
  ]),
};

const symDataProcessor: SymbolDef = {
  id: "file://example.py::DataProcessor",
  name: "DataProcessor",
  kind: SymbolKind.CLASS,
  scope: "example",
  location: {
    file: "example.py",
    line: 4,
    column: 0,
    end_line: 24,
    end_column: 44,
  },
  ast_node_id: "ast_classdef_1",
  metadata: new Map<string, any>([
    ["docstring", "A class that processes data."],
    ["bases", []],
  ]),
};

const symDataProcessorInit: SymbolDef = {
  id: "file://example.py::DataProcessor.__init__",
  name: "__init__",
  kind: SymbolKind.FUNCTION,
  scope: "example.DataProcessor",
  location: {
    file: "example.py",
    line: 7,
    column: 4,
    end_line: 9,
    end_column: 30,
  },
  ast_node_id: "ast_funcdef_1",
  metadata: new Map<string, any>([
    ["is_method", true],
    ["is_async", false],
    ["parameters", ["self", "name"]],
    ["parameter_types", { name: "str" }],
  ]),
};

const symDataProcessorProcess: SymbolDef = {
  id: "file://example.py::DataProcessor.process",
  name: "process",
  kind: SymbolKind.FUNCTION,
  scope: "example.DataProcessor",
  location: {
    file: "example.py",
    line: 11,
    column: 4,
    end_line: 16,
    end_column: 16,
  },
  ast_node_id: "ast_funcdef_2",
  metadata: new Map<string, any>([
    ["is_method", true],
    ["is_async", false],
    ["parameters", ["self", "data"]],
    ["parameter_types", { data: "list" }],
    ["return_type", "dict"],
    ["docstring", "Process data and return results."],
  ]),
};

const symDataProcessorValidate: SymbolDef = {
  id: "file://example.py::DataProcessor._validate",
  name: "_validate",
  kind: SymbolKind.FUNCTION,
  scope: "example.DataProcessor",
  location: {
    file: "example.py",
    line: 18,
    column: 4,
    end_line: 20,
    end_column: 28,
  },
  ast_node_id: "ast_funcdef_3",
  metadata: new Map<string, any>([
    ["is_method", true],
    ["is_async", false],
    ["is_private", true],
    ["parameters", ["self", "data"]],
    ["parameter_types", { data: "list" }],
    ["return_type", "bool"],
    ["docstring", "Validate data."],
  ]),
};

const symDataProcessorTransform: SymbolDef = {
  id: "file://example.py::DataProcessor._transform",
  name: "_transform",
  kind: SymbolKind.FUNCTION,
  scope: "example.DataProcessor",
  location: {
    file: "example.py",
    line: 22,
    column: 4,
    end_line: 24,
    end_column: 44,
  },
  ast_node_id: "ast_funcdef_4",
  metadata: new Map<string, any>([
    ["is_method", true],
    ["is_async", false],
    ["is_private", true],
    ["parameters", ["self", "data"]],
    ["parameter_types", { data: "list" }],
    ["return_type", "dict"],
    ["docstring", "Transform data."],
  ]),
};

const symCreateProcessor: SymbolDef = {
  id: "file://example.py::create_processor",
  name: "create_processor",
  kind: SymbolKind.FUNCTION,
  scope: "example",
  location: {
    file: "example.py",
    line: 27,
    column: 0,
    end_line: 30,
    end_column: 18,
  },
  ast_node_id: "ast_funcdef_5",
  metadata: new Map<string, any>([
    ["is_method", false],
    ["is_async", false],
    ["parameters", ["name"]],
    ["parameter_types", { name: "str" }],
    ["return_type", "DataProcessor"],
    ["docstring", "Factory function to create a processor."],
  ]),
};

const symMain: SymbolDef = {
  id: "file://example.py::main",
  name: "main",
  kind: SymbolKind.FUNCTION,
  scope: "example",
  location: {
    file: "example.py",
    line: 33,
    column: 0,
    end_line: 37,
    end_column: 20,
  },
  ast_node_id: "ast_funcdef_6",
  metadata: new Map<string, any>([
    ["is_method", false],
    ["is_async", false],
    ["parameters", []],
    ["docstring", "Main entry point."],
  ]),
};

// ─── Dependency Graph ─────────────────────────────────────────────────────────

const dependencyGraph: DependencyGraph = {
  // ── Nodes ──────────────────────────────────────────────────────────────────
  nodes: new Map<string, SymbolDef>([
    ["file://example.py::MAX_RETRIES",              symMaxRetries],
    ["file://example.py::DataProcessor",            symDataProcessor],
    ["file://example.py::DataProcessor.__init__",   symDataProcessorInit],
    ["file://example.py::DataProcessor.process",    symDataProcessorProcess],
    ["file://example.py::DataProcessor._validate",  symDataProcessorValidate],
    ["file://example.py::DataProcessor._transform", symDataProcessorTransform],
    ["file://example.py::create_processor",         symCreateProcessor],
    ["file://example.py::main",                     symMain],
  ]),

  // ── Edges ──────────────────────────────────────────────────────────────────
  edges: [
    // DataProcessor.__init__ reads the module-level MAX_RETRIES (line 9)
    {
      source_symbol_path: "file://example.py::DataProcessor.__init__",
      target_symbol_path: "file://example.py::MAX_RETRIES",
      reference_ids: ["ref_init_reads_max_retries"],
      edge_type: DependencyType.READS,
      count: 1,
    },

    // DataProcessor.process calls self._validate (line 13)
    {
      source_symbol_path: "file://example.py::DataProcessor.process",
      target_symbol_path: "file://example.py::DataProcessor._validate",
      reference_ids: ["ref_process_calls_validate"],
      edge_type: DependencyType.CALLS,
      count: 1,
    },

    // DataProcessor.process calls self._transform (line 15)
    {
      source_symbol_path: "file://example.py::DataProcessor.process",
      target_symbol_path: "file://example.py::DataProcessor._transform",
      reference_ids: ["ref_process_calls_transform"],
      edge_type: DependencyType.CALLS,
      count: 1,
    },

    // create_processor instantiates DataProcessor (line 29: DataProcessor(name))
    {
      source_symbol_path: "file://example.py::create_processor",
      target_symbol_path: "file://example.py::DataProcessor",
      reference_ids: ["ref_create_processor_instantiates_dataprocessor"],
      edge_type: DependencyType.INSTANTIATES,
      count: 1,
    },

    // create_processor has DataProcessor as its return type annotation (line 27)
    {
      source_symbol_path: "file://example.py::create_processor",
      target_symbol_path: "file://example.py::DataProcessor",
      reference_ids: ["ref_create_processor_uses_type_dataprocessor"],
      edge_type: DependencyType.USES_TYPE,
      count: 1,
    },

    // main calls create_processor (line 35)
    {
      source_symbol_path: "file://example.py::main",
      target_symbol_path: "file://example.py::create_processor",
      reference_ids: ["ref_main_calls_create_processor"],
      edge_type: DependencyType.CALLS,
      count: 1,
    },

    // main calls processor.process(...) (line 36)
    {
      source_symbol_path: "file://example.py::main",
      target_symbol_path: "file://example.py::DataProcessor.process",
      reference_ids: ["ref_main_calls_process"],
      edge_type: DependencyType.CALLS,
      count: 1,
    },

    // Module-level __main__ guard calls main() (line 41)
    {
      source_symbol_path: "file://example.py::__main__",
      target_symbol_path: "file://example.py::main",
      reference_ids: ["ref_module_guard_calls_main"],
      edge_type: DependencyType.CALLS,
      count: 1,
    },
  ],

  // ── Name → Symbol Map ──────────────────────────────────────────────────────
  // Useful for name resolution; a name can map to multiple symbols across files.
  name_to_symbol_map: new Map<string, Array<SymbolDef>>([
    ["MAX_RETRIES",    [symMaxRetries]],
    ["DataProcessor",  [symDataProcessor]],
    ["__init__",       [symDataProcessorInit]],
    ["process",        [symDataProcessorProcess]],
    ["_validate",      [symDataProcessorValidate]],
    ["_transform",     [symDataProcessorTransform]],
    ["create_processor", [symCreateProcessor]],
    ["main",           [symMain]],
  ]),

  // ── Graph-level Metadata ────────────────────────────────────────────────────
  metadata: new Map<string, any>([
    ["language",  "python"],
    ["files",     ["example.py"]],
    ["py_version", "3.x"],
    ["node_count", 8],
    ["edge_count", 8],
  ]),
};



// ─── Expected symbol paths ────────────────────────────────────────────────────
// Central reference so tests and helpers share one source of truth.
const PATHS = {
  MODULE:         "file://example.py::example",
  MAX_RETRIES:    "file://example.py::MAX_RETRIES",
  DataProcessor:  "file://example.py::DataProcessor",
  INIT:           "file://example.py::DataProcessor.__init__",
  PROCESS:        "file://example.py::DataProcessor.process",
  VALIDATE:       "file://example.py::DataProcessor._validate",
  TRANSFORM:      "file://example.py::DataProcessor._transform",
  CREATE:         "file://example.py::create_processor",
  MAIN:           "file://example.py::main",
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find edges from source → target with a given type (may be multiple). */
function findEdges(
  graph: DependencyGraph,
  source: string,
  target: string,
  type?: DependencyType,
) {
  return graph.edges.filter(
    (e) =>
      e.source_symbol_path === source &&
      e.target_symbol_path === target &&
      (type === undefined || e.edge_type === type),
  );
}

/** Assert a single edge exists and return it. */
function getEdge(
  graph: DependencyGraph,
  source: string,
  target: string,
  type: DependencyType,
) {
  const matches = findEdges(graph, source, target, type);
  expect(
    matches.length,
    `Expected exactly one ${DependencyTypeName[type]} edge from ${source} → ${target}`,
  ).toBe(1);
  return matches[0];
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("DependencyGraphBuilder — example.py", () => {
  let graph: DependencyGraph;

  beforeAll(() => {
    graph = analyzer.analyze(EXAMPLE_PY, "python", "example.py");
  });

  // ── 1. Graph shape ──────────────────────────────────────────────────────────

  describe("graph shape", () => {
    it("produces a valid graph object with required keys", () => {
      expect(graph).toBeDefined();
      expect(graph.nodes).toBeInstanceOf(Map);
      expect(graph.edges).toBeInstanceOf(Array);
      expect(graph.name_to_symbol_map).toBeInstanceOf(Map);
      expect(graph.metadata).toBeInstanceOf(Map);
    });

    it("contains exactly the 9 expected nodes (module + symbols)", () => {
      const expectedPaths = Object.values(PATHS);
      expect(graph.nodes.size).toBe(expectedPaths.length);
      for (const path of expectedPaths) {
        expect(graph.nodes.has(path), `Missing node: ${path}`).toBe(true);
      }
    });
  });

  // ── 2. Node details ─────────────────────────────────────────────────────────

  describe("nodes", () => {
    describe("MAX_RETRIES", () => {
      it("is a CONSTANT at module scope", () => {
        const sym = graph.nodes.get(PATHS.MAX_RETRIES)!;
        expect(sym.name).toBe("MAX_RETRIES");
        expect(sym.kind).toBe(SymbolKind.CONSTANT);
        expect(sym.scope).toBe("example");
      });

      it("is defined on line 2, column 0", () => {
        const sym = graph.nodes.get(PATHS.MAX_RETRIES)!;
        expect(sym.location.file).toBe("example.py");
        expect(sym.location.line).toBe(2);
        expect(sym.location.column).toBe(0);
      });
    });

    describe("DataProcessor", () => {
      it("is a CLASS at module scope", () => {
        const sym = graph.nodes.get(PATHS.DataProcessor)!;
        expect(sym.name).toBe("DataProcessor");
        expect(sym.kind).toBe(SymbolKind.CLASS);
        expect(sym.scope).toBe("example");
      });

      it("starts on line 4", () => {
        const sym = graph.nodes.get(PATHS.DataProcessor)!;
        expect(sym.location.line).toBe(4);
        expect(sym.location.column).toBe(0);
      });
    });

    describe("DataProcessor.__init__", () => {
      it("is a FUNCTION in DataProcessor scope", () => {
        const sym = graph.nodes.get(PATHS.INIT)!;
        expect(sym.name).toBe("__init__");
        expect(sym.kind).toBe(SymbolKind.FUNCTION);
        expect(sym.scope).toBe("example.DataProcessor");
      });

      it("starts on line 7", () => {
        expect(graph.nodes.get(PATHS.INIT)!.location.line).toBe(7);
      });
    });

    describe("DataProcessor.process", () => {
      it("is a FUNCTION in DataProcessor scope", () => {
        const sym = graph.nodes.get(PATHS.PROCESS)!;
        expect(sym.name).toBe("process");
        expect(sym.kind).toBe(SymbolKind.FUNCTION);
        expect(sym.scope).toBe("example.DataProcessor");
      });

      it("starts on line 11", () => {
        expect(graph.nodes.get(PATHS.PROCESS)!.location.line).toBe(11);
      });
    });

    describe("DataProcessor._validate", () => {
      it("is a FUNCTION in DataProcessor scope", () => {
        const sym = graph.nodes.get(PATHS.VALIDATE)!;
        expect(sym.name).toBe("_validate");
        expect(sym.kind).toBe(SymbolKind.FUNCTION);
        expect(sym.scope).toBe("example.DataProcessor");
      });

      it("starts on line 18", () => {
        expect(graph.nodes.get(PATHS.VALIDATE)!.location.line).toBe(18);
      });
    });

    describe("DataProcessor._transform", () => {
      it("is a FUNCTION in DataProcessor scope", () => {
        const sym = graph.nodes.get(PATHS.TRANSFORM)!;
        expect(sym.name).toBe("_transform");
        expect(sym.kind).toBe(SymbolKind.FUNCTION);
        expect(sym.scope).toBe("example.DataProcessor");
      });

      it("starts on line 22", () => {
        expect(graph.nodes.get(PATHS.TRANSFORM)!.location.line).toBe(22);
      });
    });

    describe("create_processor", () => {
      it("is a FUNCTION at module scope", () => {
        const sym = graph.nodes.get(PATHS.CREATE)!;
        expect(sym.name).toBe("create_processor");
        expect(sym.kind).toBe(SymbolKind.FUNCTION);
        expect(sym.scope).toBe("example");
      });

      it("starts on line 27", () => {
        expect(graph.nodes.get(PATHS.CREATE)!.location.line).toBe(27);
      });
    });

    describe("main", () => {
      it("is a FUNCTION at module scope", () => {
        const sym = graph.nodes.get(PATHS.MAIN)!;
        expect(sym.name).toBe("main");
        expect(sym.kind).toBe(SymbolKind.FUNCTION);
        expect(sym.scope).toBe("example");
      });

      it("starts on line 33", () => {
        expect(graph.nodes.get(PATHS.MAIN)!.location.line).toBe(33);
      });
    });

    it("every node has a non-empty ast_node_id", () => {
      for (const [path, sym] of graph.nodes) {
        expect(sym.ast_node_id, `ast_node_id missing on ${path}`).toBeTruthy();
      }
    });

    it("every node's id matches its map key", () => {
      for (const [path, sym] of graph.nodes) {
        expect(sym.id, `id/key mismatch for ${path}`).toBe(path);
      }
    });
  });

  // ── 3. Edge presence and types ──────────────────────────────────────────────

  describe("edges", () => {
    it("__init__ READS MAX_RETRIES", () => {
      const edge = getEdge(graph, PATHS.INIT, PATHS.MAX_RETRIES, DependencyType.READS);
      expect(edge.count).toBeGreaterThanOrEqual(1);
    });

    it("process CALLS _validate", () => {
      const edge = getEdge(graph, PATHS.PROCESS, PATHS.VALIDATE, DependencyType.CALLS);
      expect(edge.count).toBeGreaterThanOrEqual(1);
    });

    it("process CALLS _transform", () => {
      const edge = getEdge(graph, PATHS.PROCESS, PATHS.TRANSFORM, DependencyType.CALLS);
      expect(edge.count).toBeGreaterThanOrEqual(1);
    });

    it("create_processor INSTANTIATES DataProcessor", () => {
      const edge = getEdge(graph, PATHS.CREATE, PATHS.DataProcessor, DependencyType.INSTANTIATES);
      expect(edge.count).toBeGreaterThanOrEqual(1);
    });

    it("create_processor USES_TYPE DataProcessor (return annotation)", () => {
      const edge = getEdge(graph, PATHS.CREATE, PATHS.DataProcessor, DependencyType.USES_TYPE);
      expect(edge.count).toBeGreaterThanOrEqual(1);
    });

    it("main CALLS create_processor", () => {
      const edge = getEdge(graph, PATHS.MAIN, PATHS.CREATE, DependencyType.CALLS);
      expect(edge.count).toBeGreaterThanOrEqual(1);
    });

    it("main CALLS DataProcessor.process", () => {
      const edge = getEdge(graph, PATHS.MAIN, PATHS.PROCESS, DependencyType.CALLS);
      expect(edge.count).toBeGreaterThanOrEqual(1);
    });

    it("every edge has at least one reference_id", () => {
      for (const edge of graph.edges) {
        expect(
          edge.reference_ids.length,
          `Edge ${edge.source_symbol_path} → ${edge.target_symbol_path} has no reference_ids`,
        ).toBeGreaterThan(0);
      }
    });

    it("every edge references nodes that exist in the graph", () => {
      for (const edge of graph.edges) {
        expect(
          graph.nodes.has(edge.source_symbol_path),
          `Unknown source: ${edge.source_symbol_path}`,
        ).toBe(true);
        expect(
          graph.nodes.has(edge.target_symbol_path),
          `Unknown target: ${edge.target_symbol_path}`,
        ).toBe(true);
      }
    });

    it("there are no self-referential edges", () => {
      for (const edge of graph.edges) {
        expect(
          edge.source_symbol_path,
          `Self-loop on ${edge.source_symbol_path}`,
        ).not.toBe(edge.target_symbol_path);
      }
    });
  });

  // ── 4. No spurious edges ────────────────────────────────────────────────────
  // These guard against the analyzer hallucinating relationships that don't
  // exist in the source.

  describe("absence of spurious edges", () => {
    it("main does NOT directly call _validate or _transform", () => {
      expect(findEdges(graph, PATHS.MAIN, PATHS.VALIDATE, DependencyType.CALLS)).toHaveLength(0);
      expect(findEdges(graph, PATHS.MAIN, PATHS.TRANSFORM, DependencyType.CALLS)).toHaveLength(0);
    });

    it("_validate does NOT call _transform (or vice versa)", () => {
      expect(findEdges(graph, PATHS.VALIDATE, PATHS.TRANSFORM, DependencyType.CALLS)).toHaveLength(0);
      expect(findEdges(graph, PATHS.TRANSFORM, PATHS.VALIDATE, DependencyType.CALLS)).toHaveLength(0);
    });

    it("create_processor does NOT call main", () => {
      expect(findEdges(graph, PATHS.CREATE, PATHS.MAIN, DependencyType.CALLS)).toHaveLength(0);
    });
  });

  // ── 5. name_to_symbol_map ───────────────────────────────────────────────────

  describe("name_to_symbol_map", () => {
    const expectedNames = [
      "MAX_RETRIES",
      "DataProcessor",
      "__init__",
      "process",
      "_validate",
      "_transform",
      "create_processor",
      "main",
    ] as const;

    it("contains an entry for every expected symbol name", () => {
      for (const name of expectedNames) {
        expect(
          graph.name_to_symbol_map.has(name),
          `name_to_symbol_map missing entry for "${name}"`,
        ).toBe(true);
      }
    });

    it("each entry maps to a non-empty array of SymbolDefs", () => {
      for (const name of expectedNames) {
        const defs = graph.name_to_symbol_map.get(name)!;
        expect(Array.isArray(defs)).toBe(true);
        expect(defs.length, `Empty array for name "${name}"`).toBeGreaterThan(0);
      }
    });

    it("each SymbolDef in the map is also present in graph.nodes", () => {
      for (const [name, defs] of graph.name_to_symbol_map) {
        for (const def of defs) {
          expect(
            graph.nodes.has(def.id),
            `name_to_symbol_map["${name}"] contains symbol "${def.id}" not in nodes`,
          ).toBe(true);
        }
      }
    });

    it("DataProcessor maps to the class, not a method", () => {
      const defs = graph.name_to_symbol_map.get("DataProcessor")!;
      expect(defs.some((d) => d.kind === SymbolKind.CLASS)).toBe(true);
    });
  });

  // ── 6. Metadata ─────────────────────────────────────────────────────────────

  describe("graph metadata", () => {
    it("records 'python' as the language", () => {
      expect(graph.metadata.get("language")).toBe("python");
    });

    it("records 'example.py' in the files list", () => {
      const files: string[] = graph.metadata.get("files") ?? [];
      expect(files).toContain("example.py");
    });
  });

  // describe('graph structure', () => {
  //   it("matches the expected graph data structure", () => {
  //     expect(graph)
  //   })
  // })
});