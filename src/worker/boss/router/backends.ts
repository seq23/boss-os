import { fireworks } from "./fireworks";
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
    models: [
      {
        id: "mdl_cf_llama31_8b", slug: "@cf/meta/llama-3.1-8b-instruct",
        displayName: "Llama 3.1 8B (Workers AI)", capabilityTier: "fast",
        inMicros1k: 0, outMicros1k: 0, contextTokens: 8192,
      },
      {
        id: "mdl_cf_llama33_70b", slug: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        displayName: "Llama 3.3 70B (Workers AI)", capabilityTier: "general",
        inMicros1k: 0, outMicros1k: 0, contextTokens: 24000,
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
    models: [
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
};

export function backendKindFor(intakeKind: string | null | undefined): string | null {
  if (!intakeKind) return null;
  return INTAKE_KIND_TO_BACKEND_KIND[intakeKind] ?? null;
}
