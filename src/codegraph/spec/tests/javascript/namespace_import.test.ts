/**
 * import * as ns from './m'; ns.foo() must resolve to m.js::foo.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "m.js": `\
export function foo() {
  return 1;
}
export function bar() {
  return 2;
}
`,

  "app.js": `\
import * as ns from './m.js';

function run() {
  ns.foo();
}
run();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Namespace import — ns.foo() resolves to m.js::foo", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-namespace-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "javascript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run() in app.js has CALLS edge to foo in m.js", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsFoo = callEdges.some((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return src?.includes("app.js") && tgt?.includes("m.js");
    });
    expect(appCallsFoo, "ns.foo() must create CALLS edge to m.js::foo").toBe(true);
  });

  it("no CALLS edge from app.js to bar (bar not used)", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsBar = callEdges.some((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtPath = graph.nodes.get(e.target_symbol_path);
      return src?.includes("app.js") && tgtPath?.name === "bar";
    });
    expect(appCallsBar, "bar is not called; should not have CALLS edge").toBe(false);
  });
});
