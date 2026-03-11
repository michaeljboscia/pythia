import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { extractEdges, initLanguageService } from "../indexer/slow-path.js";

function createWorkspace() {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-slow-path-"));

  return {
    workspaceRoot,
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true })
  };
}

test("import declaration produces IMPORTS edge to target module", () => {
  const { workspaceRoot, cleanup } = createWorkspace();
  const authPath = path.join(workspaceRoot, "src", "auth.ts");
  const serverPath = path.join(workspaceRoot, "src", "server.ts");
  mkdirSync(path.dirname(authPath), { recursive: true });
  writeFileSync(authPath, "export function login() { return true; }\n", "utf8");
  const serverContent = "import { login } from './auth';\nexport function handleRequest() { return login(); }\n";
  writeFileSync(serverPath, serverContent, "utf8");

  try {
    initLanguageService(workspaceRoot);
    const edges = extractEdges(serverPath, serverContent);

    assert.ok(edges.some((edge) => (
      edge.edge_type === "IMPORTS"
      && edge.source_id === "src/server.ts::module::default"
      && edge.target_id === "src/auth.ts::module::default"
    )));
  } finally {
    cleanup();
  }
});

test("cross-file call produces CALLS edge from enclosing function", () => {
  const { workspaceRoot, cleanup } = createWorkspace();
  const authPath = path.join(workspaceRoot, "src", "auth.ts");
  const serverPath = path.join(workspaceRoot, "src", "server.ts");
  mkdirSync(path.dirname(authPath), { recursive: true });
  writeFileSync(authPath, "export function login() { return true; }\n", "utf8");
  const serverContent = "import { login } from './auth';\nexport function handleRequest() { return login(); }\n";
  writeFileSync(serverPath, serverContent, "utf8");

  try {
    initLanguageService(workspaceRoot);
    const edges = extractEdges(serverPath, serverContent);

    assert.ok(edges.some((edge) => (
      edge.edge_type === "CALLS"
      && edge.source_id === "src/server.ts::function::handleRequest"
      && edge.target_id === "src/auth.ts::function::login"
    )));
  } finally {
    cleanup();
  }
});

test("re-export file produces RE_EXPORTS edge to canonical symbol", () => {
  const { workspaceRoot, cleanup } = createWorkspace();
  const authPath = path.join(workspaceRoot, "src", "auth.ts");
  const indexPath = path.join(workspaceRoot, "src", "index.ts");
  mkdirSync(path.dirname(authPath), { recursive: true });
  writeFileSync(authPath, "export function login() { return true; }\n", "utf8");
  const indexContent = "export { login } from './auth';\n";
  writeFileSync(indexPath, indexContent, "utf8");

  try {
    initLanguageService(workspaceRoot);
    const edges = extractEdges(indexPath, indexContent);

    assert.ok(edges.some((edge) => (
      edge.edge_type === "RE_EXPORTS"
      && edge.source_id === "src/index.ts::module::default"
      && edge.target_id === "src/auth.ts::function::login"
    )));
  } finally {
    cleanup();
  }
});

test(".js files without tsconfig still extract edges", () => {
  const { workspaceRoot, cleanup } = createWorkspace();
  const authPath = path.join(workspaceRoot, "src", "auth.js");
  const serverPath = path.join(workspaceRoot, "src", "server.js");
  mkdirSync(path.dirname(authPath), { recursive: true });
  writeFileSync(authPath, "export function login() { return true; }\n", "utf8");
  const serverContent = "import { login } from './auth.js';\nexport function handleRequest() { return login(); }\n";
  writeFileSync(serverPath, serverContent, "utf8");

  try {
    initLanguageService(workspaceRoot);
    const edges = extractEdges(serverPath, serverContent);

    assert.ok(edges.some((edge) => edge.edge_type === "IMPORTS" && edge.target_id === "src/auth.js::module::default"));
    assert.ok(edges.some((edge) => edge.edge_type === "CALLS" && edge.target_id === "src/auth.js::function::login"));
  } finally {
    cleanup();
  }
});

test("imports from node_modules do not create workspace edges", () => {
  const { workspaceRoot, cleanup } = createWorkspace();
  const dependencyPath = path.join(workspaceRoot, "node_modules", "pkg", "index.js");
  const serverPath = path.join(workspaceRoot, "src", "server.ts");
  mkdirSync(path.dirname(dependencyPath), { recursive: true });
  mkdirSync(path.dirname(serverPath), { recursive: true });
  writeFileSync(dependencyPath, "export function helper() { return true; }\n", "utf8");
  const serverContent = "import { helper } from '../node_modules/pkg/index.js';\nexport function handleRequest() { return helper(); }\n";
  writeFileSync(serverPath, serverContent, "utf8");

  try {
    initLanguageService(workspaceRoot);
    const edges = extractEdges(serverPath, serverContent);

    assert.equal(edges.length, 0);
  } finally {
    cleanup();
  }
});
