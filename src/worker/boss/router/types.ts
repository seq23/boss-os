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

/**
 * What an adapter is handed at call time.
 *
 * `apiKey` is optional BECAUSE ONE BACKEND HAS NO KEY. Workers AI is a binding —
 * `env.AI` — so it has no hostname, no credential and nothing on the egress
 * allowlist. Making the key optional here is what lets a binding-backed backend
 * exist without every caller pretending to hold a secret it does not have.
 */
export interface AdapterContext {
  baseUrl: string;
  apiKey?: string;
  ai?: WorkersAiBinding;
}

/**
 * The shape of `env.AI` this router uses, declared locally.
 *
 * WHY LOCALLY: the binding is not on `Env` in `src/worker/boss/env.ts` and this
 * stage does not own that file, so the router reads it defensively and records
 * its ABSENCE rather than assuming it exists. An absent binding is an absent
 * input: Workers AI reports "binding AI is not configured on this Worker" and
 * refuses, which is the honest answer until `wrangler.toml` declares it.
 */
export interface WorkersAiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/**
 * A provider call that failed, carrying whether it is worth trying again.
 *
 * The distinction is load-bearing. 429 and 503 are the provider explicitly
 * saying "later"; a 400 or a 500 fails identically on a retry and burning a hop
 * on it only delays the fallback. Retrying everything is how a bounded retry
 * becomes a retry storm with a bill attached.
 */
export class ProviderCallError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}

/** True for the statuses a provider uses to mean "try again shortly". */
export function statusIsRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504;
}

export interface ProviderAdapter {
  id: string;
  complete(req: CompletionRequest, ctx: AdapterContext): Promise<CompletionResult>;
}
