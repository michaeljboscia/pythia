import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { chunkFile } from "../indexer/chunker-treesitter.js";

const workspaceRoot = "/repo";

test("export function login emits function chunk with correct CNI", () => {
  const chunks = chunkFile(
    "/repo/src/auth.ts",
    "export function login() {\n  return true;\n}\n",
    workspaceRoot
  );

  const functionChunk = chunks.find((chunk) => chunk.chunk_type === "function");
  assert.ok(functionChunk);
  assert.equal(functionChunk.id, "src/auth.ts::function::login");
});

test("class AuthManager emits class chunk with correct CNI", () => {
  const chunks = chunkFile(
    "/repo/src/auth.ts",
    "class AuthManager {\n  login() {\n    return true;\n  }\n}\n",
    workspaceRoot
  );

  const classChunk = chunks.find((chunk) => chunk.chunk_type === "class");
  assert.ok(classChunk);
  assert.equal(classChunk.id, "src/auth.ts::class::AuthManager");
});

test("method inside class emits nested method CNI", () => {
  const chunks = chunkFile(
    "/repo/src/auth.ts",
    "class AuthManager {\n  login() {\n    return true;\n  }\n}\n",
    workspaceRoot
  );

  const methodChunk = chunks.find((chunk) => chunk.chunk_type === "method");
  assert.ok(methodChunk);
  assert.equal(methodChunk.id, "src/auth.ts::class::AuthManager::method::login");
});

test("interface emits interface chunk", () => {
  const chunks = chunkFile(
    "/repo/src/auth.ts",
    "interface User {\n  id: string;\n}\n",
    workspaceRoot
  );

  const interfaceChunk = chunks.find((chunk) => chunk.chunk_type === "interface");
  assert.ok(interfaceChunk);
  assert.equal(interfaceChunk.id, "src/auth.ts::interface::User");
});

test("type alias emits type chunk", () => {
  const chunks = chunkFile(
    "/repo/src/auth.ts",
    "type UserId = string;\n",
    workspaceRoot
  );

  const typeChunk = chunks.find((chunk) => chunk.chunk_type === "type");
  assert.ok(typeChunk);
  assert.equal(typeChunk.id, "src/auth.ts::type::UserId");
});

test("enum emits enum chunk", () => {
  const chunks = chunkFile(
    "/repo/src/auth.ts",
    "enum Role {\n  Admin,\n  User,\n}\n",
    workspaceRoot
  );

  const enumChunk = chunks.find((chunk) => chunk.chunk_type === "enum");
  assert.ok(enumChunk);
  assert.equal(enumChunk.id, "src/auth.ts::enum::Role");
});

test("namespace emits namespace chunk", () => {
  const chunks = chunkFile(
    "/repo/src/auth.ts",
    "namespace Auth {\n  export const value = 1;\n}\n",
    workspaceRoot
  );

  const namespaceChunk = chunks.find((chunk) => chunk.chunk_type === "namespace");
  assert.ok(namespaceChunk);
  assert.equal(namespaceChunk.id, "src/auth.ts::namespace::Auth");
});

test("README with headings emits doc chunks with slug CNIs", () => {
  const content = "# Getting Started\n\nHello\n\n## API Reference\n\nWorld\n";
  const chunks = chunkFile("/repo/README.md", content, workspaceRoot);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].id, "README.md::doc::getting-started#L0");
  assert.equal(chunks[1].id, "README.md::doc::api-reference#L4");
});

test("README without headings emits default doc chunk", () => {
  const chunks = chunkFile("/repo/README.md", "hello\nworld\n", workspaceRoot);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].id, "README.md::doc::default");
});

test("duplicate function names add #L disambiguator", () => {
  const lines = Array.from({ length: 45 }, (_, index) => `// filler ${index + 1}`);
  lines.push("function helper() {");
  lines.push("  return 1;");
  lines.push("}");
  lines.push("function helper() {");
  lines.push("  return 2;");
  lines.push("}");
  const content = `${lines.join("\n")}\n`;

  const chunks = chunkFile("/repo/src/utils.ts", content, workspaceRoot).filter((chunk) => chunk.chunk_type === "function");

  assert.equal(chunks[0].id, "src/utils.ts::function::helper");
  assert.equal(chunks[1].id, "src/utils.ts::function::helper#L48");
});

test("start_line and end_line match AST positions", () => {
  const content = "export function login() {\n  return true;\n}\n";
  const chunks = chunkFile("/repo/src/auth.ts", content, workspaceRoot);
  const functionChunk = chunks.find((chunk) => chunk.chunk_type === "function");

  assert.ok(functionChunk);
  assert.equal(functionChunk.start_line, 0);
  assert.equal(functionChunk.end_line, 2);
});

test("supported file with no named symbols falls back to module chunk", () => {
  const chunks = chunkFile("/repo/src/plain.js", "const value = 1;\n", workspaceRoot);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "module");
  assert.equal(chunks[0].id, "src/plain.js::module::default");
});

test("repo-relative paths always use forward slashes", () => {
  const windowsPath = path.join("C:\\repo", "src", "auth.ts");
  const workspace = "C:\\repo";
  const chunks = chunkFile(windowsPath, "export function login() {}\n", workspace);

  assert.equal(chunks[0].file_path, "src/auth.ts");
});

test("supported file with named symbols still includes a module chunk", () => {
  const chunks = chunkFile("/repo/src/auth.ts", "export function login() {}\n", workspaceRoot);
  const moduleChunk = chunks.find((chunk) => chunk.chunk_type === "module");

  assert.ok(moduleChunk);
  assert.equal(moduleChunk.id, "src/auth.ts::module::default");
});
