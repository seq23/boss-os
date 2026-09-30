export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  modelSlug: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature: number;
  /**
   * Ask the provider to refuse any endpoint that trains on what it is sent.
   *
   * SET FROM THE MODEL ROW, NOT FROM THE CALLER'S LABEL. The router sets it true exactly when
   * `models.data_use` is `NO_TRAINING_CONTRACTUAL`, so a row claiming to be private-capable cannot
   * be called without the vendor being asked to honour that claim. See `openrouter.ts`.
   *
   * ABSENT MEANS "DO NOT ASK", WHICH IS ONLY EVER CORRECT FOR A ROUTE ALREADY RECORDED AS
   * TRAINING-PERMITTING — `policy.ts` has refused those any private work long before an adapter
   * runs. An adapter with no way to honour it ignores the field; that is safe because such a
   * provider's models cannot be marked non-training in the first place without a diff here.
   */
  requireNoTraining?: boolean;
  /**
   * When this fires, the call is abandoned.
   *
   * REQUIRED IN PRACTICE THOUGH OPTIONAL IN TYPE. Every adapter must honour it, and
   * `a-model-call-cannot-hang.mjs` fails the build for any adapter that reaches a provider without
   * passing it on. It is optional here only so a test or a bench may call an adapter directly
   * without constructing one; the router always supplies it. See `deadlines.ts` for the numbers and
   * the measurements behind them.
   */
  signal?: AbortSignal;
  /**
   * LET THE MODEL SEARCH THE WEB BEFORE IT ANSWERS (30 Sep 2026). Only an adapter that has a search
   * tool of its own honours it — today that is OpenAI's, through the Responses API. An adapter that
   * does not must ignore it and the router does not ask one to: `RouteRequest.webSearch` confines the
   * run to the provider that can.
   */
  webSearch?: boolean;
}

export interface CompletionResult {
  text: string;
  inTokens: number;
  outTokens: number;
  /** The pages a search-enabled call actually cited, as the provider reported them. */
  sources?: { title: string; url: string }[];
  /**
   * Charges the token counts do not carry. OpenAI bills each web-search call separately from tokens,
   * so a run that searched twenty times cost more than its tokens say; the router adds this to the
   * figure it records.
   */
  extraCostMicros?: number;
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
