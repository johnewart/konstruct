/**
 * Import from directory must resolve to dir/index.js (barrel).
 * app.js imports from './services' where services/index.js exists.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "services/index.js": `\
export function start() {
  return 'ok';
}
`,

  "app.js": `\
import { start } from './services';

function main() {
  start();
}
main();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Index barrel — './services' resolves to services/index.js", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-index-barrel-"));
    for (const [relPath, content] of Object.entries(SOURCE_FILES)) {
      const fullPath = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((rel) => path.join(tmpDir, rel));
    graph = analyzer.analyze_files(filePaths, "javascript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has edge from app.js to services/index.js (path must be distinct)", () => {
    const edgesFromApp = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      return srcFile?.includes("app.js");
    });
    const toServicesIndex = edgesFromApp.some((e) => {
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return (
        tgtFile?.includes("services") &&
        (tgtFile?.includes("index.js") || tgtFile?.endsWith(path.join("services", "index.js")))
      );
    });
    expect(
      toServicesIndex,
      "import from './services' must resolve to services/index.js",
    ).toBe(true);
  });

  it("main() in app.js has CALLS edge to start in services/index.js", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsStart = callEdges.some((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return src?.includes("app.js") && tgt?.includes("services") && tgt?.includes("index");
    });
    expect(appCallsStart, "start() must create CALLS edge to services/index.js::start").toBe(
      true,
    );
  });
});
