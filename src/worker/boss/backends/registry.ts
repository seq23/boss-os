/**
 * The execution backend registry — Stage 1 of `docs/boss/PLAN_v21.md`, discharging Phase 9 part 1.
 *
 * Canon: Phase 9 §33, §36, §79.7–79.9. Sovereignty Addendum §1 and §3.1.
 *
 * WHY A REGISTRY AND NOT A CONSTANT, in migration 0173's own words: the addendum forbids a critical
 * capability depending permanently on one external model provider without a documented, tested
 * continuity path. Coding is a critical capability and it currently depends entirely on one
 * provider. This makes "where else could this run, and what is that allowed to do" a row a person
 * can read and change, rather than a branch in code.
 *
 * THIS FILE READS AND ORDERS. IT NEVER DECIDES WHETHER SOMETHING MAY RUN — `guard.ts` does, and
 * every refusal in this system comes from there so there is exactly one place to read the rules.
 */

import { planState } from "../router/plan";
import type { Env } from "../env";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import {
  credentialState,
  evaluateBackend,
  freeTier,
  laneAllowance,
  spendLeverState,
  unknownBackend,
  windowState,
  type BackendRequest,
  type CredentialState,
  type FreeTier,
  type Refusal,
  type SpendLeverState,
  type Verdict,
  type WindowState,
} from "./guard";

export type BackendClass = "cloud_model" | "agent_executed";
export type BackendStatus = "registered" | "enabled" | "disabled";

/** The row as `execution_backends` stores it: JSON columns still JSON. */
export interface BackendRow {
  id: string;
  display_name: string;
  class: BackendClass;
  capabilities: string;
  allowed_kinds: string;
  forbidden_actions: string;
  credential_ref: string | null;
  security_notes: string | null;
  monthly_ceiling_micros: number;
  spent_micros: number;
  window_started_at: number | null;
  review_at: number | null;
  status: BackendStatus;
  status_reason: string | null;
  created_at: number;
  /** 0274. Epoch ms until which the seat's plan is reported out of usage; null when it is not. */
  exhausted_until?: number | null;
  exhausted_reason?: string | null;
  /**
   * free | capped | uncapped | off — what the ceiling MEANS on this row.
   *
   * Three backends carried a ceiling of $0.00 and the zeroes meant opposite things: Workers AI is
   * free, OpenRouter has nothing authorised, and the local runtime is switched off. One number,
   * three meanings, and the screen showed the number.
   */
  spend_kind: string;
  /**
   * invoiced | plan_equivalent | free — whether a figure here is MONEY.
   *
   * `bk_claude_code` runs on her Claude subscription, so its "spent" is equivalent usage against a
   * flat fee and no money moves. She was reading it as a bill.
   */
  cost_basis: string;
  /**
   * stored | plan — where the ceiling comes from.
   *
   * "i want claude ceiling to be whatever my plan allows." A backend marked `plan` takes its
   * ceiling from `router/plan.ts`, so upgrading her plan moves it without anyone editing a row.
   */
  ceiling_source: string;
}

/** The row with its lists parsed. Everything downstream takes this, never the raw row. */
export interface Backend extends Omit<BackendRow, "capabilities" | "allowed_kinds" | "forbidden_actions"> {
  capabilities: string[];
  allowed_kinds: string[];
  forbidden_actions: string[];
}

/**
 * A malformed JSON column yields an EMPTY list, and empty is the strict answer for all three:
 * no capability matches, no task kind is allowed, and — the one that could go the other way —
 * an unreadable forbidden list means nothing is recognised as forbidden.
 *
 * That last case is the reason `forbidden_actions` is not the only thing standing between a
 * backend and a commit. The charter says the same words, the runner enforces the list, and every
 * run ends as a proposal regardless. A single unparseable column must not be able to grant
 * authority, so authority is never granted by the absence of a prohibition.
 */
function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function hydrate(row: BackendRow): Backend {
  return {
    ...row,
    capabilities: parseList(row.capabilities),
    allowed_kinds: parseList(row.allowed_kinds),
    forbidden_actions: parseList(row.forbidden_actions),
  };
}

/**
 * THE CEILING A `plan` BACKEND ACTUALLY HAS.
 *
 * Applied at LOAD, so every consumer already written — the dispatch guard, the spend guard, the
 * budget alert on Today, the Backends screen — sees the derived figure without one of them being
 * taught about plans. A second place that "also knows about the plan" is how two numbers start
 * disagreeing, and the stored $50 is what happens when a figure has no source.
 */
async function applyPlanCeiling(db: D1Database, rows: Backend[]): Promise<Backend[]> {
  if (!rows.some((b) => b.ceiling_source === "plan")) return rows;
  const plan = await planState(db);
  return rows.map((b) => (b.ceiling_source === "plan" ? { ...b, monthly_ceiling_micros: plan.employeeCeilingMicros } : b));
}

export async function listBackends(db: D1Database): Promise<Backend[]> {
  const rows = await db
    .prepare(
      `SELECT id, display_name, class, capabilities, allowed_kinds, forbidden_actions,
              credential_ref, security_notes, monthly_ceiling_micros, spent_micros,
              window_started_at, review_at, status, status_reason, created_at,
              spend_kind, cost_basis, ceiling_source, exhausted_until, exhausted_reason
         FROM execution_backends
        ORDER BY CASE status WHEN 'enabled' THEN 0 WHEN 'registered' THEN 1 ELSE 2 END, id`,
    )
    .all<BackendRow>();
  return applyPlanCeiling(db, (rows.results ?? []).map(hydrate));
}

export async function getBackend(db: D1Database, id: string): Promise<Backend | null> {
  const row = await db
    .prepare(
      `SELECT id, display_name, class, capabilities, allowed_kinds, forbidden_actions,
              credential_ref, security_notes, monthly_ceiling_micros, spent_micros,
              window_started_at, review_at, status, status_reason, created_at,
              spend_kind, cost_basis, ceiling_source, exhausted_until, exhausted_reason
         FROM execution_backends WHERE id = ?`,
    )
    .bind(id)
    .first<BackendRow>();
  if (!row) return null;
  const [withPlan] = await applyPlanCeiling(db, [hydrate(row)]);
  return withPlan ?? null;
}

/**
 * What a backend looks like to a person, without any secret in it.
 *
 * `credential` carries a NAME and a presence, never a value and never a fragment of one — the
 * whole point of `credential_ref` being a pointer. `readiness` is the guard's own answer, run
 * live, so a list screen cannot say "enabled" about something that would refuse on first contact.
 */
export interface BackendView extends Backend {
  credential: CredentialState;
  free_tier: FreeTier;
  window: WindowState;
  readiness: { ready: boolean; sentence: string; code: string | null };
}

export function viewBackend(env: Env, backend: Backend, lever: SpendLeverState, now = Date.now()): BackendView {
  const credential = credentialState(env, backend.credential_ref);
  // Readiness asks the narrowest honest question: could this backend take ANY of the kinds it
  // itself claims, with no other constraint? A wider question would report a backend as broken
  // because of one request's sensitivity, and a narrower one would report nothing at all.
  const probe = evaluateBackend(env, backend, backend.allowed_kinds[0] ?? "", { lever, now });
  return {
    ...backend,
    credential,
    free_tier: freeTier(backend, null),
    window: windowState(backend, now),
    readiness: probe.refused
      ? { ready: false, sentence: probe.sentence, code: probe.code }
      : { ready: true, sentence: `${backend.display_name} can take work now.`, code: null },
  };
}

// ─── Route order ─────────────────────────────────────────────────────────────

/**
 * SOVEREIGNTY ADDENDUM §3.1, AND IT IS NOT NEGOTIABLE.
 *
 * Published as data so a screen can show the owner the order her system actually applies, rather
 * than a screen's own retelling of it. `guard.ts` implements it in this sequence; a cheaper route
 * may never bypass a privacy rule or a quality gate, which is why cost is fifth and is only ever
 * a sort key over backends that have already passed the first four.
 */
export const ROUTE_ORDER: { step: number; criterion: string; why: string }[] = [
  { step: 1, criterion: "Permission and data sensitivity", why: "What may see this at all. A cheaper backend does not become permitted by being cheaper." },
  { step: 2, criterion: "Required capability", why: "Whether it can actually do the work. A backend that cannot is not a fallback, it is a worse answer." },
  { step: 3, criterion: "Availability", why: "Whether its credential exists and it is enabled. An absent credential is named, not guessed at." },
  { step: 4, criterion: "Approved budget", why: "The lane's budget and the backend's ceiling, whichever is tighter. Budgets here stop work; they do not advise." },
  { step: 5, criterion: "Cost preference", why: "Only now, and only among backends that already passed everything above." },
];

export type Permitted = Extract<Verdict, { refused: false }>;

export interface RouteResult {
  task_kind: string;
  /** False when NO registered backend lists this kind — "nobody may" and "no such kind" differ. */
  task_kind_known: boolean;
  lever: SpendLeverState;
  /** Permitted backends, in §3.1 order. Empty is a normal answer, not an error. */
  order: Permitted[];
  /** Every backend that was refused, with why. A route with no reasons is unauditable. */
  refused: Refusal[];
  route_order: typeof ROUTE_ORDER;
}

/**
 * Which backends may take this work, in the order they should be tried.
 *
 * The lane budget and the spend lever are read HERE, once, and handed to the guard — so every
 * backend in one routing decision is judged against the same figures, and the guard itself stays
 * a pure function that a test can drive without a database.
 */
export async function eligibleFor(
  env: Env,
  taskKind: string | null | undefined,
  opts: BackendRequest & { lane?: string } = {},
): Promise<RouteResult> {
  const backends = await listBackends(env.DB);
  const lever = opts.lever ?? (await spendLeverState(env.DB));
  const lane = opts.laneBudget ?? (await laneAllowance(env.DB, opts.lane ?? "ops"));
  const req: BackendRequest = { ...opts, lever, laneBudget: lane };

  const order: Permitted[] = [];
  const refused: Refusal[] = [];

  for (const backend of backends) {
    const verdict = evaluateBackend(env, backend, taskKind, req);
    if (verdict.refused) refused.push(verdict);
    else order.push(verdict);
  }

  const kind = typeof taskKind === "string" ? taskKind.trim() : "";
  const known = kind !== "" && backends.some((b) => b.allowed_kinds.includes(kind));

  // Cost preference, applied last and only to survivors. The id tiebreak keeps the order stable
  // between two identical calls, so a fallback chain does not reshuffle itself between attempts.
  order.sort((a, b) => a.cost_rank - b.cost_rank || a.backend_id.localeCompare(b.backend_id));

  return { task_kind: kind, task_kind_known: known, lever, order, refused, route_order: ROUTE_ORDER };
}

/** A single backend, checked. Separated so a caller with an id gets `backend_unknown`, not silence. */
export async function checkBackend(
  env: Env,
  backendId: string,
  taskKind: string | null | undefined,
  opts: BackendRequest & { lane?: string } = {},
): Promise<Verdict> {
  const backend = await getBackend(env.DB, backendId);
  if (!backend) return unknownBackend(backendId);
  const lever = opts.lever ?? (await spendLeverState(env.DB));
  const laneBudget = opts.laneBudget ?? (await laneAllowance(env.DB, opts.lane ?? "ops"));
  return evaluateBackend(env, backend, taskKind, { ...opts, lever, laneBudget });
}

// ─── Changing a backend ──────────────────────────────────────────────────────

/**
 * A status change is an authority change, so it is audited here rather than at whichever call site
 * happens to make it. `status_reason` is required for the reason the column exists: a disabled
 * backend that cannot say why reads as broken, and an enabled one that cannot say why reads as an
 * accident.
 */
export class BackendChangeRefused extends Error {
  constructor(message: string, readonly hint: string, readonly code: string) {
    super(message);
    this.name = "BackendChangeRefused";
  }
}

export async function setBackendStatus(
  env: Env,
  id: string,
  status: BackendStatus,
  reason: string,
  actor = "boss",
): Promise<Backend> {
  const backend = await getBackend(env.DB, id);
  if (!backend) throw new BackendChangeRefused(`No backend is registered as ${id}`, "Check GET /api/backends.", "backend_unknown");

  const why = reason.trim();
  if (!why) {
    throw new BackendChangeRefused(
      "A backend's status does not change without a reason",
      "Send { reason } saying why. A backend that cannot say why it is in the state it is in reads as broken.",
      "reason_absent",
    );
  }

  /*
   * ENABLING SOMETHING THAT CANNOT RUN IS REFUSED, NOT WARNED ABOUT.
   *
   * `enabled` means "may take work". A backend whose credential is definitively absent cannot,
   * and letting the row claim otherwise is how a green light ends up in front of a door that does
   * not open. `unverifiable_here` is deliberately not refused — Claude Code's credential lives on
   * the owner's Mac by design, and the private agent verifies it at claim time.
   */
  if (status === "enabled") {
    const credential = credentialState(env, backend.credential_ref);
    if (credential.presence === "absent") {
      throw new BackendChangeRefused(
        `${backend.display_name} cannot be enabled: ${credential.note}`,
        "Set the credential first, then enable it. Enabled means it may take work, not that it is meant to.",
        "credential_absent",
      );
    }
  }

  await env.DB
    .prepare(`UPDATE execution_backends SET status = ?, status_reason = ? WHERE id = ?`)
    .bind(status, why, id)
    .run();

  await audit(env.DB, {
    actor,
    lane: "ops",
    entityType: "execution_backend",
    entityId: id,
    action: `backend_${status}`,
    detail: { from: backend.status, to: status, reason: why },
  });
  await logEvent(env.DB, {
    level: "info", scope: "backends", event: "status_changed", entityId: id,
    detail: { from: backend.status, to: status, reason: why },
  });

  return (await getBackend(env.DB, id))!;
}

/**
 * Raising or lowering one backend's sub-cap.
 *
 * It is a SUB-CAP, never a grant: the lane's own budget still caps whatever is set here, and the
 * spend lever still has to be off FREE_ONLY for any of it to matter. Both facts are returned to
 * the caller by the route so the screen can say them rather than implying a number is the whole
 * story.
 */
export async function setMonthlyCeiling(
  env: Env,
  id: string,
  micros: number,
  reason: string,
  actor = "boss",
): Promise<Backend> {
  const backend = await getBackend(env.DB, id);
  if (!backend) throw new BackendChangeRefused(`No backend is registered as ${id}`, "Check GET /api/backends.", "backend_unknown");

  if (!Number.isInteger(micros) || micros < 0) {
    throw new BackendChangeRefused(
      "A monthly ceiling is a whole number of micros, zero or more",
      "Micros are millionths of a dollar: $2 is 2000000. Zero means free tiers only, not unlimited.",
      "ceiling_invalid",
    );
  }

  const why = reason.trim();
  if (!why) {
    throw new BackendChangeRefused(
      "A ceiling does not change without a reason",
      "Send { reason }. Money moving with no recorded why is the thing this system exists to prevent.",
      "reason_absent",
    );
  }

  await env.DB
    .prepare(`UPDATE execution_backends SET monthly_ceiling_micros = ? WHERE id = ?`)
    .bind(micros, id)
    .run();

  await audit(env.DB, {
    actor,
    lane: "ops",
    entityType: "execution_backend",
    entityId: id,
    action: "backend_ceiling_changed",
    detail: { from_micros: backend.monthly_ceiling_micros, to_micros: micros, reason: why },
  });

  return (await getBackend(env.DB, id))!;
}
