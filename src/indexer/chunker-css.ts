import Parser from "tree-sitter";

import { DEFAULT_CSS_RULE_CHUNK_MIN_CHARS } from "../config.js";
import type { Chunk, ChunkerOptions } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
  const normalizedChild = normalizeWhitespace(childSelector).replace(/&\s+([_-])/gu, "&$1");

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

    if (/^[-_]/u.test(childPart)) {
      for (const parentPart of parentParts) {
        combined.push(normalizeWhitespace(`${parentPart}${childPart}`));
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

export function extractCssOrScssChunks(
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

          if (strategy === "scss" || strategy === "css") {
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

        if (strategy === "scss" || strategy === "css") {
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
