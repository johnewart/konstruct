/**
 * <Button /> in TSX must create ref to Button (imported from './Button').
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "Button.tsx": `\
export function Button() {
  return null;
}
`,

  "App.tsx": `\
import { Button } from './Button';

export function App() {
  return <Button />;
}
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("TSX component refs — <Button /> resolves to Button symbol", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsx-components-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "typescript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has edge from App.tsx to Button.tsx", () => {
    const edgesFromApp = graph.edges.filter((e) => {
      const src = getFileFromSymbolPath(graph, e.source_symbol_path);
      return src?.includes("App.tsx");
    });
    const toButton = edgesFromApp.some((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("Button.tsx");
    });
    expect(toButton, "App uses <Button /> so must have edge to Button.tsx").toBe(true);
  });

  it("App component has reference to Button (INSTANTIATES or REFERENCES)", () => {
    const appNode = [...graph.nodes.entries()].find(
      ([, def]) => def.name === "App" && def.location.file?.includes("App.tsx"),
    );
    expect(appNode, "App symbol should exist").toBeDefined();
    const edgesFromApp = graph.edges.filter(
      (e) => e.source_symbol_path === appNode![0] || getFileFromSymbolPath(graph, e.source_symbol_path)?.includes("App.tsx"),
    );
    const toButton = edgesFromApp.some((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("Button");
    });
    expect(toButton, "App should reference Button component").toBe(true);
  });
});
