/**
 * Proves that symbol paths use full (or project-relative) file paths, not just
 * the filename. Two files with the same basename in different dirs must
 * remain distinct, and imports must resolve to the correct file.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "a/foo.py": `\
def bar():
    return 1
`,

  "b/foo.py": `\
def bar():
    return 2
`,

  "main.py": `\
from a.foo import bar
bar()
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Full path resolution — same basename in different dirs", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "full-path-resolution-"));
    for (const [relPath, content] of Object.entries(SOURCE_FILES)) {
      const fullPath = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((rel) => path.join(tmpDir, rel));
    graph = analyzer.analyze_files(filePaths, "python");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has two distinct bar symbols (one in a/foo.py, one in b/foo.py)", () => {
    const barNodes = [...graph.nodes.entries()].filter(
      ([id, def]) => def.name === "bar" && id.includes("foo")
    );
    const files = new Set(barNodes.map(([, def]) => def.location.file));
    expect(
      files.size,
      "bar() defined in both a/foo.py and b/foo.py must be two distinct nodes (different paths)"
    ).toBe(2);
    expect(files.has(path.join(tmpDir, "a", "foo.py"))).toBe(true);
    expect(files.has(path.join(tmpDir, "b", "foo.py"))).toBe(true);
  });

  it("main.py imports and calls bar from a.foo, so edge goes to a/foo.py not b/foo.py", () => {
    const edgesFromMain = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      return srcFile?.includes("main.py");
    });
    const edgeToA = edgesFromMain.find((e) => {
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgtFile?.includes(path.join("a", "foo.py")) || tgtFile?.includes("a" + path.sep + "foo.py");
    });
    const edgeToB = edgesFromMain.find((e) => {
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgtFile?.includes(path.join("b", "foo.py")) || tgtFile?.includes("b" + path.sep + "foo.py");
    });
    expect(
      edgeToA,
      "main.py does 'from a.foo import bar' and calls bar() — must have edge to bar in a/foo.py"
    ).toBeDefined();
    expect(
      edgeToB,
      "main.py does not import from b.foo — must NOT have edge to bar in b/foo.py"
    ).toBeUndefined();
  });
});
