/**
 * import type { T } creates no runtime dependency; import { doSomething } and calling it must create edge.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "types.ts": `\
export type Config = { x: number };

export function doSomething() {
  return 1;
}
`,

  "app.ts": `\
import type { Config } from './types';
import { doSomething } from './types';

function run() {
  doSomething();
}
run();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Type-only imports — value import creates edge, type-only does not", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-type-only-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "typescript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run() in app.ts has CALLS edge to doSomething in types.ts", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsDoSomething = callEdges.some((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return src?.includes("app.ts") && tgt?.includes("types.ts");
    });
    expect(
      appCallsDoSomething,
      "doSomething() call must create CALLS edge to types.ts::doSomething",
    ).toBe(true);
  });

  it("app.ts has IMPORTS edge to types.ts (for doSomething)", () => {
    const importEdges = graph.edges.filter((e) => e.edge_type === DependencyType.IMPORTS);
    const appImportsTypes = importEdges.some((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return src?.includes("app.ts") && tgt?.includes("types.ts");
    });
    expect(appImportsTypes, "import { doSomething } must create IMPORTS edge").toBe(true);
  });
});
