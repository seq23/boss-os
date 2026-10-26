#!/usr/bin/env node
/**
 * A SEARCH READINESS RUN THAT STOPPED WITH WORK LEFT REACHES DANIELLE FIRST (25 Oct 2026).
 *
 * On 25 Oct 2026 the run ended "fixed=0 left=316" and exited 0: a network outage had stopped every
 * pass, and nothing told anyone. scripts/ops/search-readiness-fix.sh now exits non-zero with a NAMED
 * STOP whenever it ends with workable briefs left, and calls this to open the existing repair path:
 * a "failed_task" repair on Danielle's desk (emp_repo), which she builds and lands herself
 * (repairs never wait on the owner), and which reaches the owner only through Danielle's own
 * report or her spent rework budget. Never a new email from here.
 *
 *   npm run --silent vault:run -- node scripts/ops/sr-run-stopped.mjs <CODE> <sentence>
 *
 * Exits 0 only when Boss OS recorded the task; anything else is a NAMED STOP the runner logs and
 * retries on its next pass (the runner reports each stop once, after it is recorded).
 */
import { bossApi } from "./lib/duty-kit.mjs";

export const SR_RUN_TITLE = 'Find why "Search Readiness fix run" failed';

export function repairTask(code, sentence) {
  return {
    title: SR_RUN_TITLE,
    lane: "ops",
    employee_id: "emp_repo",
    input: {
      origin: "repair",
      repair_kind: "failed_task",
      prompt:
        `seq23/boss-os — the Search Readiness fix run (scripts/ops/search-readiness-fix.sh) stopped with work left: ` +
        `NAMED STOP [${code}] ${String(sentence).slice(0, 600)} Read ~/Library/Logs/boss-sr-fix/ (newest log) and ` +
        `~/.boss-os/search-readiness/run-unfinished.json. If the cause is in code, fix it at source with a test that ` +
        `runs the real script; if it was outside (the network), confirm the run resumed by itself and close this with the reason.`,
    },
  };
}

async function main() {
  const [code, ...rest] = process.argv.slice(2);
  if (!code) { console.error("NAMED STOP [NO_STOP_CODE] usage: sr-run-stopped.mjs <CODE> <sentence>"); process.exit(2); }
  try {
    const api = await bossApi();
    await api.post("/tasks", repairTask(code, rest.join(" ")));
    console.log(`SR-STOP-REPORTED: ${code} — a repair is on Danielle's desk`);
  } catch (e) {
    console.error(`NAMED STOP [SR_STOP_NOT_REPORTED] ${e?.message ?? e}`);
    process.exit(3);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
