/**
 * OPEN LOOPS (owner ruling, 1 Nov 2026: "Open Loops is the one list of everything approved but not
 * finished"). Rows in D1 `owner_open_loops` (migration 0331); rules in src/shared/boss/openLoops/openLoops.mjs;
 * the page is ☰ More → Open Loops (/?tab=loops).
 *
 *   GET  /                 { loops, waiting, names, today }  every open row + closed in the last 30 days
 *   POST /                 create { title, finish_line, next_step, owner, next_date, business, section, blocked_by }
 *   PUT  /:id              edit any of those (moving to parked clears the date: parked rows are never chased)
 *   POST /:id/close        { reason } — the real outcome, never "PR merged"
 *   POST /intake           a repo's named stop: { repo, stop, finish_line, next_step?, owner?, business?, next_date?, cleared? }
 *                          upserts by source_key (repo#STOP); `cleared: true` closes it "outcome reached".
 *   POST /intake-token     mints the intake's machine token (shown once; only its SHA-256 is kept)
 *
 * The intake is the one path outside the session gate (index.ts): a CI runner in another repo holds
 * only `BOSS_OPEN_LOOPS_TOKEN`, which can do nothing but post to /intake — never the passcode.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound, AppError } from "../lib/http";
import { newId } from "../lib/id";
import { getSetting, setSetting } from "../lib/settings";
import { readSession } from "../auth";
import { dayIdInZone } from "../../../shared/boss/timezone";
import { BRAIN_SLUGS } from "../../../shared/boss/brains/brain.mjs";
import { MORNING_SECTIONS, morningSectionProblems } from "../../../shared/boss/mail/morningSections.mjs";
import { loopProblems, morningSection, repairsDue, sourceKeyOf, visibleLoops, isOwner, isDay, type Loop } from "../../../shared/boss/openLoops/openLoops.mjs";
import { admitTask } from "../tasks/admit";

export const openLoops = new Hono<{ Bindings: Env; Variables: Vars }>();

export const INTAKE_PATH = "/api/open-loops/intake";
export const TOKEN_KEY = "open_loops_intake_token_sha256";
const ORIGIN = "https://boss.sequoiataylor.com";
const FIELDS = ["title", "finish_line", "next_step", "owner", "next_date", "business", "section", "blocked_by"] as const;

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function allLoops(db: D1Database, since = 0): Promise<Loop[]> {
  const { results } = await db.prepare(`SELECT * FROM owner_open_loops WHERE status = 'open' OR closed_at >= ? ORDER BY created_at`).bind(since).all<Loop>();
  return results ?? [];
}

async function employeeNames(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare(`SELECT id, name FROM employees`).all<{ id: string; name: string }>().catch(() => ({ results: [] as { id: string; name: string }[] }));
  return Object.fromEntries((results ?? []).map((e) => [e.id, String(e.name).split(" ")[0] ?? e.name]));
}

async function blockerProblem(db: D1Database, id: string | null | undefined, self?: string): Promise<string | null> {
  if (id == null || id === "") return null;
  if (id === self) return "a row cannot wait on itself";
  const b = await db.prepare(`SELECT id FROM owner_open_loops WHERE id = ?`).bind(id).first();
  return b ? null : "blocked_by is another loop's id";
}

openLoops.get("/", async (c) => {
  const now = Date.now();
  const loops = await allLoops(c.env.DB, now - 30 * 86_400_000);
  const { waiting } = visibleLoops(loops);
  return ok(c, { loops, waiting, names: await employeeNames(c.env.DB), today: dayIdInZone(now) });
});

openLoops.post("/", async (c) => {
  const b = (await c.req.json().catch(() => null)) as Record<string, any> | null;
  const problems = loopProblems(b, { slugs: BRAIN_SLUGS });
  const blocker = await blockerProblem(c.env.DB, b?.blocked_by);
  if (blocker) problems.push(blocker);
  if (problems.length) throw badRequest("That is not an open loop", problems.join("; "));
  const now = Date.now();
  const id = newId("olp");
  const section = b!.section ?? "not_finished";
  await c.env.DB.prepare(
    `INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, source_key, blocked_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,'open',?,NULL,?,?,?)`,
  ).bind(id, b!.title.trim(), b!.finish_line.trim(), b!.next_step ?? null, b!.owner, section === "parked" ? null : (b!.next_date || null), b!.business, section,
    b!.source ?? "manual", b!.blocked_by || null, now, now).run();
  return ok(c, { loop: await c.env.DB.prepare(`SELECT * FROM owner_open_loops WHERE id = ?`).bind(id).first() }, 201);
});

openLoops.put("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT * FROM owner_open_loops WHERE id = ?`).bind(id).first<Loop>();
  if (!row) throw notFound("No open loop with that id");
  const b = (await c.req.json().catch(() => null)) as Record<string, any> | null;
  const problems = loopProblems(b, { partial: true, slugs: BRAIN_SLUGS });
  if (b && "blocked_by" in b) { const p = await blockerProblem(c.env.DB, b.blocked_by, id); if (p) problems.push(p); }
  if (problems.length) throw badRequest("That edit was not saved", problems.join("; "));
  const next: Record<string, any> = { ...row };
  for (const k of FIELDS) if (b && k in b) next[k] = typeof b[k] === "string" ? b[k].trim() || null : b[k];
  if (next.section === "parked") next.next_date = null;
  // "Bring back" reopens a parked row, and editing a closed row reopens it only when asked.
  if (b?.reopen === true) { next.status = "open"; next.closed_reason = null; next.closed_at = null; }
  await c.env.DB.prepare(
    `UPDATE owner_open_loops SET title = ?, finish_line = ?, next_step = ?, owner = ?, next_date = ?, business = ?, section = ?, blocked_by = ?,
       status = ?, closed_reason = ?, closed_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(next.title, next.finish_line, next.next_step, next.owner, next.next_date, next.business, next.section, next.blocked_by,
    next.status, next.closed_reason, next.closed_at, Date.now(), id).run();
  return ok(c, { loop: await c.env.DB.prepare(`SELECT * FROM owner_open_loops WHERE id = ?`).bind(id).first() });
});

openLoops.post("/:id/close", async (c) => {
  const id = c.req.param("id");
  const b = (await c.req.json().catch(() => null)) as { reason?: string } | null;
  const reason = String(b?.reason ?? "").trim();
  if (!reason) throw badRequest("Say the real outcome", "A loop closes on what happened (live, selling, in store), never on \"PR merged\".");
  const r = await c.env.DB.prepare(`UPDATE owner_open_loops SET status = 'closed', closed_reason = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`)
    .bind(reason.slice(0, 400), Date.now(), Date.now(), id).run();
  if (!r.meta.changes) throw notFound("No open loop with that id");
  return ok(c, { closed: id });
});

/** Mints the intake token. Returned once; only its hash is kept, so a new mint retires the old one. */
openLoops.post("/intake-token", async (c) => {
  const token = `olt_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  await setSetting(c.env.DB, TOKEN_KEY, await sha256(token));
  return ok(c, { token }, 201);
});

/** The intake's door: the machine token, or (for her Mac's jobs) a normal session. */
async function intakeAllowed(c: Context<{ Bindings: Env; Variables: Vars }>): Promise<boolean> {
  const auth = c.req.header("authorization") ?? "";
  const m = /^Bearer\s+(olt_[a-f0-9]{64})$/.exec(auth);
  if (m) {
    const want = await getSetting(c.env.DB, TOKEN_KEY);
    return Boolean(want) && want === (await sha256(m[1]!));
  }
  return Boolean(await readSession(c.env, getCookie(c, "boss_session")));
}

openLoops.post("/intake", async (c) => {
  if (!(await intakeAllowed(c))) throw new AppError(401, "Locked");
  const b = (await c.req.json().catch(() => null)) as Record<string, any> | null;
  const key = sourceKeyOf(b?.repo, b?.stop);
  if (!key) throw badRequest("Send { repo: \"owner/name\", stop: \"NAMED_STOP\", finish_line }");
  const now = Date.now();
  const row = await c.env.DB.prepare(`SELECT * FROM owner_open_loops WHERE source_key = ?`).bind(key).first<Loop>();
  if (b!.cleared === true) {
    if (!row || row.status !== "open") return ok(c, { key, action: "nothing open" });
    await c.env.DB.prepare(`UPDATE owner_open_loops SET status = 'closed', closed_reason = 'outcome reached', closed_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, row.id).run();
    return ok(c, { key, action: "closed", id: row.id });
  }
  const finish = String(b!.finish_line ?? "").trim();
  if (!finish || finish.length > 300) throw badRequest("finish_line is the real outcome in plain words");
  const owner = isOwner(b!.owner) ? b!.owner : "claude";
  const business = BRAIN_SLUGS.includes(b!.business) ? b!.business : "spry";
  const nextDate = isDay(b!.next_date) ? b!.next_date : dayIdInZone(now + 2 * 86_400_000);
  const nextStep = typeof b!.next_step === "string" ? b!.next_step.slice(0, 400) : `Clear what stops ${String(b!.repo).split("/")[1]} and run its check again.`;
  const title = (typeof b!.title === "string" && b!.title.trim() ? b!.title.trim() : `${String(b!.repo).split("/")[1]}: a step is stopped`).slice(0, 200);
  if (row) {
    // Still stopped: refresh the words, reopen if it had closed; her edits to owner/date/business stand.
    await c.env.DB.prepare(`UPDATE owner_open_loops SET finish_line = ?, next_step = ?, status = 'open', closed_reason = NULL, closed_at = NULL,
        section = 'not_finished', next_date = COALESCE(next_date, ?), updated_at = ? WHERE id = ?`).bind(finish, nextStep, nextDate, now, row.id).run();
    return ok(c, { key, action: row.status === "open" ? "kept" : "reopened", id: row.id });
  }
  const id = newId("olp");
  await c.env.DB.prepare(
    `INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, source_key, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'not_finished','open','named_stop',?,?,?)`,
  ).bind(id, title, finish, nextStep, owner, nextDate, business, key, now, now).run();
  return ok(c, { key, action: "opened", id }, 201);
});

// ─── The daily chase (the hourly tick, src/worker/index.ts) ─────────────────────────────────────────

const SECTION = "open_loops";
const JOB = "open-loops";
/** The section is written once per Central day, from this hour (before the 06:40 email). */
export const WRITE_FROM_HOUR = 5;

function centralHour(now: number): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
}

/**
 * ONCE A DAY: writes the "open_loops" morning section (an empty list included, so a missing copy
 * means this did not run) and opens one repair per team-owned row more than three days past its date,
 * through the same admission every repair uses. Returns what it did, never silence.
 */
export async function runOpenLoopsDaily(env: Env, now = Date.now()): Promise<{ ran: boolean; reason?: string; shown?: number; overdue?: number; repairs?: string[] }> {
  if (!MORNING_SECTIONS.includes(SECTION)) return { ran: false, reason: "NAMED STOP [OPEN_LOOPS_SECTION_UNREGISTERED]" };
  const today = dayIdInZone(now);
  if (centralHour(now) < WRITE_FROM_HOUR) return { ran: false, reason: "before 05:00 Central" };
  const prev = await env.DB.prepare(`SELECT day, job FROM morning_sections WHERE section = ?`).bind(SECTION).first<{ day: string; job: string }>();
  if (prev?.day === today && prev.job === JOB) return { ran: false, reason: "already written today" };

  const loops = await allLoops(env.DB, now);
  const names = await employeeNames(env.DB);
  const sec = morningSection(loops, today, { origin: ORIGIN, names });
  const obj = { section: SECTION, at: new Date(now).toISOString(), decide: [], rows: [], title: sec.title, lines: sec.lines, link: sec.link };
  const problems = morningSectionProblems(obj);
  if (problems.length) return { ran: false, reason: `NAMED STOP [OPEN_LOOPS_SECTION_REFUSED] ${problems.join("; ")}` };
  await env.DB.prepare(
    `INSERT INTO morning_sections (section, job, day, body, status, told_at, created_at, updated_at) VALUES (?,?,?,?,'fresh',NULL,?,?)
     ON CONFLICT(section) DO UPDATE SET job = excluded.job, day = excluded.day, body = excluded.body, status = 'fresh', told_at = NULL, updated_at = excluded.updated_at`,
  ).bind(SECTION, JOB, today, JSON.stringify(obj), now, now).run();

  const opened: string[] = [];
  for (const l of repairsDue(loops, today)) {
    const who = l.owner === "claude" || l.owner === "codex" ? l.owner : names[l.owner] ?? l.owner;
    const r = await admitTask(env, {
      title: `Open loop overdue: ${l.title} [${l.id}]`,
      lane: "ops",
      employee_id: "emp_repo",
      input: {
        origin: "repair", repair_kind: "open_loop_overdue", loop_id: l.id,
        prompt: `Open Loops (☰ More → Open Loops in Boss OS): the row "${l.title}" (${l.id}), owned by ${who}, was due ${l.next_date} and is more than three days late. Finish line: ${l.finish_line}. Next step: ${l.next_step ?? "not written"}. Do the next step, or find what stops it and fix that at source. Then update the row through PUT /api/boss/open-loops/${l.id} with a new next step and date, or close it with the real outcome (POST /api/boss/open-loops/${l.id}/close). Never close it on "PR merged".`,
      },
    } as any);
    if (!r.created) { console.error(`open loops: the repair for ${l.id} was not admitted (${r.reason ?? "no reason"})`); continue; }
    await env.DB.prepare(`UPDATE owner_open_loops SET repair_for = ? WHERE id = ?`).bind(l.next_date, l.id).run();
    opened.push(l.id);
  }
  return { ran: true, shown: visibleLoops(loops).shown.length, overdue: sec.lines.length, repairs: opened };
}
