import Parser from "tree-sitter";

import type { Chunk, ChunkType } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

const CSHARP_NODE_TYPE_MAP: Record<string, ChunkType | string> = {
  class_declaration: "class",
  method_declaration: "method",
  interface_declaration: "interface",
  enum_declaration: "enum"
};

export function extractCSharpChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const targetTypes = new Set(Object.keys(CSHARP_NODE_TYPE_MAP));

  function walk(node: SyntaxNode): void {
    for (const child of node.namedChildren) {
      if (targetTypes.has(child.type)) {
        const name = child.childForFieldName("name")?.text ?? `anonymous_L${child.startPosition.row}`;
        const chunkType = CSHARP_NODE_TYPE_MAP[child.type] ?? child.type;
        chunks.push({
          id: `${filePath}::${chunkType}::${name}`,
          file_path: filePath,
          chunk_type: chunkType,
          content: child.text,
          start_line: child.startPosition.row,
          end_line: child.endPosition.row,
          language: "csharp"
        });
      }

      walk(child);
    }
  }

  walk(rootNode);
  return chunks;
}
