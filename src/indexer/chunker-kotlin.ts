import Parser from "tree-sitter";

import type { Chunk, ChunkType } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

function getKotlinName(node: SyntaxNode, fallbackRow: number): string {
  for (const child of node.namedChildren) {
    if (child.type === "simple_identifier" || child.type === "type_identifier") {
      return child.text;
    }
  }
  return `anonymous_L${fallbackRow}`;
}

export function extractKotlinChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const typeToChunkType = new Map<string, ChunkType>([
    ["class_declaration", "class"],
    ["object_declaration", "class"],
    ["function_declaration", "function"]
  ]);

  function walk(node: SyntaxNode): void {
    const chunkType = typeToChunkType.get(node.type);
    if (chunkType !== undefined) {
      const name = getKotlinName(node, node.startPosition.row);
      chunks.push({
        id: `${filePath}::${chunkType}::${name}`,
        file_path: filePath,
        chunk_type: chunkType,
        content: node.text,
        start_line: node.startPosition.row,
        end_line: node.endPosition.row,
        language: "kotlin"
      });
    }
    for (const child of node.namedChildren) {
      walk(child);
    }
  }

  walk(rootNode);
  return chunks;
}
