/**
 * Proves that "from pkg import X" resolves to pkg/__init__.py when X is defined
 * there (Python package), not only to pkg.py. Without this, the config package
 * (fides.config) would never appear as a dependency.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

const SOURCE_FILES: Record<string, string> = {
  "pkg/__init__.py": `\
CONFIG = "default"

def get_config():
    return CONFIG
`,

  "app.py": `\
from pkg import CONFIG, get_config

def main():
    print(CONFIG)
    get_config()
`,
};

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

describe("Package __init__.py import resolution", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-init-import-"));
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

  it("has an edge from app.py to pkg/__init__.py when importing from package", () => {
    const initPyPath = path.join("pkg", "__init__.py");
    const edgesFromApp = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      return srcFile?.includes("app.py");
    });
    const edgeToPkgInit = edgesFromApp.find((e) => {
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return (
        tgtFile?.includes(initPyPath) ||
        tgtFile?.includes("pkg" + path.sep + "__init__.py")
      );
    });
    expect(
      edgeToPkgInit,
      "app.py does 'from pkg import CONFIG, get_config' — must have edge to symbol in pkg/__init__.py (package)"
    ).toBeDefined();
  });
});

/**
 * Proves that "from package import submodule_a, submodule_b" resolves each name to the
 * corresponding submodule file (e.g. endpoints/config_endpoints.py), not to the package __init__.py.
 * Fixes the case where api.py imports from fides.api.api.v1.endpoints and should show
 * edges to config_endpoints.py, connection_endpoints.py, etc.
 */
const ENDPOINT_FILES: Record<string, string> = {
  "endpoints/__init__.py": "",
  "endpoints/config_endpoints.py": "def get_config(): pass",
  "endpoints/connection_endpoints.py": "def list_connections(): pass",
  "api.py": `\
from endpoints import config_endpoints, connection_endpoints

def setup():
    config_endpoints.get_config()
    connection_endpoints.list_connections()
`,
};

describe("Package submodule import resolution", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-submodule-"));
    for (const [relPath, content] of Object.entries(ENDPOINT_FILES)) {
      const fullPath = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }
    const filePaths = Object.keys(ENDPOINT_FILES).map((rel) => path.join(tmpDir, rel));
    graph = analyzer.analyze_files(filePaths, "python");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has edges from api.py to each endpoint submodule file (config_endpoints, connection_endpoints)", () => {
    const edgesFromApi = graph.edges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      return srcFile?.includes("api.py");
    });
    const toConfigEndpoints = edgesFromApi.some((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("config_endpoints.py") ?? false;
    });
    const toConnectionEndpoints = edgesFromApi.some((e) => {
      const tgt = getFileFromSymbolPath(graph, e.target_symbol_path);
      return tgt?.includes("connection_endpoints.py") ?? false;
    });
    expect(toConfigEndpoints, "api.py imports config_endpoints — must have edge to endpoints/config_endpoints.py").toBe(
      true
    );
    expect(toConnectionEndpoints, "api.py imports connection_endpoints — must have edge to endpoints/connection_endpoints.py").toBe(
      true
    );
  });
});
