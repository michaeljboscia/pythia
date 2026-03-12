import Parser from "tree-sitter";
import PHP from "tree-sitter-php";

import type { Chunk, ChunkType } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

function createChunk(
  filePath: string,
  chunkType: ChunkType | string,
  name: string,
  node: SyntaxNode,
  language: string
): Chunk {
  return {
    id: `${filePath}::${chunkType}::${name}`,
    file_path: filePath,
    chunk_type: chunkType,
    content: node.text,
    start_line: node.startPosition.row,
    end_line: node.endPosition.row,
    language
  };
}

function findEnclosingContainer(node: SyntaxNode): { type: "class" | "trait"; node: SyntaxNode } | null {
  let current: SyntaxNode | null = node.parent;

  while (current !== null) {
    if (current.type === "class_declaration" || current.type === "class") {
      return { type: "class", node: current };
    }

    if (current.type === "trait_declaration") {
      return { type: "trait", node: current };
    }

    current = current.parent;
  }

  return null;
}

function extractMethodChunks(rootNode: SyntaxNode, filePath: string, language: string): Chunk[] {
  const methods = rootNode.descendantsOfType(["method_definition", "method_declaration"]) as SyntaxNode[];
  const chunks: Chunk[] = [];

  for (const method of methods) {
    const container = findEnclosingContainer(method);

    if (container === null) {
      continue;
    }

    const containerName = container.node.childForFieldName("name")?.text ?? `anonymous_L${container.node.startPosition.row}`;
    const methodName = method.childForFieldName("name")?.text ?? `anonymous_L${method.startPosition.row}`;

    chunks.push({
      id: `${filePath}::${container.type}::${containerName}::method::${methodName}`,
      file_path: filePath,
      chunk_type: "method",
      content: method.text,
      start_line: method.startPosition.row,
      end_line: method.endPosition.row,
      language
    });
  }

  return chunks;
}

function extractPhpTopLevelChunk(node: SyntaxNode, filePath: string): Chunk | null {
  switch (node.type) {
    case "class_declaration":
      return createChunk(filePath, "class", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, "php");
    case "trait_declaration":
      return createChunk(filePath, "trait", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, "php");
    case "interface_declaration":
      return createChunk(filePath, "interface", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, "php");
    case "function_definition":
      return createChunk(filePath, "function", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, "php");
    default:
      return null;
  }
}

let cachedParser: Parser | null = null;

export function getPhpParser(): Parser {
  if (cachedParser !== null) {
    return cachedParser;
  }
  const parser = new Parser();
  parser.setLanguage(PHP.php as Parser.Language);
  cachedParser = parser;
  return parser;
}

export function extractPhpChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const node of rootNode.namedChildren) {
    const chunk = extractPhpTopLevelChunk(node, filePath);
    if (chunk !== null) {
      chunks.push(chunk);
    }
  }

  chunks.push(...extractMethodChunks(rootNode, filePath, "php"));
  return chunks;
}
