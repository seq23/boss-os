#!/usr/bin/env node
/**
 * Print the ladder the Executive Intelligence Report walks, from the shipped migrations.
 *
 * Her question (19 Sep 2026): "the Boss OS briefing is run using my two $0 lanes first, right —
 * Claude and OpenAI? The ladder is working?" This answers it with the resolver the consumer and the
 * claim endpoint actually use, run over every migration replayed into SQLite — the same world the
 * ladder validator replays — so what prints is what the duty would walk tomorrow at 06:00.
 *
 *   node scripts/ops/briefing-ladder.mjs            # the ordered list
 *   node scripts/ops/briefing-ladder.mjs --json
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { registerTsResolve } from "../validate/lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function replayedWorld(dir = join(ROOT, "migrations")) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try { db.exec(readFileSync(join(dir, f), "utf8")); } catch { /* the ladder validator reports these */ }
  }
  const backends = db.prepare(`SELECT id, status, class, monthly_ceiling_micros, spent_micros, window_started_at FROM execution_backends`).all();
  const models = db.prepare(
    `SELECT m.id, m.provider_id, m.slug, m.display_name, m.capability_tier, m.enabled,
            m.in_micros_1k, m.out_micros_1k, m.ladder_rung, m.data_use, p.enabled AS provider_enabled
       FROM models m JOIN providers p ON p.id = m.provider_id`,
  ).all();
  const duty = db.prepare(`SELECT task_input FROM standing_duties WHERE id = 'duty_exec_intel'`).get();
  return { backends: backends.map((b) => ({ ...b })), models: models.map((m) => ({ ...m })), duty: duty ? JSON.parse(duty.task_input) : null };
}

export async function ladder() {
  registerTsResolve();
  const mod = await import(new URL("../../src/worker/boss/duties/briefingLadder.ts", import.meta.url).href);
  const spec = await import(new URL("../../src/worker/boss/duties/briefingSpec.ts", import.meta.url).href);
  const access = await import(new URL("../../src/worker/boss/router/modelAccess.ts", import.meta.url).href);
  const world = replayedWorld();
  /*
   * THE ROUTER'S OWN SCAN, ON THE PROMPT THE RUN IS HANDED. Names come from production rows this
   * script cannot read, so the lexicon here holds none — the verdict below rests on the deal-term
   * patterns alone, which is the part of the scan the briefing's own wording trips.
   */
  const prompt = spec.composeBriefingPrompt({ dayLabel: spec.ctDayLabel(Date.now()), hasMarketData: true });
  const lexicon = { established: true, names: [], note: "replayed world: no private names available here" };
  const verdict = access.scanForModelAccess([{ role: "user", content: prompt }], lexicon, { modelAccess: "public_model_approved" });
  const privacy = { private_model_only: verdict.access === "private_model_only", why: verdict.reason };
  return { candidates: mod.orderBriefingCandidates(world, Date.now(), privacy), duty: world.duty, render: mod.renderLadder, privacy };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { candidates, duty, render, privacy } = await ladder();
  if (process.argv.includes("--json")) { console.log(JSON.stringify({ privacy, candidates }, null, 2)); }
  else {
    console.log(`duty_exec_intel.task_input.backend_ladder = ${JSON.stringify(duty?.backend_ladder ?? null)}; cloud_fallback = ${JSON.stringify(duty?.cloud_fallback ?? null)}`);
    console.log(`router privacy verdict on the briefing's prompt: ${privacy.private_model_only ? "PRIVATE MODEL ONLY — " + privacy.why : "public"}`);
    console.log(render(candidates));
  }
  if (candidates.length === 0) { console.error("NAMED STOP: no candidates at all."); process.exit(1); }
}
