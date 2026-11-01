#!/usr/bin/env node
/**
 * THE SCORECARD'S MONDAY RUN (owner ruling, 1 Nov 2026: "nothing runs unmeasured"; plan
 * https://claude.ai/artifact/NA78ECyBGeB5aHfWkeGqZe).
 *
 * Reads every scorecard row's real number through its reader (scripts/ops/lib/scorecard-readers.mjs),
 * judges it (src/shared/boss/scorecard/scorecard.mjs `judge`), acts, records, and writes one section
 * into Simone's Monday morning email:
 *   - a first miss tries version B (recorded; no owning repo exposes an automatic switch yet);
 *   - a second miss pauses through the owning job's own switch — a Boss OS duty's pause, Monique's
 *     outreach pause, or disabling a GitHub workflow — never a deletion; the email carries a one-tap
 *     restart;
 *   - no number (unreadable, or stuck 3 weeks) opens ONE repair job for the team (fix-first).
 *
 * Runs on her Mac, daily 06:10 Central (launchd com.seq.boss-scorecard, through the vault, because
 * every key lives there). Mondays it judges; other days it only switches back on the workflows of a
 * row she restarted with the one-tap link.
 *
 *   npm run scorecard:monday                 the real run (Mondays judge; other days restarts only)
 *   npm run scorecard:monday -- --dry        read and judge now, print the states; no email, no switch, no record
 *
 * RULE 0: zero rows, or every row unreadable, is a NAMED STOP (exit 2) — never a quiet green.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, centralDay, emailSection, isMonday, judge, pauseTargets, shapeProblems } from "../../src/shared/boss/scorecard/scorecard.mjs";
import { macContext, readMetric } from "./lib/scorecard-readers.mjs";
import { ORIGIN, bossApi, fixJob } from "./lib/duty-kit.mjs";
import { writeMorningSection } from "../../src/shared/boss/mail/morning.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

/** Read every metric a row needs this week. Never throws. */
export async function readRow(row, record, ctx) {
  const reading = { first: await readMetric(row.first, ctx), real: await readMetric(row.real, ctx) };
  if (row.startWhen && !record?.start) reading.started = await readMetric(row.startWhen, ctx);
  return reading;
}

/** Rule 0 for a run: the stop line, or null. */
export function runStop(results) {
  if (!results.length) return "NAMED STOP [SCORECARD_NOTHING_READ] the scorecard has no rows to read.";
  const unreadable = results.filter((r) => r.state === "No number" && ["first", "real"].every((k) => r.values?.[k]?.error));
  if (unreadable.length === results.length) return `NAMED STOP [SCORECARD_ALL_UNREADABLE] not one of the ${results.length} rows could be read; the keys or the network are down on this Mac.`;
  return null;
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Pause one switch. Returns a short line for the log. Never deletes. */
export async function pauseOne(api, t, why, run = gh) {
  if (t.kind === "duty") { await api.post(`/duties/${t.duty}/pause`, { paused: true }); return `paused duty ${t.duty}`; }
  if (t.kind === "outreach") { await api.put(`/outreach/business/${t.key}`, { pause: true, pause_reason: why, by: "toni" }); return `paused outreach ${t.key}`; }
  if (t.kind === "workflow") { run(["workflow", "disable", t.file, "-R", `seq23/${t.repo}`]); return `disabled ${t.repo} ${t.file}`; }
  return `to pause by hand: ${t.name}`;
}

async function applyRestarts(api, state, dry) {
  const out = [];
  for (const [id, row] of Object.entries(state?.rows ?? {})) {
    const pending = row.record?.pendingEnable ?? [];
    if (!pending.length) continue;
    if (dry) { out.push(`would switch back on ${pending.length} workflow(s) for ${id}`); continue; }
    let okAll = true;
    for (const t of pending) { try { gh(["workflow", "enable", t.file, "-R", `seq23/${t.repo}`]); } catch (e) { okAll = false; console.error(`NAMED STOP [RESTART_FAILED] ${t.repo} ${t.file}: ${String(e?.message ?? e).slice(0, 120)}`); } }
    if (okAll) { await api.post("/scorecard/restarted", { id }); out.push(`switched back on ${pending.length} workflow(s) for ${id}`); }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const dry = argv.includes("--dry");
  const now = Date.now();
  const today = centralDay(now);
  const sc = readJson("src/shared/boss/scorecard/manifest.json");
  const schedule = readJson("src/shared/boss/schedule/manifest.json");
  const sites = readJson("src/shared/boss/searchReadiness/sites.json");
  const shape = shapeProblems(sc);
  if (shape.length) throw Object.assign(new Error(`NAMED STOP [SCORECARD_SHAPE] ${shape.slice(0, 3).join("; ")}`), { code: 1 });

  const api = await bossApi();
  let state;
  try { state = (await api.get("/scorecard")).state; }
  catch (e) {
    if (!dry) throw Object.assign(new Error(`NAMED STOP [SCORECARD_RECORD_UNREADABLE] Boss OS did not return the scorecard record: ${String(e?.message ?? e).slice(0, 120)}`), { code: 2 });
    console.log(`(dry) no scorecard record yet: ${String(e?.message ?? e).slice(0, 80)}`);
    state = null;
  }
  const restarts = await applyRestarts(api, state, dry);
  if (!dry && !isMonday(today)) {
    console.log(`scorecard: not Monday, nothing judged; ${restarts.length ? restarts.join("; ") : "no restarts waiting"}.`);
    return 0;
  }

  const ctx = macContext({ now, sites });
  const results = [];
  for (const row of sc.rows) {
    const record = state?.rows?.[row.id]?.record ?? null;
    const reading = await readRow(row, record, ctx);
    results.push(judge({ row, record, reading, today, defaults: sc.defaults }));
  }
  const stop = runStop(results);

  if (dry) {
    for (const r of results) {
      const v = (k) => (r.values[k].error ? r.values[k].error.match(/\[([A-Z_]+)\]/)?.[1] ?? "error" : r.values[k].value ?? "—");
      console.log(`${r.state.padEnd(17)} ${r.id.padEnd(26)} first=${v("first")} real=${v("real")}${r.next ? ` next=${r.next}` : ""}${r.actions.length ? ` WOULD: ${r.actions.map((a) => a.kind).join(",")}` : ""}`);
    }
    const n = (s) => results.filter((r) => r.state === s).length;
    console.log(`dry run ${today}: ${results.length} rows — ${["On track", "Too early", "Trying version B", "Paused", "No number"].map((s) => `${n(s)} ${s.toLowerCase()}`).join(", ")}; nothing recorded, no email, no switch.`);
    if (stop) { console.error(stop); return 2; }
    return 0;
  }

  // Act: version B is recorded with the run; a pause goes through each job's own switch.
  const acted = [];
  for (const r of results) for (const a of r.actions) {
    if (a.kind !== "pause") continue;
    const row = sc.rows.find((x) => x.id === r.id);
    for (const t of pauseTargets(row, schedule)) {
      try { acted.push(await pauseOne(api, t, `Scorecard: ${row.initiative} missed its floor after version B (owner ruling, 1 Nov 2026).`)); }
      catch (e) { console.error(`NAMED STOP [PAUSE_FAILED] ${row.id}: ${String(e?.message ?? e).slice(0, 160)}`); }
    }
  }
  const posted = await api.post("/scorecard/run", { week: today, results: results.map(({ id, state, note, next, actions, record }) => ({ id, state, note, next, actions, record })) });
  const tokens = posted?.tokens ?? {};

  const broken = results.filter((r) => r.state === "No number");
  if (broken.length) {
    const why = await fixJob(api, { title: `Scorecard: ${broken.length} row(s) have no number this week`, prompt: `the Monday scorecard run could not read these rows; root-cause each source and fix it (a missing key is a NAMED STOP she fills, nothing else waits): ${broken.map((r) => `${r.id} — ${r.note}`).join(" | ")}` });
    if (why) console.error(`NAMED STOP [REPAIR_NOT_OPENED] ${why}`);
  }

  const section = emailSection(results, sc.rows, { today, links: (row) => ({ open: `${ORIGIN}/?tab=scorecard&row=${row.id}`, restart: tokens[row.id] ? `${ORIGIN}/tap/${tokens[row.id]}` : null }) });
  try { writeMorningSection("scorecard", { title: section.title, lines: section.lines }); }
  catch (e) { console.error(`NAMED STOP [MORNING_SECTION_REFUSED] ${e?.message ?? e}`); return 9; }

  const n = (s) => results.filter((r) => r.state === s).length;
  console.log(`scorecard ${today}: ${results.length} rows — ${n("On track")} on track, ${n("Too early")} too early, ${n("Trying version B")} trying B, ${n("Paused")} paused, ${n("No number")} no number; ${acted.length ? acted.join("; ") : "no switches"}${restarts.length ? `; ${restarts.join("; ")}` : ""}. Next check ${addDays(today, 7)}.`);
  if (stop) { console.error(stop); return 2; }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(e?.code ?? 1); });
}
