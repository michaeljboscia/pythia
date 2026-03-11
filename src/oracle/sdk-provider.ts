import { GoogleGenAI } from "@google/genai";

import type { ReasoningProvider } from "./provider.js";

type GenerateContentResponse = {
  text?: string;
};

type GenerateContentClient = {
  models: {
    generateContent(options: {
      model: string;
      contents: string;
      config: {
        responseMimeType: string;
      };
    }): Promise<GenerateContentResponse>;
  };
};

function joinContext(prompt: string, context: string[]): string {
  const sections = context
    .filter((entry) => entry.trim().length > 0)
    .map((entry, index) => `Context ${index + 1}:\n${entry}`);

  sections.push(`Prompt:\n${prompt}`);
  return sections.join("\n\n");
}

export class SdkReasoningProvider implements ReasoningProvider {
  private readonly client: GenerateContentClient;

  constructor(
    apiKey: string,
    createClient: (apiKey: string) => GenerateContentClient = defaultCreateClient
  ) {
    this.client = createClient(apiKey);
  }

  async query(prompt: string, context: string[]): Promise<string> {
    const response = await this.client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: joinContext(prompt, context),
      config: {
        responseMimeType: "text/plain"
      }
    });

    return response.text?.trim() ?? "";
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.query("Respond with OK.", []);
      return true;
    } catch {
      return false;
    }
  }
}

function defaultCreateClient(apiKey: string): GenerateContentClient {
  return new GoogleGenAI({ apiKey });
}

export type { GenerateContentClient };
