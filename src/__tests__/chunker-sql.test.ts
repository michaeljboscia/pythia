import assert from "node:assert/strict";
import test from "node:test";

import { chunkFile } from "../indexer/chunker-treesitter.js";

const workspaceRoot = "/repo";
const defaultChunkerOptions = {
  css_rule_chunk_min_chars: 80,
  max_chunk_chars: {
    module: 12000,
    class: 8000,
    function: 6000,
    method: 4000,
    trait: 6000,
    interface: 6000,
    rule: 2000,
    at_rule: 4000,
    element: 4000,
    doc: 12000
  },
  oversize_strategy: "split" as const
};

function chunkSql(content: string) {
  return chunkFile("/repo/db/routines.sql", content, workspaceRoot, defaultChunkerOptions);
}

test("named SQL function emits a function chunk with the expected CNI", () => {
  const chunks = chunkSql(
    "CREATE FUNCTION calculate_revenue(amount int) RETURNS int AS $$ BEGIN RETURN amount; END; $$ LANGUAGE plpgsql;\n"
  );

  assert.equal(chunks.filter((chunk) => chunk.chunk_type === "function").length, 1);
  assert.ok(chunks.some((chunk) => chunk.id === "db/routines.sql::function::calculate_revenue"));
  assert.ok(chunks.some((chunk) => chunk.chunk_type === "module"));
});

test("CREATE OR REPLACE FUNCTION emits the same function chunk shape", () => {
  const chunks = chunkSql(
    "CREATE OR REPLACE FUNCTION calculate_margin() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;\n"
  );

  assert.ok(chunks.some((chunk) => chunk.id === "db/routines.sql::function::calculate_margin"));
});

test("schema-qualified SQL routine names are preserved in the CNI", () => {
  const chunks = chunkSql(
    "CREATE FUNCTION public.calculate_revenue(amount int) RETURNS int AS $$ BEGIN RETURN amount; END; $$ LANGUAGE plpgsql;\n"
  );

  assert.ok(chunks.some((chunk) => chunk.id === "db/routines.sql::function::public.calculate_revenue"));
});

test("SQL trigger definitions emit function chunks", () => {
  const chunks = chunkSql(
    "CREATE TRIGGER audit_accounts BEFORE INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION public.audit();\n"
  );

  assert.ok(chunks.some((chunk) => chunk.id === "db/routines.sql::function::audit_accounts"));
});

test("SQL files with multiple named routines emit one module chunk plus one function chunk per routine", () => {
  const chunks = chunkSql([
    "CREATE FUNCTION first_fn() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;",
    "",
    "CREATE FUNCTION second_fn() RETURNS int AS $$ BEGIN RETURN 2; END; $$ LANGUAGE plpgsql;",
    "",
    "CREATE FUNCTION public.third_fn() RETURNS int AS $$ BEGIN RETURN 3; END; $$ LANGUAGE plpgsql;"
  ].join("\n"));

  assert.equal(chunks.length, 4);
  assert.equal(chunks.filter((chunk) => chunk.chunk_type === "function").length, 3);
  assert.equal(chunks.filter((chunk) => chunk.chunk_type === "module").length, 1);
});

test("SQL files with no named routines still emit a module chunk", () => {
  const chunks = chunkSql("SELECT 1;\n");

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "module");
});

test("routine-level SQL parse errors fall back to the module chunk only", () => {
  const chunks = chunkSql(
    "CREATE FUNCTION broken_fn(amount int) RETURNS int AS $$ BEGIN RETURN amount $$ LANGUAGE plpgsql;\n"
  );

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "module");
});

test("anonymous DO blocks are kept in the module chunk only", () => {
  const chunks = chunkSql("DO $$ BEGIN RAISE NOTICE 'x'; END $$;\n");

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "module");
  assert.equal(chunks.some((chunk) => chunk.chunk_type === "function"), false);
});
