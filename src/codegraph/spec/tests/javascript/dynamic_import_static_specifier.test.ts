/**
 * import('./lazy') with static specifier: either edge to lazy.js or document no edge.
 * This test documents expected behavior; implementation may support dynamic import or not.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "lazy.js": `\
export function run() {
  return 1;
}
`,

  "main.js": `\
function load() {
  return import('./lazy.js').then(m => m.run());
}
load();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Dynamic import (static specifier) — import('./lazy.js')", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-dynamic-import-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "javascript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("graph contains nodes from both main.js and lazy.js", () => {
    const nodeIds = [...graph.nodes.keys()];
    const hasMain = nodeIds.some((id) => id.includes("main"));
    const hasLazy = nodeIds.some((id) => id.includes("lazy"));
    expect(hasMain && hasLazy, "Both files should be in the graph").toBe(true);
  });

  it("if dynamic import is supported: main.js has edge to lazy.js; otherwise no false edge", () => {
    const edgesFromMain = graph.edges.filter((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      return src?.includes("main.js");
    });
    const toLazy = edgesFromMain.filter((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("lazy.js");
    });
    // Either we have an edge to lazy (implementation supports dynamic import) or we don't.
    // We must not have a wrong edge (e.g. to some other symbol as if 'run' were from main).
    const toWrong = edgesFromMain.some((e) => {
      const tgtDef = graph.nodes.get(e.target_symbol_path);
      return tgtDef?.name === "run" && !getFileFromSymbolPath(graph, e.target_symbol_path)?.includes("lazy");
    });
    expect(toWrong, "Must not create false edge to wrong run()").toBe(false);
  });
});
