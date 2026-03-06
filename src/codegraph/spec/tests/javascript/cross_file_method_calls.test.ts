/**
 * Cross-file method calls: when app.js does service.get_user(1) where service
 * is an instance of a class from another file, the graph must have a CALLS edge
 * to that class's method (e.g. UserService.get_user in services.js).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

function getFileFromSymbolPath(graph: DependencyGraph, symbolPath: string): string | undefined {
  const def = graph.nodes.get(symbolPath);
  return def?.location?.file;
}

function writeAndAnalyze(
  tmpDir: string,
  sourceFiles: Record<string, string>,
): { graph: DependencyGraph; tmpDir: string } {
  for (const [relPath, content] of Object.entries(sourceFiles)) {
    const fullPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }
  const filePaths = Object.keys(sourceFiles).map((rel) => path.join(tmpDir, rel));
  const graph = analyzer.analyze_files(filePaths, "javascript");
  return { graph, tmpDir };
}

// ─── 1. Basic: instance in local variable, then method call ─────────────────

const BASIC_METHOD_FILES: Record<string, string> = {
  "services.js": `\
export class UserService {
  get_user(id) {
    return null;
  }
}
`,

  "app.js": `\
import { UserService } from './services.js';

function run() {
  const service = new UserService();
  service.get_user(1);
}
run();
`,
};

describe("Cross-file method calls — basic (instance then method)", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-method-basic-"));
    const result = writeAndAnalyze(tmpDir, BASIC_METHOD_FILES);
    graph = result.graph;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has a symbol for UserService.get_user in services.js", () => {
    const methodNodes = [...graph.nodes.entries()].filter(
      ([id, def]) =>
        def.name === "get_user" &&
        (id.includes("UserService") || def.scope?.includes("UserService")),
    );
    const inServices = methodNodes.some(
      ([, def]) => def.location.file?.includes("services.js") ?? false,
    );
    expect(
      methodNodes.length >= 1 && inServices,
      "Graph should contain UserService.get_user from services.js",
    ).toBe(true);
  });

  it("run() in app.js has CALLS edge to UserService.get_user in services.js", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsGetUser = callEdges.some((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      const tgtDef = graph.nodes.get(e.target_symbol_path);
      return (
        srcFile?.includes("app.js") &&
        tgtFile?.includes("services.js") &&
        tgtDef?.name === "get_user"
      );
    });
    expect(
      appCallsGetUser,
      "service.get_user(1) in app.js should create CALLS edge to UserService.get_user in services.js",
    ).toBe(true);
  });
});

// ─── 2. Method on returned object: factory returns instance, then method ────

const FACTORY_RETURNS_INSTANCE_FILES: Record<string, string> = {
  "services.js": `\
export class UserService {
  get_user(id) {
    return null;
  }
}

export function createUserService() {
  return new UserService();
}
`,

  "app.js": `\
import { createUserService } from './services.js';

function run() {
  const service = createUserService();
  service.get_user(1);
}
run();
`,
};

describe("Cross-file method calls — method on factory-returned instance", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-method-factory-"));
    const result = writeAndAnalyze(tmpDir, FACTORY_RETURNS_INSTANCE_FILES);
    graph = result.graph;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run() in app.js has CALLS edge to UserService.get_user when calling service.get_user() after createUserService()", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsGetUser = callEdges.some((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtDef = graph.nodes.get(e.target_symbol_path);
      return (
        srcFile?.includes("app.js") &&
        tgtDef?.name === "get_user" &&
        (e.target_symbol_path.includes("services") || (tgtDef?.location?.file?.includes("services.js") ?? false))
      );
    });
    expect(
      appCallsGetUser,
      "service.get_user(1) where service = createUserService() should create CALLS edge to UserService.get_user",
    ).toBe(true);
  });
});

// ─── 3. Chained method calls: a.getRepo().findById(1) ───────────────────────

const CHAINED_METHOD_FILES: Record<string, string> = {
  "repo.js": `\
export class UserRepository {
  find_by_id(id) {
    return null;
  }
}
`,

  "services.js": `\
import { UserRepository } from './repo.js';

export class UserService {
  constructor() {
    this.repo = new UserRepository();
  }
  get_repo() {
    return this.repo;
  }
}
`,

  "app.js": `\
import { UserService } from './services.js';

function run() {
  const service = new UserService();
  const repo = service.get_repo();
  repo.find_by_id(1);
}
run();
`,
};

describe("Cross-file method calls — chained (service.get_repo().find_by_id)", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-method-chained-"));
    const result = writeAndAnalyze(tmpDir, CHAINED_METHOD_FILES);
    graph = result.graph;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run() in app.js has CALLS edge to UserRepository.find_by_id when calling repo.find_by_id(1)", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsFindById = callEdges.some((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtDef = graph.nodes.get(e.target_symbol_path);
      return (
        srcFile?.includes("app.js") &&
        tgtDef?.name === "find_by_id" &&
        (e.target_symbol_path.includes("repo") || (tgtDef?.location?.file?.includes("repo.js") ?? false))
      );
    });
    expect(
      appCallsFindById,
      "repo.find_by_id(1) where repo = service.get_repo() should create CALLS edge to UserRepository.find_by_id in repo.js",
    ).toBe(true);
  });
});

// ─── 4. Two classes with same method name — edge to correct class ───────────

const SAME_METHOD_NAME_FILES: Record<string, string> = {
  "admin.js": `\
export class AdminService {
  get_user(id) {
    return null;
  }
}
`,

  "user.js": `\
export class UserService {
  get_user(id) {
    return null;
  }
}
`,

  "app.js": `\
import { UserService } from './user.js';

function run() {
  const service = new UserService();
  service.get_user(1);
}
run();
`,
};

describe("Cross-file method calls — same method name on different classes", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-method-same-name-"));
    const result = writeAndAnalyze(tmpDir, SAME_METHOD_NAME_FILES);
    graph = result.graph;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run() in app.js has CALLS edge to UserService.get_user in user.js, not AdminService.get_user in admin.js", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const toUserServiceMethod = callEdges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtDef = graph.nodes.get(e.target_symbol_path);
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return (
        srcFile?.includes("app.js") &&
        tgtDef?.name === "get_user" &&
        (tgtFile?.includes("user.js") ?? false) &&
        (e.target_symbol_path.includes("UserService") || tgtDef?.scope?.includes("UserService"))
      );
    });
    const toAdminServiceMethod = callEdges.filter((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return srcFile?.includes("app.js") && tgtFile?.includes("admin.js");
    });
    expect(toUserServiceMethod.length >= 1, "Should have edge to UserService.get_user in user.js").toBe(true);
    expect(toAdminServiceMethod.length, "Should NOT have edge to admin.js (we only use UserService)").toBe(0);
  });
});

// ─── 5. Method call with no args: config.getDebug() ────────────────────────

const METHOD_NO_ARGS_FILES: Record<string, string> = {
  "config.js": `\
export class Config {
  get_debug() {
    return false;
  }
}
`,

  "app.js": `\
import { Config } from './config.js';

function run() {
  const config = new Config();
  const debug = config.get_debug();
}
run();
`,
};

describe("Cross-file method calls — method with no arguments", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "js-method-no-args-"));
    const result = writeAndAnalyze(tmpDir, METHOD_NO_ARGS_FILES);
    graph = result.graph;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run() in app.js has CALLS edge to Config.get_debug in config.js", () => {
    const callEdges = graph.edges.filter((e) => e.edge_type === DependencyType.CALLS);
    const appCallsGetDebug = callEdges.some((e) => {
      const srcFile = getFileFromSymbolPath(graph, e.source_symbol_path);
      const tgtDef = graph.nodes.get(e.target_symbol_path);
      const tgtFile = getFileFromSymbolPath(graph, e.target_symbol_path);
      return (
        srcFile?.includes("app.js") &&
        tgtFile?.includes("config.js") &&
        tgtDef?.name === "get_debug"
      );
    });
    expect(
      appCallsGetDebug,
      "config.get_debug() should create CALLS edge to Config.get_debug in config.js",
    ).toBe(true);
  });
});
