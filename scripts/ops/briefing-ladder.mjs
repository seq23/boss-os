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
  const world = replayedWorld();
  return { candidates: mod.orderBriefingCandidates(world), duty: world.duty, render: mod.renderLadder };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { candidates, duty, render } = await ladder();
  if (process.argv.includes("--json")) { console.log(JSON.stringify({ candidates }, null, 2)); }
  else {
    console.log(`duty_exec_intel.task_input.backend_ladder = ${JSON.stringify(duty?.backend_ladder ?? null)}; cloud_fallback = ${JSON.stringify(duty?.cloud_fallback ?? null)}`);
    console.log(render(candidates));
  }
  if (candidates.length === 0) { console.error("NAMED STOP: no candidates at all."); process.exit(1); }
}
