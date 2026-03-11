import { readFileSync } from "node:fs";
import path from "node:path";

import * as ts from "typescript";

export interface GraphEdge {
  source_id: string;
  target_id: string;
  edge_type: "CALLS" | "IMPORTS" | "RE_EXPORTS";
}

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const fileStore = new Map<string, { version: number; content: string }>();
const registry = ts.createDocumentRegistry();

let workspaceRoot = "";
let service: ts.LanguageService | null = null;

function isSupportedSourceFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isInWorkspace(absPath: string): boolean {
  const resolvedPath = path.resolve(absPath);

  if (!resolvedPath.startsWith(workspaceRoot)) {
    return false;
  }

  return !resolvedPath.split(path.sep).includes("node_modules");
}

function toRepoRelative(absPath: string): string {
  return path.relative(workspaceRoot, absPath).split(path.sep).join("/").replace(/^\.\//, "");
}

export function registerFileInLS(absPath: string, content: string): void {
  const resolvedPath = path.resolve(absPath);
  const existing = fileStore.get(resolvedPath);

  fileStore.set(resolvedPath, {
    version: (existing?.version ?? 0) + 1,
    content
  });
}

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [...fileStore.keys()],
  getScriptVersion: (fileName) => (fileStore.get(path.resolve(fileName))?.version ?? 0).toString(),
  getScriptSnapshot: (fileName) => {
    const resolvedPath = path.resolve(fileName);
    const cached = fileStore.get(resolvedPath);

    if (cached !== undefined) {
      return ts.ScriptSnapshot.fromString(cached.content);
    }

    try {
      const content = readFileSync(resolvedPath, "utf8");

      if (isInWorkspace(resolvedPath) && isSupportedSourceFile(resolvedPath)) {
        fileStore.set(resolvedPath, { version: 0, content });
      }

      return ts.ScriptSnapshot.fromString(content);
    } catch {
      return undefined;
    }
  },
  getCurrentDirectory: () => workspaceRoot,
  getCompilationSettings: (): ts.CompilerOptions => ({
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    esModuleInterop: true,
    maxNodeModuleJsDepth: 0
  }),
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories
};

export function initLanguageService(wsRoot: string): void {
  workspaceRoot = path.resolve(wsRoot);
  fileStore.clear();
  service?.dispose();
  service = ts.createLanguageService(host, registry);
}

function pushUnique(edges: GraphEdge[], seen: Set<string>, edge: GraphEdge): void {
  const key = `${edge.edge_type}:${edge.source_id}->${edge.target_id}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  edges.push(edge);
}

function getMethodCni(node: ts.MethodDeclaration, filePath: string): string | null {
  const methodName = node.name && ts.isIdentifier(node.name) ? node.name.text : null;

  if (methodName === null) {
    return null;
  }

  let current: ts.Node | undefined = node.parent;

  while (current !== undefined) {
    if (ts.isClassDeclaration(current) && current.name !== undefined) {
      return `${filePath}::class::${current.name.text}::method::${methodName}`;
    }

    current = current.parent;
  }

  return null;
}

function getFunctionName(node: ts.FunctionLikeDeclarationBase): string | null {
  if ("name" in node && node.name !== undefined && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  const parent = node.parent;

  if (parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }

  if (parent !== undefined && ts.isBinaryExpression(parent) && ts.isIdentifier(parent.left)) {
    return parent.left.text;
  }

  return null;
}

function enclosingFunctionCni(node: ts.Node, relPath: string): string {
  let current: ts.Node | undefined = node.parent;

  while (current !== undefined) {
    if (ts.isMethodDeclaration(current)) {
      const methodCni = getMethodCni(current, relPath);

      if (methodCni !== null) {
        return methodCni;
      }
    }

    if (
      ts.isFunctionDeclaration(current)
      || ts.isArrowFunction(current)
      || ts.isFunctionExpression(current)
    ) {
      const functionName = getFunctionName(current);

      if (functionName !== null) {
        return `${relPath}::function::${functionName}`;
      }
    }

    current = current.parent;
  }

  return `${relPath}::module::default`;
}

function definitionToCni(definition: ts.DefinitionInfo): string | null {
  if (!isInWorkspace(definition.fileName)) {
    return null;
  }

  const relPath = toRepoRelative(definition.fileName);
  const kind = definition.kind;
  const name = definition.name;

  if (name.length === 0) {
    return null;
  }

  if (kind === ts.ScriptElementKind.memberFunctionElement || kind === ts.ScriptElementKind.memberVariableElement) {
    if (definition.containerName.length === 0) {
      return null;
    }

    return `${relPath}::class::${definition.containerName}::method::${name}`;
  }

  if (kind === ts.ScriptElementKind.moduleElement || kind === ts.ScriptElementKind.externalModuleName) {
    return `${relPath}::module::default`;
  }

  if (kind === ts.ScriptElementKind.classElement) {
    return `${relPath}::class::${name}`;
  }

  if (kind === ts.ScriptElementKind.interfaceElement) {
    return `${relPath}::interface::${name}`;
  }

  if (kind === ts.ScriptElementKind.enumElement || kind === ts.ScriptElementKind.enumMemberElement) {
    return `${relPath}::enum::${name}`;
  }

  if (kind === ts.ScriptElementKind.typeElement || kind === ts.ScriptElementKind.typeParameterElement) {
    return `${relPath}::type::${name}`;
  }

  return `${relPath}::function::${name}`;
}

export function extractEdges(absFilePath: string, content: string): GraphEdge[] {
  if (service === null) {
    throw new Error("LanguageService not initialized — call initLanguageService() first");
  }

  const languageService = service;

  const resolvedPath = path.resolve(absFilePath);

  if (!isSupportedSourceFile(resolvedPath)) {
    return [];
  }

  registerFileInLS(resolvedPath, content);

  const program = languageService.getProgram();

  if (program === undefined) {
    return [];
  }

  const sourceFile = program.getSourceFile(resolvedPath);

  if (sourceFile === undefined) {
    return [];
  }

  const relPath = toRepoRelative(resolvedPath);
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const resolved = ts.resolveModuleName(
        node.moduleSpecifier.text,
        resolvedPath,
        host.getCompilationSettings(),
        ts.sys
      );
      const targetPath = resolved.resolvedModule?.resolvedFileName;

      if (targetPath !== undefined && isInWorkspace(targetPath)) {
        pushUnique(edges, seen, {
          source_id: `${relPath}::module::default`,
          target_id: `${toRepoRelative(targetPath)}::module::default`,
          edge_type: "IMPORTS"
        });
      }
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const specifier of node.exportClause.elements) {
          const targetNode = specifier.propertyName ?? specifier.name;
          const definitions = languageService.getDefinitionAtPosition(resolvedPath, targetNode.getStart(sourceFile)) ?? [];

          for (const definition of definitions) {
            const targetCni = definitionToCni(definition);

            if (targetCni !== null) {
              pushUnique(edges, seen, {
                source_id: `${relPath}::module::default`,
                target_id: targetCni,
                edge_type: "RE_EXPORTS"
              });
            }
          }
        }
      } else {
        const resolved = ts.resolveModuleName(
          node.moduleSpecifier.text,
          resolvedPath,
          host.getCompilationSettings(),
          ts.sys
        );
        const targetPath = resolved.resolvedModule?.resolvedFileName;

        if (targetPath !== undefined && isInWorkspace(targetPath)) {
          pushUnique(edges, seen, {
            source_id: `${relPath}::module::default`,
            target_id: `${toRepoRelative(targetPath)}::module::default`,
            edge_type: "RE_EXPORTS"
          });
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const definitions = languageService.getDefinitionAtPosition(resolvedPath, node.expression.getStart(sourceFile)) ?? [];

      for (const definition of definitions) {
        if (path.resolve(definition.fileName) === resolvedPath || !isInWorkspace(definition.fileName)) {
          continue;
        }

        const targetCni = definitionToCni(definition);

        if (targetCni === null) {
          continue;
        }

        pushUnique(edges, seen, {
          source_id: enclosingFunctionCni(node, relPath),
          target_id: targetCni,
          edge_type: "CALLS"
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return edges;
}
