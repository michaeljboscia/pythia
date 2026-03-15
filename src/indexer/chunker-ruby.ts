import Parser from "tree-sitter";

import type { Chunk, ChunkType } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

export function extractRubyChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const targetTypes = new Set(["method", "singleton_method", "class", "module"]);

  function walk(node: SyntaxNode): void {
    for (const child of node.namedChildren) {
      if (targetTypes.has(child.type)) {
        const name = child.childForFieldName("name")?.text ?? `anonymous_L${child.startPosition.row}`;
        const chunkType: ChunkType | string = child.type === "singleton_method" ? "method" : child.type as ChunkType;
        chunks.push({
          id: `${filePath}::${chunkType}::${name}`,
          file_path: filePath,
          chunk_type: chunkType,
          content: child.text,
          start_line: child.startPosition.row,
          end_line: child.endPosition.row,
          language: "ruby"
        });
      }

      walk(child);
    }
  }

  walk(rootNode);
  return chunks;
}
