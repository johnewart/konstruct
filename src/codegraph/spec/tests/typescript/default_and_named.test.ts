/**
 * Default export must have stable symbol id; named and default from same module both create edges.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "config.ts": `\
export const MAX = 10;

export default class Config {
  constructor(public n: number) {}
}
`,

  "main.ts": `\
import Config from './config';
import { MAX } from './config';

function run() {
  const c = new Config(MAX);
}
run();
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Default and named exports — stable default id, both create edges", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-default-named-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "typescript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("config.ts has a node for the default export (Config class)", () => {
    const configNodes = [...graph.nodes.entries()].filter(([id, def]) => {
      const file = def.location.file;
      return file?.includes("config.ts") && (def.name === "Config" || id.includes("default"));
    });
    expect(
      configNodes.length,
      "Default export (Config) must have a symbol in the graph",
    ).toBeGreaterThanOrEqual(1);
  });

  it("main.ts has edge to config.ts for both Config and MAX", () => {
    const edgesFromMain = graph.edges.filter((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      return src?.includes("main.ts");
    });
    const toConfig = edgesFromMain.filter((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("config.ts");
    });
    expect(toConfig.length, "main.ts should depend on config.ts (Config and MAX)").toBeGreaterThanOrEqual(
      1,
    );
  });

  it("main.ts has INSTANTIATES edge to Config", () => {
    const instantiateEdges = graph.edges.filter((e) => e.edge_type === DependencyType.INSTANTIATES);
    const mainInstantiatesConfig = instantiateEdges.some((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return src?.includes("main.ts") && tgt?.includes("config.ts");
    });
    expect(mainInstantiatesConfig, "new Config(MAX) must create INSTANTIATES edge").toBe(true);
  });
});
