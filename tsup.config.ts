import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/main": "src/cli/main.ts",
    "indexer/worker": "src/indexer/worker.ts",
    index: "src/index.ts"
  },
  format: ["esm"],
  target: "node22",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  external: [
    "better-sqlite3",
    "sqlite-vec",
    "tree-sitter",
    "tree-sitter-typescript",
    "@huggingface/transformers",
    "onnxruntime-node",
    "typescript"
  ]
});
