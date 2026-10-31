/**
 * THE OWNER'S DUTY EDITS — the Worker half (Builder U, 23 Oct 2026, boards 7 + 8).
 *
 * Every change she makes on an employee page lands here: instructions, schedule, pause, remove,
 * undo. Each one writes a `duty_versions` row (the state AFTER the change) so every version is kept
 * and "Undo to the last version" is a restore, never a delete. The pure rules — which duties carry
 * instructions, which schedules a Mac tick can honour, what duty-run.sh does with a brief — live in
 * src/shared/boss/duties/ownerEdits.mjs. The jobs read the result:
 *   - materialiseDueDuties reads `owner_prompt` as the task's prompt (Worker duties);
 *   - /api/duties/brief/:local_job hands it to duty-run.sh (Mac duties), with pause and schedule.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/http";
import { EARLY_RUN_GRACE_MS, isDue, nextDueAt, type DutySchedule } from "./cadence";
import { composeBriefingPrompt, ctDayLabel } from "./briefingSpec";
import {
  DUTY_PROMPT_FILES, choiceOf, choicesFor, localDate, macDueToday, scheduleFromChoice, scheduleWords, timeEditable,
} from "../../../shared/boss/duties/ownerEdits.mjs";
import { REPO_PROMPTS } from "../../../shared/boss/duties/repoPrompts.generated.mjs";

export const MAX_INSTRUCTIONS = 60_000;
export const OWNER_TZ = "America/Chicago";

export interface OwnedDuty {
  id: string; name: string; employee_id: string; lane: string;
  local_hour: number; local_minute: number; timezone: string;
  cadence: "daily" | "weekly" | "monthly"; weekday: number | null; weekdays: string | null;
  next_due_at: number; last_run_at: number | null; task_input: string | null; success_criteria: string;
  suspended: number; executor: string | null; last_outcome: string | null; last_outcome_at: number | null;
  last_failure_reason: string | null;
  owner_prompt: string | null; owner_schedule_at: number | null; removed_at: number | null; mac_tick: string | null;
}

export interface Instructions {
  /** owner = her edit; repo = the repository's prompt, read as the default; fixed = steps in code, nothing to edit. */
  source: "owner" | "repo" | "fixed";
  text: string | null;
  /** The repository's text, so the page can say "back to the original". Null for fixed duties. */
  repo_text: string | null;
  where: string | null;
}

function inputOf(d: Pick<OwnedDuty, "task_input">): Record<string, unknown> {
  try { return d.task_input ? (JSON.parse(d.task_input) as Record<string, unknown>) : {}; } catch { return {}; }
}

/** The instructions the repository gives this duty, or null when its steps are fixed in code. */
export function repoInstructions(d: OwnedDuty, now = Date.now()): { text: string; where: string } | null {
  const file = (DUTY_PROMPT_FILES as Record<string, string>)[d.id];
  if (file) {
    const p = (REPO_PROMPTS as Record<string, { path: string; text: string }>)[d.id];
    return p ? { text: p.text, where: p.path } : null;
  }
  if (d.executor === "local_job" || d.executor === "worker") return null;
  const input = inputOf(d);
  if (input.spec_module === "executive_briefing") {
    return { text: composeBriefingPrompt({ dayLabel: ctDayLabel(now), hasMarketData: true }), where: "src/worker/boss/duties/briefingSpec.ts" };
  }
  if (typeof input.prompt === "string" && input.prompt.trim()) return { text: input.prompt, where: "the duty's own record" };
  return null;
}

export function instructionsOf(d: OwnedDuty, now = Date.now()): Instructions {
  const repo = repoInstructions(d, now);
  if (!repo) return { source: "fixed", text: null, repo_text: null, where: null };
  if (d.owner_prompt !== null && d.owner_prompt !== undefined) {
    return { source: "owner", text: d.owner_prompt, repo_text: repo.text, where: "your edit, saved in Boss OS" };
  }
  return { source: "repo", text: repo.text, repo_text: repo.text, where: repo.where };
}

export async function loadDuty(env: Env, id: string): Promise<OwnedDuty> {
  const d = await env.DB.prepare(`SELECT * FROM standing_duties WHERE id = ?`).bind(id).first<OwnedDuty>();
  if (!d) throw notFound("No duty with that id");
  return d;
}

function scheduleOf(d: Pick<OwnedDuty, "local_hour" | "local_minute" | "timezone" | "cadence" | "weekday" | "weekdays">): DutySchedule {
  let weekdays: number[] | null = null;
  try { weekdays = d.weekdays ? (JSON.parse(d.weekdays) as number[]) : null; } catch { weekdays = null; }
  return { local_hour: d.local_hour, local_minute: d.local_minute, timezone: d.timezone, cadence: d.cadence, weekday: d.weekday, weekdays };
}

interface VersionRow {
  version: number; action: string; owner_prompt: string | null; cadence: string; weekday: number | null;
  weekdays: string | null; local_hour: number; local_minute: number; suspended: number; removed: number; created_at: number;
}

export async function versionsOf(env: Env, dutyId: string): Promise<VersionRow[]> {
  return (await env.DB.prepare(
    `SELECT version, action, owner_prompt, cadence, weekday, weekdays, local_hour, local_minute, suspended, removed, created_at
       FROM duty_versions WHERE duty_id = ? ORDER BY version DESC`,
  ).bind(dutyId).all<VersionRow>()).results ?? [];
}

async function writeVersion(env: Env, d: OwnedDuty, action: string, now: number): Promise<number> {
  const top = await env.DB.prepare(`SELECT MAX(version) AS v FROM duty_versions WHERE duty_id = ?`).bind(d.id).first<{ v: number | null }>();
  const version = top?.v === null || top?.v === undefined ? 0 : top.v + 1;
  await env.DB.prepare(
    `INSERT INTO duty_versions (id, duty_id, version, action, owner_prompt, cadence, weekday, weekdays, local_hour, local_minute, suspended, removed, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(newId("dv"), d.id, version, action, d.owner_prompt, d.cadence, d.weekday, d.weekdays, d.local_hour, d.local_minute,
    d.suspended, d.removed_at ? 1 : 0, now).run();
  return version;
}

/** Version 0 is the duty as it was before her first change, so the first Undo has somewhere to go. */
async function ensureOriginal(env: Env, d: OwnedDuty, now: number): Promise<void> {
  const any = await env.DB.prepare(`SELECT 1 AS x FROM duty_versions WHERE duty_id = ? LIMIT 1`).bind(d.id).first();
  if (!any) await writeVersion(env, d, "original", now);
}

async function store(env: Env, d: OwnedDuty): Promise<void> {
  await env.DB.prepare(
    `UPDATE standing_duties SET owner_prompt = ?, owner_schedule_at = ?, removed_at = ?, cadence = ?, weekday = ?, weekdays = ?,
            local_hour = ?, local_minute = ?, next_due_at = ?, suspended = ?, suspended_reason = ? WHERE id = ?`,
  ).bind(d.owner_prompt, d.owner_schedule_at, d.removed_at, d.cadence, d.weekday, d.weekdays, d.local_hour, d.local_minute,
    d.next_due_at, d.suspended, d.suspended ? (d.removed_at ? "Removed on the employee page" : "Paused on the employee page") : null, d.id).run();
}

export interface EditInput { instructions?: string | null; schedule?: string | null; hour?: number | null; minute?: number | null }

/** Save changes: her instructions and/or when it runs. Refused, with the reason, rather than half-applied. */
export async function editDuty(env: Env, id: string, input: EditInput, now = Date.now()) {
  const d = await loadDuty(env, id);
  if (d.removed_at) throw badRequest("This duty was removed", "Undo the removal first, then change it.");
  const next: OwnedDuty = { ...d };
  const changed: string[] = [];

  if (input.instructions !== undefined && input.instructions !== null) {
    const repo = repoInstructions(d, now);
    if (!repo) {
      throw badRequest("This duty has no written instructions to change",
        "Its steps are fixed in code. Use \"Ask Danielle to change how it works\" instead.");
    }
    const text = String(input.instructions).replace(/\r\n/g, "\n");
    if (!text.trim()) throw badRequest("The instructions are empty", "Write what she should do, or use Undo to go back.");
    if (text.length > MAX_INSTRUCTIONS) throw badRequest("The instructions are too long", `At most ${MAX_INSTRUCTIONS.toLocaleString()} characters.`);
    // Saving the repository's own words is "back to the default", stored as NULL so the repo stays the source.
    const owner = text.trim() === repo.text.trim() ? null : text;
    if (owner !== d.owner_prompt) { next.owner_prompt = owner; changed.push("instructions"); }
  }

  let scheduleChanged = false;
  if (input.schedule) {
    const allowed = choicesFor(d).map((c) => c.key);
    if (!allowed.includes(input.schedule)) {
      throw badRequest("That schedule is not one this duty can keep",
        d.executor === "local_job" ? "It runs on your Mac, which starts it on its own fixed days." : `Choose one of: ${allowed.join(", ")}.`);
    }
    const s = scheduleFromChoice(input.schedule)!;
    if (s.cadence !== d.cadence || s.weekday !== d.weekday || (s.weekdays ?? null) !== (d.weekdays ?? null)) {
      next.cadence = s.cadence; next.weekday = s.weekday; next.weekdays = s.weekdays; scheduleChanged = true;
    }
  }
  if ((input.hour !== undefined && input.hour !== null) || (input.minute !== undefined && input.minute !== null)) {
    const hour = Number(input.hour ?? d.local_hour);
    const minute = Number(input.minute ?? d.local_minute);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw badRequest("That is not a time of day", "An hour 0–23 and a minute 0–59.");
    }
    if (hour !== d.local_hour || minute !== d.local_minute) {
      if (!timeEditable(d)) throw badRequest("Your Mac starts this one at its own set time", "You can change which days it runs, or pause it.");
      next.local_hour = hour; next.local_minute = minute; scheduleChanged = true;
    }
  }
  if (scheduleChanged) {
    next.next_due_at = nextDueAt(scheduleOf(next), now);
    next.owner_schedule_at = now;
    changed.push("schedule");
  }
  if (changed.length === 0) return { duty_id: id, changed, version: null as number | null };

  await ensureOriginal(env, d, now);
  await store(env, next);
  const version = await writeVersion(env, next, "edit", now);
  await audit(env.DB, { actor: "owner", lane: d.lane, entityType: "standing_duty", entityId: id, action: "owner_edited", detail: { changed, version } });
  return { duty_id: id, changed, version };
}

/** Undo to the last version: restore the state before the newest, and record the undo as a version of its own. */
export async function undoDuty(env: Env, id: string, now = Date.now()) {
  const d = await loadDuty(env, id);
  const versions = await versionsOf(env, id);
  if (versions.length < 2) throw badRequest("There is nothing to undo", "This duty is still the way it was set up.");
  const back = versions[1]!;
  const original = versions[versions.length - 1]!;
  const next: OwnedDuty = {
    ...d,
    owner_prompt: back.owner_prompt,
    cadence: back.cadence as OwnedDuty["cadence"], weekday: back.weekday, weekdays: back.weekdays,
    local_hour: back.local_hour, local_minute: back.local_minute,
    suspended: back.suspended, removed_at: back.removed ? (d.removed_at ?? now) : null,
  };
  const sameAsOriginal = back.cadence === original.cadence && back.weekday === original.weekday
    && (back.weekdays ?? null) === (original.weekdays ?? null) && back.local_hour === original.local_hour && back.local_minute === original.local_minute;
  const scheduleMoved = next.cadence !== d.cadence || next.weekday !== d.weekday || (next.weekdays ?? null) !== (d.weekdays ?? null)
    || next.local_hour !== d.local_hour || next.local_minute !== d.local_minute;
  next.owner_schedule_at = sameAsOriginal ? null : (d.owner_schedule_at ?? now);
  if (scheduleMoved || (d.suspended && !next.suspended)) next.next_due_at = nextDueAt(scheduleOf(next), now);
  await store(env, next);
  const version = await writeVersion(env, next, "undo", now);
  await audit(env.DB, { actor: "owner", lane: d.lane, entityType: "standing_duty", entityId: id, action: "owner_undid", detail: { to_version: back.version, version } });
  return { duty_id: id, restored_version: back.version, version };
}

/** Pause or resume. Resuming starts from the next proper time, never a burst of missed runs. */
export async function pauseDuty(env: Env, id: string, paused: boolean, now = Date.now()) {
  const d = await loadDuty(env, id);
  if (d.removed_at) throw badRequest("This duty was removed", "Undo the removal to bring it back.");
  if (Boolean(d.suspended) === paused) return { duty_id: id, paused, version: null as number | null };
  await ensureOriginal(env, d, now);
  const next: OwnedDuty = { ...d, suspended: paused ? 1 : 0 };
  if (!paused) next.next_due_at = nextDueAt(scheduleOf(next), now);
  await store(env, next);
  const version = await writeVersion(env, next, paused ? "pause" : "resume", now);
  await audit(env.DB, { actor: "owner", lane: d.lane, entityType: "standing_duty", entityId: id, action: paused ? "owner_paused" : "owner_resumed", detail: { version } });
  return { duty_id: id, paused, version };
}

/** Remove, after she confirmed. The row, its runs and its versions stay; Undo brings it back. */
export async function removeDuty(env: Env, id: string, confirmed: boolean, now = Date.now()) {
  if (!confirmed) throw badRequest("Removing needs your confirmation", "Send confirm: true from the confirm step.");
  const d = await loadDuty(env, id);
  if (d.removed_at) return { duty_id: id, removed: true, version: null as number | null };
  await ensureOriginal(env, d, now);
  const next: OwnedDuty = { ...d, removed_at: now, suspended: 1 };
  await store(env, next);
  const version = await writeVersion(env, next, "remove", now);
  await audit(env.DB, { actor: "owner", lane: d.lane, entityType: "standing_duty", entityId: id, action: "owner_removed", detail: { version } });
  return { duty_id: id, removed: true, version };
}

/**
 * What a Mac job is told before it runs (duty-run.sh → scripts/ops/duty-brief.mjs). Resolved by
 * script name, exactly like /due and /ran, so no second list exists.
 */
export async function dutyBrief(env: Env, localJob: string, now = Date.now()) {
  const rows = (await env.DB.prepare(
    `SELECT * FROM standing_duties WHERE json_extract(task_input, '$.local_job') = ?`,
  ).bind(localJob).all<OwnedDuty>()).results ?? [];
  if (rows.length === 0) throw badRequest(`No standing duty names "${localJob}" as its local job`, "Refused rather than guessed at.");
  if (rows.length > 1) throw badRequest(`${rows.length} duties name "${localJob}" as their local job`, `They are: ${rows.map((r) => r.id).join(", ")}.`);
  const d = rows[0]!;
  const ownerSchedule = d.owner_schedule_at !== null && d.owner_schedule_at !== undefined;
  /*
   * DUE WITHIN THE EARLY-RUN GRACE, THE SAME WINDOW THE RUN RECORDER CREDITS (31 Oct 2026).
   *
   * launchd ticks on the Mac's wall clock and duties are kept in Central. Her Mac is on Eastern, so the
   * daily 07:30 tick for duty_search_readiness_repair (Tuesday 07:30 Central) asked at 06:30 Central,
   * was told "not due", and the Tuesday slot passed with no run: Today said "never fired, 1 scheduled
   * run gone by" about a duty created two days before. A run inside EARLY_RUN_GRACE_MS of its slot
   * already counts as that slot's run (`creditFrom`, routes/duties.ts), so the gate that decides
   * whether to start it must use the same window, or a duty whose tick falls before its slot can never
   * run on its own day.
   */
  const due = d.suspended ? false : ownerSchedule ? macDueToday(d, now) : isDue(d.next_due_at, false, now + EARLY_RUN_GRACE_MS);
  const top = await env.DB.prepare(`SELECT MAX(version) AS v FROM duty_versions WHERE duty_id = ?`).bind(d.id).first<{ v: number | null }>();
  return {
    duty_id: d.id,
    local_job: localJob,
    paused: Boolean(d.suspended) && !d.removed_at,
    removed: Boolean(d.removed_at),
    owner_schedule: ownerSchedule,
    due,
    next_due_at: d.next_due_at,
    reason: due ? `due since ${localDate(d.timezone, d.next_due_at)}` : `next due ${localDate(d.timezone, d.next_due_at)} (${scheduleWords(d)})`,
    // Only HER words. With none, the job reads the repository's prompt file exactly as before.
    instructions: d.owner_prompt ?? null,
    version: top?.v ?? null,
  };
}

const hm = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: OWNER_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(ms));

/** The Your team page: one card per employee, everything from D1. */
export async function teamCards(env: Env, now = Date.now()) {
  const today = localDate(OWNER_TZ, now);
  const since = now - 36 * 3_600_000;
  const [people, duties, runs] = await Promise.all([
    env.DB.prepare(`SELECT id, name, role FROM employees WHERE lifecycle NOT IN ('retired','merged') ORDER BY name`).all<any>(),
    env.DB.prepare(`SELECT * FROM standing_duties WHERE removed_at IS NULL ORDER BY next_due_at`).all<OwnedDuty>(),
    env.DB.prepare(
      `SELECT r.duty_id, r.outcome, r.finished_at, d.employee_id, d.name FROM duty_runs r JOIN standing_duties d ON d.id = r.duty_id
        WHERE r.finished_at >= ? ORDER BY r.finished_at DESC`,
    ).bind(since).all<any>(),
  ]);
  const all = duties.results ?? [];
  return (people.results ?? []).map((e: any) => {
    const mine = all.filter((d) => d.employee_id === e.id);
    const did: string[] = [];
    for (const r of (runs.results ?? []).filter((r: any) => r.employee_id === e.id && localDate(OWNER_TZ, r.finished_at) === today)) {
      if (!did.some((x) => x.startsWith(r.name))) did.push(`${r.name}: ${r.outcome === "ok" ? "done" : "did not finish"} ${hm(r.finished_at)}`);
    }
    for (const d of mine.filter((d) => d.executor !== "local_job" && d.last_run_at && localDate(OWNER_TZ, d.last_run_at) === today)) {
      if (!did.some((x) => x.startsWith(d.name))) {
        did.push(`${d.name}: ${d.last_outcome === "failed" ? "did not finish" : d.executor === "worker" ? "done" : "started"} ${hm(d.last_run_at!)}`);
      }
    }
    const upcoming = mine.filter((d) => !d.suspended).sort((a, b) => a.next_due_at - b.next_due_at)[0];
    return {
      id: e.id, name: e.name, role: e.role,
      handles: mine.map((d) => d.name),
      duty_count: mine.length,
      paused_count: mine.filter((d) => d.suspended).length,
      today: did,
      next: upcoming ? { duty: upcoming.name, at: upcoming.next_due_at, words: scheduleWords(upcoming) } : null,
    };
  });
}

/** One duty as the owner's pages show it: what it does, the instructions it follows, when it runs. */
function shapeDuty(d: OwnedDuty, counts: Map<string, { n: number; last: number }>, now: number) {
    const input = inputOf(d);
    const v = counts.get(d.id);
    return {
      id: d.id, name: d.name,
      what: d.success_criteria,
      sends: typeof input.sends === "string" ? input.sends : typeof input.delivers === "string" ? input.delivers : null,
      runs_on: d.executor === "local_job" ? "mac" : "boss_os",
      schedule_words: scheduleWords(d),
      choice: choiceOf(d),
      choices: choicesFor(d),
      time_editable: timeEditable(d),
      local_hour: d.local_hour, local_minute: d.local_minute,
      paused: Boolean(d.suspended) && !d.removed_at,
      removed: Boolean(d.removed_at),
      instructions: instructionsOf(d, now),
      changes: v?.n ?? 0,
      last_changed_at: v?.last ?? null,
      last_run_at: d.last_run_at, last_outcome: d.last_outcome, next_due_at: d.next_due_at,
    };
}

async function versionCounts(env: Env, employeeId: string | null) {
  const counts = new Map<string, { n: number; last: number }>();
  for (const r of (await env.DB.prepare(
    `SELECT duty_id, COUNT(*) AS n, MAX(created_at) AS last FROM duty_versions
      WHERE (?1 IS NULL OR duty_id IN (SELECT id FROM standing_duties WHERE employee_id = ?1)) AND action != 'original' GROUP BY duty_id`,
  ).bind(employeeId).all<any>()).results ?? []) counts.set(r.duty_id, { n: r.n, last: r.last });
  return counts;
}

/** One employee's page: every duty with what it does, the instructions it follows, when it runs. */
export async function employeeDuties(env: Env, employeeId: string, now = Date.now()) {
  const e = await env.DB.prepare(`SELECT id, name, role, charter FROM employees WHERE id = ?`).bind(employeeId).first<any>();
  if (!e) throw notFound("No employee with that id");
  const rows = (await env.DB.prepare(`SELECT * FROM standing_duties WHERE employee_id = ? ORDER BY name`).bind(employeeId).all<OwnedDuty>()).results ?? [];
  const counts = await versionCounts(env, employeeId);
  const shape = (d: OwnedDuty) => shapeDuty(d, counts, now);
  return {
    employee: { id: e.id, name: e.name, role: e.role, charter: e.charter },
    duties: rows.filter((d) => !d.removed_at).map(shape),
    removed: rows.filter((d) => d.removed_at).map(shape),
  };
}

/** A plain example, never invented: the duty's own written example, else what its last good run said. */
function exampleOf(d: OwnedDuty, lastSaid: string | null): string | null {
  const input = inputOf(d);
  if (typeof input.example === "string" && input.example.trim()) return input.example.trim();
  const said = String(lastSaid ?? "").replace(/\s+/g, " ").trim();
  return said ? `Last time it reported: "${said.slice(0, 240)}${said.length > 240 ? "…" : ""}"` : null;
}

/**
 * The Team page's duties grid: every standing duty of every active employee in one list, each with
 * its owner, cadence and last run, plus everything the duty editor needs (the same shape the
 * employee page edits), so a change made in either place is the same change.
 */
export async function allDuties(env: Env, now = Date.now()) {
  const [people, rows, said] = await Promise.all([
    env.DB.prepare(`SELECT id, name, role FROM employees WHERE lifecycle NOT IN ('retired','merged')`).all<any>(),
    env.DB.prepare(`SELECT * FROM standing_duties WHERE removed_at IS NULL`).all<OwnedDuty>(),
    env.DB.prepare(
      `SELECT r.duty_id, r.reason FROM duty_runs r
        JOIN (SELECT duty_id, MAX(finished_at) AS at FROM duty_runs WHERE outcome = 'ok' AND reason IS NOT NULL AND trim(reason) != '' GROUP BY duty_id) m
          ON m.duty_id = r.duty_id AND m.at = r.finished_at
        WHERE r.outcome = 'ok'`,
    ).all<any>(),
  ]);
  const who = new Map((people.results ?? []).map((e: any) => [e.id, e]));
  const lastSaid = new Map((said.results ?? []).map((r: any) => [r.duty_id, r.reason as string]));
  const counts = await versionCounts(env, null);
  return (rows.results ?? [])
    .filter((d) => who.has(d.employee_id))
    .map((d) => {
      const e: any = who.get(d.employee_id);
      return { ...shapeDuty(d, counts, now), owner: { id: e.id, name: e.name, role: e.role }, example: exampleOf(d, lastSaid.get(d.id) ?? null) };
    })
    .sort((a, b) => a.owner.name.localeCompare(b.owner.name) || a.name.localeCompare(b.name));
}
