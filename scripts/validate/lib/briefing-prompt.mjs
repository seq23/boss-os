/**
 * The Executive Intelligence Report's prompt, as the run is actually handed it.
 *
 * ─── Why this replaced `newestPrompt(migrationsDir)` in four validators ────
 *
 * Until 19 September 2026 the prompt lived in `standing_duties.task_input` and every rewrite landed
 * as `UPDATE standing_duties SET task_input = json_set(task_input, '$.prompt', '...')` in a new
 * migration. Four validators each carried their own copy of a function that read every `.sql` file,
 * stripped comments, and kept the last one mentioning `$.prompt` and `duty_exec_intel` — four
 * readers of a specification that existed only as a string in a data row nobody could diff.
 *
 * Migration 0257 removed `$.prompt` from the row. `materialise.ts` composes the text on every firing
 * from `src/worker/boss/duties/briefingSpec.ts`, and THIS is what those validators now read: the
 * same function, run the same way, over the same module. What the validator checks is what ships.
 *
 *   import { currentBriefingPrompt } from "./lib/briefing-prompt.mjs";
 *   const prompt = await currentBriefingPrompt();
 */
import { registerTsResolve } from "./ts-resolve.mjs";

let cached = null;

export async function loadBriefingSpec() {
  registerTsResolve();
  return import(new URL("../../../src/worker/boss/duties/briefingSpec.ts", import.meta.url).href);
}

export async function currentBriefingPrompt() {
  if (cached) return cached;
  const spec = await loadBriefingSpec();
  cached = spec.composeBriefingPrompt({ dayLabel: spec.ctDayLabel(Date.now()), hasMarketData: true });
  return cached;
}
