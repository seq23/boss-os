import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { getBool, getSetting } from "../lib/settings";
import { AppError } from "../lib/http";
import { costPolicy } from "../../../shared/boss/governance";
import { orderCandidates } from "../../../shared/boss/router/candidateOrder.mjs";
import { ProviderCallError, type ChatMessage } from "./types";
import { evaluateModel, estimateCostMicros, type ModelRow, type RouteStage } from "./policy";
import { rollBudgetWindows, laneBudgetState, employeeBudgetState } from "./budget";
import { WIRING_BY_PROVIDER, adapterCredential, backendKindFor } from "./backends";
import { formatMicros, spendLeverState } from "./spend";
import { checkBackend } from "../backends/registry";
import { laneAllowance, monthWindowStart, type Refusal } from "../backends/guard";
import {
  MAX_ATTEMPTS_PER_BACKEND, breakerState, recordFailure, recordSuccess, trip,
} from "./breaker";

/**
 * Refusal codes from the backend guard that mean "money", as opposed to "not
 * permitted" or "not available".
 *
 * They are separated because they end differently: a money refusal is held for a
 * spend decision a human can make, and the queue consumer already turns a
 * `BudgetExceeded` into exactly that card. A capability refusal is terminal and
 * must not masquerade as one.
 */
/** How many FREE routes one run may try after the paid ones. Bounded, not unlimited. */
export const MAX_FREE_HOPS = 2;


const BUDGET_REFUSAL_CODES = new Set([
  "lever_free_only",
  "zero_ceiling_not_free_tier",
  "budget_ceiling_breached",
  "lane_budget_exhausted",
  "lane_budget_absent",
  "cost_estimate_absent",
  "spend_window_absent",
]);

export class BudgetExceeded extends Error {
  constructor(
    public lane: string,
    public period: string,
    message?: string,
    /** One sentence naming what a person can change. Never a code. */
    public remedy?: string,
  ) {
    super(message ?? `The ${lane} lane has spent its ${period} budget`);
  }
}

/**
 * The router refused to run. `approvable` means a human could unblock it by
 * approving a sensitive-routing card rather than by changing configuration.
 */
/**
 * A POLICY REFUSAL, AND THEREFORE A 409 — not a 500.
 *
 * It carried a message and a hint from the start, and nothing turned them into a response: every
 * routing refusal that reached an HTTP route surfaced as a bare 500 with the hint dropped, AND was
 * written to `system_events` as `unhandled_error`, which put refusals the system made ON PURPOSE
 * into the log a person reads to find out what broke.
 *
 * Extending AppError is what fixes both at once, because `errorBody` already knows what to do with
 * one. 409 is the honest code: a refusal by policy will fail identically forever, so it is a
 * conflict with the request, never a fault on this side. `outcome` and `approvable` are untouched —
 * the queue consumer branches on them and still does.
 */
export class RoutingBlocked extends AppError {
  /*
   * A HINT IS NOT OPTIONAL ON A REFUSAL, even though AppError allows it to be. Every caller here
   * already passes one, the queue consumer reads it as a string to build the card it shows her,
   * and a policy refusal with nothing to do about it is the thing this repository calls a red
   * light with no remedy. `declare` narrows the inherited field without redefining it.
   */
  declare hint: string;

  constructor(
    message: string,
    public outcome: string,
    hint: string,
    public approvable = false,
  ) {
    super(409, message, hint);
  }
}

/**
 * Every eligible model was actually called and every call failed.
 *
 * Distinct from RoutingBlocked on purpose: a provider outage deserves a queue
 * retry, whereas a policy refusal will fail identically forever and must not be
 * retried. Collapsing the two would either burn retries on a misconfiguration or
 * drop work that a retry would have completed.
 */
export class ProviderFailure extends Error {
  constructor(message: string, public hint: string) {
    super(message);
  }
}

interface RouteRow {
  route_id: string;
  max_output_tokens: number;
  temperature: number;
  primary_model_id: string;
  fallback_model_id: string | null;
}

export interface RouteRequest {
  routeId: string;
  lane: string;
  messages: ChatMessage[];
  taskId?: string | null;
  employeeId?: string | null;
  intakeKind?: string | null;
  risk?: string;
  sensitivity?: string;
  costMode?: string | null;
  /** Hard ceiling from the task's permission envelope. 0 means lane budget only. */
  budgetMicros?: number;
  cloudForRestrictedAllowed?: boolean;
  /**
   * CONFINE THIS RUN TO ONE PROVIDER, because something outside the router promised it would be.
   *
   * The morning coaching consent names a backend — "consent to Claude Code on her own Mac is not
   * consent to OpenRouter" — and without this the promise had no mechanism behind it: the route
   * would screen every eligible model and could have answered her on a provider she never
   * approved. It only failed to because the unapproved one happened to have no key, which is luck,
   * not a guard.
   *
   * It NARROWS and never widens. Every other stage still runs on whatever survives, so this cannot
   * promote a model past privacy, capability, risk or budget — it can only take candidates away.
   */
  onlyProviderId?: string | null;
}

export interface RouteResult {
  text: string;
  costMicros: number;
  modelId: string;
  /**
   * WHAT THE SCREEN SHOWS. When the run degraded this string carries the label,
   * because the label must reach the screen through code paths this stage does
   * not own: the queue consumer stores `{ text, model: modelName }` on the task
   * and the approval card is built from it. Putting the honest words in the one
   * provenance field every surface already renders is what stops a cheaper model
   * quietly doing worse work without anybody being told.
   */
  modelName: string;
  /** The same name without the label, for anywhere that wants it plain. */
  modelDisplayName: string;
  /**
   * WHICH PROVIDER ACTUALLY ANSWERED. Callers that confined a run with `onlyProviderId` need to be
   * able to CHECK that, rather than assume it held — a promise verified against the result is worth
   * more than the same promise inferred from the fact that a reply came back.
   */
  providerId: string;
  usedFallback: boolean;
  decisionId: string;
  backendId: string | null;
  backendName: string | null;
  /** True whenever something other than the route's primary model ran. */
  degraded: boolean;
  degradedReason: string | null;
  /** A full sentence for a person. Null on a normal run. */
  notice: string | null;
  freeTier: boolean;
}

async function loadModel(db: D1Database, modelId: string): Promise<ModelRow | null> {
  return db
    .prepare(
      `SELECT m.id, m.slug, m.provider_id, m.display_name, m.in_micros_1k, m.out_micros_1k,
              m.enabled, m.privacy_class, m.capability_tier, m.benchmark_status,
              m.approved_task_kinds, m.forbidden_task_kinds, m.max_risk,
              p.base_url, p.api_key_var
         FROM models m JOIN providers p ON p.id = m.provider_id
        WHERE m.id = ? AND p.enabled = 1`,
    )
    .bind(modelId)
    .first<ModelRow>();
}

/**
 * Every other model that could carry this work — the continuity tier.
 *
 * These are consulted only after the route's OWN models have been refused or
 * have failed, and they are sorted cheapest-first among themselves. That is
 * where cost preference lives, and it is the LAST stage: it orders survivors,
 * it never promotes a candidate past privacy, capability, availability or
 * budget, and it never replaces an approved route default. Becoming a default is
 * a promotion, and a promotion needs benchmark evidence and an approved card.
 */
async function loadContinuityModels(db: D1Database, exclude: string[]): Promise<ModelRow[]> {
  const res = await db
    .prepare(
      `SELECT m.id, m.slug, m.provider_id, m.display_name, m.in_micros_1k, m.out_micros_1k,
              m.enabled, m.privacy_class, m.capability_tier, m.benchmark_status,
              m.approved_task_kinds, m.forbidden_task_kinds, m.max_risk,
              p.base_url, p.api_key_var
         FROM models m JOIN providers p ON p.id = m.provider_id
        WHERE m.enabled = 1 AND p.enabled = 1`,
    )
    .all<ModelRow>();
  const skip = new Set(exclude);
  return (res.results ?? []).filter((m) => !skip.has(m.id) && WIRING_BY_PROVIDER.has(m.provider_id));
}

async function recordDecision(
  db: D1Database,
  row: {
    lane: string; taskId?: string | null; employeeId?: string | null; intakeKind?: string | null;
    risk?: string | null; sensitivity?: string | null; costMode?: string | null;
    routeId?: string | null; chosenModelId?: string | null; outcome: string; reason: string;
    candidates: unknown;
  },
): Promise<string> {
  const id = newId("rtd");
  await db
    .prepare(
      `INSERT INTO routing_decisions
         (id, ts, lane, task_id, employee_id, intake_kind, risk, sensitivity, cost_mode,
          route_id, chosen_model_id, outcome, reason, candidates)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, Date.now(), row.lane, row.taskId ?? null, row.employeeId ?? null,
      row.intakeKind ?? null, row.risk ?? null, row.sensitivity ?? null, row.costMode ?? null,
      row.routeId ?? null, row.chosenModelId ?? null, row.outcome, row.reason,
      JSON.stringify(row.candidates),
    )
    .run();
  return id;
}

export async function recordUsage(
  db: D1Database,
  row: {
    lane: string; routeId: string | null; modelId: string | null; employeeId?: string | null;
    taskId?: string | null; inTokens: number; outTokens: number; costMicros: number;
    status: string; detail?: string | null; backendId?: string | null;
  },
) {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO usage_ledger (id, ts, lane, route_id, model_id, employee_id, task_id,
                                   in_tokens, out_tokens, cost_micros, status, detail)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        newId("usg"), Date.now(), row.lane, row.routeId, row.modelId,
        row.employeeId ?? null, row.taskId ?? null, row.inTokens, row.outTokens,
        row.costMicros, row.status, row.detail ?? null,
      ),
  ];

  // Only real spend moves a budget. A blocked or errored call costs nothing and
  // must not eat the day's allowance.
  //
  // SPEND ACCRUES AT EVERY LEVER POSITION, INCLUDING OPEN. Nothing refuses on
  // these numbers while the lever is open, but they are still the only record of
  // what the month cost, and a number nobody is checking is still a number she
  // needs to be able to read.
  if (row.costMicros > 0) {
    statements.push(
      db.prepare(`UPDATE budgets SET spent_micros = spent_micros + ? WHERE lane = ?`).bind(row.costMicros, row.lane),
    );
    if (row.employeeId) {
      statements.push(
        db
          .prepare(`UPDATE employees SET spent_micros_day = spent_micros_day + ? WHERE id = ?`)
          .bind(row.costMicros, row.employeeId),
      );
    }
    if (row.backendId) {
      // THE SPEND AND ITS WINDOW ARE WRITTEN TOGETHER, ALWAYS.
      //
      // The guard refuses a backend that has recorded spend and no window it
      // belongs to — correctly, because a figure with no month cannot be checked
      // against a monthly ceiling. Accruing without stamping the window would
      // therefore have taken the backend out of service on its first successful
      // call, which is the sort of self-inflicted outage that only shows up in
      // production. A lapsed window is replaced rather than added to.
      const monthStart = monthWindowStart(Date.now());
      statements.push(
        db
          .prepare(
            `UPDATE execution_backends
                SET spent_micros = CASE WHEN window_started_at IS NULL OR window_started_at < ?
                                        THEN ? ELSE spent_micros + ? END,
                    window_started_at = CASE WHEN window_started_at IS NULL OR window_started_at < ?
                                        THEN ? ELSE window_started_at END
              WHERE id = ?`,
          )
          .bind(monthStart, row.costMicros, row.costMicros, monthStart, monthStart, row.backendId),
      );
    }
  }

  await db.batch(statements);
}

interface CandidateNote {
  model_id: string;
  backend_id: string | null;
  tier: "route" | "continuity";
  stage: RouteStage | "call";
  verdict: string;
  reason: string;
  estimate_micros?: number;
  free?: boolean;
}

/**
 * Route a completion.
 *
 * THE ORDER IS THE ADDENDUM'S, §3.1, AND IS NOT NEGOTIABLE:
 *   permission and data sensitivity → required capability → availability →
 *   approved budget → then cost preference.
 *
 * Cost is last and only ORDERS the continuity tier. It cannot resurrect a
 * candidate an earlier stage refused, which is what "a cheaper route may never
 * bypass a privacy rule or a quality gate" means in code. Restricted material
 * therefore has no automatic escape to cloud when a preferred route fails: the
 * privacy stage refuses every cloud candidate the same way, and the run ends in
 * `ask_human` rather than in a quiet downgrade.
 *
 * Every exit — including every refusal — writes a `routing_decisions` row.
 */
export async function routeCompletion(env: Env, opts: RouteRequest): Promise<RouteResult> {
  const db = env.DB;
  await rollBudgetWindows(db);

  const risk = opts.risk ?? "low";
  const sensitivity = opts.sensitivity ?? "private";
  const costMode = opts.costMode ?? (await getSetting(db, "cost_mode")) ?? "NORMAL";
  const policy = costPolicy(costMode);
  const base = {
    lane: opts.lane, taskId: opts.taskId, employeeId: opts.employeeId,
    intakeKind: opts.intakeKind, risk, sensitivity, costMode, routeId: opts.routeId,
  };

  if (!policy.autonomousSpendAllowed) {
    await recordDecision(db, {
      ...base, outcome: "blocked_policy",
      reason: `Cost mode ${policy.id} stops autonomous spend`,
      candidates: [],
    });
    throw new RoutingBlocked(
      `Cost mode is ${policy.label}, so nothing runs on its own`,
      "blocked_policy",
      "Change the cost mode in Settings to let queued work run.",
    );
  }

  // The lane budget is the outer dollar authority and it is read, not thrown on,
  // at this point. A blocked lane still permits a route that costs literally
  // nothing — refusing free work because paid work is exhausted would be a
  // continuity system switching itself off at the moment it is needed.
  const laneBudget = await laneBudgetState(db, opts.lane);

  const empBudget = await employeeBudgetState(db, opts.employeeId);
  if (empBudget.blocked) {
    await recordDecision(db, {
      ...base, outcome: "blocked_budget",
      reason: "Employee has spent its daily allowance",
      candidates: [],
    });
    throw new RoutingBlocked(
      "This employee has spent its daily allowance",
      "blocked_budget",
      "Raise the employee's daily budget in Team, or wait for the window to roll at 00:00 UTC.",
    );
  }

  const route = await db
    .prepare(
      `SELECT id AS route_id, max_output_tokens, temperature, primary_model_id, fallback_model_id
         FROM routes WHERE id = ? AND lane = ?`,
    )
    .bind(opts.routeId, opts.lane)
    .first<RouteRow>();
  if (!route) {
    await recordDecision(db, {
      ...base, outcome: "blocked_no_model",
      reason: `Route ${opts.routeId} is not defined for the ${opts.lane} lane`,
      candidates: [],
    });
    throw new RoutingBlocked(
      `Route ${opts.routeId} is not defined for the ${opts.lane} lane`,
      "blocked_no_model",
      "Check the routes table, or point the employee at a route that exists.",
    );
  }

  const requireBenchmarkHighRisk = await getBool(db, "require_benchmark_high_risk", true);
  const ctx = {
    policy, risk, sensitivity,
    intakeKind: opts.intakeKind ?? null,
    requireBenchmarkHighRisk,
    cloudForRestrictedAllowed: opts.cloudForRestrictedAllowed ?? false,
  };

  const envelopeCeiling = opts.budgetMicros && opts.budgetMicros > 0 ? opts.budgetMicros : null;
  const promptChars = opts.messages.reduce((n, m) => n + m.content.length, 0);

  const declaredIds = [route.primary_model_id, route.fallback_model_id].filter(Boolean) as string[];
  const declared: ModelRow[] = [];
  const considered: CandidateNote[] = [];
  for (const id of declaredIds) {
    const m = await loadModel(db, id);
    if (m) declared.push(m);
    else {
      considered.push({
        model_id: id, backend_id: null, tier: "route", stage: "availability",
        verdict: "skipped", reason: "model or provider is disabled or missing",
      });
    }
  }

  // ── Stage 5 · COST PREFERENCE, applied to the continuity tier only. ─────────
  //
  // AND AT EQUAL COST, CAPABILITY — NOT THE ALPHABET.
  //
  // The tie-break used to be `display_name.localeCompare`, and Workers AI gives this system TWO
  // models that both cost exactly 0: "Llama 3.1 8B" and "Llama 3.3 70B". Alphabetically the 8B wins
  // every tie, the loop calls it, succeeds, and stops — so the 70B was never even SCREENED, let
  // alone rejected. `rtd_m2b0p2mdcrt61m4g` is what that produced: three candidates, no mention of
  // the 70B, and an 8-billion-parameter model answering a request to find a buyer for $1B of OpenAI
  // stock with "Classification: General Inquiry. Routing: Route to Customer Service Team."
  //
  // A tie-break is a decision. An alphabetical one was silently overruling Stage 2 — capability —
  // with a fact about spelling, for free. `general` outranks `fast` because that is what those words
  // mean, and cost is genuinely unchanged, so nothing here promotes a candidate past an earlier
  // stage: every model in this list has already survived screening on its own merits.
  const continuity = orderCandidates(
    await loadContinuityModels(db, declaredIds),
    (m) => estimateCostMicros(m, promptChars, route.max_output_tokens),
  );

  // THE TRADING LANE GETS NO CONTINUITY TIER. PLAN_v21 Stage 1's table says it in
  // one line — OpenRouter "may not touch the trading lane" — and the seeded row
  // does not encode it, so it is enforced here, at the only place that chooses a
  // continuity candidate. A trading route falls back to its own declared models
  // or it stops; it never quietly acquires a new vendor.
  const assembled: { model: ModelRow; tier: "route" | "continuity" }[] = [
    ...declared.map((model) => ({ model, tier: "route" as const })),
    ...(opts.lane === "trading" ? [] : continuity.map((model) => ({ model, tier: "continuity" as const }))),
  ];

  /*
   * THE CALLER'S OWN CONFINEMENT, applied before anything is screened.
   *
   * A dropped candidate is NOTED, never silently discarded. The decision log is what a person reads
   * a month later to find out why a particular model answered, and "it was not on the approved
   * backend" is exactly the kind of answer that has to be findable rather than inferred from an
   * absence.
   */
  const ordered = assembled.filter(({ model, tier }) => {
    if (!opts.onlyProviderId || model.provider_id === opts.onlyProviderId) return true;
    considered.push({
      model_id: model.id,
      backend_id: WIRING_BY_PROVIDER.get(model.provider_id)?.backendId ?? null,
      tier, stage: "privacy", verdict: "skipped",
      reason: `this run is confined to ${opts.onlyProviderId} and this model is on ${model.provider_id}`,
    });
    return false;
  });

  let approvable = false;
  let lastError: Error | null = null;
  let attemptedCall = false;
  let budgetRefusal: { message: string; remedy: string } | null = null;
  // The hop limit caps how many BACKENDS a run may call. It deliberately does not
  // cap how many models are screened: in a cheap cost mode the eligible model is
  // often further down the list, and refusing to look at it would block work the
  // mode was meant to allow.
  let hops = 0;
  let freeHops = 0;

  // Read ONCE and hand to the guard, so every candidate in one routing decision
  // is judged against the same lever and the same lane budget.
  const lever = await spendLeverState(db);
  const lane = await laneAllowance(db, opts.lane);

  for (const { model, tier } of ordered) {
    const def = WIRING_BY_PROVIDER.get(model.provider_id);
    const backendId = def?.backendId ?? null;

    const note = (stage: CandidateNote["stage"], verdict: string, reason: string, extra: Partial<CandidateNote> = {}) => {
      considered.push({ model_id: model.id, backend_id: backendId, tier, stage, verdict, reason, ...extra });
    };

    // ── Stages 1–2 · privacy and sensitivity, then capability. ───────────────
    const verdict = evaluateModel(model, ctx);
    if (!verdict.eligible) {
      note(verdict.stage ?? "capability", "rejected", verdict.reason);
      if (verdict.approvable) approvable = true;
      continue;
    }

    // ── Stages 3–4 · AVAILABILITY, then APPROVED BUDGET ──────────────────────
    //
    // DELEGATED, NOT REIMPLEMENTED. `backends/guard.ts` is the one place this
    // system decides whether a backend may run something: it owns the enabled
    // check, the credential presence, the free-tier proof, the spend lever and
    // the min(lane, ceiling) arithmetic. Repeating any of that here would create
    // a second opinion about whether a call is affordable, and the two would
    // eventually disagree in the direction of spending money.
    if (!def) {
      note("availability", "skipped", `provider ${model.provider_id} has no registered execution backend`);
      continue;
    }
    const estimate = estimateCostMicros(model, promptChars, route.max_output_tokens);
    const verdictBackend = await checkBackend(env, def.backendId, backendKindFor(opts.intakeKind), {
      model: model.slug,
      sensitivity: sensitivity as never,
      cloudForRestrictedAllowed: opts.cloudForRestrictedAllowed ?? false,
      estimatedCostMicros: estimate,
      laneBudget: lane,
      lever,
    });

    if (verdictBackend.refused) {
      const refusal = verdictBackend as Refusal;
      const budgetShaped = BUDGET_REFUSAL_CODES.has(refusal.code);
      note(budgetShaped ? "budget" : refusal.approvable ? "privacy" : "availability", "rejected", refusal.sentence, {
        estimate_micros: estimate,
      });
      if (refusal.approvable) approvable = true;
      if (budgetShaped) budgetRefusal = { message: refusal.sentence, remedy: refusal.sentence };
      continue;
    }

    const free = verdictBackend.cost_basis.free;
    const backendName = def.providerName;

    const cred = adapterCredential(env, def);
    if (!cred.available) {
      // The guard already checks that the credential EXISTS; this is the value
      // itself, and a disagreement between the two is worth surfacing rather
      // than crashing inside an adapter.
      note("availability", "skipped", cred.detail);
      lastError = new Error(cred.detail);
      continue;
    }

    const breaker = await breakerState(db, def.backendId);
    if (breaker.open) {
      note(
        "availability", "skipped",
        `circuit breaker is open for ${backendName} until ${new Date(breaker.opensAgainAt ?? 0).toISOString()}: ${breaker.reason ?? "repeated failures"}`,
      );
      continue;
    }

    // The task's permission envelope binds on top of everything the guard said.
    // It is what a human granted THIS piece of work, not a spending preference.
    if (envelopeCeiling !== null && estimate > envelopeCeiling) {
      const sentence =
        `estimated ${formatMicros(estimate)} exceeds the ${formatMicros(envelopeCeiling)} this task's ` +
        `permission envelope allows`;
      note("budget", "rejected", sentence, { estimate_micros: estimate, free });
      budgetRefusal = { message: sentence, remedy: "Raise the task's envelope budget, or approve the spend." };
      continue;
    }

    // A FREE ROUTE DOES NOT CONSUME A FALLBACK HOP.
    //
    // The cost mode's hop limit exists to bound how much a single run may SPEND
    // trying again. A route that costs nothing spends nothing, so counting it
    // against that limit would switch off the continuity tier at exactly the
    // moment the paid tier has used the budget up — the failure the free tier
    // exists to cover. Free attempts are still bounded, by their own limit.
    if (free) {
      if (freeHops >= MAX_FREE_HOPS) {
        note("availability", "skipped", `already tried ${MAX_FREE_HOPS} free routes on this run`);
        break;
      }
      freeHops++;
    } else {
      if (hops > policy.maxFallbackHops) {
        note(
          "availability", "skipped",
          `cost mode ${policy.id} allows ${policy.maxFallbackHops} paid fallback hop(s), already used`,
        );
        break;
      }
      hops++;
    }
    attemptedCall = true;

    // Bounded retries: the same backend is tried again ONLY for an error the
    // provider itself marked as temporary. A 400 or a 500 fails identically on a
    // second call and spending a retry on it only delays the fallback.
    let called: { text: string; inTokens: number; outTokens: number } | null = null;
    let attempt = 0;
    let attemptError: Error | null = null;
    while (attempt < MAX_ATTEMPTS_PER_BACKEND) {
      attempt++;
      try {
        called = await def.adapter.complete(
          {
            modelSlug: model.slug,
            messages: opts.messages,
            maxOutputTokens: route.max_output_tokens,
            temperature: route.temperature,
          },
          { baseUrl: model.base_url, apiKey: cred.apiKey, ai: cred.ai },
        );
        attemptError = null;
        break;
      } catch (err) {
        attemptError = err as Error;
        const retryable = err instanceof ProviderCallError && err.retryable;
        if (!retryable || attempt >= MAX_ATTEMPTS_PER_BACKEND) break;
        note("call", "retried", `attempt ${attempt} failed and is retryable: ${attemptError.message.slice(0, 200)}`);
      }
    }

    if (!called || attemptError) {
      lastError = attemptError ?? new Error("provider returned nothing");
      const state = await recordFailure(db, def.backendId, lastError.message);
      note(
        "call", "failed",
        `${lastError.message.slice(0, 240)}${state.open ? " — circuit breaker opened" : ""}`,
      );
      await recordUsage(db, {
        lane: opts.lane, routeId: route.route_id, modelId: model.id, backendId: def.backendId,
        employeeId: opts.employeeId, taskId: opts.taskId,
        inTokens: 0, outTokens: 0, costMicros: 0, status: "error",
        detail: lastError.message.slice(0, 500),
      });
      await logEvent(db, {
        level: "warn", scope: "router", event: "model_call_failed", lane: opts.lane,
        entityId: opts.taskId ?? null,
        detail: {
          model_id: model.id, backend_id: def.backendId, attempts: attempt,
          breaker_open: state.open, message: lastError.message,
        },
      });
      continue;
    }

    const costMicros = free
      ? 0
      : Math.round(
          (called.inTokens / 1000) * model.in_micros_1k + (called.outTokens / 1000) * model.out_micros_1k,
        );

    await recordSuccess(db, def.backendId);
    await recordUsage(db, {
      lane: opts.lane, routeId: route.route_id, modelId: model.id, backendId: def.backendId,
      employeeId: opts.employeeId, taskId: opts.taskId,
      inTokens: called.inTokens, outTokens: called.outTokens, costMicros, status: "ok",
      detail: free
        ? `Free route on ${backendName}. ${verdictBackend.cost_basis.basis} ` +
          `A Worker cannot read how much of an included allowance is left, so $0 here is the tier's price and not a measurement.`
        : null,
    });

    note("cost", "used", "completed", { estimate_micros: estimate, free });

    const isPrimary = model.id === route.primary_model_id;
    const degraded = !isPrimary;
    const degradedReason = degraded ? firstRefusalReason(considered, model.id) : null;
    const notice = degraded
      ? `Degraded run: ${model.display_name} on ${backendName} produced this, not the route's ` +
        `primary model. ${degradedReason ?? "The primary did not run."} A continuity route is not a ` +
        `promise of equal quality — read this the way you would read a draft from a stand-in.`
      : null;

    const decisionId = await recordDecision(db, {
      ...base, chosenModelId: model.id,
      outcome: !degraded ? "routed" : tier === "route" ? "fallback" : "degraded",
      reason: !degraded
        ? "primary model accepted the work"
        : `${tier === "route" ? "route fallback" : "continuity backend"} ran this: ${degradedReason ?? "primary unavailable"}`,
      candidates: considered,
    });

    if (degraded) {
      await logEvent(db, {
        level: "warn", scope: "router", event: "degraded_route", lane: opts.lane,
        entityId: opts.taskId ?? null,
        detail: { model_id: model.id, backend_id: def.backendId, tier, reason: degradedReason, free },
      });
    }

    return {
      text: called.text,
      costMicros,
      modelId: model.id,
      modelName: degraded
        ? `${model.display_name} — DEGRADED TIER via ${backendName}`
        : model.display_name,
      modelDisplayName: model.display_name,
      providerId: model.provider_id,
      usedFallback: degraded,
      decisionId,
      backendId: def.backendId,
      backendName,
      degraded,
      degradedReason,
      notice,
      freeTier: free,
    };
  }

  // ── Nothing ran. Say precisely why, in the order §3.1 asks the question in. ──
  const outcome = approvable
    ? "ask_human"
    : attemptedCall
      ? "provider_failed"
      : budgetRefusal
        ? "blocked_budget"
        : "blocked_no_model";

  await recordDecision(db, {
    ...base, outcome,
    reason: approvable
      ? "restricted content and no permitted private route"
      : budgetRefusal && !attemptedCall
        ? budgetRefusal.message.slice(0, 300)
        : lastError
          ? lastError.message.slice(0, 300)
          // THE ROW SAYS THE SAME THING THE REFUSAL SAYS. A decision log that is vaguer than the
          // error it explains is the thing the error was telling her to go and read.
          : (theWall(considered)?.sentence ?? "no model on this route satisfied policy").slice(0, 300),
    candidates: considered,
  });

  // PRIVACY BEFORE CONTINUITY. Restricted material does not escape to cloud
  // because a preferred route failed; it stops here and asks.
  if (approvable) {
    throw new RoutingBlocked(
      "This task holds restricted content and no private model is available",
      "ask_human",
      "Approve the routing card to let it run on a cloud model once, or register a local model.",
      true,
    );
  }

  // A model was eligible and the call itself failed: worth retrying.
  if (attemptedCall && lastError) {
    throw new ProviderFailure(
      `Every model on this route failed: ${lastError.message}`,
      "The provider may be down. The queue will retry; check Diagnostics if it keeps failing.",
    );
  }

  if (budgetRefusal) {
    throw new BudgetExceeded(
      opts.lane,
      laneBudget.blockedPeriod ?? "month",
      budgetRefusal.message,
      budgetRefusal.remedy,
    );
  }

  if (laneBudget.blocked) {
    throw new BudgetExceeded(opts.lane, laneBudget.blockedPeriod ?? "day");
  }

  /*
   * A CONFINED RUN THAT FOUND NOTHING SAYS SO IN THOSE WORDS. Told only that "no model satisfied
   * policy", a reader would go looking through privacy and budget for a refusal that never
   * happened — the candidates were removed a stage earlier, by the caller's own promise.
   */
  if (opts.onlyProviderId && !ordered.length) {
    throw new RoutingBlocked(
      `Nothing is available on ${opts.onlyProviderId}, which is the only provider this run was allowed to use`,
      "blocked_no_model",
      "Provision or enable a model on that backend, or approve a different one. Nothing was tried elsewhere on purpose.",
    );
  }

  /*
   * ─── A RED LIGHT CARRIES ITS REMEDY ───────────────────────────────────────
   *
   * "No model on this route satisfied policy", with "check the routing decision" as the hint, is a
   * failure that makes her go and read a JSON column to find out what happened. `tsk_m2bk7zfffhjatvsf`
   * is what that looks like on her desk: a `failed` task with a sentence that could mean privacy,
   * capability, availability, budget or an outage.
   *
   * It was none of those individually — it was ONE fact, true of all four candidates at once:
   *
   *     mdl_kimi_k2        availability   Fireworks is registered, not enabled
   *     mdl_qwen_fast      capability     model is cleared to low risk, task is medium
   *     mdl_cf_llama33_70b capability     model is cleared to low risk, task is medium
   *     mdl_cf_llama31_8b  capability     model is cleared to low risk, task is medium
   *
   * Every model in this system carries `max_risk = 'low'`, so nothing classified `medium` can route
   * at all. That is a real ceiling and it is the OWNER'S to lift — raising a model's risk clearance
   * is a promotion, and §3.1 says a promotion needs benchmark evidence and an approved card, not a
   * quiet UPDATE by whoever hit the wall first. So this does not widen anything. It states the wall,
   * in one sentence, with the decision that would move it.
   */
  const wall = theWall(considered);
  throw new RoutingBlocked(
    lastError ? `No model could run this: ${lastError.message}` : wall?.sentence ?? "No model on this route satisfied policy",
    "blocked_no_model",
    wall?.remedy ?? "Check the routing decision for why each model was refused.",
  );
}

/**
 * ─── A RED LIGHT CARRIES ITS REMEDY ─────────────────────────────────────────
 *
 * "No model on this route satisfied policy", with "check the routing decision" as the hint, is a
 * failure that makes her go and read a JSON column to find out what happened. `tsk_m2bk7zfffhjatvsf`
 * is what that looks like on her desk: a `failed` task carrying a sentence that could mean privacy,
 * capability, availability, budget or a provider outage.
 *
 * It meant ONE thing, true of three of the four candidates:
 *
 *     mdl_kimi_k2        availability   Fireworks is registered, not enabled
 *     mdl_qwen_fast      capability     model is cleared to low risk, task is medium
 *     mdl_cf_llama33_70b capability     model is cleared to low risk, task is medium
 *     mdl_cf_llama31_8b  capability     model is cleared to low risk, task is medium
 *
 * THE LARGEST GROUP, NOT A UNANIMOUS ONE. The first version of this required every rejection to
 * share a stage and a reason, and on the real decision it fired on nothing — one Fireworks model
 * refused for a different reason was enough to silence it. A wall three candidates out of four hit
 * is the wall, and saying "3 of 4" is more honest than saying nothing.
 *
 * IT WIDENS NOTHING. Raising a model's risk clearance is a PROMOTION, and §3.1 requires benchmark
 * evidence and an approved card — not a quiet UPDATE by whoever hit the wall first. So this states
 * the wall and names the decision that would move it; the decision stays the owner's.
 */
export function theWall(considered: CandidateNote[]): { sentence: string; remedy: string } | null {
  const rejected = considered.filter((c) => c.verdict === "rejected");
  if (rejected.length === 0) return null;

  const groups = new Map<string, { stage: string; reason: string; n: number }>();
  for (const c of rejected) {
    const key = `${c.stage}|${c.reason}`;
    const g = groups.get(key) ?? { stage: String(c.stage), reason: c.reason, n: 0 };
    g.n += 1;
    groups.set(key, g);
  }
  const biggest = [...groups.values()].sort((a, b) => b.n - a.n)[0]!;

  const REMEDY: Record<string, string> = {
    capability:
      "The models here are not cleared for work at this risk. Either this task is not really that "
      + "risky — reclassify it — or a model needs a risk promotion, which takes a benchmark and an "
      + "approved card. Nothing widens a risk ceiling on its own.",
    availability:
      "The backends that could take this are not commissioned. Enable one in Systems -> Backends, or "
      + "provision a model on one that is already enabled.",
    budget: "Raise the ceiling for this lane, or wait for the window to roll.",
    privacy: "Approve the routing card to let it run once, or register a model that may hold this.",
  };

  return {
    sentence: `No model on this route satisfied policy: ${biggest.n} of ${rejected.length} `
      + `refused at ${biggest.stage} — ${biggest.reason}`,
    remedy: REMEDY[biggest.stage] ?? "Check the routing decision for why each model was refused.",
  };
}

/** Why the primary did not run, in the words already recorded for it. */
function firstRefusalReason(considered: CandidateNote[], chosenId: string): string | null {
  const first = considered.find((c) => c.model_id !== chosenId && c.verdict !== "used" && c.verdict !== "retried");
  return first ? `${first.reason}.` : null;
}

/**
 * Take a backend out of service deliberately — a cost-limit breach or a policy
 * change, both named by §3.1 as breaker triggers alongside outage.
 */
export async function tripBackend(db: D1Database, backendId: string, reason: string): Promise<void> {
  await trip(db, backendId, reason);
  await logEvent(db, {
    level: "warn", scope: "router", event: "breaker_tripped", entityId: backendId,
    detail: { reason },
  });
}
