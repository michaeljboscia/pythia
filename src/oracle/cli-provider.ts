import { spawn } from "node:child_process";

import { PythiaError } from "../errors.js";
import type { ReasoningProvider } from "./provider.js";

type CliResponse = {
  code: number;
  stderr: string;
  stdout: string;
};

type CliRunner = (prompt: string, context: string[]) => Promise<CliResponse>;
type SleepFn = (delayMs: number) => Promise<void>;

const RETRY_DELAYS_MS = [1000, 5000, 15000] as const;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isAuthInvalid(detail: string): boolean {
  return /auth|unauthori[sz]ed|permission denied|gemini_api_key|login/i.test(detail);
}

function parseGeminiJson(stdout: string): string {
  const parsed = JSON.parse(stdout) as
    | string
    | {
      response?: string;
      text?: string;
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

  if (typeof parsed === "string") {
    return parsed;
  }

  if (typeof parsed.response === "string") {
    return parsed.response;
  }

  if (typeof parsed.text === "string") {
    return parsed.text;
  }

  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (text.length > 0) {
    return text;
  }

  throw new Error("Gemini CLI returned an unsupported JSON payload");
}

async function defaultRunner(prompt: string, context: string[]): Promise<CliResponse> {
  return await new Promise((resolve, reject) => {
    const child = spawn("gemini", [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      "gemini-2.5-flash",
      "--yolo"
    ], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stderr,
        stdout
      });
    });

    child.stdin.write(context.join("\n\n"));
    child.stdin.end();
  });
}

export class CliReasoningProvider implements ReasoningProvider {
  private readonly runner: CliRunner;
  private readonly sleepImpl: SleepFn;

  constructor(options: { runner?: CliRunner; sleepImpl?: SleepFn } = {}) {
    this.runner = options.runner ?? defaultRunner;
    this.sleepImpl = options.sleepImpl ?? sleep;
  }

  async query(prompt: string, context: string[]): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await this.runner(prompt, context);
        const detail = [response.stderr, response.stdout].filter(Boolean).join("\n").trim();

        if (response.code !== 0) {
          if (isAuthInvalid(detail)) {
            throw new PythiaError("AUTH_INVALID", detail);
          }

          throw new Error(detail.length === 0 ? `Gemini CLI exited with ${response.code}` : detail);
        }

        return parseGeminiJson(response.stdout);
      } catch (error) {
        lastError = error;

        if (error instanceof PythiaError && error.code === "AUTH_INVALID") {
          throw error;
        }

        if (attempt < RETRY_DELAYS_MS.length - 1) {
          await this.sleepImpl(RETRY_DELAYS_MS[attempt]);
        }
      }
    }

    throw new PythiaError(
      "PROVIDER_UNAVAILABLE",
      lastError instanceof Error ? lastError.message : String(lastError)
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.query("Respond with OK.", []);
      return true;
    } catch {
      return false;
    }
  }

  describe(): { provider: string; model: string } {
    return { provider: "gemini-cli", model: "gemini" };
  }
}
