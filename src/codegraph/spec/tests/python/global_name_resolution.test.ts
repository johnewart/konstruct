/**
 * Tests that name resolution does not create cross-file edges for names that are
 * only local variables (or that are not imported). In Python, a name in file A
 * can only refer to something in file B if it was imported; we must not resolve
 * by global name lookup across the codebase.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

// Flat layout so import table resolves (analyzer uses basename: run_infrastructure.py, utils_nox.py).
// health.py defines health(); session.py uses local variable "health" -> must not edge to health.py.
const SOURCE_FILES: Record<string, string> = {
  "session.py": `\
from run_infrastructure import run_services
from utils_nox import lint

def session_ok(session):
    """Uses imported names only -> edges to run_infrastructure and utils_nox allowed."""
    run_services(session)
    lint(session)

def session_ambiguous(session):
    """Uses 'health' as local only -> must NOT edge to app's health()."""
    health = "http://localhost:8000/health"
    run_services(session, health_endpoint=health)
`,

  "run_infrastructure.py": `\
def run_services(session, health_endpoint=None):
    pass
`,

  "utils_nox.py": `\
def lint(session):
    pass
`,

  "health.py": `\
def health():
    return "ok"
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Global name resolution — no cross-file edges for locals", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "global-name-resolution-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) => path.join(tmpDir, f));
    graph = analyzer.analyze_files(filePaths, "python");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has edges from session.py to run_infrastructure and utils_nox (imports/calls)", () => {
    const edgesToRunInfra = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return srcFile?.includes("session.py") && tgtFile?.includes("run_infrastructure.py");
    });
    const edgesToUtils = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return srcFile?.includes("session.py") && tgtFile?.includes("utils_nox.py");
    });
    expect(edgesToRunInfra.length, "session.py should reference run_infrastructure.py").toBeGreaterThan(0);
    expect(edgesToUtils.length, "session.py should reference utils_nox.py").toBeGreaterThan(0);
  });

  it("must NOT create any edge from session.py to health.py (local 'health' must not resolve to app)", () => {
    const badEdges = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return srcFile?.includes("session.py") && tgtFile?.includes("health.py");
    });
    expect(
      badEdges,
      "Local variable 'health' in session_ambiguous must not resolve to health(); no edge from session.py to health.py"
    ).toHaveLength(0);
  });
});
