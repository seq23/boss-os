/**
 * The governance gate — canon §18 (emotional state risk classification), §2 and
 * §3 (decision rights), §17 (anti-dependency), §7 (the mode card).
 *
 * This is the enforcement half of the Operating Governance Layer. Every
 * protected action in the system calls `assertProtectedAction` before it does
 * anything, and a high-risk state stops it — kindly, in writing, with the
 * refusal recorded as a compliance flag so the pattern is visible later.
 *
 * The tone matters and is part of the specification. A system that blocks a
 * grieving person from wiring money should sound like a friend holding a door,
 * not like a policy engine.
 */

import type { Env } from "../env";
import { newId } from "../lib/id";
import { AppError } from "../lib/http";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";

const DAY_MS = 86_400_000;

export type RiskClass = "low" | "elevated" | "high";

export const RISK_CLASSES: RiskClass[] = ["low", "elevated", "high"];

export const EMOTIONAL_STATES = [
  "steady", "stretched", "activated", "depleted", "grieving", "elated",
] as const;

/**
 * Canon §4's watch list. The section's own enumeration is not reproduced in any
 * authority document available to this build, so these are the watch items this
 * system can actually check, each tied to a real table.
 */
export const WATCH_LIST = [
  { key: "high_risk_state", label: "A high-risk state is active", severity: "high" },
  { key: "restricted_export", label: "Restricted knowledge left the system", severity: "high" },
  { key: "protected_action_blocked", label: "A protected action was refused", severity: "medium" },
  { key: "kill_switch", label: "The trading kill switch is engaged", severity: "high" },
  { key: "open_dead_letters", label: "Tasks gave up and are untriaged", severity: "medium" },
  { key: "stale_vault", label: "No verified snapshot in more than two days", severity: "high" },
  { key: "expiring_approvals", label: "Approvals expire within a day", severity: "medium" },
  { key: "overdue_maintenance", label: "Maintenance is overdue", severity: "medium" },
  { key: "ip_renewal_due", label: "An IP asset renewal is due", severity: "medium" },
  { key: "unresolved_predictions", label: "Predictions are past their date and unscored", severity: "low" },
  { key: "uncovered_job_type", label: "A job type has no active capability default", severity: "medium" },
  { key: "bridge_refusal", label: "Something was refused at the firm boundary", severity: "medium" },
] as const;

export interface CurrentState {
  id: string | null;
  state: string;
  risk_class: RiskClass;
  ts: number | null;
  note: string | null;
  valid_until: number | null;
  expired: boolean;
}

/**
 * The state that is currently in force. A report with an expiry that has passed
 * is not in force — a Tuesday is not allowed to gate a Friday.
 */
export async function currentState(db: D1Database, now = Date.now()): Promise<CurrentState> {
  const row = await db
    .prepare(
      `SELECT * FROM emotional_states
        WHERE cleared_at IS NULL AND (valid_until IS NULL OR valid_until > ?)
        ORDER BY ts DESC LIMIT 1`,
    )
    .bind(now)
    .first<{ id: string; state: string; risk_class: string; ts: number; note: string | null; valid_until: number | null }>();

  if (!row) {
    return { id: null, state: "unrecorded", risk_class: "low", ts: null, note: null, valid_until: null, expired: false };
  }
  return {
    id: row.id,
    state: row.state,
    risk_class: row.risk_class as RiskClass,
    ts: row.ts,
    note: row.note,
    valid_until: row.valid_until,
    expired: false,
  };
}

export interface DecisionRight {
  action_class: string;
  label: string;
  decider: string;
  protected: number;
  requires_approval: number;
  max_autonomous_micros: number;
  rationale: string;
  status: string;
}

export async function decisionRight(db: D1Database, actionClass: string): Promise<DecisionRight | null> {
  return db
    .prepare(`SELECT * FROM decision_rights WHERE action_class = ? AND status = 'active'`)
    .bind(actionClass)
    .first<DecisionRight>();
}

/** Writes a flag. Every refusal this layer makes leaves one. */
export async function raiseFlag(
  db: D1Database,
  flag: {
    watch_key: string;
    severity?: string;
    subject_type?: string | null;
    subject_id?: string | null;
    summary: string;
    detail?: unknown;
  },
  now = Date.now(),
): Promise<string> {
  const id = newId("flg");
  await db
    .prepare(
      `INSERT INTO compliance_flags (id, ts, watch_key, severity, subject_type, subject_id, summary, detail, status)
       VALUES (?,?,?,?,?,?,?,?,'open')`,
    )
    .bind(
      id, now, flag.watch_key, flag.severity ?? "medium",
      flag.subject_type ?? null, flag.subject_id ?? null, flag.summary,
      flag.detail === undefined ? null : JSON.stringify(flag.detail),
    )
    .run();
  return id;
}

export interface GateResult {
  allowed: boolean;
  action_class: string;
  state: CurrentState;
  right: DecisionRight | null;
  reason: string | null;
  flag_id?: string;
}

/**
 * Canon §18. Checks one protected action against the state that is in force.
 *
 * Returns rather than throws, so a caller can report the refusal in whatever
 * shape suits it. `assertProtectedAction` is the throwing version, and is what
 * the routes use.
 */
export async function checkProtectedAction(
  env: Env,
  actionClass: string,
  subject?: { type?: string; id?: string },
  now = Date.now(),
): Promise<GateResult> {
  const [state, right] = await Promise.all([currentState(env.DB, now), decisionRight(env.DB, actionClass)]);

  // An action with no recorded right is allowed and noticed: the governance
  // layer refuses to invent a rule it was never given.
  if (!right || !right.protected) {
    return { allowed: true, action_class: actionClass, state, right, reason: null };
  }

  if (state.risk_class !== "high") {
    return { allowed: true, action_class: actionClass, state, right, reason: null };
  }

  const since = state.ts ? new Date(state.ts).toISOString().slice(0, 16).replace("T", " ") : "earlier";
  const reason =
    `Not now. You recorded yourself as ${state.state} at ${since}, and ${right.label.toLowerCase()} is one of the ` +
    `protected actions. ${right.rationale} It will still be here when the state clears, and nothing has been lost.`;

  const flagId = await raiseFlag(
    env.DB,
    {
      watch_key: "protected_action_blocked",
      severity: "medium",
      subject_type: subject?.type ?? null,
      subject_id: subject?.id ?? null,
      summary: `${right.label} was refused while a high-risk state was in force.`,
      detail: { action_class: actionClass, state: state.state, state_id: state.id, recorded_at: state.ts },
    },
    now,
  );

  await audit(env.DB, {
    actor: "system", lane: "ops", entityType: "governance", entityId: flagId, action: "protected_action_blocked",
    detail: { action_class: actionClass, state: state.state },
  });
  await logEvent(env.DB, {
    level: "warn", scope: "governance", event: "protected_action_blocked", entityId: flagId,
    detail: { action_class: actionClass, risk_class: state.risk_class },
  });

  return { allowed: false, action_class: actionClass, state, right, reason, flag_id: flagId };
}

/** The throwing form. A refused protected action is a 409, not an error. */
export async function assertProtectedAction(
  env: Env,
  actionClass: string,
  subject?: { type?: string; id?: string },
): Promise<void> {
  const result = await checkProtectedAction(env, actionClass, subject);
  if (result.allowed) return;
  throw new AppError(
    409,
    result.reason ?? "That action is protected right now",
    "Record a steadier state, or clear the one in force, and it will go through. Canon §18.",
  );
}

/**
 * Canon §17, the Anti-Dependency Protocol, as a real check rather than a
 * promise. Each item asks the same question in a different place: if this
 * system stopped existing tonight, what would the Boss still have?
 */
export interface DependencyCheck {
  key: string;
  question: string;
  pass: boolean;
  detail: string;
}

export async function runAntiDependencyCheck(env: Env, now = Date.now()): Promise<{
  checks: DependencyCheck[];
  passing: number;
  failing: number;
  verdict: string;
}> {
  const [offline, snapshot, exported, providers, drill, manual] = await Promise.all([
    env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM knowledge_items k JOIN knowledge_surfaces s ON s.key = k.surface_key
          JOIN memory_items m ON m.id = k.item_id
          WHERE s.offline = 1 AND m.status = 'active' AND m.retired_at IS NULL`,
      )
      .first<{ n: number }>(),
    env.DB
      .prepare(`SELECT ts, status FROM vault_snapshots WHERE status = 'complete' ORDER BY ts DESC LIMIT 1`)
      .first<{ ts: number; status: string }>(),
    env.DB
      .prepare(`SELECT ts FROM knowledge_exports WHERE status = 'complete' ORDER BY ts DESC LIMIT 1`)
      .first<{ ts: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM providers WHERE enabled = 1`).first<{ n: number }>(),
    env.DB.prepare(`SELECT ts, status FROM vault_restores ORDER BY ts DESC LIMIT 1`).first<{ ts: number; status: string }>(),
    env.DB.prepare(`SELECT version, generated_at FROM manual_versions ORDER BY version DESC LIMIT 1`).first<{ version: number; generated_at: number }>(),
  ]);

  const checks: DependencyCheck[] = [
    {
      key: "offline_library",
      question: "Is anything readable with no network and no account?",
      pass: (offline?.n ?? 0) > 0,
      detail: `${offline?.n ?? 0} item(s) filed on offline surfaces.`,
    },
    {
      key: "verified_snapshot",
      question: "Is there a snapshot that has actually been verified?",
      pass: Boolean(snapshot) && now - (snapshot?.ts ?? 0) < 7 * DAY_MS,
      detail: snapshot ? `Last complete snapshot ${Math.floor((now - snapshot.ts) / DAY_MS)} day(s) ago.` : "No complete snapshot exists.",
    },
    {
      key: "portable_export",
      question: "Does a portable copy of the knowledge exist outside the schema?",
      pass: Boolean(exported),
      detail: exported ? `Last export ${Math.floor((now - exported.ts) / DAY_MS)} day(s) ago.` : "Nothing has ever been exported.",
    },
    {
      key: "restore_rehearsed",
      question: "Has a restore been rehearsed, not merely configured?",
      pass: Boolean(drill),
      detail: drill ? `Last restore attempt was ${drill.status}.` : "No restore has ever been attempted.",
    },
    {
      key: "provider_plurality",
      question: "Is more than one provider path configured?",
      pass: (providers?.n ?? 0) > 1,
      detail: `${providers?.n ?? 0} provider(s) enabled. One is a single point of failure, not a strategy.`,
    },
    {
      key: "operating_manual",
      question: "Is how the Boss operates written down outside the Boss?",
      pass: Boolean(manual),
      detail: manual ? `Manual at version ${manual.version}.` : "The Personal Operating Manual has never been generated.",
    },
  ];

  const failing = checks.filter((c) => !c.pass);
  return {
    checks,
    passing: checks.length - failing.length,
    failing: failing.length,
    verdict:
      failing.length === 0
        ? "Nothing here is load-bearing on this system alone."
        : `${failing.length} of ${checks.length} dependencies are on this system alone: ${failing.map((f) => f.key).join(", ")}.`,
  };
}

/**
 * Canon §7's mode card: what mode the system is operating in right now, and
 * what that permits. Assembled from live state — the cost mode, the lane
 * authority, the state in force and the rights table — rather than declared.
 */
export async function modeCard(env: Env, now = Date.now()): Promise<Record<string, unknown>> {
  const [costMode, authority, state, protectedActions, openFlags] = await Promise.all([
    env.DB.prepare(`SELECT value FROM settings WHERE key = 'cost_mode'`).first<{ value: string }>(),
    env.DB.prepare(`SELECT live_enabled, kill_switch FROM trading_authority LIMIT 1`).first<{ live_enabled: number; kill_switch: number }>(),
    currentState(env.DB, now),
    env.DB.prepare(`SELECT action_class, label FROM decision_rights WHERE protected = 1 AND status = 'active' ORDER BY action_class`).all<{ action_class: string; label: string }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM compliance_flags WHERE status = 'open'`).first<{ n: number }>(),
  ]);

  const gated = state.risk_class === "high";
  return {
    issued_at: now,
    cost_mode: costMode?.value ?? "NORMAL",
    emotional_state: { state: state.state, risk_class: state.risk_class, recorded_at: state.ts },
    trading: { live_enabled: Boolean(authority?.live_enabled), kill_switch: Boolean(authority?.kill_switch) },
    open_flags: openFlags?.n ?? 0,
    protected_actions: (protectedActions.results ?? []).map((r) => ({
      ...r,
      allowed_now: !gated,
    })),
    boundary: gated
      ? "A high-risk state is in force. Protected actions are held; everything else runs as normal."
      : "No state-based hold. Protected actions still require their own approvals.",
  };
}
