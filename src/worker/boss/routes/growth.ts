import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { AppError, ok, badRequest } from "../lib/http";
import { dayIdInZone } from "../../../shared/boss/timezone";
import manifest from "../../../shared/boss/scorecard/manifest.json";
import { readingProblems, summarize } from "../../../shared/boss/growth/scoreboard.mjs";
import { loadRoster } from "../growth/run";
import { AI_SITES, aiCard } from "../../../shared/boss/growth/aiAnswers.mjs";
import { backlinkOrders } from "../../../shared/boss/growth/director.mjs";
import { machineTokenOk } from "./openLoops";
import { noelleContext, queueView, recordDone, recordNotice, writeLedger, claimCall, replyCall, releaseCall } from "../growth/noelle";
import { admitTask } from "../tasks/admit";
import { callAckLine } from "../../../shared/boss/growth/noelle.mjs";
import { wallClock } from "../../../shared/boss/timezone";

/**
 * THE GROWTH DIRECTOR'S RECORD (21 Nov 2026).
 *
 *   POST /readings   the daily scoreboard read (scripts/ops/growth-scoreboard.mjs): refused when a
 *                    measure is unknown, a value is not a number, or a missing number has no
 *                    "not read" reason. Same day + measure replaces the row (a re-run is one row).
 *   GET  /           the scoreboard per business: the newest reading of each measure beside the one
 *                    from about 28 days earlier, and the newest day read.
 *   GET  /page       the Growth page, per business: upcoming (the Director's open to-dos, the rows
 *                    her roster links, her pending Decide cards), happening (the scoreboard and the
 *                    newest decision), happened (earlier decisions and finished to-dos, 8 weeks),
 *                    and `ai`: the site's AI answers week (growth/aiAnswers.ts), apart from its numbers.
 *   GET  /backlink-orders  (machine token, as ai-misses; public address /api/boss/growth/backlink-orders)
 *                    the backlink network's weekly read:
 *                    { cycle, read_at, orders: [{ business, topic, draft, why }] } from the NEWEST
 *                    cycle's decisions only (director.mjs backlinkOrders). No cycle yet → orders [].
 */
export const growthRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const MAX_READINGS = 500;

growthRoutes.post("/readings", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  const problems = readingProblems(body, manifest);
  if (problems.length) throw badRequest("The readings were refused", problems.slice(0, 8).join("; "));
  if (body.readings.length > MAX_READINGS) throw badRequest("Too many readings", `At most ${MAX_READINGS}.`);
  const at = Date.now();
  await c.env.DB.batch(body.readings.map((r: any) => c.env.DB.prepare(
    // A same-day re-run replaces the row, except that a failed read never overwrites a good number.
    `INSERT INTO growth_readings (day, measure, business, kind, channel, language, value, unread, at) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(day, measure) DO UPDATE SET value = excluded.value, unread = excluded.unread, at = excluded.at
       WHERE excluded.value IS NOT NULL OR growth_readings.value IS NULL`,
  ).bind(body.day, r.measure, r.business, r.kind, r.channel, r.language, r.value, r.unread ?? null, at)));
  return ok(c, { kept: body.readings.length, day: body.day }, 201);
});

/** The newest reading per measure, and the newest one at least 25 days older (the "before"). */
export async function latestReadings(db: D1Database) {
  const latest = (await db.prepare(
    `SELECT r.* FROM growth_readings r JOIN (SELECT measure, MAX(day) AS day FROM growth_readings GROUP BY measure) m ON m.measure = r.measure AND m.day = r.day`,
  ).all<any>()).results ?? [];
  const before = (await db.prepare(
    `SELECT r.* FROM growth_readings r JOIN (SELECT g.measure, MAX(g.day) AS day FROM growth_readings g
       JOIN (SELECT measure, MAX(day) AS top FROM growth_readings GROUP BY measure) t ON t.measure = g.measure
      WHERE g.day <= date(t.top, '-25 days') GROUP BY g.measure) m ON m.measure = r.measure AND m.day = r.day`,
  ).all<any>()).results ?? [];
  const day = latest.reduce((d: string | null, r: any) => (!d || r.day > d ? r.day : d), null);
  return { latest, before, day };
}

growthRoutes.get("/", async (c) => {
  const { latest, before, day } = await latestReadings(c.env.DB);
  return ok(c, { day, businesses: summarize(manifest, latest, before, dayIdInZone(Date.now())) });
});

/**
 * The route's path INSIDE the Boss app (the session gate in boss/index.ts matches on it). Its public
 * address is `/api/boss/growth/backlink-orders`: the Worker's entry hands only `/api/boss/*` to this app
 * (bossMount.ts handleBossRequest) and answers every other /api path with the retired fund API's 410.
 * Give callers the public address, never this one.
 */
export const BACKLINK_ORDERS_PATH = "/api/growth/backlink-orders";
/** Noelle's machine routes (her Mac's run and the posting jobs' ledger rows): the machine token only, checked in each handler below. */
export const NOELLE_PATHS: ReadonlySet<string> = new Set(["/api/growth/noelle/context", "/api/growth/noelle/done", "/api/growth/noelle/notice", "/api/growth/noelle/ledger", "/api/growth/noelle/call/claim", "/api/growth/noelle/call/reply", "/api/growth/noelle/call/release"]);

/**
 * The backlink orders of the newest WEEK (Noelle runs daily since 23 Nov 2026, so a week is the 7 days
 * ending on the newest cycle): every decided row's orders, once each per business and topic. Never Open
 * Loops rows. A malformed actions row is skipped and logged.
 */
export async function readBacklinkOrders(db: D1Database, now = Date.now()) {
  const top = await db.prepare(`SELECT MAX(cycle) AS cycle FROM growth_decisions`).first<{ cycle: string | null }>();
  const cycle = top?.cycle ?? null;
  if (!cycle) return { cycle: null, read_at: new Date(now).toISOString(), orders: [] };
  const rows = (await db.prepare(`SELECT id, business, state, actions, created_at FROM growth_decisions WHERE cycle > date(?, '-7 days') ORDER BY created_at DESC`).bind(cycle).all<any>()).results ?? [];
  const seen = new Set<string>(); const orders: any[] = []; const skipped: string[] = [];
  for (const r of rows) {
    const one = backlinkOrders([r]);
    skipped.push(...one.skipped);
    for (const o of one.orders) { const k = `${o.business}|${o.topic.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); orders.push(o); } }
  }
  orders.sort((a, b) => a.business.localeCompare(b.business));
  if (skipped.length) console.warn(`backlink-orders: skipped ${skipped.length} growth_decisions row(s) whose actions are not a JSON list: ${skipped.join(", ")}`);
  return { cycle, read_at: new Date(now).toISOString(), orders };
}

// Noelle's run (growth/noelle.ts): the machine token only, as the backlink network's read.
growthRoutes.get("/noelle/context", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  return ok(c, await noelleContext(c.env));
});
growthRoutes.post("/noelle/done", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const body = await c.req.json<any>().catch(() => null);
  try { return ok(c, await recordDone(c.env, body), 201); }
  catch (e) { const m = String((e as Error)?.message ?? e); if (/NAMED STOP/.test(m)) throw e; throw badRequest("The run's end was refused", m.slice(0, 200)); }
});

growthRoutes.post("/noelle/notice", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  return ok(c, await recordNotice(c.env, await c.req.json<any>().catch(() => null)));
});
// One row (her own call) or { rows } from a posting job on the platform's confirmation (H5).
growthRoutes.post("/noelle/ledger", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  return ok(c, await writeLedger(c.env, await c.req.json<any>().catch(() => null)));
});

/**
 * H3b: her message on Noelle's page (her own session, the passcode gate in boss/index.ts). It is a call on
 * the same claim path as her email: a task on Noelle's seat, source boss_page, parked for her Mac
 * (queue/consumer.ts), answered on the card. Says when Noelle answers (H3c).
 */
growthRoutes.post("/noelle/message", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 20_000) : "";
  if (!text) throw badRequest("Write a message for Noelle", "Send { text }.");
  const subject = text.split("\n")[0].slice(0, 120);
  const r = await admitTask(c.env, { title: `Noelle: ${subject}`, lane: "ops", employee_id: "emp_growth", input: { source: "boss_page", subject, body: text } });
  const w = wallClock(Date.now());
  return ok(c, { task_id: r.task_id, line: callAckLine(`${String(w.h).padStart(2, "0")}:${String(w.min).padStart(2, "0")}`) }, 201);
});

// A #noelle call (growth/noelle.ts claimCall): her Mac claims one waiting email, replies once, or releases it.
growthRoutes.post("/noelle/call/claim", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const body = await c.req.json<any>().catch(() => ({}));
  return ok(c, { call: await claimCall(c.env, String(body?.device_id ?? "mac")) });
});
growthRoutes.post("/noelle/call/reply", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  return ok(c, await replyCall(c.env, await c.req.json<any>().catch(() => null)));
});
growthRoutes.post("/noelle/call/release", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  return ok(c, await releaseCall(c.env, await c.req.json<any>().catch(() => null)));
});

growthRoutes.get("/backlink-orders", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  return c.json(await readBacklinkOrders(c.env.DB));
});

const DIRECTOR = "emp_growth";
/** The Monday (YYYY-MM-DD) of a Central day's week. */
function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const HAPPENED_DAYS = 56;

growthRoutes.get("/page", async (c) => {
  const db = c.env.DB;
  const { latest, before } = await latestReadings(db);
  const today = dayIdInZone(Date.now());
  const board = summarize(manifest, latest, before, today);
  const { roster, problems } = await loadRoster(db);
  const linked = [...new Set(roster.flatMap((e) => e.linked))];
  const loops = ((await db.prepare(
    `SELECT id, title, next_step, owner, next_date, business, status, source_key, updated_at FROM owner_open_loops
      WHERE (owner = ? OR source_key LIKE 'growth#%' OR source_key LIKE 'growth-yes#%' OR id IN (SELECT value FROM json_each(?)))
        AND (status = 'open' OR updated_at >= ?)
      ORDER BY updated_at DESC LIMIT 200`,
  ).bind(DIRECTOR, JSON.stringify(linked), Date.now() - HAPPENED_DAYS * 86_400_000).all<any>()).results ?? []);
  // The Director's cards are judgement calls (resume kind growth_proposal); the business rides in resume_detail.
  const cards = ((await db.prepare(
    `SELECT a.id, a.title, a.status, a.requested_at, j.resume_detail AS payload FROM approvals a JOIN judgement_calls j ON j.approval_id = a.id
      WHERE j.resume_kind = 'growth_proposal' AND j.state <> 'superseded' AND (a.status = 'pending' OR a.requested_at >= ?) ORDER BY a.requested_at DESC LIMIT 30`,
  ).bind(Date.now() - HAPPENED_DAYS * 86_400_000).all<any>()).results ?? []);
  const decisions = ((await db.prepare(
    `SELECT business, cycle, state, decision, evidence, test, actions, next_check FROM growth_decisions WHERE created_at >= ? ORDER BY cycle DESC, created_at DESC`,
  ).bind(Date.now() - HAPPENED_DAYS * 86_400_000).all<any>()).results ?? []);
  const parse = (t: string | null, d: unknown) => { try { return t ? JSON.parse(t) : d; } catch { return d; } };
  const aiReads = ((await db.prepare(`SELECT site, week, status, stop, run_at, prompts, answered, cited, mentioned, engines FROM ai_answer_reads WHERE read_at >= ? ORDER BY week DESC`)
    .bind(Date.now() - 5 * 7 * 86_400_000).all<any>()).results ?? []);
  const noelle = await queueView(db);
  const hostOf = (key: string) => Object.entries(AI_SITES).find(([, v]) => v.business === key)?.[0] ?? null;
  const businesses = (manifest as any).scoreboard.businesses.map((b: any) => {
    const entry = roster.find((e) => e.key === b.key);
    const mine = (l: any) => entry?.linked.includes(l.id) || String(l.source_key ?? "").startsWith(`growth#${b.key}#`) || String(l.source_key ?? "").startsWith(`growth-yes#${b.key}#`) || (l.owner === DIRECTOR && (l.title as string).startsWith(`${b.label}:`));
    const own = loops.filter(mine);
    const ds = decisions.filter((d) => d.business === b.key).map((d) => ({ ...d, evidence: parse(d.evidence, []), test: parse(d.test, null), actions: parse(d.actions, []) }));
    const cs = cards.filter((x) => parse(x.payload, {})?.business === b.key).map(({ payload: _p, ...x }) => x);
    const host = hostOf(b.key);
    return {
      key: b.key, label: b.label,
      ai: host ? { host, ...aiCard(aiReads.filter((r) => r.site === host)) } : null,
      paused: entry?.paused ?? (typeof b.paused === "string" ? b.paused : b.paused ? "paused for now" : null),
      onRoster: !!entry,
      // What Noelle last saw queued on each owned channel; a failed read says "not read", never an empty queue.
      queue: noelle.unread ? { unread: noelle.unread, channels: [] } : { unread: null, channels: noelle.queues[b.key] ?? [] },
      upcoming: {
        todos: own.filter((l) => l.status === "open").map((l) => ({ id: l.id, title: l.title, next: l.next_step, date: l.next_date, elsewhere: l.owner !== DIRECTOR && !String(l.source_key ?? "").startsWith("growth") })),
        cards: cs.filter((x) => x.status === "pending"),
      },
      // Happening is THIS week's decision only; an older one is history, with its date said.
      happening: { board: board.find((x: any) => x.key === b.key) ?? null, decision: ds[0] && ds[0].cycle >= weekStart(today) ? ds[0] : null, last: ds[0]?.cycle ?? null },
      happened: {
        decisions: ds[0] && ds[0].cycle >= weekStart(today) ? ds.slice(1) : ds,
        done: own.filter((l) => l.status !== "open").map((l) => ({ id: l.id, title: l.title, at: l.updated_at, status: l.status })),
        answered: cs.filter((x) => x.status !== "pending"),
      },
    };
  });
  // The Director's to-dos that name no one business (the "Growth Director: …" list): their own block.
  const placed = new Set(businesses.flatMap((b: any) => [...b.upcoming.todos, ...b.happened.done].map((t: any) => t.id)));
  const general = loops.filter((l) => !placed.has(l.id) && l.status === "open").map((l) => ({ id: l.id, title: l.title, next: l.next_step, date: l.next_date, elsewhere: l.owner !== DIRECTOR && !String(l.source_key ?? "").startsWith("growth") }));
  // This week = this Monday's Central cycle (the duty runs Mondays); a held decision counts as written.
  // One per business: the newest (rows arrive newest first), so a same-day re-run is not counted twice.
  const thisWeek = decisions.filter((d, i) => d.cycle >= weekStart(today) && decisions.findIndex((x) => x.business === d.business) === i);
  const week = { decided: thisWeek.filter((d) => d.state === "decided").length, held: thisWeek.filter((d) => String(d.state).startsWith("held")).length };
  return ok(c, { day: today, problems, general, businesses, week, noelle: noelle.last });
});
