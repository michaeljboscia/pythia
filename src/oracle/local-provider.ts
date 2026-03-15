import type { ReasoningProvider } from "./provider.js";

export class LocalReasoningProvider implements ReasoningProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  async query(prompt: string, context: string[]): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      messages: [{ role: "user", content: [prompt, ...context].join("\n\n") }],
      stream: false
    });

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
    } catch (error) {
      throw new Error(`PROVIDER_UNAVAILABLE: local provider unreachable at ${this.baseUrl}: ${String(error)}`);
    }

    if (!response.ok) {
      throw new Error(`PROVIDER_UNAVAILABLE: /v1/chat/completions returned HTTP ${response.status}`);
    }

    const json = await response.json() as { choices: Array<{ message: { content: string } }> };
    return json.choices[0].message.content;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/models`);

      if (!response.ok) {
        return false;
      }

      const json = await response.json() as { data: Array<{ id: string }> };
      return json.data.some((model) => model.id === this.model);
    } catch {
      return false;
    }
  }

  describe(): { provider: string; model: string } {
    return { provider: "local", model: this.model };
  }
}
