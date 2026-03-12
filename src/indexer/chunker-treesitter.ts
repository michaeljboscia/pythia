import path from "node:path";

import { XMLParser } from "fast-xml-parser";
import Parser from "tree-sitter";
import CSS from "tree-sitter-css";
import Go from "tree-sitter-go";
import Java from "tree-sitter-java";
import JavaScript from "tree-sitter-javascript";
import PHP from "tree-sitter-php";
import Python from "tree-sitter-python";
import Rust from "tree-sitter-rust";
import SQL from "tree-sitter-sql";
import TypeScript from "tree-sitter-typescript";

import {
  DEFAULT_MAX_CHUNK_CHARS,
  DEFAULT_OVERSIZE_STRATEGY
} from "../config.js";
import { splitOversizedChunks } from "./chunk-splitter.js";
import { extractCssOrScssChunks } from "./chunker-css.js";
import { extractPhpChunks } from "./chunker-php.js";

type SyntaxNode = Parser.SyntaxNode;
type ChunkStrategy =
  | "symbols"
  | "php"
  | "phtml"
  | "sql"
  | "css"
  | "scss"
  | "module";

type LanguageConfig = {
  language: string;
  parserLanguage?: unknown;
  strategy: ChunkStrategy;
};

export type ChunkType =
  | "at_rule"
  | "class"
  | "doc"
  | "element"
  | "enum"
  | "function"
  | "interface"
  | "method"
  | "mixin"
  | "module"
  | "namespace"
  | "rule"
  | "trait"
  | "type";

export interface Chunk {
  id: string;
  file_path: string;
  chunk_type: ChunkType | string;
  content: string;
  start_line: number;
  end_line: number;
  language: string;
}

export type ChunkerOptions = {
  css_rule_chunk_min_chars?: number;
  max_chunk_chars?: Record<string, number>;
  oversize_strategy?: "split" | "truncate";
};

const languageConfigEntries: Array<[string, LanguageConfig]> = [
  [".ts", { language: "typescript", parserLanguage: TypeScript.typescript, strategy: "symbols" }],
  [".tsx", { language: "typescript", parserLanguage: TypeScript.tsx, strategy: "symbols" }],
  [".js", { language: "javascript", parserLanguage: JavaScript, strategy: "symbols" }],
  [".jsx", { language: "javascript", parserLanguage: JavaScript, strategy: "symbols" }],
  [".mjs", { language: "javascript", parserLanguage: JavaScript, strategy: "symbols" }],
  [".cjs", { language: "javascript", parserLanguage: JavaScript, strategy: "symbols" }],
  [".py", { language: "python", parserLanguage: Python, strategy: "symbols" }],
  [".go", { language: "go", parserLanguage: Go, strategy: "symbols" }],
  [".rs", { language: "rust", parserLanguage: Rust, strategy: "symbols" }],
  [".java", { language: "java", parserLanguage: Java, strategy: "symbols" }],
  [".php", { language: "php", parserLanguage: PHP.php as Parser.Language, strategy: "php" }],
  [".phtml", { language: "php", parserLanguage: PHP.php as Parser.Language, strategy: "phtml" }],
  [".sql", { language: "sql", parserLanguage: SQL as Parser.Language, strategy: "sql" }],
  [".css", { language: "css", parserLanguage: CSS as Parser.Language, strategy: "css" }],
  [".scss", { language: "scss", parserLanguage: CSS as Parser.Language, strategy: "scss" }]
];

const languageConfigByExtension = new Map<string, LanguageConfig>(languageConfigEntries);

const parserByExtension = new Map<string, Parser>();
const LAYOUT_XML_PATH = /(?:^|\/)view\/(?:frontend|adminhtml|base)\/layout\/[^/]+\.xml$/u;

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

function defaultLanguageForExtension(extension: string): string {
  if (extension === "") {
    return "text";
  }

  return extension.replace(/^\./u, "") || "text";
}

function createParser(extension: string): Parser | null {
  const config = languageConfigByExtension.get(extension);

  if (config?.parserLanguage === undefined) {
    return null;
  }

  const existing = parserByExtension.get(extension);

  if (existing !== undefined) {
    return existing;
  }

  const parser = new Parser();
  parser.setLanguage(config.parserLanguage as Parser.Language);
  parserByExtension.set(extension, parser);
  return parser;
}

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

function createModuleChunk(
  filePath: string,
  content: string,
  language: string
): Chunk {
  const lineCount = content.split("\n").length;

  return {
    id: `${filePath}::module::default`,
    file_path: filePath,
    chunk_type: "module",
    content,
    start_line: 0,
    end_line: Math.max(lineCount - 1, 0),
    language
  };
}

function getIdentifierText(node: SyntaxNode | null): string | null {
  return node?.text ?? null;
}

function isExportDefault(node: SyntaxNode): boolean {
  return node.parent?.type === "export_statement" && node.parent.text.includes("default");
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
    case "interface_declaration":
      return createChunk(filePath, "interface", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, language);
    case "type_alias_declaration":
      return createChunk(filePath, "type", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, language);
    case "enum_declaration":
      return createChunk(filePath, "enum", node.childForFieldName("name")?.text ?? `anonymous_L${node.startPosition.row}`, node, language);
    case "namespace_declaration":
    case "internal_module":
    case "module": {
      const namespaceName = getIdentifierText(node.childForFieldName("name")) ?? "default";
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
          return {
            ...chunk,
            content: node.text,
            start_line: node.startPosition.row,
            end_line: node.endPosition.row
          };
        }
      }
      return null;
    default:
      return null;
  }
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

type XmlOpenElement = {
  attributes: Map<string, string>;
  name: string;
  startIndex: number;
  startLine: number;
};

function parseXmlAttributes(rawAttributes: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const attributeRegex = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/gu;

  for (const match of rawAttributes.matchAll(attributeRegex)) {
    const value = match[3] ?? match[4] ?? "";
    attributes.set(match[1], value);
  }

  return attributes;
}

function countNewlinesBefore(content: string, index: number): number {
  return content.slice(0, index).split("\n").length - 1;
}

function extractXmlChunks(source: string, filePath: string): Chunk[] {
  const baseName = path.basename(filePath);
  const isDiXml = baseName === "di.xml";
  const isLayoutXml = LAYOUT_XML_PATH.test(filePath);

  if (!isDiXml && !isLayoutXml) {
    return [];
  }

  const elementConfig = isDiXml
    ? new Map([
      ["plugin", "name"],
      ["preference", "for"],
      ["type", "name"],
      ["virtualType", "name"]
    ])
    : new Map([
      ["block", "name"],
      ["referenceBlock", "name"],
      ["referenceContainer", "name"]
    ]);

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: () => true
    });
    parser.parse(source);
  } catch {
    return [];
  }

  const chunks: Chunk[] = [];
  const stack: XmlOpenElement[] = [];
  const tagRegex = /<[^>]+>/gu;

  for (const match of source.matchAll(tagRegex)) {
    const token = match[0];
    const startIndex = match.index ?? 0;

    if (token.startsWith("<?") || token.startsWith("<!")) {
      continue;
    }

    const closingMatch = token.match(/^<\/\s*([^\s>]+)\s*>$/u);

    if (closingMatch !== null) {
      const closingName = closingMatch[1];
      const openElement = stack.pop();

      if (openElement === undefined || openElement.name !== closingName) {
        return [];
      }

      const identifierAttribute = elementConfig.get(closingName);

      if (identifierAttribute === undefined) {
        continue;
      }

      const identifier = openElement.attributes.get(identifierAttribute);

      if (identifier === undefined || identifier.length === 0) {
        continue;
      }

      const endIndex = startIndex + token.length;
      chunks.push({
        id: `${filePath}::element::${closingName}[${identifier}]`,
        file_path: filePath,
        chunk_type: "element",
        content: source.slice(openElement.startIndex, endIndex),
        start_line: openElement.startLine,
        end_line: countNewlinesBefore(source, endIndex),
        language: "xml"
      });
      continue;
    }

    const openingMatch = token.match(/^<\s*([^\s/>]+)([\s\S]*?)\s*(\/?)>$/u);

    if (openingMatch === null) {
      continue;
    }

    const [, openingName, rawAttributes, explicitSelfClosing] = openingMatch;
    const attributes = parseXmlAttributes(rawAttributes);
    const isSelfClosing = explicitSelfClosing === "/" || /\/\s*>$/u.test(token);
    const identifierAttribute = elementConfig.get(openingName);

    if (isSelfClosing) {
      if (identifierAttribute === undefined) {
        continue;
      }

      const identifier = attributes.get(identifierAttribute);

      if (identifier === undefined || identifier.length === 0) {
        continue;
      }

      const endIndex = startIndex + token.length;
      chunks.push({
        id: `${filePath}::element::${openingName}[${identifier}]`,
        file_path: filePath,
        chunk_type: "element",
        content: token,
        start_line: countNewlinesBefore(source, startIndex),
        end_line: countNewlinesBefore(source, endIndex),
        language: "xml"
      });
      continue;
    }

    stack.push({
      name: openingName,
      attributes,
      startIndex,
      startLine: countNewlinesBefore(source, startIndex)
    });
  }

  if (stack.length > 0) {
    return [];
  }

  return chunks;
}

function getSqlObjectReference(node: SyntaxNode): SyntaxNode | null {
  return node.namedChildren.find((child) => child.type === "object_reference") ?? null;
}

function getSqlQualifiedName(referenceNode: SyntaxNode | null): string | null {
  if (referenceNode === null) {
    return null;
  }

  const nameNode = referenceNode.childForFieldName("name");
  const schemaNode = referenceNode.childForFieldName("schema");
  const name = nameNode?.text ?? null;

  if (name === null) {
    return null;
  }

  if (schemaNode !== null) {
    return `${schemaNode.text}.${name}`;
  }

  return name;
}

function hasRoutineLevelError(node: SyntaxNode): boolean {
  return node.hasError || node.descendantsOfType("ERROR").length > 0;
}

function extractSqlChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const routines = rootNode.descendantsOfType([
    "create_function",
    "create_function_statement",
    "create_procedure",
    "create_procedure_statement",
    "create_trigger",
    "create_trigger_statement"
  ]) as SyntaxNode[];

  for (const routine of routines) {
    if (hasRoutineLevelError(routine)) {
      continue;
    }

    const qualifiedName = getSqlQualifiedName(getSqlObjectReference(routine));

    if (qualifiedName === null) {
      continue;
    }

    chunks.push({
      id: `${filePath}::function::${qualifiedName}`,
      file_path: filePath,
      chunk_type: "function",
      content: routine.text,
      start_line: routine.startPosition.row,
      end_line: routine.endPosition.row,
      language: "sql"
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

function sortChunks(chunks: Chunk[]): Chunk[] {
  return [...chunks].sort((left, right) => {
    if (left.start_line !== right.start_line) {
      return left.start_line - right.start_line;
    }

    if (left.chunk_type === "module" && right.chunk_type !== "module") {
      return -1;
    }

    if (right.chunk_type === "module" && left.chunk_type !== "module") {
      return 1;
    }

    return left.id.localeCompare(right.id);
  });
}

function finalizeChunks(chunks: Chunk[], options: ChunkerOptions): Chunk[] {
  const ordered = addDisambiguators(sortChunks(chunks));

  return splitOversizedChunks(
    ordered,
    options.max_chunk_chars ?? DEFAULT_MAX_CHUNK_CHARS,
    options.oversize_strategy ?? DEFAULT_OVERSIZE_STRATEGY
  );
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
    const headingText = lines[startLine].replace(/^#{1,6}\s+/u, "");

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

export function chunkFile(
  filePath: string,
  content: string,
  workspaceRoot: string,
  options: ChunkerOptions = {}
): Chunk[] {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".md" || extension === ".mdx") {
    return finalizeChunks(chunkMarkdown(filePath, content, workspaceRoot), options);
  }

  if (extension === ".xml") {
    const normalizedXmlPath = normalizeRelativePath(filePath, workspaceRoot);
    const base = [createModuleChunk(normalizedXmlPath, content, "xml")];
    const elementChunks = extractXmlChunks(content, normalizedXmlPath);
    return finalizeChunks([...base, ...elementChunks], options);
  }

  const normalizedPath = normalizeRelativePath(filePath, workspaceRoot);
  const config = languageConfigByExtension.get(extension);

  if (config === undefined) {
    return finalizeChunks([createModuleChunk(normalizedPath, content, defaultLanguageForExtension(extension))], options);
  }

  const baseChunks: Chunk[] = [createModuleChunk(normalizedPath, content, config.language)];

  if (config.strategy === "module" || config.strategy === "phtml") {
    return finalizeChunks(baseChunks, options);
  }

  const parser = createParser(extension);

  if (parser === null) {
    return finalizeChunks(baseChunks, options);
  }

  const tree = parser.parse(content);
  const rootNode = tree.rootNode;

  if (config.strategy === "symbols") {
    for (const node of rootNode.namedChildren) {
      const chunk = extractTopLevelChunk(node, normalizedPath, config.language);
      if (chunk !== null) {
        baseChunks.push(chunk);
      }
    }

    baseChunks.push(...extractMethodChunks(rootNode, normalizedPath, config.language));
    return finalizeChunks(baseChunks, options);
  }

  if (config.strategy === "php") {
    baseChunks.push(...extractPhpChunks(rootNode, normalizedPath));
    return finalizeChunks(baseChunks, options);
  }

  if (config.strategy === "sql") {
    baseChunks.push(...extractSqlChunks(rootNode, normalizedPath));
    return finalizeChunks(baseChunks, options);
  }

  if (config.strategy === "css" || config.strategy === "scss") {
    baseChunks.push(...extractCssOrScssChunks(rootNode, normalizedPath, options, config.strategy));
    return finalizeChunks(baseChunks, options);
  }

  return finalizeChunks(baseChunks, options);
}
