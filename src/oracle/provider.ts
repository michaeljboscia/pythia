export interface ReasoningProvider {
  query(prompt: string, context: string[]): Promise<string>;
  healthCheck(): Promise<boolean>;
}
