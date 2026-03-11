#!/usr/bin/env node
/**
 * Pythia MCP Smoke Test
 * Uses the MCP SDK's own StdioClientTransport to spawn the server and fire a real query.
 * Run from the workspace root: node scripts/smoke-test.mjs [workspace]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const workspace = process.argv[2] ?? process.cwd();
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mainScript = path.join(scriptDir, "../dist/cli/main.js");

console.error(`[smoke] workspace: ${workspace}`);
console.error(`[smoke] server:    ${mainScript}`);
console.error(`[smoke] starting MCP server via StdioClientTransport...`);

const transport = new StdioClientTransport({
  command: "node",
  args: [mainScript, "start", "--workspace", workspace],
  stderr: "inherit",  // so we see server logs
});

const client = new Client(
  { name: "pythia-smoke-test", version: "1.0.0" },
  { capabilities: {} }
);

try {
  await client.connect(transport);
  console.error(`[smoke] connected ✓`);

  // List available tools
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name);
  console.error(`[smoke] tools registered: ${toolNames.join(", ")}`);

  if (!toolNames.includes("lcs_investigate")) {
    console.error(`[smoke] FAIL: lcs_investigate not found`);
    process.exit(1);
  }

  // Fire a real query
  const query = "how does the chunking and embedding pipeline work";
  console.error(`[smoke] calling lcs_investigate: "${query}"`);

  const result = await client.callTool(
    { name: "lcs_investigate", arguments: { query } },
    undefined,
    { timeout: 180_000 }  // 3 min — model cold-loads on first call
  );

  console.log("=== lcs_investigate result ===");
  if (result.content && result.content.length > 0) {
    for (const block of result.content) {
      if (block.type === "text") {
        console.log(block.text);
      }
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  console.error(`[smoke] PASS ✓`);
} catch (err) {
  console.error(`[smoke] ERROR: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
} finally {
  await client.close();
}
