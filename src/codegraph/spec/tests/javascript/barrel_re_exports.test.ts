/**
 * Barrel re-exports: index.js re-exports from ./a and ./b; consumer imports from '.'.
 * Edges from consumer should resolve to the defining file (a.js / b.js) for the actual symbol.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "a.js": `\
export function a() {
  return 1;
}
`,

  "b.js": `\
export function b() {
  return 2;
}
`,

  "index.js": `\
export { a } from './a.js';
export { b } from './b.js';
`,

  "app.js": `\
import { a, b } from '.';

function run() {
  a();
  b();
}
run();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Barrel re-exports — edges to defining file", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-barrel-reexport-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "javascript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run() in app.js has CALLS edge to a() in a.js", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsA = callEdges.some((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return src?.includes("app.js") && tgt?.includes("a.js") && !tgt?.includes("b.js");
    });
    expect(appCallsA, "a() call must resolve to a.js::a").toBe(true);
  });

  it("run() in app.js has CALLS edge to b() in b.js", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsB = callEdges.some((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return src?.includes("app.js") && tgt?.includes("b.js");
    });
    expect(appCallsB, "b() call must resolve to b.js::b").toBe(true);
  });
});
