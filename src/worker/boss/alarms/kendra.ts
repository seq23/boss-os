/**
 * KENDRA'S ALARMS (owner, 5 Nov 2026: stop "green but did nothing"). The one Systems alert path.
 *
 * An alarm is a row in `system_alarms` (migration 0350), one open row per key, owned by Kendra
 * (emp_continuity, Systems). When it opens she is given ONE repair task through the same admission
 * every repair uses; it closes itself when the condition clears. It reaches the owner's Today only
 * when it is `hers` (a key only she holds) — everything else is the team's to fix.
 *
 * The checks, run on the Worker's hourly tick (`runKendraChecks`), beside duties/staleness.ts:
 *   A. output floors   — a duty below its floor for `output_runs` runs in a row
 *                        ("<job> ran but produced <n> <metric> (needs <floor>)").
 *   B. first-run loops — every duty created after its floor existed gets an Open Loops row
 *                        "Check <job> produced <metric> by <created + 2 days>", owner Kendra, closed by
 *                        its first above-floor run.
 *   G2. stale tasks    — a task "running" for more than twice its usual duration, or two hours with
 *                        no recorded progress, naming its title and seat.
 * G1 (owner-bound email that fails) is read on her Mac (scripts/ops/owner-mail-watch.mjs), because
 * West Peek OS's database is not this Worker's; it raises through POST /api/boss/alarms.
 *
 * The rules are pure, in src/shared/boss/alarms/rules.mjs. This file only reads and writes.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { admitTask } from "../tasks/admit";
import {
  KENDRA, floorVerdict, floorAlarmText, firstRunLoop, firstRunMet, usualDuration, staleTaskVerdict, staleTaskText,
} from "../../../shared/boss/alarms/rules.mjs";

export type AlarmKind = "output_floor" | "stale_task" | "owner_mail";

export interface RaiseInput {
  key: string;
  kind: AlarmKind;
  text: string;
  subject_id?: string | null;
  hers?: boolean;
}

export interface Run {
  outcome: "ok" | "failed";
  output_count: number | null;
  finished_at: number;
}

const KEY_RE = /^(output|task|mail):[A-Za-z0-9_.#:@ -]{1,200}$/;
export const isAlarmKey = (k: unknown): k is string => typeof k === "string" && KEY_RE.test(k);

/**
 * Raise or refresh one alarm. A key already open is refreshed (its words and `seen`), never doubled;
 * a closed or new key opens a row and gives Kendra one repair task (none for `hers`: she alone can act).
 */
export async function raiseAlarm(env: Env, a: RaiseInput, now = Date.now()): Promise<{ action: "opened" | "kept" | "reopened"; id: string }> {
  if (!isAlarmKey(a.key)) throw new Error(`NAMED STOP [ALARM_KEY] "${a.key}" is not an alarm key`);
  const text = a.text.trim().slice(0, 600);
  const hers = a.hers ? 1 : 0;
  const row = await env.DB.prepare(`SELECT id, status FROM system_alarms WHERE alarm_key = ?`).bind(a.key).first<{ id: string; status: string }>();
  if (row?.status === "open") {
    await env.DB.prepare(`UPDATE system_alarms SET text = ?, hers = ?, last_at = ?, seen = seen + 1 WHERE id = ?`).bind(text, hers, now, row.id).run();
    return { action: "kept", id: row.id };
  }
  const id = row?.id ?? newId("alm");
  if (row) {
    await env.DB.prepare(
      `UPDATE system_alarms SET status = 'open', text = ?, hers = ?, first_at = ?, last_at = ?, seen = 1, task_id = NULL, closed_at = NULL, closed_reason = NULL WHERE id = ?`,
    ).bind(text, hers, now, now, id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO system_alarms (id, alarm_key, kind, owner, subject_id, text, hers, status, first_at, last_at, seen) VALUES (?,?,?,?,?,?,?,'open',?,?,1)`,
    ).bind(id, a.key, a.kind, KENDRA, a.subject_id ?? null, text, hers, now, now).run();
  }
  if (!hers) {
    const r = await admitTask(env, {
      title: `Kendra's alarm: ${text.slice(0, 140)}`,
      lane: "ops",
      employee_id: KENDRA,
      input: {
        origin: "repair", repair_kind: "kendra_alarm", alarm_id: id, alarm_key: a.key,
        prompt: `Systems alarm (${a.kind}): ${text} Find why at source and fix it, then let the next run prove it: ` +
          `the alarm closes itself when the condition clears. A floor that is simply wrong is changed on the duty row ` +
          `(standing_duties.output_floor) and in its Schedule row's "output", with the reason.`,
      },
    } as any).catch((err: unknown) => ({ created: false, reason: err instanceof Error ? err.message : String(err) }) as any);
    if (r?.created && r.task_id) await env.DB.prepare(`UPDATE system_alarms SET task_id = ? WHERE id = ?`).bind(r.task_id, id).run();
    else console.error(`kendra: the repair for alarm ${a.key} was not admitted (${r?.reason ?? "no reason"})`);
  }
  return { action: row ? "reopened" : "opened", id };
}

/** Close an open alarm whose condition cleared. Returns whether one was open. */
export async function clearAlarm(env: Env, key: string, reason: string, now = Date.now()): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE system_alarms SET status = 'closed', closed_at = ?, closed_reason = ? WHERE alarm_key = ? AND status = 'open'`)
    .bind(now, reason.slice(0, 300), key).run();
  return (r.meta.changes ?? 0) > 0;
}

// ─── Reading a duty's runs, whichever way it runs ─────────────────────────────────────────────

interface DutyFloorRow {
  id: string; name: string; executor: string; created_at: number | string | null;
  output_metric: string | null; output_floor: number | null; output_runs: number | null; output_since: number | null;
}

const MAX_RUNS = 12;

/**
 * The duty's runs since its floor was set, newest first. A Mac or cloud job reports through
 * /duties/ran (duty_runs.output_count, from its OUTPUT line). A Worker reader's run is its
 * `ran_in_worker` audit row (the rows it wrote). An agent duty's run is the task it materialised:
 * done with an output is 1 report delivered, failed is a failed run, still open is not judged yet.
 */
export async function runsFor(env: Env, d: DutyFloorRow): Promise<Run[]> {
  const since = Number(d.output_since ?? 0);
  if (d.executor === "worker") {
    const { results } = await env.DB.prepare(
      `SELECT ts, detail FROM audit_log WHERE entity_type = 'standing_duty' AND entity_id = ? AND action = 'ran_in_worker' AND ts >= ? ORDER BY ts DESC LIMIT ?`,
    ).bind(d.id, since, MAX_RUNS).all<{ ts: number; detail: string }>();
    return (results ?? []).map((r) => {
      let written: number | null = null;
      try { const v = JSON.parse(r.detail)?.written; written = Number.isFinite(Number(v)) ? Number(v) : null; } catch { written = null; }
      return { outcome: "ok", output_count: written, finished_at: r.ts };
    });
  }
  if (d.executor === "agent") {
    const { results } = await env.DB.prepare(
      `SELECT a.ts, t.status, t.output FROM audit_log a JOIN tasks t ON t.id = json_extract(a.detail, '$.task_id')
        WHERE a.entity_type = 'standing_duty' AND a.entity_id = ? AND a.action = 'materialised' AND a.ts >= ?
        ORDER BY a.ts DESC LIMIT ?`,
    ).bind(d.id, since, MAX_RUNS).all<{ ts: number; status: string; output: string | null }>();
    const out: Run[] = [];
    for (const r of results ?? []) {
      if (r.status === "failed" || r.status === "cancelled") out.push({ outcome: "failed", output_count: 0, finished_at: r.ts });
      else if (r.status === "done") out.push({ outcome: "ok", output_count: r.output && r.output.trim() ? 1 : 0, finished_at: r.ts });
      // queued / running / awaiting approval: not finished, so not judged — and not a reason to stop counting.
    }
    return out;
  }
  const { results } = await env.DB.prepare(
    `SELECT outcome, output_count, finished_at FROM duty_runs WHERE duty_id = ? AND finished_at >= ? ORDER BY finished_at DESC LIMIT ?`,
  ).bind(d.id, since, MAX_RUNS).all<Run>();
  return results ?? [];
}

const createdMs = (v: number | string | null): number => {
  const n = typeof v === "number" ? v : Date.parse(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
};

// ─── The hourly checks ───────────────────────────────────────────────────────────────────────

export interface KendraResult {
  duties: number;
  floors: { opened: string[]; kept: string[]; cleared: string[] };
  first_run: { opened: string[]; closed: string[] };
  stale: { opened: string[]; kept: string[]; cleared: string[] };
  running: number;
}

export async function runKendraChecks(env: Env, now = Date.now()): Promise<KendraResult> {
  const out: KendraResult = {
    duties: 0, floors: { opened: [], kept: [], cleared: [] }, first_run: { opened: [], closed: [] },
    stale: { opened: [], kept: [], cleared: [] }, running: 0,
  };

  // ── A and B: every live duty that declares a floor ─────────────────────────────────────────
  const { results: duties } = await env.DB.prepare(
    `SELECT id, name, executor, created_at, output_metric, output_floor, output_runs, output_since
       FROM standing_duties WHERE suspended = 0 AND removed_at IS NULL AND output_floor IS NOT NULL`,
  ).all<DutyFloorRow>();
  out.duties = (duties ?? []).length;
  // Rule 0: the migration declared a floor on every duty; reading none means the guard sees nothing.
  if (out.duties === 0) throw new Error("NAMED STOP [NO_FLOORS] no live duty declares an output floor, so nothing can be judged");

  for (const d of duties ?? []) {
    const runs = await runsFor(env, d);
    const key = `output:${d.id}`;
    const v = floorVerdict(d, runs);
    if (v.alarm) {
      const r = await raiseAlarm(env, { key, kind: "output_floor", subject_id: d.id, text: floorAlarmText(d, v) }, now);
      (r.action === "kept" ? out.floors.kept : out.floors.opened).push(d.id);
    } else if (runs.length && v.low === 0 && (await clearAlarm(env, key, "the newest run met its floor", now))) {
      out.floors.cleared.push(d.id);
    }

    // B. A duty born after its floor existed gets its first-run check; the first good run closes it.
    const born = createdMs(d.created_at);
    if (!Number.isFinite(born) || born < Number(d.output_since ?? Infinity)) continue;
    const loop = firstRunLoop({ ...d, created_at: born });
    const existing = await env.DB.prepare(`SELECT id, status FROM owner_open_loops WHERE source_key = ?`).bind(loop.source_key).first<{ id: string; status: string }>();
    const met = runs.find((r) => firstRunMet(r, d.output_floor));
    if (!existing && !met) {
      await env.DB.prepare(
        `INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, source_key, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'personal','not_finished','open','agent_report',?,?,?)`,
      ).bind(newId("olp"), loop.title, loop.finish_line, loop.next_step, loop.owner, loop.next_date, loop.source_key, now, now).run();
      out.first_run.opened.push(d.id);
    } else if (existing?.status === "open" && met) {
      await env.DB.prepare(`UPDATE owner_open_loops SET status = 'closed', closed_reason = ?, closed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(Number(d.output_floor) > 0 ? `first run produced ${met.output_count} ${d.output_metric}` : "first run finished cleanly", now, now, existing.id).run();
      out.first_run.closed.push(d.id);
    }
  }

  // ── G2: tasks that sit "running" ───────────────────────────────────────────────────────────
  const { results: running } = await env.DB.prepare(
    `SELECT t.id, t.title, t.intake_kind, t.started_at,
            (SELECT MAX(ts) FROM task_events e WHERE e.task_id = t.id) AS last_event_at,
            (SELECT MAX(COALESCE(r.claimed_at, r.started_at)) FROM backend_runs r WHERE r.task_id = t.id) AS last_claim_at,
            (SELECT r.backend_id FROM backend_runs r WHERE r.task_id = t.id ORDER BY COALESCE(r.claimed_at, r.started_at) DESC LIMIT 1) AS seat
       FROM tasks t WHERE t.status = 'running'`,
  ).all<{ id: string; title: string; intake_kind: string | null; started_at: number | null; last_event_at: number | null; last_claim_at: number | null; seat: string | null }>();
  out.running = (running ?? []).length;
  const usualByKind = new Map<string, number | null>();
  const stillStale = new Set<string>();
  for (const t of running ?? []) {
    const kind = t.intake_kind ?? "";
    if (!usualByKind.has(kind)) {
      const { results: done } = await env.DB.prepare(
        `SELECT finished_at - started_at AS ms FROM tasks WHERE status = 'done' AND COALESCE(intake_kind, '') = ? AND started_at IS NOT NULL
           AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 50`,
      ).bind(kind).all<{ ms: number }>();
      usualByKind.set(kind, usualDuration((done ?? []).map((r) => r.ms)));
    }
    const last = Math.max(Number(t.last_event_at ?? 0), Number(t.last_claim_at ?? 0)) || null;
    const v = staleTaskVerdict({ started_at: t.started_at, last_progress_at: last }, usualByKind.get(kind) ?? null, now);
    if (!v.stale) continue;
    stillStale.add(t.id);
    const r = await raiseAlarm(env, { key: `task:${t.id}`, kind: "stale_task", subject_id: t.id, text: staleTaskText({ title: t.title, seat: t.seat }, v) }, now);
    (r.action === "kept" ? out.stale.kept : out.stale.opened).push(t.id);
  }
  // A stale alarm whose task finished, failed or moved on is cleared.
  const { results: openStale } = await env.DB.prepare(`SELECT alarm_key, subject_id FROM system_alarms WHERE kind = 'stale_task' AND status = 'open'`)
    .all<{ alarm_key: string; subject_id: string }>();
  for (const a of openStale ?? []) {
    if (stillStale.has(a.subject_id)) continue;
    if (await clearAlarm(env, a.alarm_key, "the task is no longer stuck running", now)) out.stale.cleared.push(a.subject_id);
  }
  return out;
}

/** Open alarms only the owner can fix, for her Today. */
export async function herAlarms(db: D1Database): Promise<{ text: string; alarm_key: string }[]> {
  const { results } = await db.prepare(`SELECT text, alarm_key FROM system_alarms WHERE status = 'open' AND hers = 1 ORDER BY last_at DESC LIMIT 10`)
    .all<{ text: string; alarm_key: string }>()
    .catch(() => ({ results: [] as { text: string; alarm_key: string }[] }));
  return results ?? [];
}
