import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { dayIdInZone } from "../../../shared/boss/timezone";
import manifest from "../../../shared/boss/scorecard/manifest.json";
import { readingProblems, summarize } from "../../../shared/boss/growth/scoreboard.mjs";
import { loadRoster } from "../growth/run";

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
 *                    newest decision), happened (earlier decisions and finished to-dos, 8 weeks).
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
  const businesses = (manifest as any).scoreboard.businesses.map((b: any) => {
    const entry = roster.find((e) => e.key === b.key);
    const mine = (l: any) => entry?.linked.includes(l.id) || String(l.source_key ?? "").startsWith(`growth#${b.key}#`) || String(l.source_key ?? "").startsWith(`growth-yes#${b.key}#`) || (l.owner === DIRECTOR && (l.title as string).startsWith(`${b.label}:`));
    const own = loops.filter(mine);
    const ds = decisions.filter((d) => d.business === b.key).map((d) => ({ ...d, evidence: parse(d.evidence, []), test: parse(d.test, null), actions: parse(d.actions, []) }));
    const cs = cards.filter((x) => parse(x.payload, {})?.business === b.key).map(({ payload: _p, ...x }) => x);
    return {
      key: b.key, label: b.label,
      paused: entry?.paused ?? (typeof b.paused === "string" ? b.paused : b.paused ? "paused for now" : null),
      onRoster: !!entry,
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
  return ok(c, { day: today, problems, general, businesses, week });
});
