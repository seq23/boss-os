#!/usr/bin/env node
/**
 * A RULING OF HERS THAT REACHED THE WRONG DESK, RE-SENT WORD FOR WORD (owner incident, 1 Nov
 * 2026). "Change to Camille's Marketplace listings duty … your call" was triaged to Camille as
 * research (tsk_m6c11wsgrxcd9d2z) instead of reaching the duty it named, and the research page
 * said "Done" while the duty stayed as it was (see src/shared/boss/research/page.mjs). The mail
 * door and the employee page now both open a real repo change for a ruling on a duty with fixed
 * steps (src/worker/boss/duties/editByMail.ts, src/worker/boss/routes/duties.ts). This is the tool
 * for a ruling that already landed on the wrong desk: it reads her words back out of the task that
 * took them, strips the "research: " prefix Simone's triage adds, and posts them to that SAME
 * ask-change door, so the lane builds from her own words without asking her again.
 *
 *   node scripts/ops/duty-ruling.mjs <task_id> <duty_id>
 * Run through the vault (needs BOSS_PASSCODE): npm run vault:run -- node scripts/ops/duty-ruling.mjs …
 */
import { bossApi } from "./lib/duty-kit.mjs";

const RESEARCH_PREFIX = /^research:\s*/i;

/**
 * Her words, as the ruling, out of a task row's own `input` — the body Simone's triage carried it
 * in, with the "research: " prefix that sent it to a research page (rather than the duty it named)
 * stripped — or null when the task holds no words to re-send. Pure.
 */
export function rulingWordsIn(task) {
  let input = {};
  try { input = task?.input ? JSON.parse(task.input) : {}; } catch { input = {}; }
  const raw = [input.body, input.prompt].find((x) => typeof x === "string" && x.trim());
  if (!raw) return null;
  const words = raw.trim().replace(RESEARCH_PREFIX, "").trim();
  return words || null;
}

async function main() {
  const [taskId, dutyId] = process.argv.slice(2);
  if (!taskId || !dutyId) {
    console.error("usage: duty-ruling.mjs <task_id> <duty_id>");
    process.exit(2);
  }
  const api = await bossApi();
  const { task } = await api.get(`/tasks/${taskId}`);
  const words = rulingWordsIn(task);
  if (!words) {
    console.error(`NAMED STOP [NO_RULING_WORDS] task ${taskId} holds no words to re-send.`);
    process.exit(3);
  }
  const res = await api.post(`/duties/${dutyId}/ask-change`, { text: words });
  console.log(`${taskId} -> duty ${dutyId}: task ${res.task_id ?? "(none)"} ${res.created ? "created" : "not created"}${res.reason ? ` (${res.reason})` : ""}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
