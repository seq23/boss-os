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
  KENDRA, floorVerdict, floorAlarmText, firstRunLoop, firstRunMet, usualDuration, staleTaskVerdict, staleTaskText, centralDay,
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
    /*
     * THE REPAIR GOES TO DANIELLE'S REPAIR LANE, NEVER A MODEL'S PROSE (7 Nov 2026). Until now the
     * repair was a one-off on Kendra's desk: a free cloud model with no tools and no data, asked to
     * "find why at source". It invented a "Morning System Report: 31 Oct 2026" (a "Task D", a
     * "dev-sandbox-04", "84GB headroom") and ended "Waiting for Partner approval", which put it in her
     * Inbox. Now it is a repo-change repair on Danielle's desk (kind `kendra_alarm` in REPAIR_KINDS):
     * real code, real reads, no plan approval (repairs never wait on her, 25 Oct 2026), one plain
     * line after. The prompt carries the recorded facts and nothing else (`alarmFacts`).
     */
    const facts = alarmFacts({ id, key: a.key, kind: a.kind, text, subject_id: a.subject_id ?? null, at: now });
    const r = await admitTask(env, {
      title: `Fix Kendra's alarm: ${text.replace(/^(?:"?(?:Fix )?Kendra's alarm:\s*)+/i, "").slice(0, 140)}`,
      lane: "ops",
      employee_id: REPAIR_SEAT,
      input: {
        origin: "repair", repair_kind: "kendra_alarm", alarm_id: id, alarm_key: a.key, build_ask: true,
        prompt: `seq23/boss-os — Kendra's Systems alarm (${a.kind}). Recorded facts, the only facts:\n${facts}\n` +
          `Find why at source in the code and the live records, and fix it, then let the next run prove it: ` +
          `the alarm closes itself when the condition clears. A floor that is simply wrong is changed on the duty row ` +
          `(standing_duties.output_floor) and in its Schedule row's "output", with the reason. A stuck claim, lock or ` +
          `hung run is cleared, re-run or reaped by you, logged, never put to her. Write only what you read; a value you ` +
          `did not read is "not read: <reason>". Ask her only for money, her own accounts or sign-ins, legal steps, or ` +
          `publishing that cannot be undone.`,
      },
    } as any).catch((err: unknown) => ({ created: false, reason: err instanceof Error ? err.message : String(err) }) as any);
    if (r?.created && r.task_id) await env.DB.prepare(`UPDATE system_alarms SET task_id = ? WHERE id = ?`).bind(r.task_id, id).run();
    else console.error(`kendra: the repair for alarm ${a.key} was not admitted (${r?.reason ?? "no reason"})`);
  }
  return { action: row ? "reopened" : "opened", id };
}

/** Danielle's desk: every repair Boss OS opens itself runs there (lane.mjs REPAIR_KINDS). */
export const REPAIR_SEAT = "emp_repo";

/** The alarm's recorded facts, one per line: what the repair is told and what its report may say. Pure. */
export function alarmFacts(a: { id: string; key: string; kind: string; text: string; subject_id: string | null; at: number }): string {
  return [
    `- alarm ${a.id} (${a.kind}), key ${a.key}, opened ${new Date(a.at).toISOString()}`,
    `- what Kendra's check read: ${a.text}`,
    a.subject_id ? `- about: ${a.subject_id}` : null,
  ].filter(Boolean).join("\n");
}

/** Is this task's input one of Kendra's own alarm repairs? Pure. */
export function isKendraRepair(input: unknown): boolean {
  let v: any = input;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return false; } }
  return Boolean(v) && typeof v === "object" && v.origin === "repair" && v.repair_kind === "kendra_alarm";
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

/*
 * WHAT AN AGENT DUTY DELIVERED (8 Nov 2026, alarm output:duty_exec_intel). The agent branch used to
 * score a done task by `tasks.output`, which only the cloud completion paths write. Every agent duty is
 * dispatched to a seat and finishes through POST /backends/report, which closes the task and never
 * writes `output` — so the morning report, delivered at 06:15 Central both days, scored 0 two runs in
 * a row and raised a false alarm (and the four other agent duties would have followed). A run's real
 * output is the rows it wrote into the table its task declares in `input.delivers`, the one contract
 * duties/deliverReport.ts guards on. Each statement is STATIC so validate:sql EXPLAINs it against the
 * real schema (an interpolated table name is skipped by that validator). Bounded by `output_since`,
 * grouped by task. scripts/validate/duties-deliver-somewhere.mjs check 11 fails the build when a
 * floored agent duty declares a key this map does not hold.
 */
export const DELIVERY_CENSUS = {
  executive_reports:
    `SELECT task_id, COUNT(*) AS n FROM executive_reports WHERE task_id IS NOT NULL AND status <> 'failed' AND generated_at >= ? GROUP BY task_id`,
  practice_week:
    `SELECT task_id, COUNT(*) AS n FROM practice_week WHERE task_id IS NOT NULL AND status <> 'failed' AND generated_at >= ? GROUP BY task_id`,
  sourcing_candidates:
    `SELECT r.task_id AS task_id, COUNT(*) AS n FROM sourcing_candidates x JOIN backend_runs r ON r.id = x.run_id WHERE x.updated_at >= ? GROUP BY r.task_id`,
  link_prospects:
    `SELECT r.task_id AS task_id, COUNT(*) AS n FROM link_prospects x JOIN backend_runs r ON r.id = x.run_id WHERE x.updated_at >= ? GROUP BY r.task_id`,
  tool_suggestions:
    `SELECT r.task_id AS task_id, COUNT(*) AS n FROM tool_suggestions x JOIN backend_runs r ON r.id = x.run_id WHERE x.updated_at >= ? GROUP BY r.task_id`,
  quality_reads:
    `SELECT task_id, COUNT(*) AS n FROM quality_reads WHERE task_id IS NOT NULL AND at >= ? GROUP BY task_id`,
} as const;
export type DeliveryKey = keyof typeof DELIVERY_CENSUS;

/** Rows delivered per task into one declared table since the floor was set. */
async function deliveredByTask(env: Env, key: DeliveryKey, since: number): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(DELIVERY_CENSUS[key]).bind(since).all<{ task_id: string | null; n: number }>();
  const m = new Map<string, number>();
  for (const r of results ?? []) if (r.task_id) m.set(r.task_id, Number(r.n) || 0);
  return m;
}

/**
 * The duty's runs since its floor was set, newest first. A Mac or cloud job reports through
 * /duties/ran (duty_runs.output_count, from its OUTPUT line). A Worker reader's run is its
 * `ran_in_worker` audit row (the rows it wrote). An agent duty's run is the task it materialised:
 * done counts the rows it delivered into the table its task declares (`delivers`, DELIVERY_CENSUS),
 * failed is a failed run, still open is not judged yet.
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
      `SELECT a.ts, t.id AS task_id, t.status, t.output, json_extract(t.input, '$.delivers') AS delivers
         FROM audit_log a JOIN tasks t ON t.id = json_extract(a.detail, '$.task_id')
        WHERE a.entity_type = 'standing_duty' AND a.entity_id = ? AND a.action = 'materialised' AND a.ts >= ?
        ORDER BY a.ts DESC LIMIT ?`,
    ).bind(d.id, since, MAX_RUNS).all<{ ts: number; task_id: string; status: string; output: string | null; delivers: string | null }>();
    // ONE grouped read per delivery table this duty's runs declare, not one per run.
    const delivered = new Map<string, Map<string, number>>();
    for (const r of results ?? []) {
      if (r.status !== "done" || !r.delivers || !(r.delivers in DELIVERY_CENSUS) || delivered.has(r.delivers)) continue;
      delivered.set(r.delivers, await deliveredByTask(env, r.delivers as DeliveryKey, since));
    }
    const out: Run[] = [];
    for (const r of results ?? []) {
      if (r.status === "failed" || r.status === "cancelled") out.push({ outcome: "failed", output_count: 0, finished_at: r.ts });
      else if (r.status === "done") {
        const census = r.delivers ? delivered.get(r.delivers) : undefined;
        // A declared delivery table is the truth: a done task with no row delivered nothing and still scores 0.
        // Only a task that declares no table the census holds falls back to the cloud path's `tasks.output`.
        const n = census ? (census.get(r.task_id) ?? 0) : (r.output && r.output.trim() ? 1 : 0);
        out.push({ outcome: "ok", output_count: n, finished_at: r.ts });
      }
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
  stale: { opened: string[]; kept: string[]; cleared: string[]; repairs?: number };
  running: number;
  morning?: MorningVerdict | "not read";
}

// ─── C. The morning email that did not go ────────────────────────────────────────────────────

/** From this Central hour a morning email that has not gone is said out loud: the 07:50 safety tick has had its turn. */
export const MORNING_MISSING_FROM_HOUR = 9;
export const MORNING_ALARM_KEY = "mail:morning-email";
export type MorningVerdict = "sent" | "early" | "told" | "already told";

/**
 * THE MORNING EMAIL CAN NEVER GO MISSING SILENTLY (owner, 13 Nov 2026: on 10 Nov both ticks ended
 * "send refused" and nothing told her). Read HERE, on the Worker's hourly tick, because it shares
 * nothing with what failed: not the GitHub runner, not the email's builder, not its plain-words gate.
 * "Sent" is the day's own mark (`morning_digests.sent_at`, written by the run after the send) or a
 * digest in the sent log since midnight. Not sent by 09:00 Central: Kendra's alarm opens (ONE repair
 * for Danielle) and ONE notice a day is written, which her Mac's drain sends as an alarm email
 * (`morning_missing`, scripts/ops/task-notices.mjs). The email itself is sent by the next tick of
 * job-your-day.yml that works (09:30, 12:30); the alarm closes when it has gone.
 */
export async function morningEmailCheck(env: Env, now = Date.now()): Promise<MorningVerdict> {
  const day = centralDay(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
  const marked = await env.DB.prepare(`SELECT sent_at FROM morning_digests WHERE day = ?`).bind(day).first<{ sent_at: number | null }>();
  const mailed = marked?.sent_at != null || (await env.DB
    .prepare(`SELECT 1 AS x FROM boss_sent_mail WHERE layout = 'digest' AND delivery_state = 'sent' AND sent_at >= ? LIMIT 1`)
    .bind(now - (hour + 1) * 3600_000).first<{ x: number }>()) != null;
  if (mailed) {
    await clearAlarm(env, MORNING_ALARM_KEY, "the morning email went", now);
    return "sent";
  }
  if (hour < MORNING_MISSING_FROM_HOUR) return "early";
  await raiseAlarm(env, {
    key: MORNING_ALARM_KEY, kind: "owner_mail", subject_id: day,
    text: `Simone's morning email for ${day} had not been sent by ${hour}:00 Central (no sent mark on the day's morning and no digest in the sent log). Read the job's private log (job-your-day.yml, scripts/ops/your-day.mjs), fix the cause at source, and let its next tick send it`,
  }, now);
  const noticeKey = `morning-${day}`;
  const told = await env.DB.prepare(`SELECT id FROM boss_task_notices WHERE task_id = ? AND kind = 'morning_missing' LIMIT 1`).bind(noticeKey).first<{ id: string }>();
  if (told) return "already told";
  const body = [
    "What broke: Your morning email has not gone out today.",
    "What was lost: Nothing. Today's decisions, deals and briefing are on your Today page in Boss OS.",
    "What is being done: Danielle has a repair job for it, and the email is tried again later this morning and at midday. It reaches you as soon as it works.",
  ].join("\n");
  await env.DB.prepare(
    `INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her) VALUES (?,?,'ops','Kendra','morning_missing',?,?,?,1)`,
  ).bind(newId("tnt"), noticeKey, "Your morning email did not go out today", body, now).run();
  return "told";
}

/** The last 50 done tasks of one title, or of one intake kind: each one's WORK time (finish minus the newest claim, else the start). */
const USUAL_BY_TITLE = `SELECT t.finished_at - COALESCE((SELECT MAX(r.claimed_at) FROM backend_runs r WHERE r.task_id = t.id), t.started_at) AS ms
  FROM tasks t WHERE t.status = 'done' AND t.title = ? AND t.started_at IS NOT NULL AND t.finished_at IS NOT NULL
  ORDER BY t.finished_at DESC LIMIT 50`;
const USUAL_BY_KIND = `SELECT t.finished_at - COALESCE((SELECT MAX(r.claimed_at) FROM backend_runs r WHERE r.task_id = t.id), t.started_at) AS ms
  FROM tasks t WHERE t.status = 'done' AND COALESCE(t.intake_kind, '') = ? AND t.started_at IS NOT NULL AND t.finished_at IS NOT NULL
  ORDER BY t.finished_at DESC LIMIT 50`;
async function usualOf(env: Env, sql: typeof USUAL_BY_TITLE | typeof USUAL_BY_KIND, value: string): Promise<number | null> {
  const { results } = await env.DB.prepare(sql).bind(value).all<{ ms: number }>();
  return usualDuration((results ?? []).map((r) => r.ms));
}

export async function runKendraChecks(env: Env, now = Date.now()): Promise<KendraResult> {
  const out: KendraResult = {
    duties: 0, floors: { opened: [], kept: [], cleared: [] }, first_run: { opened: [], closed: [] },
    stale: { opened: [], kept: [], cleared: [], repairs: 0 }, running: 0,
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
  /*
   * THE CLOCK IS THE WORK'S (9 Nov 2026). tasks.started_at is stamped when the task enters the cloud,
   * a second before its run is parked on a seat; a run no machine has claimed is waiting, not running,
   * and names no seat it "runs on". The newest run's claim decides both.
   */
  const { results: running } = await env.DB.prepare(
    `SELECT t.id, t.title, t.intake_kind, t.started_at, t.input,
            (SELECT MAX(ts) FROM task_events e WHERE e.task_id = t.id) AS last_event_at,
            (SELECT MAX(COALESCE(r.claimed_at, r.started_at)) FROM backend_runs r WHERE r.task_id = t.id) AS last_claim_at,
            (SELECT COUNT(*) FROM backend_runs r WHERE r.task_id = t.id) AS run_count,
            (SELECT r.backend_id FROM backend_runs r WHERE r.task_id = t.id ORDER BY r.started_at DESC LIMIT 1) AS run_seat,
            (SELECT r.claimed_at FROM backend_runs r WHERE r.task_id = t.id ORDER BY r.started_at DESC LIMIT 1) AS claimed_at,
            (SELECT MAX(r.started_at) FROM backend_runs r WHERE r.task_id = t.id) AS parked_at
       FROM tasks t WHERE t.status = 'running'`,
  ).all<{
    id: string; title: string; intake_kind: string | null; started_at: number | null; input?: string | null;
    last_event_at: number | null; last_claim_at: number | null; run_count: number | null; run_seat: string | null; claimed_at: number | null; parked_at: number | null;
  }>();
  out.running = (running ?? []).length;
  const usual = new Map<string, number | null>();
  const stillStale = new Set<string>();
  for (const t of running ?? []) {
    /*
     * NO ALARM ON KENDRA'S OWN REPAIR (7 Nov 2026). Each repair of a stale task ran long, went stale
     * itself, and opened a repair of the repair: "Kendra's alarm: Kendra's alarm: Kendra's alarm: …",
     * one an hour from 20:00 to 03:00 UTC on 6-7 Nov. The alarm it serves is still open and is the
     * record; the repair is counted here, never raised again.
     */
    if (isKendraRepair(t.input)) { out.stale.repairs = (out.stale.repairs ?? 0) + 1; continue; }
    /*
     * "ITS USUAL" IS THE JOB'S OWN (9 Nov 2026, alarm task:tsk_m702ww3013yvqr98). The kind's median
     * mixed every research job (0 to 1,647 min over the last 50) into a 9-minute "usual" for the
     * Brokerage Sourcing Sweep; the title's own work times come first once it has USUAL_MIN_SAMPLES
     * finished runs, the kind's only before then. Both are WORK time: finish minus the newest claim.
     */
    const kind = t.intake_kind ?? "";
    const titleKey = `title:${t.title}`;
    if (!usual.has(titleKey)) usual.set(titleKey, await usualOf(env, USUAL_BY_TITLE, t.title));
    let usualMs = usual.get(titleKey) ?? null;
    if (usualMs == null) {
      const kindKey = `kind:${kind}`;
      if (!usual.has(kindKey)) usual.set(kindKey, await usualOf(env, USUAL_BY_KIND, kind));
      usualMs = usual.get(kindKey) ?? null;
    }
    const last = Math.max(Number(t.last_event_at ?? 0), Number(t.last_claim_at ?? 0)) || null;
    const parked = Number(t.run_count ?? 0) > 0 && t.claimed_at == null;
    const v = staleTaskVerdict({ started_at: t.started_at, claimed_at: t.claimed_at, parked, parked_at: t.parked_at, last_progress_at: last }, usualMs, now);
    if (!v.stale) continue;
    stillStale.add(t.id);
    const r = await raiseAlarm(env, { key: `task:${t.id}`, kind: "stale_task", subject_id: t.id, text: staleTaskText({ title: t.title, seat: parked ? null : t.run_seat, parked_on: t.run_seat }, v) }, now);
    (r.action === "kept" ? out.stale.kept : out.stale.opened).push(t.id);
  }
  // A stale alarm whose task finished, failed or moved on is cleared.
  const { results: openStale } = await env.DB.prepare(`SELECT alarm_key, subject_id FROM system_alarms WHERE kind = 'stale_task' AND status = 'open'`)
    .all<{ alarm_key: string; subject_id: string }>();
  for (const a of openStale ?? []) {
    if (stillStale.has(a.subject_id)) continue;
    if (await clearAlarm(env, a.alarm_key, "the task is no longer stuck running", now)) out.stale.cleared.push(a.subject_id);
  }
  // ── C: the morning email ───────────────────────────────────────────────────────────────────
  out.morning = await morningEmailCheck(env, now).catch((e: unknown) => { console.error(`kendra: the morning email check did not run (${e instanceof Error ? e.message : String(e)})`); return "not read" as const; });
  return out;
}

/** Open alarms only the owner can fix, for her Today. */
export async function herAlarms(db: D1Database): Promise<{ text: string; alarm_key: string }[]> {
  const { results } = await db.prepare(`SELECT text, alarm_key FROM system_alarms WHERE status = 'open' AND hers = 1 ORDER BY last_at DESC LIMIT 10`)
    .all<{ text: string; alarm_key: string }>()
    .catch(() => ({ results: [] as { text: string; alarm_key: string }[] }));
  return results ?? [];
}
