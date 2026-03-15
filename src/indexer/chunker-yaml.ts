import type { Chunk } from "./chunker-treesitter.js";

const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):/u;

export function extractYamlChunks(source: string, filePath: string): Chunk[] {
  const lines = source.split("\n");
  const chunks: Chunk[] = [];
  let currentKey: string | null = null;
  let startLine = 0;
  const currentLines: string[] = [];

  function flush(endLine: number): void {
    if (currentKey !== null && currentLines.length > 0) {
      chunks.push({
        id: `${filePath}::block::${currentKey}`,
        file_path: filePath,
        chunk_type: "block",
        content: currentLines.join("\n"),
        start_line: startLine,
        end_line: endLine - 1,
        language: "yaml"
      });
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = TOP_LEVEL_KEY.exec(line);

    if (match !== null) {
      flush(index);
      currentKey = match[1];
      startLine = index;
      currentLines.length = 0;
    }

    if (currentKey !== null) {
      currentLines.push(line);
    }
  }

  flush(lines.length);
  return chunks;
}
