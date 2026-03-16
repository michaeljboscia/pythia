import Parser from "tree-sitter";

import type { Chunk, ChunkType } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

export function extractSwiftChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const typeToChunkType = new Map<string, ChunkType>([
    ["class_declaration", "class"],
    ["protocol_declaration", "interface"],
    ["function_declaration", "function"]
  ]);

  function walk(node: SyntaxNode): void {
    const chunkType = typeToChunkType.get(node.type);
    if (chunkType !== undefined) {
      const name = node.childForFieldName("name")?.text
        ?? `anonymous_L${node.startPosition.row}`;
      chunks.push({
        id: `${filePath}::${chunkType}::${name}`,
        file_path: filePath,
        chunk_type: chunkType,
        content: node.text,
        start_line: node.startPosition.row,
        end_line: node.endPosition.row,
        language: "swift"
      });
    }
    for (const child of node.namedChildren) {
      walk(child);
    }
  }

  walk(rootNode);
  return chunks;
}
