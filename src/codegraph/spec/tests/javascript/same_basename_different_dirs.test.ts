/**
 * Same basename in different dirs: a/foo.js and b/foo.js both export bar();
 * main.js imports from './a/foo' and calls bar(). Edge must go to a/foo.js::bar, not b/foo.js::bar.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "a/foo.js": `\
export function bar() {
  return 1;
}
`,

  "b/foo.js": `\
export function bar() {
  return 2;
}
`,

  "main.js": `\
import { bar } from './a/foo.js';

function run() {
  bar();
}
run();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Same basename different dirs — edge to correct file", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-same-basename-"));
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

  it("has two distinct bar symbols (one in a/foo.js, one in b/foo.js)", () => {
    const barNodes = [...graph.nodes.entries()].filter(
      ([id, def]) => def.name === "bar" && (id.includes("foo") || id.includes("a") || id.includes("b")),
    );
    const files = new Set(barNodes.map(([, def]) => def.location.file));
    expect(files.size, "bar() defined in both a/foo.js and b/foo.js must be two distinct nodes").toBe(
      2,
    );
  });

  it("main.js imports from a/foo so edge goes to a/foo.js, not b/foo.js", () => {
    const edgesFromMain = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      return srcFile?.includes("main.js");
    });
    const edgeToA = edgesFromMain.find((e) => {
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return (
        tgtFile?.includes(path.join("a", "foo")) ||
        tgtFile?.includes("a" + path.sep + "foo") ||
        (tgtFile?.includes("a") && tgtFile?.includes("foo"))
      );
    });
    const edgeToB = edgesFromMain.find((e) => {
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return (
        tgtFile?.includes(path.join("b", "foo")) ||
        tgtFile?.includes("b" + path.sep + "foo")
      );
    });
    expect(
      edgeToA,
      "main.js imports from './a/foo' and calls bar() — must have edge to bar in a/foo.js",
    ).toBeDefined();
    expect(
      edgeToB,
      "main.js does not import from b/foo — must NOT have edge to bar in b/foo.js",
    ).toBeUndefined();
  });
});
