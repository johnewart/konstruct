// multi-file.dependency-graph.test.ts
// Tests that DependencyGraphBuilder correctly unifies four interconnected Python
// files into a single graph with accurate cross-file and intra-file edges.

import { describe, it, expect, beforeAll, afterAll } from "vitest"; // or swap for "jest"
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DependencyGraph } from "../../graph.spec";
import { DependencyType, DependencyTypeName, SymbolKind } from "../../graph.spec";
import { analyzer } from "../../../analyzer";

// ─── Source fixtures ──────────────────────────────────────────────────────────
// Four files forming a layered architecture:
//   config.py  ←  models.py  ←  services.py  ←  app.py

const SOURCE_FILES: Record<string, string> = {

  // Leaf layer: pure constants + Config class, no imports from sibling files.
  "config.py": `\
# config.py
MAX_CONNECTIONS = 10
DEFAULT_TIMEOUT = 30.0
APP_NAME = "MyApp"

class Config:
    def __init__(self, debug: bool = False):
        self.debug = debug
        self.max_connections = MAX_CONNECTIONS
        self.timeout = DEFAULT_TIMEOUT

    def is_debug(self) -> bool:
        return self.debug
`,

  // Data layer: imports Config + MAX_CONNECTIONS from config.
  "models.py": `\
# models.py
from config import Config, MAX_CONNECTIONS


class User:
    def __init__(self, user_id: int, name: str):
        self.user_id = user_id
        self.name = name

    def to_dict(self) -> dict:
        return {"id": self.user_id, "name": self.name}


class UserRepository:
    def __init__(self, config: Config):
        self.config = config
        self.max_users = MAX_CONNECTIONS

    def find_by_id(self, user_id: int) -> User:
        return User(user_id, "Unknown")

    def save(self, user: User) -> bool:
        return True
`,

  // Service layer: imports Config from config, User+UserRepository from models.
  "services.py": `\
# services.py
from config import Config
from models import User, UserRepository


class UserService:
    def __init__(self, config: Config):
        self.repo = UserRepository(config)

    def get_user(self, user_id: int) -> User:
        return self.repo.find_by_id(user_id)

    def update_user(self, user_id: int, name: str) -> bool:
        user = self.repo.find_by_id(user_id)
        user.name = name
        return self.repo.save(user)


def create_service(config: Config) -> UserService:
    return UserService(config)
`,

  // Entry point: imports from all three layers.
  "app.py": `\
# app.py
from config import Config, APP_NAME
from models import User
from services import UserService, create_service


def run(debug: bool = False):
    config = Config(debug)
    service = create_service(config)
    user = service.get_user(1)
    print(f"{APP_NAME}: Found user {user.to_dict()}")


def main():
    run(debug=True)


if __name__ == "__main__":
    main()
`,
};

// ─── Expected symbol paths ────────────────────────────────────────────────────

const PATHS = {
  // ── config.py (6 symbols) ──
  MAX_CONNECTIONS:  "file://config.py::MAX_CONNECTIONS",
  DEFAULT_TIMEOUT:  "file://config.py::DEFAULT_TIMEOUT",
  APP_NAME:         "file://config.py::APP_NAME",
  Config:           "file://config.py::Config",
  Config_init:      "file://config.py::Config.__init__",
  Config_is_debug:  "file://config.py::Config.is_debug",

  // ── models.py (7 symbols) ──
  User:             "file://models.py::User",
  User_init:        "file://models.py::User.__init__",
  User_to_dict:     "file://models.py::User.to_dict",
  UserRepository:   "file://models.py::UserRepository",
  UserRepo_init:    "file://models.py::UserRepository.__init__",
  UserRepo_find:    "file://models.py::UserRepository.find_by_id",
  UserRepo_save:    "file://models.py::UserRepository.save",

  // ── services.py (5 symbols) ──
  UserService:      "file://services.py::UserService",
  UserSvc_init:     "file://services.py::UserService.__init__",
  UserSvc_get:      "file://services.py::UserService.get_user",
  UserSvc_update:   "file://services.py::UserService.update_user",
  create_service:   "file://services.py::create_service",

  // ── app.py (2 symbols) ──
  run:              "file://app.py::run",
  main:             "file://app.py::main",
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findEdges(
  graph: DependencyGraph,
  source: string,
  target: string,
  type?: DependencyType,
) {
  return graph.edges.filter(
    (e) =>
      e.source_symbol_path === source &&
      e.target_symbol_path === target &&
      (type === undefined || e.edge_type === type),
  );
}

/** Asserts exactly one matching edge exists and returns it. */
function getEdge(
  graph: DependencyGraph,
  source: string,
  target: string,
  type: DependencyType,
) {
  const matches = findEdges(graph, source, target, type);
  expect(
    matches.length,
    `Expected exactly one ${DependencyTypeName[type]} edge:\n  ${source}\n→ ${target}`,
  ).toBe(1);
  return matches[0];
}

/** Find ANY edge from a file prefix to a target path with the given type. */
function findCrossFileImport(
  graph: DependencyGraph,
  sourceFilePrefix: string,
  targetPath: string,
) {
  return graph.edges.find(
    (e) =>
      e.source_symbol_path.startsWith(sourceFilePrefix) &&
      e.target_symbol_path === targetPath &&
      e.edge_type === DependencyType.IMPORTS,
  );
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("DependencyGraphBuilder — four-file Python project", () => {
  let graph: DependencyGraph;
  let tmpDir: string;

  beforeAll(() => {
    // Write source files into a temp directory so analyze_files gets real paths.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-graph-multifile-"));
    for (const [filename, content] of Object.entries(SOURCE_FILES)) {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
    }
    const filePaths = Object.keys(SOURCE_FILES).map((f) =>
      path.join(tmpDir, f),
    );
    graph = analyzer.analyze_files(filePaths, "python");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Graph shape ──────────────────────────────────────────────────────────

  describe("graph shape", () => {
    it("produces a valid graph object with required keys", () => {
      expect(graph).toBeDefined();
      expect(graph.nodes).toBeInstanceOf(Map);
      expect(graph.edges).toBeInstanceOf(Array);
      expect(graph.name_to_symbol_map).toBeInstanceOf(Map);
      expect(graph.metadata).toBeInstanceOf(Map);
    });

    it("contains all 20 expected named symbols", () => {
      for (const p of Object.values(PATHS)) {
        expect(graph.nodes.has(p), `Missing node: ${p}`).toBe(true);
      }
    });

    // Allow ≥ 20 because implementations may also emit module-level nodes.
    it("contains at least 20 nodes", () => {
      expect(graph.nodes.size).toBeGreaterThanOrEqual(20);
    });

    it("every node's id matches its map key", () => {
      for (const [key, sym] of graph.nodes) {
        expect(sym.id, `id/key mismatch at "${key}"`).toBe(key);
      }
    });

    it("every node has a non-empty ast_node_id", () => {
      for (const [key, sym] of graph.nodes) {
        expect(sym.ast_node_id, `Missing ast_node_id on "${key}"`).toBeTruthy();
      }
    });
  });

  // ── 2. Node details ─────────────────────────────────────────────────────────

  describe("nodes — config.py", () => {
    it("MAX_CONNECTIONS is a CONSTANT at module scope on line 2", () => {
      const s = graph.nodes.get(PATHS.MAX_CONNECTIONS)!;
      expect(s.kind).toBe(SymbolKind.CONSTANT);
      expect(s.scope).toBe("config");
      expect(s.location.file).toMatch(/config\.py$/);
      expect(s.location.line).toBe(2);
      expect(s.location.column).toBe(0);
    });

    it("DEFAULT_TIMEOUT is a CONSTANT at module scope on line 3", () => {
      const s = graph.nodes.get(PATHS.DEFAULT_TIMEOUT)!;
      expect(s.kind).toBe(SymbolKind.CONSTANT);
      expect(s.scope).toBe("config");
      expect(s.location.line).toBe(3);
    });

    it("APP_NAME is a CONSTANT at module scope on line 4", () => {
      const s = graph.nodes.get(PATHS.APP_NAME)!;
      expect(s.kind).toBe(SymbolKind.CONSTANT);
      expect(s.scope).toBe("config");
      expect(s.location.line).toBe(4);
    });

    it("Config is a CLASS at module scope starting on line 6", () => {
      const s = graph.nodes.get(PATHS.Config)!;
      expect(s.kind).toBe(SymbolKind.CLASS);
      expect(s.scope).toBe("config");
      expect(s.location.line).toBe(6);
      expect(s.location.column).toBe(0);
    });

    it("Config.__init__ is a FUNCTION in Config scope on line 7", () => {
      const s = graph.nodes.get(PATHS.Config_init)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("config.Config");
      expect(s.location.line).toBe(7);
    });

    it("Config.is_debug is a FUNCTION in Config scope on line 12", () => {
      const s = graph.nodes.get(PATHS.Config_is_debug)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("config.Config");
      expect(s.location.line).toBe(12);
    });
  });

  describe("nodes — models.py", () => {
    it("User is a CLASS at module scope on line 5", () => {
      const s = graph.nodes.get(PATHS.User)!;
      expect(s.kind).toBe(SymbolKind.CLASS);
      expect(s.scope).toBe("models");
      expect(s.location.file).toMatch(/models\.py$/);
      expect(s.location.line).toBe(5);
    });

    it("User.__init__ is a FUNCTION in User scope on line 6", () => {
      const s = graph.nodes.get(PATHS.User_init)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("models.User");
      expect(s.location.line).toBe(6);
    });

    it("User.to_dict is a FUNCTION in User scope on line 10", () => {
      const s = graph.nodes.get(PATHS.User_to_dict)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("models.User");
      expect(s.location.line).toBe(10);
    });

    it("UserRepository is a CLASS at module scope on line 14", () => {
      const s = graph.nodes.get(PATHS.UserRepository)!;
      expect(s.kind).toBe(SymbolKind.CLASS);
      expect(s.scope).toBe("models");
      expect(s.location.line).toBe(14);
    });

    it("UserRepository.__init__ is a FUNCTION in UserRepository scope on line 15", () => {
      const s = graph.nodes.get(PATHS.UserRepo_init)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("models.UserRepository");
      expect(s.location.line).toBe(15);
    });

    it("UserRepository.find_by_id is a FUNCTION in UserRepository scope on line 19", () => {
      const s = graph.nodes.get(PATHS.UserRepo_find)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("models.UserRepository");
      expect(s.location.line).toBe(19);
    });

    it("UserRepository.save is a FUNCTION in UserRepository scope on line 22", () => {
      const s = graph.nodes.get(PATHS.UserRepo_save)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("models.UserRepository");
      expect(s.location.line).toBe(22);
    });
  });

  describe("nodes — services.py", () => {
    it("UserService is a CLASS at module scope on line 6", () => {
      const s = graph.nodes.get(PATHS.UserService)!;
      expect(s.kind).toBe(SymbolKind.CLASS);
      expect(s.scope).toBe("services");
      expect(s.location.file).toMatch(/services\.py$/);
      expect(s.location.line).toBe(6);
    });

    it("UserService.__init__ is a FUNCTION in UserService scope on line 7", () => {
      const s = graph.nodes.get(PATHS.UserSvc_init)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("services.UserService");
      expect(s.location.line).toBe(7);
    });

    it("UserService.get_user is a FUNCTION in UserService scope on line 10", () => {
      const s = graph.nodes.get(PATHS.UserSvc_get)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("services.UserService");
      expect(s.location.line).toBe(10);
    });

    it("UserService.update_user is a FUNCTION in UserService scope on line 13", () => {
      const s = graph.nodes.get(PATHS.UserSvc_update)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("services.UserService");
      expect(s.location.line).toBe(13);
    });

    it("create_service is a FUNCTION at module scope on line 19", () => {
      const s = graph.nodes.get(PATHS.create_service)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("services");
      expect(s.location.line).toBe(19);
    });
  });

  describe("nodes — app.py", () => {
    it("run is a FUNCTION at module scope on line 7", () => {
      const s = graph.nodes.get(PATHS.run)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("app");
      expect(s.location.file).toMatch(/app\.py$/);
      expect(s.location.line).toBe(7);
    });

    it("main is a FUNCTION at module scope on line 14", () => {
      const s = graph.nodes.get(PATHS.main)!;
      expect(s.kind).toBe(SymbolKind.FUNCTION);
      expect(s.scope).toBe("app");
      expect(s.location.line).toBe(14);
    });
  });

  // ── 3. Intra-file edges ─────────────────────────────────────────────────────

  describe("intra-file edges", () => {
    describe("config.py", () => {
      it("Config.__init__ READS MAX_CONNECTIONS (line 9)", () => {
        const edge = getEdge(graph, PATHS.Config_init, PATHS.MAX_CONNECTIONS, DependencyType.READS);
        expect(edge.count).toBeGreaterThanOrEqual(1);
      });

      it("Config.__init__ READS DEFAULT_TIMEOUT (line 10)", () => {
        const edge = getEdge(graph, PATHS.Config_init, PATHS.DEFAULT_TIMEOUT, DependencyType.READS);
        expect(edge.count).toBeGreaterThanOrEqual(1);
      });
    });

    describe("models.py", () => {
      it("UserRepository.find_by_id INSTANTIATES User (line 20)", () => {
        getEdge(graph, PATHS.UserRepo_find, PATHS.User, DependencyType.INSTANTIATES);
      });

      it("UserRepository.find_by_id USES_TYPE User (return annotation, line 19)", () => {
        getEdge(graph, PATHS.UserRepo_find, PATHS.User, DependencyType.USES_TYPE);
      });

      it("UserRepository.save USES_TYPE User (parameter annotation, line 22)", () => {
        getEdge(graph, PATHS.UserRepo_save, PATHS.User, DependencyType.USES_TYPE);
      });
    });

    describe("services.py", () => {
      it("create_service INSTANTIATES UserService (line 20)", () => {
        getEdge(graph, PATHS.create_service, PATHS.UserService, DependencyType.INSTANTIATES);
      });

      it("create_service USES_TYPE UserService (return annotation, line 19)", () => {
        getEdge(graph, PATHS.create_service, PATHS.UserService, DependencyType.USES_TYPE);
      });
    });

    describe("app.py", () => {
      it("main CALLS run (line 15)", () => {
        getEdge(graph, PATHS.main, PATHS.run, DependencyType.CALLS);
      });
    });
  });

  // ── 4. Cross-file edges ─────────────────────────────────────────────────────

  describe("cross-file edges", () => {
    describe("models.py → config.py", () => {
      it("UserRepository.__init__ USES_TYPE Config (param annotation, line 15)", () => {
        getEdge(graph, PATHS.UserRepo_init, PATHS.Config, DependencyType.USES_TYPE);
      });

      it("UserRepository.__init__ READS MAX_CONNECTIONS (line 17)", () => {
        getEdge(graph, PATHS.UserRepo_init, PATHS.MAX_CONNECTIONS, DependencyType.READS);
      });
    });

    describe("services.py → config.py", () => {
      it("UserService.__init__ USES_TYPE Config (param annotation, line 7)", () => {
        getEdge(graph, PATHS.UserSvc_init, PATHS.Config, DependencyType.USES_TYPE);
      });

      it("create_service USES_TYPE Config (param annotation, line 19)", () => {
        getEdge(graph, PATHS.create_service, PATHS.Config, DependencyType.USES_TYPE);
      });
    });

    describe("services.py → models.py", () => {
      it("UserService.__init__ INSTANTIATES UserRepository (line 8)", () => {
        getEdge(graph, PATHS.UserSvc_init, PATHS.UserRepository, DependencyType.INSTANTIATES);
      });

      it("UserService.get_user CALLS UserRepository.find_by_id (line 11)", () => {
        getEdge(graph, PATHS.UserSvc_get, PATHS.UserRepo_find, DependencyType.CALLS);
      });

      it("UserService.get_user USES_TYPE User (return annotation, line 10)", () => {
        getEdge(graph, PATHS.UserSvc_get, PATHS.User, DependencyType.USES_TYPE);
      });

      it("UserService.update_user CALLS UserRepository.find_by_id (line 14)", () => {
        getEdge(graph, PATHS.UserSvc_update, PATHS.UserRepo_find, DependencyType.CALLS);
      });

      it("UserService.update_user CALLS UserRepository.save (line 16)", () => {
        getEdge(graph, PATHS.UserSvc_update, PATHS.UserRepo_save, DependencyType.CALLS);
      });
    });

    describe("app.py → config.py", () => {
      it("run INSTANTIATES Config (line 8)", () => {
        getEdge(graph, PATHS.run, PATHS.Config, DependencyType.INSTANTIATES);
      });

      it("run READS APP_NAME (line 11)", () => {
        getEdge(graph, PATHS.run, PATHS.APP_NAME, DependencyType.READS);
      });
    });

    describe("app.py → services.py", () => {
      it("run CALLS create_service (line 9)", () => {
        getEdge(graph, PATHS.run, PATHS.create_service, DependencyType.CALLS);
      });

      it("run CALLS UserService.get_user via the returned service object (line 10)", () => {
        getEdge(graph, PATHS.run, PATHS.UserSvc_get, DependencyType.CALLS);
      });
    });

    describe("app.py → models.py", () => {
      it("run CALLS User.to_dict via the returned user object (line 11)", () => {
        getEdge(graph, PATHS.run, PATHS.User_to_dict, DependencyType.CALLS);
      });
    });
  });

  // ── 5. Import edges ─────────────────────────────────────────────────────────
  // IMPORTS edges may originate from a module-level node whose exact path is
  // implementation-defined, so we use a file-prefix search rather than an exact
  // source path. This makes the test robust to different module-node conventions.

  describe("import edges", () => {
    it("models.py imports Config from config.py", () => {
      expect(
        findCrossFileImport(graph, "file://models.py", PATHS.Config),
        "No IMPORTS edge from models.py to Config",
      ).toBeDefined();
    });

    it("models.py imports MAX_CONNECTIONS from config.py", () => {
      expect(
        findCrossFileImport(graph, "file://models.py", PATHS.MAX_CONNECTIONS),
        "No IMPORTS edge from models.py to MAX_CONNECTIONS",
      ).toBeDefined();
    });

    it("services.py imports Config from config.py", () => {
      expect(
        findCrossFileImport(graph, "file://services.py", PATHS.Config),
        "No IMPORTS edge from services.py to Config",
      ).toBeDefined();
    });

    it("services.py imports User from models.py", () => {
      expect(
        findCrossFileImport(graph, "file://services.py", PATHS.User),
        "No IMPORTS edge from services.py to User",
      ).toBeDefined();
    });

    it("services.py imports UserRepository from models.py", () => {
      expect(
        findCrossFileImport(graph, "file://services.py", PATHS.UserRepository),
        "No IMPORTS edge from services.py to UserRepository",
      ).toBeDefined();
    });

    it("app.py imports Config from config.py", () => {
      expect(
        findCrossFileImport(graph, "file://app.py", PATHS.Config),
        "No IMPORTS edge from app.py to Config",
      ).toBeDefined();
    });

    it("app.py imports APP_NAME from config.py", () => {
      expect(
        findCrossFileImport(graph, "file://app.py", PATHS.APP_NAME),
        "No IMPORTS edge from app.py to APP_NAME",
      ).toBeDefined();
    });

    it("app.py imports User from models.py", () => {
      expect(
        findCrossFileImport(graph, "file://app.py", PATHS.User),
        "No IMPORTS edge from app.py to User",
      ).toBeDefined();
    });

    it("app.py imports UserService from services.py", () => {
      expect(
        findCrossFileImport(graph, "file://app.py", PATHS.UserService),
        "No IMPORTS edge from app.py to UserService",
      ).toBeDefined();
    });

    it("app.py imports create_service from services.py", () => {
      expect(
        findCrossFileImport(graph, "file://app.py", PATHS.create_service),
        "No IMPORTS edge from app.py to create_service",
      ).toBeDefined();
    });
  });

  // ── 6. Absence of spurious edges ────────────────────────────────────────────
  // Guards against the analyzer hallucinating reverse or skip-layer dependencies.

  describe("absence of spurious edges", () => {
    // config.py is the leaf — nothing in it should depend on sibling files.
    it("config.py has no outbound edges to other files", () => {
      const outbound = graph.edges.filter(
        (e) =>
          e.source_symbol_path.startsWith("file://config.py") &&
          !e.target_symbol_path.startsWith("file://config.py"),
      );
      expect(outbound, "config.py → external file edges should not exist").toHaveLength(0);
    });

    // models.py only knows about config — it must not reach up the stack.
    it("models.py has no outbound edges to services.py or app.py", () => {
      const spurious = graph.edges.filter(
        (e) =>
          e.source_symbol_path.startsWith("file://models.py") &&
          (e.target_symbol_path.startsWith("file://services.py") ||
            e.target_symbol_path.startsWith("file://app.py")),
      );
      expect(spurious, "models.py → services.py/app.py edges should not exist").toHaveLength(0);
    });

    // services.py only knows about config + models — it must not reach app.
    it("services.py has no outbound edges to app.py", () => {
      const spurious = graph.edges.filter(
        (e) =>
          e.source_symbol_path.startsWith("file://services.py") &&
          e.target_symbol_path.startsWith("file://app.py"),
      );
      expect(spurious, "services.py → app.py edges should not exist").toHaveLength(0);
    });

    // Specific absence checks.
    it("main does NOT directly call UserService.get_user or create_service", () => {
      expect(findEdges(graph, PATHS.main, PATHS.UserSvc_get, DependencyType.CALLS)).toHaveLength(0);
      expect(findEdges(graph, PATHS.main, PATHS.create_service, DependencyType.CALLS)).toHaveLength(0);
    });

    it("UserService.get_user does NOT call UserRepository.save", () => {
      expect(findEdges(graph, PATHS.UserSvc_get, PATHS.UserRepo_save, DependencyType.CALLS)).toHaveLength(0);
    });

    it("create_service does NOT call get_user or update_user", () => {
      expect(findEdges(graph, PATHS.create_service, PATHS.UserSvc_get, DependencyType.CALLS)).toHaveLength(0);
      expect(findEdges(graph, PATHS.create_service, PATHS.UserSvc_update, DependencyType.CALLS)).toHaveLength(0);
    });

    // Structural integrity.
    it("there are no self-loops", () => {
      for (const edge of graph.edges) {
        expect(
          edge.source_symbol_path,
          `Self-loop on ${edge.source_symbol_path}`,
        ).not.toBe(edge.target_symbol_path);
      }
    });

    it("all edge endpoints reference nodes that exist in the graph", () => {
      for (const edge of graph.edges) {
        expect(
          graph.nodes.has(edge.source_symbol_path),
          `Unknown source: ${edge.source_symbol_path}`,
        ).toBe(true);
        expect(
          graph.nodes.has(edge.target_symbol_path),
          `Unknown target: ${edge.target_symbol_path}`,
        ).toBe(true);
      }
    });

    it("every edge has at least one reference_id", () => {
      for (const edge of graph.edges) {
        expect(
          edge.reference_ids.length,
          `Edge ${edge.source_symbol_path} → ${edge.target_symbol_path} has no reference_ids`,
        ).toBeGreaterThan(0);
      }
    });
  });

  // ── 7. name_to_symbol_map ───────────────────────────────────────────────────

  describe("name_to_symbol_map", () => {
    const expectedNames = [
      "MAX_CONNECTIONS",
      "DEFAULT_TIMEOUT",
      "APP_NAME",
      "Config",
      "is_debug",
      "User",
      "to_dict",
      "UserRepository",
      "find_by_id",
      "save",
      "UserService",
      "get_user",
      "update_user",
      "create_service",
      "run",
      "main",
      // __init__ appears in all four classes
      "__init__",
    ] as const;

    it("contains an entry for every expected symbol name", () => {
      for (const name of expectedNames) {
        expect(graph.name_to_symbol_map.has(name), `Missing entry for "${name}"`).toBe(true);
      }
    });

    it("each entry is a non-empty array", () => {
      for (const name of expectedNames) {
        const defs = graph.name_to_symbol_map.get(name)!;
        expect(Array.isArray(defs), `Not an array for "${name}"`).toBe(true);
        expect(defs.length, `Empty array for "${name}"`).toBeGreaterThan(0);
      }
    });

    // __init__ is defined in Config, User, UserRepository, and UserService → 4 entries.
    it("__init__ maps to all four class constructors", () => {
      const defs = graph.name_to_symbol_map.get("__init__")!;
      expect(defs.length).toBe(4);
      const ids = new Set(defs.map((d) => d.id));
      expect(ids.has(PATHS.Config_init),    "Missing Config.__init__").toBe(true);
      expect(ids.has(PATHS.User_init),      "Missing User.__init__").toBe(true);
      expect(ids.has(PATHS.UserRepo_init),  "Missing UserRepository.__init__").toBe(true);
      expect(ids.has(PATHS.UserSvc_init),   "Missing UserService.__init__").toBe(true);
    });

    // Names that appear in only one file should map to exactly one entry.
    it("create_service maps to exactly one symbol (services.py)", () => {
      const defs = graph.name_to_symbol_map.get("create_service")!;
      expect(defs).toHaveLength(1);
      expect(defs[0].id).toBe(PATHS.create_service);
    });

    it("Config maps to the CLASS definition, not a method", () => {
      const defs = graph.name_to_symbol_map.get("Config")!;
      expect(defs.some((d) => d.kind === SymbolKind.CLASS && d.id === PATHS.Config)).toBe(true);
    });

    it("User maps to the CLASS definition in models.py", () => {
      const defs = graph.name_to_symbol_map.get("User")!;
      expect(defs.some((d) => d.kind === SymbolKind.CLASS && d.id === PATHS.User)).toBe(true);
    });

    it("every SymbolDef in the map is also present in graph.nodes", () => {
      for (const [name, defs] of graph.name_to_symbol_map) {
        for (const def of defs) {
          expect(
            graph.nodes.has(def.id),
            `name_to_symbol_map["${name}"] references "${def.id}" which is not in nodes`,
          ).toBe(true);
        }
      }
    });
  });

  // ── 8. Graph metadata ────────────────────────────────────────────────────────

  describe("graph metadata", () => {
    it("records 'python' as the language", () => {
      expect(graph.metadata.get("language")).toBe("python");
    });

    it("records all four source files", () => {
      const files: string[] = graph.metadata.get("files") ?? [];
      expect(files.some((f) => f.endsWith("config.py")),   "Missing config.py").toBe(true);
      expect(files.some((f) => f.endsWith("models.py")),   "Missing models.py").toBe(true);
      expect(files.some((f) => f.endsWith("services.py")), "Missing services.py").toBe(true);
      expect(files.some((f) => f.endsWith("app.py")),      "Missing app.py").toBe(true);
    });

    it("node_count is at least 20 if present", () => {
      const count = graph.metadata.get("node_count") as number | undefined;
      if (count !== undefined) {
        expect(count).toBeGreaterThanOrEqual(20);
      }
    });
  });
});