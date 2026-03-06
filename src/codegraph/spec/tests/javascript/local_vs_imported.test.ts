/**
 * Local variable must not resolve to another file's export.
 * session.js imports run_services and lint; has local const health = '...'.
 * health.js exports function health(). Must NOT create any edge from session.js to health.js.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "session.js": `\
import { run_services } from './run_infrastructure.js';
import { lint } from './utils_nox.js';

function session_ok(s) {
  run_services(s);
  lint(s);
}

function session_ambiguous(s) {
  const health = 'http://localhost:8000/health';
  run_services(s, health);
}
`,

  "run_infrastructure.js": `\
export function run_services(session, health_endpoint) {}
`,

  "utils_nox.js": `\
export function lint(session) {}
`,

  "health.js": `\
export function health() {
  return 'ok';
}
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Local vs imported — no cross-file edge for local name", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-local-vs-imported-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "javascript");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has edges from session.js to run_infrastructure.js and utils_nox.js", () => {
    const edgesFromSession = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      return srcFile?.includes("session.js");
    });
    const toRunInfra = edgesFromSession.some((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("run_infrastructure.js");
    });
    const toUtils = edgesFromSession.some((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("utils_nox.js");
    });
    expect(toRunInfra, "session.js should reference run_infrastructure.js").toBe(true);
    expect(toUtils, "session.js should reference utils_nox.js").toBe(true);
  });

  it("must NOT create any edge from session.js to health.js", () => {
    const badEdges = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return srcFile?.includes("session.js") && tgtFile?.includes("health.js");
    });
    expect(
      badEdges,
      "Local variable 'health' in session_ambiguous must not resolve to health(); no edge to health.js",
    ).toHaveLength(0);
  });
});
