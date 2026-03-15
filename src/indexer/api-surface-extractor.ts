import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import fg from "fast-glob";
import { Project } from "ts-morph";
import type { SourceFile } from "ts-morph";
import Parser from "tree-sitter";
import Go from "tree-sitter-go";
import Java from "tree-sitter-java";
import PHP from "tree-sitter-php";
import Python from "tree-sitter-python";
import Rust from "tree-sitter-rust";

type SyntaxNode = Parser.SyntaxNode;

export type ApiSurfaceResult = {
  path: string;
  surface: string;
  strategy: "ts-morph" | "tree-sitter" | "unsupported";
};

type TreeSitterConfig = {
  declarations: Set<string>;
  language: unknown;
};

const TS_MORPH_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const TREE_SITTER_CONFIG_BY_EXTENSION = new Map<string, TreeSitterConfig>([
  [
    ".py",
    {
      language: Python,
      declarations: new Set(["class_definition", "function_definition"])
    }
  ],
  [
    ".go",
    {
      language: Go,
      declarations: new Set(["function_declaration", "method_declaration", "type_declaration"])
    }
  ],
  [
    ".rs",
    {
      language: Rust,
      declarations: new Set(["enum_item", "function_item", "impl_item", "struct_item", "trait_item"])
    }
  ],
  [
    ".java",
    {
      language: Java,
      declarations: new Set([
        "class_declaration",
        "constructor_declaration",
        "enum_declaration",
        "interface_declaration",
        "method_declaration"
      ])
    }
  ],
  [
    ".php",
    {
      language: PHP.php as Parser.Language,
      declarations: new Set([
        "class_declaration",
        "enum_declaration",
        "function_definition",
        "interface_declaration",
        "method_declaration",
        "trait_declaration"
      ])
    }
  ],
  [
    ".phtml",
    {
      language: PHP.php as Parser.Language,
      declarations: new Set([
        "class_declaration",
        "enum_declaration",
        "function_definition",
        "interface_declaration",
        "method_declaration",
        "trait_declaration"
      ])
    }
  ]
]);

function extractTsMorphSurface(filePath: string): string {
  const project = new Project({
    compilerOptions: {
      target: 99,
      module: 100,
      moduleResolution: 99,
      allowJs: true,
      checkJs: true,
      declaration: true,
      strict: true,
      skipLibCheck: true
    }
  });
  const sourceFile: SourceFile = project.addSourceFileAtPath(filePath);
  const emitOutput = sourceFile.getEmitOutput({ emitOnlyDtsFiles: true });

  return emitOutput.getOutputFiles()[0]?.getText() ?? "";
}

function findBodyNode(node: SyntaxNode): SyntaxNode | null {
  const fieldBody = node.childForFieldName("body");

  if (fieldBody !== null) {
    return fieldBody;
  }

  for (const child of node.namedChildren) {
    if (
      child.type === "block"
      || child.type === "body_statement"
      || child.type === "class_body"
      || child.type === "declaration_list"
      || child.type === "enum_body"
      || child.type === "impl_item_list"
      || child.type === "interface_body"
      || child.type === "compound_statement"
    ) {
      return child;
    }
  }

  return node.lastNamedChild;
}

function buildSkeleton(source: string, node: SyntaxNode): string {
  const bodyNode = findBodyNode(node);

  if (bodyNode === null || bodyNode.startIndex <= node.startIndex) {
    return node.text.trim();
  }

  const signature = source.slice(node.startIndex, bodyNode.startIndex).trimEnd();

  if (signature.length === 0) {
    return node.text.trim();
  }

  return `${signature} { ... }`;
}

function walkTree(
  node: SyntaxNode,
  source: string,
  declarations: Set<string>,
  parts: string[]
): void {
  if (declarations.has(node.type)) {
    const skeleton = buildSkeleton(source, node);

    if (skeleton.length > 0) {
      parts.push(skeleton);
    }
  }

  for (const child of node.namedChildren) {
    walkTree(child, source, declarations, parts);
  }
}

function extractTreeSitterSurface(filePath: string, config: TreeSitterConfig): string {
  const source = readFileSync(filePath, "utf8");
  const parser = new Parser();
  parser.setLanguage(config.language as Parser.Language);
  const tree = parser.parse(source);
  const parts: string[] = [];

  walkTree(tree.rootNode, source, config.declarations, parts);

  return parts.join("\n\n");
}

function extractSingleFile(filePath: string): ApiSurfaceResult {
  const extension = path.extname(filePath).toLowerCase();

  if (TS_MORPH_EXTENSIONS.has(extension)) {
    return {
      path: filePath,
      surface: extractTsMorphSurface(filePath),
      strategy: "ts-morph"
    };
  }

  const treeSitterConfig = TREE_SITTER_CONFIG_BY_EXTENSION.get(extension);

  if (treeSitterConfig === undefined) {
    return {
      path: filePath,
      surface: "",
      strategy: "unsupported"
    };
  }

  return {
    path: filePath,
    surface: extractTreeSitterSurface(filePath, treeSitterConfig),
    strategy: "tree-sitter"
  };
}

export async function extractApiSurface(pathOrGlob: string): Promise<ApiSurfaceResult[]> {
  const paths = await fg(pathOrGlob, { onlyFiles: true, absolute: true });

  if (paths.length === 0 && !fg.isDynamicPattern(pathOrGlob)) {
    const absolutePath = path.resolve(pathOrGlob);
    const extension = path.extname(absolutePath).toLowerCase();

    if (TS_MORPH_EXTENSIONS.has(extension) || TREE_SITTER_CONFIG_BY_EXTENSION.has(extension)) {
      if (!existsSync(absolutePath)) {
        throw new Error(`API_SURFACE_PATH_NOT_FOUND: ${absolutePath}`);
      }
    }

    return [extractSingleFile(absolutePath)];
  }

  return Promise.all(paths.map(async (filePath) => extractSingleFile(filePath)));
}
