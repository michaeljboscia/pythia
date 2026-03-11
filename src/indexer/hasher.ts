import { createHash } from "node:crypto";

import { blake3 } from "hash-wasm";

export async function hashFile(content: Buffer | string): Promise<string> {
  try {
    const digest = await blake3(content);
    return `blake3:${digest}`;
  } catch {
    const digest = createHash("sha256")
      .update(typeof content === "string" ? Buffer.from(content) : content)
      .digest("hex");

    return `sha256:${digest}`;
  }
}
