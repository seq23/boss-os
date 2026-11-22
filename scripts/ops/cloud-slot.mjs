#!/usr/bin/env node
/**
 * Tells Boss OS that a clock slot's run started or ended (cloud-job.yml, its first and last steps).
 *
 * The Worker's clock knows GitHub ACCEPTED a start; only the runner knows it RAN. On 22 Nov 2026 the
 * 06:40 morning-email slot was accepted, waited 65 minutes in GitHub's queue and nobody was told.
 * With these two reports the clock's tick (src/worker/boss/cron/dispatch.ts slotCheck) can say so.
 *
 * BEST EFFORT, NEVER IN THE WAY: each call has a 5-second budget and this always exits 0, so Boss OS
 * being down never stops the job itself. What it could not report it says, in one line; a start that
 * never reached Boss OS is read from the end report, and a run that reports neither is the miss the
 * check exists to tell about.
 *
 *   SLOT_KEY  the dispatch's client_payload.key (empty on a hand-started run: nothing to report)
 *   PHASE     start | end      OUTCOME  the job's status at the end: success | failure | cancelled
 */
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const BUDGET_MS = 5_000;
const OUTCOMES = { success: "ok", failure: "failed", cancelled: "cancelled" };

export function slotReport(env) {
  const key = (env.SLOT_KEY ?? "").trim();
  if (!key) return { skip: "no slot key (started by hand, not by the clock)" };
  const phase = env.PHASE;
  if (phase !== "start" && phase !== "end") return { skip: `phase "${phase}" is not start or end` };
  if (phase === "start") return { body: { key, phase } };
  return { body: { key, phase, outcome: OUTCOMES[env.OUTCOME] ?? "failed" } };
}

async function main() {
  const r = slotReport(process.env);
  if (r.skip) { console.log(`cloud-slot: not reported, ${r.skip}`); return; }
  if (!process.env.BOSS_PASSCODE) { console.log("cloud-slot: not reported [NO_PASSCODE]"); return; }
  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }), signal: AbortSignal.timeout(BUDGET_MS),
  });
  if (!unlock.ok) { console.log(`cloud-slot: not reported [UNLOCK_FAILED ${unlock.status}]`); return; }
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
  const res = await fetch(`${ORIGIN}/api/boss/duties/slot`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(r.body), signal: AbortSignal.timeout(BUDGET_MS),
  });
  console.log(`cloud-slot: ${r.body.phase} of ${r.body.key} ${res.ok ? "reported" : `not reported [${res.status}]`}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => console.log(`cloud-slot: not reported [${String(err?.name ?? err)}]`));
}
