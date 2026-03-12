import path from "node:path";

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
import XML from "tree-sitter-xml";

import {
  DEFAULT_CSS_RULE_CHUNK_MIN_CHARS,
  DEFAULT_MAX_CHUNK_CHARS,
  DEFAULT_OVERSIZE_STRATEGY
} from "../config.js";
import { splitOversizedChunks } from "./chunk-splitter.js";

type SyntaxNode = Parser.SyntaxNode;
type ChunkStrategy =
  | "symbols"
  | "php"
  | "phtml"
  | "xml"
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
  [".xml", { language: "xml", parserLanguage: XML.xml as Parser.Language, strategy: "xml" }],
  [".sql", { language: "sql", parserLanguage: SQL as Parser.Language, strategy: "module" }],
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function stripXmlAttributeValue(rawValue: string): string {
  return rawValue.replace(/^['"]/u, "").replace(/['"]$/u, "");
}

function getXmlTagNode(node: SyntaxNode): SyntaxNode | null {
  return node.namedChildren.find((child) => child.type === "STag" || child.type === "EmptyElemTag") ?? null;
}

function getXmlTagName(tagNode: SyntaxNode | null): string | null {
  return tagNode?.namedChildren.find((child) => child.type === "Name")?.text ?? null;
}

function getXmlAttributes(tagNode: SyntaxNode | null): Map<string, string> {
  const attributes = new Map<string, string>();

  if (tagNode === null) {
    return attributes;
  }

  for (const child of tagNode.namedChildren) {
    if (child.type !== "Attribute") {
      continue;
    }

    const nameNode = child.namedChildren.find((namedChild) => namedChild.type === "Name");
    const valueNode = child.namedChildren.find((namedChild) => namedChild.type === "AttValue");

    if (nameNode !== undefined && valueNode !== undefined) {
      attributes.set(nameNode.text, stripXmlAttributeValue(valueNode.text));
    }
  }

  return attributes;
}

function extractXmlChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  if (rootNode.hasError) {
    return [];
  }

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

  const chunks: Chunk[] = [];

  function walk(node: SyntaxNode): void {
    if (node.type === "element") {
      const tagNode = getXmlTagNode(node);
      const tagName = getXmlTagName(tagNode);

      if (tagName !== null) {
        const identifierAttribute = elementConfig.get(tagName);

        if (identifierAttribute !== undefined) {
          const attributes = getXmlAttributes(tagNode);
          const identifier = attributes.get(identifierAttribute);

          if (identifier !== undefined) {
            chunks.push({
              id: `${filePath}::element::${tagName}[${identifier}]`,
              file_path: filePath,
              chunk_type: "element",
              content: node.text,
              start_line: node.startPosition.row,
              end_line: node.endPosition.row,
              language: "xml"
            });
          }
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

function countNewlinesBefore(content: string, index: number): number {
  return content.slice(0, index).split("\n").length - 1;
}

function findMatchingBrace(content: string, openBraceIndex: number): number {
  let depth = 0;

  for (let index = openBraceIndex; index < content.length; index += 1) {
    if (content[index] === "{") {
      depth += 1;
      continue;
    }

    if (content[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractScssPatternChunks(
  content: string,
  filePath: string,
  keyword: "function" | "mixin",
  chunkType: "function" | "mixin"
): Chunk[] {
  const regex = new RegExp(`@${keyword}\\s+([A-Za-z0-9_-]+)\\s*\\(`, "gu");
  const chunks: Chunk[] = [];

  for (const match of content.matchAll(regex)) {
    const name = match[1];
    const startIndex = match.index ?? 0;
    const openBraceIndex = content.indexOf("{", startIndex);

    if (openBraceIndex === -1) {
      continue;
    }

    const closeBraceIndex = findMatchingBrace(content, openBraceIndex);

    if (closeBraceIndex === -1) {
      continue;
    }

    chunks.push({
      id: `${filePath}::${chunkType}::${name}`,
      file_path: filePath,
      chunk_type: chunkType,
      content: content.slice(startIndex, closeBraceIndex + 1),
      start_line: countNewlinesBefore(content, startIndex),
      end_line: countNewlinesBefore(content, closeBraceIndex + 1),
      language: "scss"
    });
  }

  return chunks;
}

function getCssNamedChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.namedChildren.find((child) => child.type === type) ?? null;
}

function combineSelectors(parentSelector: string | null, childSelector: string): string {
  const normalizedChild = normalizeWhitespace(childSelector);

  if (parentSelector === null || parentSelector === "") {
    return normalizedChild;
  }

  const parentParts = parentSelector.split(",").map((part) => normalizeWhitespace(part)).filter(Boolean);
  const childParts = normalizedChild.split(",").map((part) => normalizeWhitespace(part)).filter(Boolean);
  const combined: string[] = [];

  for (const childPart of childParts) {
    if (childPart.includes("&")) {
      for (const parentPart of parentParts) {
        combined.push(normalizeWhitespace(childPart.replace(/&/gu, parentPart)));
      }
      continue;
    }

    for (const parentPart of parentParts) {
      combined.push(normalizeWhitespace(`${parentPart} ${childPart}`));
    }
  }

  return combined.join(", ");
}

function cssAtRuleName(node: SyntaxNode): string {
  return normalizeWhitespace(node.text.split("{")[0].split(";")[0]);
}

function isCssAtRuleNode(node: SyntaxNode): boolean {
  return node.text.startsWith("@")
    && (node.type === "at_rule" || node.type.endsWith("_statement"));
}

function extractCssChunks(
  rootNode: SyntaxNode,
  filePath: string,
  options: ChunkerOptions,
  strategy: "css" | "scss"
): Chunk[] {
  const threshold = options.css_rule_chunk_min_chars ?? DEFAULT_CSS_RULE_CHUNK_MIN_CHARS;
  const chunks: Chunk[] = [];

  function walk(node: SyntaxNode, parentSelector: string | null = null): void {
    for (const child of node.namedChildren) {
      if (child.type === "rule_set") {
        const selectorsNode = getCssNamedChild(child, "selectors");
        const selectorText = selectorsNode?.text;

        if (selectorText !== undefined) {
          const selectorName = combineSelectors(parentSelector, selectorText);

          if (child.text.length >= threshold) {
            chunks.push({
              id: `${filePath}::rule::${selectorName}`,
              file_path: filePath,
              chunk_type: "rule",
              content: child.text,
              start_line: child.startPosition.row,
              end_line: child.endPosition.row,
              language: strategy
            });
          }

          if (strategy === "scss") {
            const blockNode = getCssNamedChild(child, "block");
            if (blockNode !== null) {
              walk(blockNode, selectorName);
            }
          }
        }

        continue;
      }

      if (isCssAtRuleNode(child)) {
        const atRuleName = cssAtRuleName(child);

        if (
          !atRuleName.startsWith("@function")
          && !atRuleName.startsWith("@mixin")
          && !atRuleName.startsWith("@return")
        ) {
          chunks.push({
            id: `${filePath}::at_rule::${atRuleName}`,
            file_path: filePath,
            chunk_type: "at_rule",
            content: child.text,
            start_line: child.startPosition.row,
            end_line: child.endPosition.row,
            language: strategy
          });
        }

        if (strategy === "scss") {
          const blockNode = getCssNamedChild(child, "block");
          if (blockNode !== null) {
            walk(blockNode, parentSelector);
          }
        }

        continue;
      }

      if (strategy === "scss" && child.type === "block") {
        walk(child, parentSelector);
      }
    }
  }

  walk(rootNode);

  if (strategy === "scss") {
    chunks.push(...extractScssPatternChunks(rootNode.text, filePath, "mixin", "mixin"));
    chunks.push(...extractScssPatternChunks(rootNode.text, filePath, "function", "function"));
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
    for (const node of rootNode.namedChildren) {
      const chunk = extractPhpTopLevelChunk(node, normalizedPath);
      if (chunk !== null) {
        baseChunks.push(chunk);
      }
    }

    baseChunks.push(...extractMethodChunks(rootNode, normalizedPath, "php"));
    return finalizeChunks(baseChunks, options);
  }

  if (config.strategy === "xml") {
    baseChunks.push(...extractXmlChunks(rootNode, normalizedPath));
    return finalizeChunks(baseChunks, options);
  }

  if (config.strategy === "css" || config.strategy === "scss") {
    baseChunks.push(...extractCssChunks(rootNode, normalizedPath, options, config.strategy));
    return finalizeChunks(baseChunks, options);
  }

  return finalizeChunks(baseChunks, options);
}
