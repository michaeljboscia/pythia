import type { PythiaConfig } from "../config.js";
import { CliReasoningProvider } from "./cli-provider.js";
import { SdkReasoningProvider } from "./sdk-provider.js";

export interface ReasoningProvider {
  query(prompt: string, context: string[]): Promise<string>;
  healthCheck(): Promise<boolean>;
}

export function createReasoningProvider(
  config: Pick<PythiaConfig, "reasoning">,
  env: NodeJS.ProcessEnv = process.env
): ReasoningProvider {
  const envApiKey = env.GEMINI_API_KEY?.trim();
  const configApiKey = config.reasoning.mode === "sdk" ? config.reasoning.gemini_api_key?.trim() : undefined;
  const apiKey = envApiKey && envApiKey.length > 0 ? envApiKey : configApiKey;

  if (config.reasoning.mode === "sdk" && apiKey && apiKey.length > 0) {
    return new SdkReasoningProvider(apiKey);
  }

  return new CliReasoningProvider();
}
