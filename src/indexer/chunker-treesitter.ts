import path from "node:path";

import Parser from "tree-sitter";
import Go from "tree-sitter-go";
import Java from "tree-sitter-java";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import Rust from "tree-sitter-rust";
import TypeScript from "tree-sitter-typescript";

type SyntaxNode = Parser.SyntaxNode;

export interface Chunk {
  id: string;
  file_path: string;
  chunk_type: string;
  content: string;
  start_line: number;
  end_line: number;
  language: string;
}

type LanguageConfig = {
  language: string;
  parserLanguage: unknown;
};

const languageConfigByExtension = new Map<string, LanguageConfig>([
  [".ts", { language: "typescript", parserLanguage: TypeScript.typescript }],
  [".tsx", { language: "typescript", parserLanguage: TypeScript.tsx }],
  [".js", { language: "javascript", parserLanguage: JavaScript }],
  [".jsx", { language: "javascript", parserLanguage: JavaScript }],
  [".mjs", { language: "javascript", parserLanguage: JavaScript }],
  [".cjs", { language: "javascript", parserLanguage: JavaScript }],
  [".py", { language: "python", parserLanguage: Python }],
  [".go", { language: "go", parserLanguage: Go }],
  [".rs", { language: "rust", parserLanguage: Rust }],
  [".java", { language: "java", parserLanguage: Java }]
]);

const parserByExtension = new Map<string, Parser>();

function normalizeRelativePath(filePath: string, workspaceRoot: string): string {
  const relativePath = path.relative(workspaceRoot, filePath);
  return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}

function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function createParser(extension: string): Parser | null {
  const config = languageConfigByExtension.get(extension);

  if (config === undefined) {
    return null;
  }

  let parser = parserByExtension.get(extension);

  if (parser !== undefined) {
    return parser;
  }

  parser = new Parser();
  parser.setLanguage(config.parserLanguage as Parser.Language);
  parserByExtension.set(extension, parser);
  return parser;
}

function createChunk(
  filePath: string,
  chunkType: string,
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

function isExportDefault(node: SyntaxNode): boolean {
  return node.parent?.type === "export_statement" && node.parent.text.includes("default");
}

function getIdentifierText(node: SyntaxNode | null): string | null {
  if (node === null) {
    return null;
  }

  return node.text;
}

function extractVariableFunctionChunk(
  node: SyntaxNode,
  filePath: string,
  language: string
): Chunk | null {
  const valueNode = node.childForFieldName("value");

  if (valueNode === null || (valueNode.type !== "arrow_function" && valueNode.type !== "function_expression")) {
    return null;
  }

  const nameNode = node.childForFieldName("name");
  const derivedName = getIdentifierText(nameNode)
    ?? getIdentifierText(valueNode.childForFieldName("name"))
    ?? `anonymous_L${valueNode.startPosition.row}`;

  return createChunk(filePath, "function", derivedName, valueNode, language);
}

function extractTopLevelChunk(
  node: SyntaxNode,
  filePath: string,
  language: string
): Chunk | null {
  if (node.type === "expression_statement" && node.firstNamedChild?.type === "internal_module") {
    return extractTopLevelChunk(node.firstNamedChild, filePath, language);
  }

  switch (node.type) {
    case "function_declaration": {
      const nameNode = node.childForFieldName("name");
      const functionName = getIdentifierText(nameNode)
        ?? (isExportDefault(node) ? "default" : `anonymous_L${node.startPosition.row}`);
      return createChunk(filePath, "function", functionName, node, language);
    }
    case "class_declaration":
    case "class": {
      const nameNode = node.childForFieldName("name");
      const className = getIdentifierText(nameNode)
        ?? (isExportDefault(node) ? "default" : `anonymous_L${node.startPosition.row}`);
      return createChunk(filePath, "class", className, node, language);
    }
    case "interface_declaration": {
      return createChunk(filePath, "interface", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, language);
    }
    case "type_alias_declaration": {
      return createChunk(filePath, "type", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, language);
    }
    case "enum_declaration": {
      return createChunk(filePath, "enum", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, language);
    }
    case "namespace_declaration":
    case "internal_module":
    case "module": {
      const nameNode = node.childForFieldName("name");
      const namespaceName = getIdentifierText(nameNode) ?? "default";
      return createChunk(filePath, "namespace", namespaceName, node, language);
    }
    case "lexical_declaration":
    case "variable_declaration": {
      for (const child of node.namedChildren) {
        if (child.type === "variable_declarator") {
          const chunk = extractVariableFunctionChunk(child, filePath, language);
          if (chunk !== null) {
            return chunk;
          }
        }
      }
      return null;
    }
    case "export_statement":
    case "export_default_declaration":
      for (const child of node.namedChildren) {
        const chunk = extractTopLevelChunk(child, filePath, language);
        if (chunk !== null) {
          return chunk;
        }
      }
      return null;
    default:
      return null;
  }
}

function findEnclosingClass(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent;

  while (current !== null) {
    if (current.type === "class_declaration" || current.type === "class") {
      return current;
    }
    current = current.parent;
  }

  return null;
}

function extractMethodChunks(rootNode: SyntaxNode, filePath: string, language: string): Chunk[] {
  const methods = rootNode.descendantsOfType("method_definition") as SyntaxNode[];
  const chunks: Chunk[] = [];

  for (const method of methods) {
    const classNode = findEnclosingClass(method);

    if (classNode === null) {
      continue;
    }

    const className = classNode.childForFieldName("name")?.text ?? `anonymous_L${classNode.startPosition.row}`;
    const methodName = method.childForFieldName("name")?.text ?? `anonymous_L${method.startPosition.row}`;

    chunks.push({
      id: `${filePath}::class::${className}::method::${methodName}`,
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

function addDisambiguators(chunks: Chunk[]): Chunk[] {
  const seen = new Map<string, number>();

  return chunks.map((chunk) => {
    const count = seen.get(chunk.id) ?? 0;
    seen.set(chunk.id, count + 1);

    if (count === 0) {
      return chunk;
    }

    return {
      ...chunk,
      id: `${chunk.id}#L${chunk.start_line}`
    };
  });
}

function chunkMarkdown(filePath: string, content: string, workspaceRoot: string): Chunk[] {
  const normalizedPath = normalizeRelativePath(filePath, workspaceRoot);
  const lines = content.split("\n");
  const headingIndexes: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (/^#{1,6}\s+/.test(lines[index])) {
      headingIndexes.push(index);
    }
  }

  if (headingIndexes.length === 0) {
    return [{
      id: `${normalizedPath}::doc::default`,
      file_path: normalizedPath,
      chunk_type: "doc",
      content,
      start_line: 0,
      end_line: Math.max(lines.length - 1, 0),
      language: "markdown"
    }];
  }

  const chunks: Chunk[] = [];

  for (let index = 0; index < headingIndexes.length; index += 1) {
    const startLine = headingIndexes[index];
    const endLineExclusive = headingIndexes[index + 1] ?? lines.length;
    const sectionLines = lines.slice(startLine, endLineExclusive);
    const headingText = lines[startLine].replace(/^#{1,6}\s+/, "");

    chunks.push({
      id: `${normalizedPath}::doc::${slugifyHeading(headingText)}#L${startLine}`,
      file_path: normalizedPath,
      chunk_type: "doc",
      content: sectionLines.join("\n"),
      start_line: startLine,
      end_line: endLineExclusive - 1,
      language: "markdown"
    });
  }

  return chunks;
}

export function chunkFile(filePath: string, content: string, workspaceRoot: string): Chunk[] {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".md" || extension === ".mdx") {
    return chunkMarkdown(filePath, content, workspaceRoot);
  }

  const parser = createParser(extension);

  if (parser === null) {
    return [];
  }

  const normalizedPath = normalizeRelativePath(filePath, workspaceRoot);
  const config = languageConfigByExtension.get(extension);

  if (config === undefined) {
    return [];
  }

  const tree = parser.parse(content);
  const rootNode = tree.rootNode;
  const chunks: Chunk[] = [];

  for (const node of rootNode.namedChildren) {
    const chunk = extractTopLevelChunk(node, normalizedPath, config.language);
    if (chunk !== null) {
      chunks.push(chunk);
    }
  }

  chunks.push(...extractMethodChunks(rootNode, normalizedPath, config.language));

  if (chunks.length === 0) {
    return [{
      id: `${normalizedPath}::module::default`,
      file_path: normalizedPath,
      chunk_type: "module",
      content,
      start_line: rootNode.startPosition.row,
      end_line: rootNode.endPosition.row,
      language: config.language
    }];
  }

  return addDisambiguators(chunks).sort((left, right) => {
    if (left.start_line !== right.start_line) {
      return left.start_line - right.start_line;
    }

    return left.id.localeCompare(right.id);
  });
}
