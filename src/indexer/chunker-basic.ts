export type BasicChunk = {
  content: string;
  startLine: number;
  endLine: number;
};

export function chunkFile(content: string, chunkSize = 50, overlap = 10): BasicChunk[] {
  const lines = content.split("\n");

  if (lines.length === 0) {
    return [];
  }

  const chunks: BasicChunk[] = [];
  const step = Math.max(1, chunkSize - overlap);

  for (let startLine = 0; startLine < lines.length; startLine += step) {
    const endLine = Math.min(lines.length, startLine + chunkSize);
    const chunkLines = lines.slice(startLine, endLine);

    if (chunkLines.length === 0) {
      continue;
    }

    chunks.push({
      content: chunkLines.join("\n"),
      startLine,
      endLine: endLine - 1
    });

    if (endLine === lines.length) {
      break;
    }
  }

  return chunks;
}
