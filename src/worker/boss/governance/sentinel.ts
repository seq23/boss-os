/**
 * The Compliance Sentinel — canon §4.
 *
 * It reads the real tables and raises a flag per watch item that is currently
 * true. Every check names the table it read; a sentinel that reports on
 * nothing checkable is a status light wired to a battery.
 *
 * Flags are idempotent per watch item and subject: running the sentinel twice
 * in a row does not double the board.
 */

import { vaultIsStale } from "../cron/cadence";
import type { Env } from "../env";
import { raiseFlag, WATCH_LIST } from "./gate";
import { SERIOUS_JOB_TYPES } from "../routes/capability";

const DAY_MS = 86_400_000;

export interface SentinelResult {
  ran_at: number;
  checked: number;
  raised: { watch_key: string; summary: string }[];
  already_open: string[];
  clean: string[];
}

async function alreadyOpen(db: D1Database, watchKey: string, subjectId: string | null): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM compliance_flags
        WHERE watch_key = ? AND status = 'open' AND (subject_id IS ? OR subject_id = ?)
        LIMIT 1`,
    )
    .bind(watchKey, subjectId, subjectId)
    .first();
  return Boolean(row);
}

/** One sweep. Reads only; the only writes are the flags it raises. */
export async function runSentinel(env: Env, now = Date.now()): Promise<SentinelResult> {
  const raised: { watch_key: string; summary: string }[] = [];
  const alreadyThere: string[] = [];
  const clean: string[] = [];

  const consider = async (
    watchKey: string,
    condition: boolean,
    summary: string,
    detail: unknown,
    subjectId: string | null = null,
  ) => {
    if (!condition) { clean.push(watchKey); return; }
    if (await alreadyOpen(env.DB, watchKey, subjectId)) { alreadyThere.push(watchKey); return; }
    const severity = WATCH_LIST.find((w) => w.key === watchKey)?.severity ?? "medium";
    await raiseFlag(env.DB, { watch_key: watchKey, severity, summary, detail, subject_id: subjectId }, now);
    raised.push({ watch_key: watchKey, summary });
  };

  const [
    state, authority, deadLetters, snapshot, expiring, maintenance, ipDue, predictions, defaults, restrictedExports,
  ] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, state, risk_class, ts FROM emotional_states
          WHERE cleared_at IS NULL AND (valid_until IS NULL OR valid_until > ?)
          ORDER BY ts DESC LIMIT 1`,
      )
      .bind(now)
      .first<{ id: string; state: string; risk_class: string; ts: number }>(),
    env.DB.prepare(`SELECT kill_switch FROM trading_authority LIMIT 1`).first<{ kill_switch: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM dead_letters WHERE status = 'open'`).first<{ n: number }>(),
    env.DB.prepare(`SELECT ts FROM vault_snapshots WHERE status = 'complete' ORDER BY ts DESC LIMIT 1`).first<{ ts: number }>(),
    env.DB
      .prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`)
      .bind(now + DAY_MS)
      .first<{ n: number }>(),
    env.DB
      .prepare(`SELECT key, title, due_at FROM maintenance_items WHERE status = 'active' AND due_at IS NOT NULL AND due_at < ?`)
      .bind(now)
      .all<{ key: string; title: string; due_at: number }>(),
    env.DB
      .prepare(`SELECT id, name, renewal_at FROM ip_assets WHERE status = 'active' AND renewal_at IS NOT NULL AND renewal_at < ?`)
      .bind(now + 30 * DAY_MS)
      .all<{ id: string; name: string; renewal_at: number }>(),
    env.DB
      .prepare(`SELECT COUNT(*) AS n FROM predictions WHERE status = 'open' AND resolves_at < ?`)
      .bind(now)
      .first<{ n: number }>(),
    env.DB.prepare(`SELECT job_type FROM active_defaults`).all<{ job_type: string }>(),
    env.DB
      .prepare(`SELECT id, ts, restricted_included FROM knowledge_exports WHERE restricted_included > 0 ORDER BY ts DESC LIMIT 1`)
      .first<{ id: string; ts: number; restricted_included: number }>(),
  ]);

  await consider(
    "high_risk_state",
    state?.risk_class === "high",
    `A high-risk state (${state?.state}) is in force. Protected actions are held.`,
    { state_id: state?.id, recorded_at: state?.ts },
    state?.id ?? null,
  );

  await consider("kill_switch", Boolean(authority?.kill_switch), "The trading kill switch is engaged.", {}, null);

  await consider(
    "open_dead_letters",
    (deadLetters?.n ?? 0) > 0,
    `${deadLetters?.n ?? 0} task(s) gave up and have not been triaged.`,
    { count: deadLetters?.n ?? 0 },
  );

  await consider(
    "stale_vault",
    // One rule, in `cron/cadence.ts`, asked of the cadence that takes the snapshots. This read
    // `now - snapshot.ts > 2 * DAY_MS` and `routes/governance.ts` held an identical copy — two
    // components each keeping their own idea of freshness, and neither linked to the schedule.
    vaultIsStale(now, snapshot?.ts ?? null),
    snapshot
      ? `The last complete snapshot is ${Math.floor((now - snapshot.ts) / DAY_MS)} days old.`
      : "No complete snapshot has ever been taken.",
    { last_snapshot_at: snapshot?.ts ?? null },
  );

  await consider(
    "expiring_approvals",
    (expiring?.n ?? 0) > 0,
    `${expiring?.n ?? 0} approval(s) expire within a day, and an expired approval cancels its origin.`,
    { count: expiring?.n ?? 0 },
  );

  for (const item of maintenance.results ?? []) {
    await consider(
      "overdue_maintenance",
      true,
      `Maintenance overdue: ${item.title}.`,
      { key: item.key, due_at: item.due_at },
      item.key,
    );
  }
  if ((maintenance.results?.length ?? 0) === 0) clean.push("overdue_maintenance");

  for (const asset of ipDue.results ?? []) {
    await consider(
      "ip_renewal_due",
      true,
      `${asset.name} renews within thirty days.`,
      { renewal_at: asset.renewal_at },
      asset.id,
    );
  }
  if ((ipDue.results?.length ?? 0) === 0) clean.push("ip_renewal_due");

  await consider(
    "unresolved_predictions",
    (predictions?.n ?? 0) > 0,
    `${predictions?.n ?? 0} prediction(s) are past their date and unscored.`,
    { count: predictions?.n ?? 0 },
  );

  const covered = new Set((defaults.results ?? []).map((d) => d.job_type));
  const uncovered = SERIOUS_JOB_TYPES.filter((j) => !covered.has(j));
  await consider(
    "uncovered_job_type",
    uncovered.length > 0,
    `${uncovered.length} job type(s) have no active capability default: ${uncovered.join(", ")}.`,
    { uncovered },
  );

  await consider(
    "restricted_export",
    Boolean(restrictedExports) && now - (restrictedExports?.ts ?? 0) < 7 * DAY_MS,
    restrictedExports
      ? `An export carried ${restrictedExports.restricted_included} restricted item(s) in the last week.`
      : "",
    { export_id: restrictedExports?.id ?? null },
    restrictedExports?.id ?? null,
  );

  return {
    ran_at: now,
    checked: WATCH_LIST.length,
    raised,
    already_open: [...new Set(alreadyThere)],
    clean: [...new Set(clean)],
  };
}
