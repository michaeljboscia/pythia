import { z } from "zod";

import { extractApiSurface } from "../indexer/api-surface-extractor.js";

export const apiSurfaceInputSchema = {
  path: z.string().describe("File path or fast-glob pattern to extract API surface from."),
  language: z.string().optional().describe("Optional language override. If omitted, inferred from file extension.")
};

export function createApiSurfaceHandler() {
  return async (input: { path: string; language?: string }) => {
    const results = await extractApiSurface(input.path);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  };
}
