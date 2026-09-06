export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  modelSlug: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature: number;
}

export interface CompletionResult {
  text: string;
  inTokens: number;
  outTokens: number;
}

export interface ProviderAdapter {
  id: string;
  complete(req: CompletionRequest, apiKey: string, baseUrl: string): Promise<CompletionResult>;
}
