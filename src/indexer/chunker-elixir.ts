import Parser from "tree-sitter";

import type { Chunk } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

const ELIXIR_DEF_TO_CHUNK_TYPE: Record<string, string> = {
  defmodule: "module",
  defprotocol: "interface",
  def: "function",
  defp: "function",
  defmacro: "function"
};

function getElixirName(defKeyword: string, callNode: SyntaxNode): string {
  const args = callNode.namedChildren.find((child) => child.type === "arguments");
  const firstArg = args?.firstNamedChild;
  if (!firstArg) return `anonymous_L${callNode.startPosition.row}`;

  if (defKeyword === "defmodule" || defKeyword === "defprotocol") {
    return firstArg.text;
  }

  const fnNameNode = firstArg.type === "call"
    ? firstArg.firstNamedChild
    : firstArg;
  return fnNameNode?.text?.split("(")[0] ?? `anonymous_L${callNode.startPosition.row}`;
}

export function extractElixirChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  function walk(node: SyntaxNode): void {
    if (node.type === "call") {
      const firstChild = node.firstNamedChild;
      if (firstChild?.type === "identifier") {
        const chunkType = ELIXIR_DEF_TO_CHUNK_TYPE[firstChild.text];
        if (chunkType !== undefined) {
          const name = getElixirName(firstChild.text, node);
          chunks.push({
            id: `${filePath}::${chunkType}::${name}`,
            file_path: filePath,
            chunk_type: chunkType,
            content: node.text,
            start_line: node.startPosition.row,
            end_line: node.endPosition.row,
            language: "elixir"
          });
        }
      }
    }

    for (const child of node.namedChildren) {
      walk(child);
    }
  }

  walk(rootNode);
  return chunks;
}
