/**
 * The refusal layer for the execution backend registry — Stage 1, `docs/boss/PLAN_v21.md`.
 *
 * Canon: Phase 9 §33, Sovereignty Addendum §1 and §3.1, v20.1 §3 (the airlock).
 *
 * EVERY RULE HERE CAN REFUSE, AND EVERY REFUSAL CARRIES TWO THINGS: a code a caller can branch on
 * and a sentence a person can read. The pair matters because these refusals surface in two places
 * with different audiences — `backend_runs.refusal_reason` is read by the owner in an approval
 * card, and the code is what a router matches on to try the next backend.
 *
 * A REFUSAL IS NOT A FAILURE. `backend_runs` gives them separate statuses on purpose, and nothing
 * in this file ever returns a failure shape for a deliberate decline. A backend that says "no,
 * because the ceiling is spent" has worked correctly; colouring that red teaches the owner to
 * ignore red.
 *
 * FAIL CLOSED, INCLUDING ON IGNORANCE. An unknown backend id, an absent task kind, a credential
 * this Worker cannot see, a spend figure with no window to belong to — each is a refusal. The
 * airlock already establishes this shape for classification (§11, "Unknown classification"); the
 * same logic applies to "where may this run".
 */

import type { AiProcessing } from "../policy/airlock";
import type { Sensitivity } from "../../../shared/boss/governance";
import type { Backend } from "./registry";
import { newId } from "../lib/id";
import { laneBudgetState } from "../router/budget";
import { formatMicros, spendLeverState, type SpendLeverState } from "../router/spend";
import type { Env } from "../env";

/** Machine-readable refusal codes. Closed on purpose: a router matches on these. */
export type RefusalCode =
  | "backend_unknown"
  | "backend_not_enabled"
  | "task_kind_absent"
  | "task_kind_not_allowed"
  | "action_forbidden"
  | "capability_missing"
  | "credential_absent"
  | "local_only_processing"
  | "restricted_needs_routing_card"
  | "spend_window_absent"
  | "budget_ceiling_breached"
  | "zero_ceiling_not_free_tier"
  | "cost_estimate_absent"
  | "lane_budget_absent"
  | "lane_budget_exhausted"
  | "lever_free_only";

export interface Refusal {
  refused: true;
  code: RefusalCode;
  backend_id: string;
  /** What the owner reads. One sentence, says what was refused and what would change it. */
  sentence: string;
  /** The facts the sentence was built from, so a refusal can be checked rather than believed. */
  detail: Record<string, unknown>;
  /** True when a human decision could legitimately unblock this, rather than a code change. */
  approvable: boolean;
}

export interface Permitted {
  refused: false;
  backend_id: string;
  /** §3.1 puts cost LAST. This is the tiebreak among survivors, never a way past a rule above. */
  cost_rank: number;
  cost_basis: FreeTier;
  credential: CredentialState;
  /** What this request may spend, and on whose authority. Never a bare number with no story. */
  spend: SpendVerdict;
}

/**
 * WHAT MAY BE SPENT, SAID OUT LOUD RATHER THAN ENCODED IN A NUMBER.
 *
 * There is no sentinel here — no `Infinity`, no `-1`, no "0 means unlimited". "There is no cap"
 * is its own named state, because a future reader who misreads a sentinel misreads it in the
 * direction of spending money.
 */
export type SpendVerdict =
  /** A genuinely free route. It spends nothing, so no cap applies and none was consulted. */
  | { kind: "no_cost"; note: string }
  /** `min(lane remaining, lever allowance, ceiling − spent)`, with the binding side named. */
  | { kind: "capped"; allowance_micros: number; bound_by: BoundBy; note: string }
  /** The OPEN lever position. No dollar ceiling exists to compare against; spend still accrues. */
  | { kind: "uncapped"; note: string };

export type Verdict = Permitted | Refusal;

/** Which of the three stated limits is doing the limiting. Named so a refusal can point at it. */
export type BoundBy = "lane" | "lever" | "backend_ceiling";

// ─── Credentials ─────────────────────────────────────────────────────────────

/**
 * THREE STATES, NOT TWO, and the third is the honest one.
 *
 * `credential_ref` is a NAME. For an env var or a binding this Worker can see whether the thing
 * exists. For `local:claude-code-session` it cannot and never will — that credential lives on the
 * owner's Mac, which is the whole point of the arrangement (PLAN_v21 Stage 2: "the cloud half
 * never holds it, so a compromised Worker cannot spend it").
 *
 * Reporting that as `present` would be a guess. Reporting it as `absent` would make the entire
 * `agent_executed` class permanently ineligible and Stage 2 impossible. So it is recorded as what
 * it is — not knowable from here — and the verification moves to the party that can do it: the
 * private agent, at the moment it claims the task. §20's rule is the same rule: an absent input is
 * recorded as absent, never defaulted to a guess.
 */
export type CredentialPresence = "present" | "absent" | "unverifiable_here";

export interface CredentialState {
  ref: string | null;
  presence: CredentialPresence;
  /** Why the presence is what it is. Never the value, and never a fragment of one. */
  note: string;
}

/**
 * `local:none` is NOT the same as `local:<something>`.
 *
 * It is the local runtime's row saying, in data, that no such credential exists — the DEFERRED
 * slot Batch 2 fills. That is a positive statement of absence, so it refuses, while a named local
 * credential defers verification to the machine that holds it.
 */
export function credentialState(env: Env, ref: string | null): CredentialState {
  if (!ref) {
    return {
      ref: null,
      presence: "absent",
      note: "This backend names no credential at all, so there is nothing to authenticate with.",
    };
  }

  if (ref === "local:none") {
    return {
      ref,
      presence: "absent",
      note: "The row declares that no credential exists for this backend — it is a registered slot, not a running thing.",
    };
  }

  if (ref.startsWith("local:")) {
    return {
      ref,
      presence: "unverifiable_here",
      note:
        `${ref} lives on the owner's machine and is deliberately not held by this Worker. ` +
        `Presence is verified by the private agent when it claims the task, not from here.`,
    };
  }

  if (ref.startsWith("binding:")) {
    const name = ref.slice("binding:".length);
    const bound = name in (env as unknown as Record<string, unknown>);
    return {
      ref,
      presence: bound ? "present" : "absent",
      note: bound
        ? `The ${name} binding is attached to this Worker, so no key exists to leak.`
        : `No ${name} binding is attached to this Worker. It is declared in wrangler config, not set as a secret.`,
    };
  }

  const value = (env as unknown as Record<string, unknown>)[ref];
  const present = typeof value === "string" && value.trim().length > 0;
  return {
    ref,
    presence: present ? "present" : "absent",
    note: present
      ? `${ref} is set on this Worker.`
      : `${ref} is not set on this Worker. Set the secret before enabling this backend.`,
  };
}

// ─── The $0 posture ──────────────────────────────────────────────────────────

/**
 * WHAT A CEILING OF ZERO MEANS, stated once, because getting it wrong costs money.
 *
 * Every seeded backend carries `monthly_ceiling_micros = 0`. Zero is neither "unlimited" nor
 * "nothing may ever run". It means **only genuinely free tiers may run** — the migration says so
 * in the OpenRouter row's own comment ("A zero ceiling means only free-tier models are eligible;
 * raising it is a deliberate, visible act") and the owner's standing instruction is to keep this
 * system as close to $0 as possible.
 *
 * WHICH TIERS ARE GENUINELY FREE IS A FACT ABOUT A VENDOR, NOT A ROW. It is hardcoded here for the
 * same reason `bridge/categories.ts` hardcodes its forbidden list: a table of "what counts as
 * free" is a table somebody can edit at 2am to unlock spending, and this is the one control
 * standing between a zero ceiling and a surprise invoice.
 *
 * A CALLER MAY NOT ASSERT ITS OWN ROUTE IS FREE. `free_model_slug` is checked against the model
 * the request actually names, using OpenRouter's own `:free` suffix convention — an observable
 * property of the route, not a claim.
 */
export type FreeTierKind = "no_vendor_call" | "included_allowance" | "free_model_slug" | "metered";

export interface FreeTier {
  kind: FreeTierKind;
  free: boolean;
  /** Cheaper is a lower number. §3.1's LAST criterion, applied only to backends already permitted. */
  rank: number;
  basis: string;
}

const FREE_ROUTES: Record<string, { kind: "included_allowance" | "free_model_slug"; suffix?: string; basis: string }> = {
  bk_workers_ai: {
    kind: "included_allowance",
    basis: "Workers AI's included daily allowance on an account already paid for. No key, no egress, no per-call charge.",
  },
  bk_openrouter: {
    kind: "free_model_slug",
    suffix: ":free",
    basis: "OpenRouter bills nothing for a model whose slug ends in :free. Any other slug is metered.",
  },
};

export function freeTier(backend: Backend, model?: string | null): FreeTier {
  // Nothing on this side is billed for work that happens on the owner's own machine under her own
  // session. That is not the same as "free" in the sovereignty sense — see externalInference().
  if (backend.class === "agent_executed") {
    return {
      kind: "no_vendor_call",
      free: true,
      rank: 0,
      basis: "Runs on the owner's machine under her own session. This system is billed nothing for it.",
    };
  }

  const rule = FREE_ROUTES[backend.id];
  if (!rule) {
    return {
      kind: "metered",
      free: false,
      rank: 3,
      basis: `${backend.display_name} has no free tier recorded here, so every call to it costs money.`,
    };
  }

  if (rule.kind === "included_allowance") {
    return { kind: "included_allowance", free: true, rank: 1, basis: rule.basis };
  }

  const slug = typeof model === "string" ? model.trim() : "";
  if (!slug) {
    return {
      kind: "metered",
      free: false,
      rank: 3,
      basis: `${backend.display_name} has free models, but this request named none, so nothing shows the route is free.`,
    };
  }
  if (slug.endsWith(rule.suffix!)) {
    return { kind: "free_model_slug", free: true, rank: 2, basis: `${slug} — ${rule.basis}` };
  }
  return {
    kind: "metered",
    free: false,
    rank: 3,
    basis: `${slug} is not a ${rule.suffix} model on ${backend.display_name}, so it is metered.`,
  };
}

// ─── Sovereignty ─────────────────────────────────────────────────────────────

/**
 * The ONLY backend a LOCAL_ONLY-processing task may reach — migration 0173's own words for the
 * local runtime row: "the only backend eligible for a LOCAL_ONLY-processing task".
 *
 * Hardcoded, and an unknown id is not in it, so a backend added later is sovereign only when
 * somebody says so here in a diff.
 */
export const LOCAL_ONLY_ELIGIBLE = new Set<string>(["bk_local_runtime"]);

/**
 * `agent_executed` DOES NOT MEAN LOCAL, and conflating the two is the mistake worth writing down.
 *
 * Claude Code runs on the owner's Mac, which makes it private from this Worker — and it still
 * sends every token it reads to Anthropic. Only a runtime with locally stored weights performs no
 * external inference. So restricted content needs an approved routing card for Claude Code exactly
 * as it does for OpenRouter.
 */
export function sendsToExternalModel(backend: Backend): boolean {
  return !LOCAL_ONLY_ELIGIBLE.has(backend.id);
}

// ─── Budget windows ──────────────────────────────────────────────────────────

/** UTC calendar month, matching `router/budget.ts` so two budgets never disagree about "month". */
export function monthWindowStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export interface WindowState {
  spent_micros: number;
  lapsed: boolean;
  /** A spend figure with no window it belongs to cannot be checked against a ceiling. */
  unusable: boolean;
}

/**
 * THE LANE BUDGET IS THE DOLLAR AUTHORITY. A BACKEND CEILING IS A SUB-CAP INSIDE IT.
 *
 * `budgets` already governs money per lane and per period with a hard stop — ops is $2/day and
 * $25/month in this build. A backend ceiling narrows that for one backend; it never widens it and
 * it is never consulted alone. Effective allowance is therefore
 * `min(lane remaining, ceiling − spent)`, computed in ONE place below, which is what stops this
 * becoming "two components each keeping their own list with no link between them".
 *
 * `remaining_micros` is NULL, not zero, when the lane has no budget row. A lane nobody funded is
 * an absence of authority, not a $0 grant, and the two refuse with different sentences.
 *
 * COST MODE IS NOT READ HERE, DELIBERATELY. The six cost modes govern which capability tiers may
 * run and how many fallback hops are allowed — a quality question. Reading one as the other is how
 * "we are in low-cost mode" silently becomes "we have no money", or worse, the reverse.
 */
export interface LaneAllowance {
  lane: string;
  /** null = the lane has no budget row at all. Absence, recorded as absence. */
  remaining_micros: number | null;
  blocked: boolean;
  blocked_period: string | null;
}

export async function laneAllowance(db: D1Database, lane: string): Promise<LaneAllowance> {
  const state = await laneBudgetState(db, lane);
  return {
    lane,
    remaining_micros: state.rows.length ? state.remainingMicros : null,
    blocked: state.blocked,
    blocked_period: state.blockedPeriod,
  };
}

// ─── The spend lever ─────────────────────────────────────────────────────────

/**
 * THE LEVER IS NOT DEFINED HERE. IT IS READ FROM THE ONE PLACE THAT OWNS IT.
 *
 * `router/spend.ts` holds the owner's three positions — FREE_ONLY ($0, the default), MODERATE (a
 * figure she sets), OPEN (no dollar ceiling) — along with the remedy sentence each position
 * carries. This file imports that state rather than parsing `settings.spend_lever` a second time,
 * because two readers of one setting is how the guard and the router end up disagreeing about
 * whether there is money.
 *
 * WHAT THIS FILE ADDS is the only thing the lever cannot know: how its allowance combines with the
 * lane budget and one backend's sub-cap. See `effectiveAllowance` below — the smallest of the
 * three always wins, which is what makes three numbers incapable of disagreeing.
 *
 * FAIL CLOSED ON A MISSING ARGUMENT. `spendLeverState` already resolves an absent, misspelled or
 * hand-edited position to FREE_ONLY. This constant covers the other absence — a caller that passed
 * no lever at all — so OPEN is unreachable by omission as well as by typo.
 */
export const FREE_ONLY_FALLBACK: SpendLeverState = {
  position: "FREE_ONLY",
  allowanceMicros: 0,
  uncapped: false,
  moderateMicros: 0,
  moderateSource: "absent",
  label: "Free only — $0",
  remedy:
    "No spend lever was supplied with this request, so the system holds at $0. " +
    "Move the lever to MODERATE or OPEN in Settings to allow paid models.",
};

export { spendLeverState, formatMicros };
export type { SpendLeverState };

export function windowState(backend: Backend, now: number): WindowState {
  const start = monthWindowStart(now);
  if (backend.window_started_at === null) {
    // Zero spend with no window is the seeded state and reads fine. Recorded spend with no window
    // is a broken row, and guessing which month it belongs to would be inventing evidence.
    return { spent_micros: backend.spent_micros, lapsed: false, unusable: backend.spent_micros > 0 };
  }
  if (backend.window_started_at < start) {
    return { spent_micros: 0, lapsed: true, unusable: false };
  }
  return { spent_micros: backend.spent_micros, lapsed: false, unusable: false };
}

/**
 * THE ONE PLACE THE THREE LIMITS ARE COMBINED.
 *
 * Nothing else in this system may compute "how much may this backend spend". If a second site did
 * the arithmetic, the two could disagree about whether a call is affordable — the "two components
 * each keeping their own list, with no link" defect. Three numbers that can never disagree,
 * because the smallest always wins:
 *
 *   the lane budget       — the outer dollar authority, and the lever never raises it;
 *   the lever's allowance — what the owner has currently pulled the lever to;
 *   the backend's ceiling — a sub-cap for this one backend, WHEN ONE IS SET.
 *
 * A CEILING OF 0 IS "NO SUB-CAP STATED", NOT "$0 FOR THIS BACKEND". Every seeded row is 0 because
 * a registry that arrives with per-backend budgets already typed in is a registry nobody set. At
 * FREE_ONLY that distinction cannot matter — the lever's own allowance is 0, so nothing paid runs
 * whatever the ceilings say. It only becomes visible once she pulls the lever, and at that point
 * the honest reading is the one that makes the lever work: a backend with no figure of its own
 * defers to the lever. To hold ONE backend at $0 while others spend, disable it — that is a
 * statement, and it says why in `status_reason`.
 *
 * `bound_by` names which side is limiting, so a refusal can tell the owner which lever to pull.
 */
export function effectiveAllowance(
  backend: Backend,
  window: WindowState,
  lane: LaneAllowance,
  lever: SpendLeverState,
): { micros: number; bound_by: BoundBy; backend_remaining_micros: number | null } {
  const backendRemaining =
    backend.monthly_ceiling_micros > 0 ? Math.max(0, backend.monthly_ceiling_micros - window.spent_micros) : null;
  const laneRemaining = lane.remaining_micros ?? 0;

  const candidates: { micros: number; bound_by: BoundBy }[] = [
    { micros: laneRemaining, bound_by: "lane" },
    { micros: lever.allowanceMicros, bound_by: "lever" },
  ];
  if (backendRemaining !== null) candidates.push({ micros: backendRemaining, bound_by: "backend_ceiling" });

  // Ties resolve to the FIRST candidate, so a refusal names the outer authority rather than the
  // narrower one when both say the same number. The lane is the fact she can least easily change.
  const tightest = candidates.reduce((a, b) => (b.micros < a.micros ? b : a));
  return { ...tightest, backend_remaining_micros: backendRemaining };
}

// ─── The request ─────────────────────────────────────────────────────────────

export interface BackendRequest {
  /** Actions the work would perform. Anything on `forbidden_actions` refuses the whole request. */
  actions?: string[];
  /** A capability the work needs, checked against the backend's `capabilities`. */
  requires?: string | null;
  sensitivity?: Sensitivity | null;
  /** The airlock's second axis. LOCAL_ONLY leaves exactly one backend standing. */
  aiProcessing?: AiProcessing | null;
  /** Held on the task's permission envelope by an approved `model_route` card. Never assumed. */
  cloudForRestrictedAllowed?: boolean;
  /** The model slug the route would use, where the backend has one. Proves a free-tier route. */
  model?: string | null;
  /** Absent means absent. Under a live ceiling a metered route with no estimate is refused. */
  estimatedCostMicros?: number;
  /**
   * The lane's own budget, read by `laneAllowance()`. Passed in rather than fetched so this stays
   * a pure function — and omitting it does not open a hole: a metered route with no lane authority
   * attached is refused, never waved through.
   */
  laneBudget?: LaneAllowance;
  /** Omitting it is not a shortcut to OPEN — an absent lever is FREE_ONLY. */
  lever?: SpendLeverState;
  now?: number;
}

const refuse = (
  backend_id: string,
  code: RefusalCode,
  sentence: string,
  detail: Record<string, unknown>,
  approvable = false,
): Refusal => ({ refused: true, code, backend_id, sentence, detail, approvable });

/**
 * The whole boundary, in the order the Sovereignty Addendum §3.1 fixes and this file may not
 * reorder: permission and data sensitivity → required capability → availability → approved
 * budget → then cost preference.
 *
 * Cost is last and is only a RANK on the returned verdict — there is no branch anywhere below in
 * which a cheaper backend skips a check a dearer one had to pass. That is the addendum's actual
 * requirement: a cheaper route may never bypass a privacy rule or a quality gate.
 */
export function evaluateBackend(env: Env, backend: Backend, taskKind: string | null | undefined, req: BackendRequest = {}): Verdict {
  const now = req.now ?? Date.now();

  // ── 1. Permission and data sensitivity ──────────────────────────────────────
  if (backend.status !== "enabled") {
    return refuse(
      backend.id,
      "backend_not_enabled",
      `${backend.display_name} is ${backend.status}, not enabled, so it may not take work. ${backend.status_reason ?? "No reason is recorded on the row."}`,
      { status: backend.status, status_reason: backend.status_reason },
    );
  }

  const kind = typeof taskKind === "string" ? taskKind.trim() : "";
  if (!kind) {
    return refuse(
      backend.id,
      "task_kind_absent",
      "The request named no task kind, and an unnamed kind cannot be checked against an allowed list.",
      { allowed_kinds: backend.allowed_kinds },
    );
  }
  if (!backend.allowed_kinds.includes(kind)) {
    return refuse(
      backend.id,
      "task_kind_not_allowed",
      `${backend.display_name} is not allowed to take ${kind} work. Its allowed kinds are ${backend.allowed_kinds.join(", ") || "none"}.`,
      { task_kind: kind, allowed_kinds: backend.allowed_kinds },
    );
  }

  const requested = (req.actions ?? []).map((a) => String(a).trim()).filter(Boolean);
  const forbidden = requested.filter((a) => backend.forbidden_actions.includes(a));
  if (forbidden.length) {
    return refuse(
      backend.id,
      "action_forbidden",
      `${forbidden.join(", ")} ${forbidden.length === 1 ? "is" : "are"} on ${backend.display_name}'s forbidden list and no request can lift it. Every run ends as a proposal in the approval inbox instead.`,
      { forbidden_requested: forbidden, forbidden_actions: backend.forbidden_actions },
    );
  }

  if (req.aiProcessing === "LOCAL_ONLY" && !LOCAL_ONLY_ELIGIBLE.has(backend.id)) {
    return refuse(
      backend.id,
      "local_only_processing",
      `This work is classed LOCAL_ONLY for AI processing, and ${backend.display_name} sends what it reads to an external model. Nothing is transmitted.`,
      { ai_processing: "LOCAL_ONLY", class: backend.class, local_only_eligible: [...LOCAL_ONLY_ELIGIBLE] },
    );
  }

  if (req.sensitivity === "restricted" && sendsToExternalModel(backend) && !req.cloudForRestrictedAllowed) {
    return refuse(
      backend.id,
      "restricted_needs_routing_card",
      `Restricted content does not reach ${backend.display_name} on this system's own authority. Approve a sensitive-routing card for the task first.`,
      { sensitivity: "restricted", class: backend.class },
      true,
    );
  }

  // ── 2. Required capability ──────────────────────────────────────────────────
  const requires = typeof req.requires === "string" ? req.requires.trim() : "";
  if (requires && !backend.capabilities.includes(requires)) {
    return refuse(
      backend.id,
      "capability_missing",
      `${backend.display_name} cannot do ${requires}. It can do ${backend.capabilities.join(", ") || "nothing recorded"}.`,
      { required: requires, capabilities: backend.capabilities },
    );
  }

  // ── 3. Availability ─────────────────────────────────────────────────────────
  const credential = credentialState(env, backend.credential_ref);
  if (credential.presence === "absent") {
    return refuse(
      backend.id,
      "credential_absent",
      `${backend.display_name} cannot run: ${credential.note}`,
      { credential_ref: credential.ref, presence: credential.presence },
    );
  }

  // ── 4. Approved budget ──────────────────────────────────────────────────────
  const window = windowState(backend, now);
  if (window.unusable) {
    return refuse(
      backend.id,
      "spend_window_absent",
      `${backend.display_name} has ${backend.spent_micros} micros of recorded spend and no window it belongs to, so its ceiling cannot be checked.`,
      { spent_micros: backend.spent_micros, window_started_at: backend.window_started_at },
    );
  }

  const cost = freeTier(backend, req.model);
  const lever = req.lever ?? FREE_ONLY_FALLBACK;
  const permit = (spend: SpendVerdict): Permitted => ({
    refused: false,
    backend_id: backend.id,
    cost_rank: cost.rank,
    cost_basis: cost,
    credential,
    spend,
  });

  /*
   * A FREE ROUTE PASSES EVERY SPEND GATE BECAUSE IT SPENDS NOTHING.
   *
   * Neither the ceiling nor the lane budget is consulted, and that is the point of the $0 posture
   * rather than a hole in it: a hard-stopped ops budget must not be able to stop Workers AI's
   * included allowance. If it could, the day the lane hit its cap would be the day the system
   * stopped doing even the work that costs nothing.
   */
  if (cost.free) return permit({ kind: "no_cost", note: cost.basis });

  // ── From here the route costs money, so the lever governs it ────────────────

  if (lever.position === "FREE_ONLY") {
    return refuse(
      backend.id,
      "lever_free_only",
      `${backend.display_name} would charge for this, and the spend lever is at $0. ${lever.remedy} ` +
        `Work that costs nothing keeps running meanwhile — Workers AI's included allowance, and OpenRouter models priced at zero.`,
      { lever_position: lever.position, lever_allowance_micros: lever.allowanceMicros, free_tier: cost.kind },
    );
  }

  /*
   * OPEN — THE BRANCH WHERE THERE IS NO CEILING TO COMPARE AGAINST.
   *
   * Named rather than implied. The owner chose "genuinely uncapped", so this path computes no
   * allowance, consults no lane budget and consults no backend ceiling — there is nothing to
   * consult. It is reachable only from an exact `OPEN` in `settings.spend_lever`; every other
   * value, including none and including a caller that passed no lever at all, lands on FREE_ONLY.
   *
   * SPEND IS STILL ACCRUED. The runner writes `backend_runs.cost_micros` and
   * `execution_backends.spent_micros` exactly as it does at MODERATE. Uncapped means nothing here
   * refuses on money; it does not mean nobody counts it, and she still needs to see the number.
   */
  if (lever.uncapped) {
    return permit({
      kind: "uncapped",
      note:
        `The lever is OPEN, so no dollar ceiling applies to ${backend.display_name} and nothing was compared ` +
        `against one. This run's cost is still recorded against its monthly window.`,
    });
  }

  // ── MODERATE: every stated figure applies, and the smallest of them wins ─────

  if (req.estimatedCostMicros === undefined || req.estimatedCostMicros === null) {
    return refuse(
      backend.id,
      "cost_estimate_absent",
      `${backend.display_name} is metered and this request carries no cost estimate, so there is nothing to check ` +
        `against the ${formatMicros(lever.allowanceMicros)} the lever allows. An unpriced call is refused rather than guessed at.`,
      { lever_allowance_micros: lever.allowanceMicros, monthly_ceiling_micros: backend.monthly_ceiling_micros, spent_micros: window.spent_micros },
    );
  }

  const lane = req.laneBudget;
  if (!lane) {
    return refuse(
      backend.id,
      "lane_budget_absent",
      `No lane budget was supplied with this request. The lane's budget is the outer dollar authority and the ` +
        `lever never raises it, so nothing that costs money runs without one.`,
      { lever_allowance_micros: lever.allowanceMicros },
    );
  }
  if (lane.remaining_micros === null) {
    return refuse(
      backend.id,
      "lane_budget_absent",
      `The ${lane.lane} lane has no budget at all, so there is no dollar authority for ${backend.display_name} to ` +
        `spend against. A lane nobody funded is an absence of permission, not a $0 allowance. Give the lane a budget first.`,
      { lane: lane.lane, lever_allowance_micros: lever.allowanceMicros },
    );
  }
  if (lane.blocked) {
    return refuse(
      backend.id,
      "lane_budget_exhausted",
      `The ${lane.lane} lane has spent its ${lane.blocked_period ?? "current"} budget, so nothing that costs money ` +
        `runs in it until the window rolls or you raise that budget. Free tiers are unaffected and still run.`,
      { lane: lane.lane, blocked_period: lane.blocked_period, lever_allowance_micros: lever.allowanceMicros },
    );
  }

  const allowance = effectiveAllowance(backend, window, lane, lever);
  const estimate = Math.max(0, Number(req.estimatedCostMicros));
  if (estimate > allowance.micros) {
    const remedy =
      allowance.bound_by === "lane"
        ? `Raise the ${lane.lane} lane's budget to allow it.`
        : allowance.bound_by === "lever"
          ? lever.remedy
          : `Raise ${backend.display_name}'s own monthly ceiling to allow it, or disable the ceiling by setting it to 0 so the lever governs.`;
    return refuse(
      backend.id,
      "budget_ceiling_breached",
      `This call needs ${formatMicros(estimate)} and only ${formatMicros(allowance.micros)} is available — ` +
        `${allowance.bound_by === "lane" ? `the ${lane.lane} lane's remaining budget` : allowance.bound_by === "lever" ? "the spend lever's allowance" : `${backend.display_name}'s own monthly ceiling`} ` +
        `is the tightest of the limits in force. ${remedy} Budgets here stop work; they do not advise.`,
      {
        bound_by: allowance.bound_by,
        effective_allowance_micros: allowance.micros,
        estimated_cost_micros: estimate,
        lane: lane.lane,
        lane_remaining_micros: lane.remaining_micros,
        lever_allowance_micros: lever.allowanceMicros,
        monthly_ceiling_micros: backend.monthly_ceiling_micros,
        backend_remaining_micros: allowance.backend_remaining_micros,
        window_lapsed: window.lapsed,
      },
    );
  }

  // ── 5. Cost preference — a rank, never a bypass ─────────────────────────────
  return permit({
    kind: "capped",
    allowance_micros: allowance.micros,
    bound_by: allowance.bound_by,
    note:
      `${formatMicros(allowance.micros)} available, limited by ` +
      `${allowance.bound_by === "lane" ? `the ${lane.lane} lane's budget` : allowance.bound_by === "lever" ? "the spend lever" : `${backend.display_name}'s own ceiling`}.`,
  });
}

/** An id nobody registered. Named separately so "unknown" never reads as "not enabled". */
export function unknownBackend(id: string): Refusal {
  return refuse(
    id,
    "backend_unknown",
    `No backend is registered as ${id}. The registry is an allowlist: an unrecognised id is a refusal, not a question.`,
    { backend_id: id },
  );
}

/**
 * A refusal, written where the owner will see it — Stage 1's acceptance sentence: "a backend asked
 * for a task kind outside its allowed list is refused at the boundary AND THE REFUSAL IS RECORDED".
 *
 * It lands in `backend_runs` because that is the evidence table, and it lands with
 * `status = 'refused'` rather than `'failed'` because those are different facts. `finished_at` is
 * set in the same statement: a refusal is over the moment it is made, and a refused run left
 * running would read as work still in flight.
 */
export async function recordRefusal(
  env: Env,
  args: { backendId: string; taskId?: string | null; envelopeId?: string | null; requested: string; refusal: Refusal },
): Promise<string> {
  const id = newId("brn");
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO backend_runs
         (id, task_id, backend_id, envelope_id, requested, summary, cost_micros,
          started_at, finished_at, status, refusal_reason)
       VALUES (?,?,?,?,?,?,0,?,?,'refused',?)`,
    )
    .bind(
      id,
      args.taskId ?? null,
      args.backendId,
      args.envelopeId ?? null,
      args.requested,
      args.refusal.sentence,
      now,
      now,
      JSON.stringify({ code: args.refusal.code, sentence: args.refusal.sentence, detail: args.refusal.detail }),
    )
    .run();
  return id;
}

/**
 * How a run's status should be COLOURED, so "refused" never renders as "failed".
 *
 * The distinction is the migration's own ("A refusal is not a failure and must not be coloured as
 * one"), and it only survives if every reader derives it from one function rather than each
 * screen deciding for itself.
 */
export type OutcomeClass = "in_progress" | "success" | "failure" | "refusal" | "cancelled";

export function outcomeClass(status: string): OutcomeClass {
  switch (status) {
    case "running": return "in_progress";
    case "succeeded": return "success";
    case "failed": return "failure";
    case "refused": return "refusal";
    case "cancelled": return "cancelled";
    default: return "failure";
  }
}
