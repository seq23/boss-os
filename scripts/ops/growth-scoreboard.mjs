#!/usr/bin/env node
/**
 * THE GROWTH SCOREBOARD'S DAILY READ (Growth Director, 21 Nov 2026), in the cloud: GitHub Actions
 * `job-growth-scoreboard.yml`, started by Boss OS's own clock at 05:20 Central.
 *
 * Reads every measure in the Scorecard manifest's `scoreboard` block with the Scorecard's own readers
 * (one counting stack), over a 28-day window, and posts the readings to Boss OS
 * (POST /api/boss/growth/readings → D1 growth_readings). Counts and sums only.
 *
 * RULE 0: prints `OUTPUT <read> growth readings (<unread> not read)`. No measure at all is
 * NAMED STOP [GROWTH_SCOREBOARD_EMPTY]; every measure unread is NAMED STOP
 * [GROWTH_SCOREBOARD_NOTHING_READ] (exit 2) — the readings are still recorded, so the page and the
 * Director say "not read: <reason>" per cell. A source that fails is "not read", never 0.
 *
 *   node scripts/ops/growth-scoreboard.mjs [--dry]     (through the vault on the Mac; repo secrets in the cloud)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMetric, macContext } from "./lib/scorecard-readers.mjs";
import { activeMeasures, scoreboardProblems, toReading } from "../../src/shared/boss/growth/scoreboard.mjs";
import { centralDay } from "../../src/shared/boss/scorecard/scorecard.mjs";

const ORIGIN = process.env.BOSS_ORIGIN ?? "https://boss.sequoiataylor.com";
const MANIFEST = new URL("../../src/shared/boss/scorecard/manifest.json", import.meta.url);
const SITES = new URL("../../src/shared/boss/searchReadiness/sites.json", import.meta.url);

export class Stop extends Error { constructor(code, s, exit = 2) { super(`NAMED STOP [${code}] ${s}`); this.exit = exit; } }

/** Read every active measure: the readings, never throwing for one source. Pure apart from ctx. */
export async function readAll(manifest, ctx, day) {
  const problems = scoreboardProblems(manifest);
  if (problems.length) throw new Stop("GROWTH_SCOREBOARD_SHAPE", problems.join("; "));
  const measures = activeMeasures(manifest);
  if (!measures.length) throw new Stop("GROWTH_SCOREBOARD_EMPTY", "the scoreboard has no measures to read.");
  const out = [];
  for (const m of measures) out.push(toReading(m, m.reader === "none" ? null : await readMetric(m, ctx), day));
  return out;
}

export async function run({ env = process.env, now = Date.now(), fetchImpl = fetch, dry = false, ctx } = {}) {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const sites = JSON.parse(readFileSync(SITES, "utf8"));
  const day = centralDay(now);
  const readings = await readAll(manifest, ctx ?? { ...macContext({ env, now, sites }), fetch: fetchImpl }, day);
  const read = readings.filter((r) => r.value !== null).length;
  if (!dry) {
    if (!env.BOSS_PASSCODE) throw new Stop("NO_PASSCODE", "BOSS_PASSCODE is not set; the caller injects it.", 3);
    const u = await fetchImpl(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: env.BOSS_PASSCODE }) });
    if (!u.ok) throw new Stop("UNLOCK_REFUSED", `Boss OS refused the passcode (${u.status}).`, 3);
    const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
    const p = await fetchImpl(`${ORIGIN}/api/boss/growth/readings`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ day, readings }) });
    if (!p.ok) throw new Stop("NOT_RECORDED", `Boss OS did not keep the readings (${p.status}: ${(await p.text()).slice(0, 160)}).`);
  }
  return { day, readings, read, unread: readings.length - read };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dry = process.argv.includes("--dry");
  run({ dry }).then((r) => {
    for (const x of r.readings) console.log(`${x.business} · ${x.measure}: ${x.value ?? x.unread}`);
    console.log(`OUTPUT ${r.read} growth readings (${r.unread} not read)`);
    if (r.read === 0) { console.log("NAMED STOP [GROWTH_SCOREBOARD_NOTHING_READ] every measure was unreadable; the cells say why."); process.exit(2); }
  }).catch((e) => { console.error(String(e?.message ?? e)); console.log("OUTPUT 0 growth readings"); process.exit(e?.exit ?? 1); });
}
