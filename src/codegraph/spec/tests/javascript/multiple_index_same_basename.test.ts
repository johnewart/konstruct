/**
 * Two index.js in different dirs must be distinct (utils/index.js vs components/index.js).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "utils/index.js": `\
export function util() {
  return 1;
}
`,

  "components/index.js": `\
export function comp() {
  return 2;
}
`,

  "app.js": `\
import { util } from './utils';
import { comp } from './components';

function main() {
  util();
  comp();
}
main();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Multiple index.js — distinct paths for utils vs components", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-multi-index-"));
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

  it("has two distinct nodes for util and comp (different file paths)", () => {
    const nodesWithUtil = [...graph.nodes.entries()].filter(
      ([id, def]) => def.name === "util" || id.includes("util"),
    );
    const nodesWithComp = [...graph.nodes.entries()].filter(
      ([id, def]) => def.name === "comp" || id.includes("comp"),
    );
    const utilFiles = new Set(nodesWithUtil.map(([, def]) => def.location.file));
    const compFiles = new Set(nodesWithComp.map(([, def]) => def.location.file));
    expect(utilFiles.size, "util should come from one file (utils/index.js)").toBeGreaterThanOrEqual(1);
    expect(compFiles.size, "comp should come from one file (components/index.js)").toBeGreaterThanOrEqual(1);
    // The two files should be different
    const utilFile = [...utilFiles][0];
    const compFile = [...compFiles][0];
    expect(utilFile).toMatch(/utils/);
    expect(compFile).toMatch(/components/);
  });

  it("app.js has edges to both utils and components", () => {
    const edgesFromApp = graph.edges.filter((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      return src?.includes("app.js");
    });
    const toUtils = edgesFromApp.some((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("utils");
    });
    const toComponents = edgesFromApp.some((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("components");
    });
    expect(toUtils, "app.js should depend on utils").toBe(true);
    expect(toComponents, "app.js should depend on components").toBe(true);
  });
});
