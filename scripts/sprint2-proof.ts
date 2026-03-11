import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { forceIndexPath } from "../src/mcp/force-index.js";
import { createLcsInvestigateHandler } from "../src/mcp/lcs-investigate.js";

async function main(): Promise<void> {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-sprint2-proof-"));
  const dbPath = path.join(workspaceRoot, ".pythia", "lcs.db");
  const authFilePath = path.join(workspaceRoot, "src", "auth.ts");

  mkdirSync(path.dirname(dbPath), { recursive: true });
  mkdirSync(path.dirname(authFilePath), { recursive: true });

  const source = [
    "export function formatDisplayName(name: string): string {",
    "  return name.trim().toUpperCase();",
    "}",
    "",
    "export function handleUserAuthentication(username: string, password: string): boolean {",
    "  const normalizedUser = username.trim().toLowerCase();",
    "  const validPassword = password.length > 12 && password.includes(\"!\");",
    "  return normalizedUser.length > 0 && validPassword;",
    "}",
    "",
    "export function logAuditTrail(message: string): string {",
    "  return `[audit] ${message}`;",
    "}",
    ""
  ].join("\n");
  writeFileSync(authFilePath, source, "utf8");

  const db = openDb(dbPath);

  try {
    runMigrations(db);
    await forceIndexPath(db, { workspace_path: workspaceRoot }, "src");

    const lcsInvestigate = createLcsInvestigateHandler(db);
    const result = await lcsInvestigate({
      query: "function that handles user authentication",
      intent: "semantic",
      limit: 3
    });
    const output = result.content[0].text;

    console.error(output);

    const blocks = output.split("\n\n--- CHUNK ").map((block, index) => (
      index === 0 ? block : `--- CHUNK ${block}`
    ));

    assert.ok(blocks.length >= 1, "Expected at least one result");
    assert.ok(output.includes("TYPE: function"), "Expected a function chunk in the results");
    assert.ok(output.includes("CNI: src/auth.ts::function::handleUserAuthentication"), "Expected auth function CNI in the top 3");

    const sourceLines = readFileSync(authFilePath, "utf8").split("\n");
    const expectedStartLine = sourceLines.findIndex((line) => line.includes("handleUserAuthentication"));
    const expectedEndLine = expectedStartLine + 4;

    assert.notEqual(expectedStartLine, -1, "Expected function definition in source file");
    assert.ok(output.includes(`LINES: ${expectedStartLine}-${expectedEndLine}`), "Expected correct line numbers");

    const authBlock = blocks.find((block) => block.includes("CNI: src/auth.ts::function::handleUserAuthentication"));
    assert.ok(authBlock, "Expected auth function block in output");

    const codeFenceMatch = authBlock.match(/```typescript\n([\s\S]*?)\n```/u);
    assert.ok(codeFenceMatch, "Expected TypeScript fenced block");

    const chunkContent = codeFenceMatch[1];
    assert.ok(chunkContent.startsWith("export function handleUserAuthentication"), "Expected chunk to start at function boundary");
    assert.ok(chunkContent.trimEnd().endsWith("}"), "Expected chunk to end at function boundary");
  } finally {
    db.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[sprint2-proof] Failed:", error);
  process.exit(1);
});
