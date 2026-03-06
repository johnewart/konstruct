/**
 * Basic multi-file JS: config.js → utils.js → main.js.
 * Exercises: named imports, function calls, class instantiation, cross-file edges.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "config.js": `\
export const MAX = 10;
export class Config {
  constructor(n) {
    this.n = n;
  }
}
`,

  "utils.js": `\
import { MAX, Config } from './config.js';

export function makeConfig(n) {
  return new Config(n);
}
`,

  "main.js": `\
import { makeConfig } from './utils.js';

function run() {
  makeConfig(1);
}
run();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("DependencyGraphBuilder — three-file JavaScript project", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-multifile-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "javascript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("graph shape", () => {
    it("produces a valid graph with nodes and edges", () => {
      expect(graph).toBeDefined();
      expect(graph.nodes).toBeInstanceOf(Map);
      expect(graph.edges).toBeInstanceOf(Array);
    });

    it("contains symbols from config.js, utils.js, and main.js", () => {
      const nodeIds = [...graph.nodes.keys()];
      const hasConfig = nodeIds.some((id) => id.includes("config"));
      const hasUtils = nodeIds.some((id) => id.includes("utils"));
      const hasMain = nodeIds.some((id) => id.includes("main"));
      expect(hasConfig && hasUtils && hasMain, "Graph should have nodes from all three files").toBe(
        true,
      );
    });
  });

  describe("import edges", () => {
    it("main.js imports makeConfig from utils.js", () => {
      const edgesFromMain = graph.edges.filter((e) => {
        const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
        return srcFile?.includes("main.js");
      });
      const toUtils = edgesFromMain.some((e) => {
        const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
        return tgtFile?.includes("utils.js");
      });
      expect(toUtils, "main.js should have edge to utils.js").toBe(true);
    });

    it("utils.js imports Config and MAX from config.js", () => {
      const edgesFromUtils = graph.edges.filter((e) => {
        const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
        return srcFile?.includes("utils.js");
      });
      const toConfig = edgesFromUtils.some((e) => {
        const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
        return tgtFile?.includes("config.js");
      });
      expect(toConfig, "utils.js should have edge to config.js").toBe(true);
    });
  });

  describe("call edges", () => {
    it("run() in main.js calls makeConfig", () => {
      const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
      const mainCallsMakeConfig = callEdges.some((e) => {
        const src = getFileFromSymbolPath(graph, e.source_symbol_path);
        const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
        return src?.includes("main.js") && tgt?.includes("utils.js");
      });
      expect(mainCallsMakeConfig, "main.js run() should CALL makeConfig in utils.js").toBe(true);
    });
  });
});
