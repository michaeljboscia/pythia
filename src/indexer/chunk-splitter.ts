type ChunkLike = {
  id: string;
  file_path: string;
  chunk_type: string;
  content: string;
  start_line: number;
  end_line: number;
  language: string;
};

function splitTextAtNewlines(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) {
    return [content];
  }

  const lines = content.split("\n");
  const parts: string[] = [];
  let current = "";

  function pushCurrent(): void {
    if (current.length > 0) {
      parts.push(current);
      current = "";
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const suffix = index === lines.length - 1 ? "" : "\n";
    const segment = `${line}${suffix}`;

    if (segment.length > maxChars) {
      pushCurrent();

      let remaining = segment;

      while (remaining.length > maxChars) {
        parts.push(remaining.slice(0, maxChars));
        remaining = remaining.slice(maxChars);
      }

      current = remaining;
      continue;
    }

    if (current.length > 0 && current.length + segment.length > maxChars) {
      pushCurrent();
    }

    current += segment;
  }

  pushCurrent();

  return parts.length === 0 ? [content] : parts;
}

function countNewlines(value: string): number {
  return value.split("\n").length - 1;
}

function endLineForSlice(content: string, sliceEnd: number): number {
  if (sliceEnd <= 0) {
    return 0;
  }

  if (content[sliceEnd - 1] === "\n") {
    return countNewlines(content.slice(0, sliceEnd - 1));
  }

  return countNewlines(content.slice(0, sliceEnd));
}

export function splitOversizedChunks<T extends ChunkLike>(
  chunks: T[],
  maxChunkChars: Record<string, number>,
  strategy: "split" | "truncate"
): T[] {
  const output: T[] = [];

  for (const chunk of chunks) {
    const limit = maxChunkChars[chunk.chunk_type];

    if (limit === undefined || chunk.content.length <= limit) {
      output.push(chunk);
      continue;
    }

    if (strategy === "truncate") {
      const truncatedContent = `${chunk.content.slice(0, limit)}\n...[TRUNCATED]`;
      const relativeEndLine = endLineForSlice(truncatedContent, truncatedContent.length);

      output.push({
        ...chunk,
        content: truncatedContent,
        end_line: chunk.start_line + relativeEndLine
      });
      continue;
    }

    const parts = splitTextAtNewlines(chunk.content, limit);
    let consumedChars = 0;

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const partStart = consumedChars;
      const partEnd = consumedChars + part.length;
      const relativeStartLine = countNewlines(chunk.content.slice(0, partStart));
      const relativeEndLine = endLineForSlice(chunk.content, partEnd);

      output.push({
        ...chunk,
        id: `${chunk.id}#part${index + 1}`,
        content: part,
        start_line: chunk.start_line + relativeStartLine,
        end_line: chunk.start_line + relativeEndLine
      });

      consumedChars = partEnd;
    }
  }

  return output;
}
