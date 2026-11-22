import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { dayIdInZone } from "../../../shared/boss/timezone";
import manifest from "../../../shared/boss/scorecard/manifest.json";
import { readingProblems, summarize } from "../../../shared/boss/growth/scoreboard.mjs";

/**
 * THE GROWTH DIRECTOR'S RECORD (21 Nov 2026).
 *
 *   POST /readings   the daily scoreboard read (scripts/ops/growth-scoreboard.mjs): refused when a
 *                    measure is unknown, a value is not a number, or a missing number has no
 *                    "not read" reason. Same day + measure replaces the row (a re-run is one row).
 *   GET  /           the scoreboard per business: the newest reading of each measure beside the one
 *                    from about 28 days earlier, and the newest day read.
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
