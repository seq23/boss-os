import { anthropic } from "./anthropic";
import { fireworks } from "./fireworks";
import { openai } from "./openai";
import { openrouter } from "./openrouter";
import { workersAi } from "./workersAi";
import type { ProviderAdapter, WorkersAiBinding } from "./types";

/**
 * HOW A `cloud_model` BACKEND IS ACTUALLY CALLED.
 *
 * This file is deliberately small, and what is NOT in it matters more than what
 * is. It holds no ceiling, no lever, no free-tier rule and no allowance
 * arithmetic — every one of those lives in `../backends/guard.ts`, which is the
 * single place this system decides whether something may run. A second copy of
 * that arithmetic here would be the "two components each keeping their own list,
 * with no link between them" defect, and the two copies would eventually
 * disagree about whether a call was affordable.
 *
 * What this file holds is the one thing the guard cannot: the wire. A registry
 * row says a backend exists and may take work; this says which function to call,
 * at which host, with which credential.
 *
 * THE HOST IS A CONSTANT HERE, NOT A COLUMN. `providers.base_url` is a database
 * value, and a database value is something a request could one day set.
 * Provisioning reads the URL from this file and never from a request body, which
 * is what keeps the single OpenRouter egress-allowlist entry honest.
 *
 * THE LOCAL RUNTIME IS ABSENT ON PURPOSE. `bk_local_runtime` is `agent_executed`
 * and disabled — DEFERRED, NO LOCAL HOST. A Worker cannot reach a model on the
 * owner's Mac, so there is nothing here for it to point at. The slot exists in
 * the registry; a wire to it does not, and pretending otherwise would be the
 * "exists but nothing invokes it" defect wearing a sovereignty badge.
 */

export interface BackendModelSeed {
  id: string;
  slug: string;
  displayName: string;
  capabilityTier: "fast" | "general" | "frontier";
  inMicros1k: number;
  outMicros1k: number;
  contextTokens: number | null;
}

export interface CloudBackendWiring {
  backendId: string;
  providerId: string;
  providerName: string;
  /** The ONE host this backend may reach. `binding:AI` means it reaches none. */
  baseUrl: string;
  /** The NAME of a credential or binding, matching `execution_backends.credential_ref`. */
  credential: { kind: "env" | "binding"; name: string };
  adapter: ProviderAdapter;
  note: string;
  /** Models this backend may be provisioned with. Unbenchmarked, low risk, cloud. */
  models: BackendModelSeed[];
}

export const CLOUD_BACKENDS: CloudBackendWiring[] = [
  {
    backendId: "bk_workers_ai",
    providerId: "prv_workers_ai",
    providerName: "Workers AI",
    baseUrl: "binding:AI",
    credential: { kind: "binding", name: "AI" },
    adapter: workersAi,
    note: "A binding, so no key and no egress. The included daily allowance makes routine work genuinely $0.",
    /*
     * THE PRICES ARE NOT ZERO, AND THE ROUTE IS STILL FREE. Those are two different facts and this
     * file used to conflate them.
     *
     * Cloudflare publishes a real per-token rate for both of these (migration 0248 quotes it, from
     * the vendor's own token column, cross-checked against the neuron column at $0.011 per 1,000
     * neurons). What makes a Workers AI call cost nothing is the INCLUDED DAILY ALLOWANCE, which is
     * a property of the BACKEND — `backends/guard.ts` proves it there, and `routeIsBilled` is the
     * one statement of it.
     *
     * Writing 0 here to mean "free" put a price nobody had checked into the ledger and made the
     * estimate exactly zero, so the per-run cap, the task envelope and the lane budget had nothing
     * to compare against and could not have refused a Workers AI call however large it was. These
     * figures MUST equal the migration's: `validate:free-brain` compares the two lists and fails if
     * they drift, which is how this was caught.
     */
    models: [
      {
        // THE SLUG IS `-fp8` BECAUSE THAT IS THE ONE THAT EXISTS. The unquantised
        // `@cf/meta/llama-3.1-8b-instruct` was seeded here and is not in the account's model
        // catalogue at all, so this row would have provisioned cleanly and then failed at the
        // first call — the failure landing on whoever typed the first sentence. The provisioning
        // script now checks every slug against `wrangler ai models` before writing a row.
        id: "mdl_cf_llama31_8b", slug: "@cf/meta/llama-3.1-8b-instruct-fp8",
        displayName: "Llama 3.1 8B (Workers AI)", capabilityTier: "fast",
        inMicros1k: 152, outMicros1k: 287, contextTokens: 8192,
      },
      {
        id: "mdl_cf_llama33_70b", slug: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        displayName: "Llama 3.3 70B (Workers AI)", capabilityTier: "general",
        inMicros1k: 293, outMicros1k: 2253, contextTokens: 24000,
      },
    ],
  },
  {
    backendId: "bk_openrouter",
    providerId: "prv_openrouter",
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    credential: { kind: "env", name: "OPENROUTER_API_KEY" },
    adapter: openrouter,
    note: "One host, reached only through this router. Free variants carry the :free suffix, which is what proves the route free — a zero in a price column does not.",
    /*
     * ─── THE ONE LADDER, MIGRATION 0256 ───────────────────────────────────────
     *
     * Every row below completed a REAL GENERATION through `/chat/completions` on 17 September 2026
     * before it was written here — HTTP 200 with actual text back, not a read-only probe. The two
     * lanes that would not complete are in the migration, registered and DISABLED with their
     * refusals quoted, and they are deliberately absent from this list: this constant is the
     * provisioning source, and provisioning a row that cannot serve is how a dead lane comes to
     * look healthy.
     *
     * PRICES ARE MICRODOLLARS PER 1,000 TOKENS and must equal the migration's exactly —
     * `validate:free-brain` compares the two lists field by field and fails on any drift. They were
     * read live from https://openrouter.ai/api/v1/models and every paid one was then checked
     * against the `usage.cost` a real call actually reported.
     *
     * NOTHING HERE IS `frontier`, INCLUDING SONNET 5, and that is a deliberate reading of what the
     * column does. `capability_tier` gates cost modes — `NORMAL.allowedTiers` is `["fast",
     * "general"]` and NORMAL is the live mode — so a `frontier` rung is refused at Stage 2 on every
     * ordinary run and the ladder simply stops above it. A last resort nothing can reach is not a
     * last resort. Cost ordering, not the tier, is what keeps the dear rungs last.
     */
    models: [
      // ── Free reasoning, rungs 100-130. All $0 by the :free suffix; all training-permitting. ──
      {
        id: "mdl_or_nemotron_ultra_free", slug: "nvidia/nemotron-3-ultra-550b-a55b:free",
        displayName: "Nemotron 3 Ultra 550B (OpenRouter, free)", capabilityTier: "general",
        inMicros1k: 0, outMicros1k: 0, contextTokens: 1000000,
      },
      {
        id: "mdl_or_deepseek_v4_free", slug: "deepseek/deepseek-v4-flash-0731:free",
        displayName: "DeepSeek V4 Flash (OpenRouter, free)", capabilityTier: "general",
        inMicros1k: 0, outMicros1k: 0, contextTokens: 1048576,
      },
      {
        id: "mdl_or_glm52_free", slug: "z-ai/glm-5.2:free",
        displayName: "GLM 5.2 (OpenRouter, free)", capabilityTier: "general",
        inMicros1k: 0, outMicros1k: 0, contextTokens: 32768,
      },
      {
        id: "mdl_or_nemotron_super_free", slug: "nvidia/nemotron-3-super-120b-a12b:free",
        displayName: "Nemotron 3 Super 120B (OpenRouter, free)", capabilityTier: "general",
        inMicros1k: 0, outMicros1k: 0, contextTokens: 262144,
      },
      // ── The two older free rows, rungs 150-160. Unchanged. ──────────────────
      {
        id: "mdl_or_llama33_free", slug: "meta-llama/llama-3.3-70b-instruct:free",
        displayName: "Llama 3.3 70B (OpenRouter, free)", capabilityTier: "general",
        inMicros1k: 0, outMicros1k: 0, contextTokens: 65536,
      },
      {
        id: "mdl_or_gemma3_free", slug: "google/gemma-3-27b-it:free",
        displayName: "Gemma 3 27B (OpenRouter, free)", capabilityTier: "fast",
        inMicros1k: 0, outMicros1k: 0, contextTokens: 96000,
      },
      /*
       * ── Paid, rungs 200-250, cheapest first, every one private-capable. ─────
       *
       * These are the lanes an LP name may reach, and what makes that true is not the vendor's
       * reputation: `openrouter.ts` sends `provider: { data_collection: "deny" }` on every call to
       * a model recorded non-training, OpenRouter refuses any endpoint that collects, and a request
       * it cannot satisfy comes back 404 rather than going somewhere that trains. Proven
       * negatively the same day — two `:free` rungs were refused under the identical flag.
       */
      {
        id: "mdl_or_gemini_flash_lite", slug: "google/gemini-2.5-flash-lite",
        displayName: "Gemini 2.5 Flash Lite (OpenRouter)", capabilityTier: "general",
        inMicros1k: 100, outMicros1k: 400, contextTokens: 1048576,
      },
      {
        id: "mdl_or_gpt5_mini", slug: "openai/gpt-5-mini",
        displayName: "GPT-5 mini (OpenRouter)", capabilityTier: "general",
        inMicros1k: 250, outMicros1k: 2000, contextTokens: 400000,
      },
      {
        id: "mdl_or_gemini_flash", slug: "google/gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash (OpenRouter)", capabilityTier: "general",
        inMicros1k: 300, outMicros1k: 2500, contextTokens: 1048576,
      },
      {
        // The same model as the free rung at the top, by a paid road: when the free endpoint is
        // exhausted the work gets the same brain and a bill, not a weaker brain and silence.
        id: "mdl_or_nemotron_ultra", slug: "nvidia/nemotron-3-ultra-550b-a55b",
        displayName: "Nemotron 3 Ultra 550B (OpenRouter, metered)", capabilityTier: "general",
        inMicros1k: 625, outMicros1k: 3125, contextTokens: 262144,
      },
      {
        id: "mdl_or_haiku45", slug: "anthropic/claude-haiku-4.5",
        displayName: "Claude Haiku 4.5 (OpenRouter)", capabilityTier: "general",
        inMicros1k: 1000, outMicros1k: 5000, contextTokens: 200000,
      },
      {
        id: "mdl_or_sonnet5", slug: "anthropic/claude-sonnet-5",
        displayName: "Claude Sonnet 5 (OpenRouter)", capabilityTier: "general",
        inMicros1k: 2000, outMicros1k: 10000, contextTokens: 1000000,
      },
    ],
  },
  /*
   * ─── THE TWO FRONTIER BACKENDS, AND WHY THEY EXIST ────────────────────────
   *
   * Everything else in this system was pushed DOWN to the cheapest model that could do the job. One
   * briefing cost $3.88 by inheriting the default, and the fix was to name a cheap model on every
   * duty. Coaching is the deliberate exception, in her words:
   *
   *   "i think for coaching it is imperative that i use the best models with the best thinking
   *    brains and the most integrity."
   *
   * It is the one route carrying her interior life and the quality of the reasoning IS the product.
   * A verified turn on 9 September was answered by Llama 3.1 8B on Workers AI — free, working, and
   * exactly the wrong instrument for the job.
   *
   * DIRECT, NOT THROUGH OPENROUTER, for this route only. OpenRouter stays wired and stays the right
   * trade for utility work; it is the wrong one here because it puts an extra party in the one
   * conversation whose design is about minimising who sees her words.
   *
   * BOTH, SO SHE CAN COMPARE. Picking on reputation is not testable. Running a week on each and
   * keeping the one she trusts more when it disagrees with her is.
   *
   * PRICES ARE PER 1,000 TOKENS IN MICRODOLLARS, from the published list prices at the time of
   * writing. They are estimates in exactly the way every other price in this file is: the ledger has
   * arithmetic it can prove and prices it cannot, and it says so.
   */
  {
    backendId: "bk_anthropic",
    providerId: "prv_anthropic",
    providerName: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    credential: { kind: "env", name: "ANTHROPIC_API_KEY" },
    adapter: anthropic,
    note: "Direct, for coaching only. Nothing here is free, so it never runs while the spend lever is at FREE_ONLY — and coaching is her asking directly, which the budget never blocks.",
    models: [
      {
        id: "mdl_anthropic_frontier", slug: "claude-sonnet-4-5-20250929",
        displayName: "Claude Sonnet 4.5 (Anthropic)", capabilityTier: "frontier",
        inMicros1k: 3000, outMicros1k: 15000, contextTokens: 200000,
      },
    ],
  },
  {
    backendId: "bk_openai",
    providerId: "prv_openai",
    providerName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    credential: { kind: "env", name: "OPENAI_API_KEY" },
    adapter: openai,
    note: "Direct, for coaching only. The second frontier provider, so no critical capability depends permanently on one vendor.",
    models: [
      {
        id: "mdl_openai_frontier", slug: "gpt-4.1",
        displayName: "GPT-4.1 (OpenAI)", capabilityTier: "frontier",
        inMicros1k: 2000, outMicros1k: 8000, contextTokens: 1000000,
      },
    ],
  },
  {
    backendId: "bk_fireworks",
    providerId: "prv_fireworks",
    providerName: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    credential: { kind: "env", name: "FIREWORKS_API_KEY" },
    adapter: fireworks,
    note: "The paid tier. Nothing here is free, so it never runs while the spend lever is at FREE_ONLY.",
    models: [],
  },
];

export const WIRING_BY_PROVIDER = new Map(CLOUD_BACKENDS.map((b) => [b.providerId, b]));
export const WIRING_BY_BACKEND = new Map(CLOUD_BACKENDS.map((b) => [b.backendId, b]));

export interface AdapterCredential {
  available: boolean;
  /** Named, always. An absent credential is reported by name, never inferred around. */
  detail: string;
  apiKey?: string;
  ai?: WorkersAiBinding;
}

/**
 * Fetch the credential VALUE for a call.
 *
 * `guard.credentialState()` answers "does this exist" for the registry and the
 * screens, and it is the authority on that question. This answers the different
 * question an adapter needs answered at the moment of the call — "hand me the
 * thing" — and it never disagrees with the guard, because both read the same
 * `env` by the same name.
 */
export function adapterCredential(env: unknown, wiring: CloudBackendWiring): AdapterCredential {
  const bag = env as Record<string, unknown>;
  if (wiring.credential.kind === "binding") {
    const binding = bag[wiring.credential.name] as WorkersAiBinding | undefined;
    if (!binding || typeof binding.run !== "function") {
      return { available: false, detail: `the ${wiring.credential.name} binding is not configured on this Worker` };
    }
    return { available: true, detail: `binding ${wiring.credential.name}`, ai: binding };
  }
  const key = bag[wiring.credential.name];
  if (typeof key !== "string" || key.length === 0) {
    return { available: false, detail: `${wiring.credential.name} is not set` };
  }
  return { available: true, detail: `${wiring.credential.name} is set`, apiKey: key };
}

/**
 * THE LINK BETWEEN TWO VOCABULARIES THAT WERE WRITTEN SEPARATELY.
 *
 * `INTAKE_KINDS` in shared/boss/governance.ts classifies WHAT WAS ASKED FOR —
 * drafting, research, coaching, decision_support. `execution_backends.allowed_kinds`
 * in migration 0173 classifies WHAT KIND OF WORK a backend may be handed —
 * document, research, classify, summarise, repo_work. They are different lists
 * and neither is wrong, but nothing joined them, and two components each keeping
 * their own list with no link between them is the defect this repository names
 * explicitly. This table is the link, in one place, so the join can be read and
 * changed rather than being re-derived differently at each call site.
 *
 * AN UNMAPPED KIND REFUSES. There is no default: a task kind nobody has decided
 * about is an absent input, and the guard's `task_kind_absent` refusal says so.
 * Adding a kind here is a deliberate act with a diff behind it.
 */
export const INTAKE_KIND_TO_BACKEND_KIND: Record<string, string> = {
  one_off: "document",
  recurring_duty: "document",
  scheduled_check: "classify",
  triggered_workflow: "document",
  approval_request: "document",
  research: "research",
  drafting: "document",
  coaching: "document",
  memory_promotion: "classify",
  relationship: "document",
  decision_support: "research",
  repository: "repo_work",
  model_benchmark: "summarise",
  trading: "research",
  west_peek_bridge: "document",
  new_agent_proposal: "document",
  /*
   * ─── THE FIRM SCAN'S CALLS, NAMED FOR WHAT THE MODEL IS ACTUALLY ASKED TO DO ───
   *
   * "Find firms that did X" (research/firmScan.ts) is a `research` TASK, and Workers AI is rightly
   * not allowed research — a model that cannot open a page must not be asked to recall one. But
   * the scan does not ask it to: the Worker fetches the news itself and hands the model the text.
   * What the model does is write three search queries (a classification-sized job) and extract
   * named firms with a verbatim sentence from text it was given (a summarise-sized job), and each
   * finding is then checked against the page by code. Those calls carry these kinds, so the
   * routing record says what happened and the free non-training rung may take them.
   */
  search_queries: "classify",
  extract_from_fetched_text: "summarise",
};

export function backendKindFor(intakeKind: string | null | undefined): string | null {
  if (!intakeKind) return null;
  return INTAKE_KIND_TO_BACKEND_KIND[intakeKind] ?? null;
}
