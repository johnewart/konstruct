/**
 * Imports without extensions must resolve to .js (or index.js).
 * main.js imports from './utils' (no extension); resolver should find utils.js.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "utils.js": `\
export function add(a, b) {
  return a + b;
}
`,

  "main.js": `\
import { add } from './utils';

function run() {
  add(1, 2);
}
run();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Extensionless imports — './utils' resolves to utils.js", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-extensionless-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "javascript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has edge from main.js to utils.js (resolved from './utils')", () => {
    const edgesFromMain = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      return srcFile?.includes("main.js");
    });
    const toUtils = edgesFromMain.some((e) => {
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgtFile?.includes("utils.js");
    });
    expect(toUtils, "import from './utils' must resolve to utils.js").toBe(true);
  });

  it("run() in main.js has CALLS edge to add in utils.js", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const mainCallsAdd = callEdges.some((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return src?.includes("main.js") && tgt?.includes("utils.js");
    });
    expect(mainCallsAdd, "add(1, 2) must create CALLS edge to utils.js::add").toBe(true);
  });
});
