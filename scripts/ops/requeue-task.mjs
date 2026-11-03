#!/usr/bin/env node
/**
 * REQUEUE ONE NAMED TASK, AND PROVE IT RAN — THE POST-LAND STEP FOR rc_m6gtk39nn15aqs9x.
 *
 * `tsk_m6c2nxx17qyp6qr5`, her Chrome job from 1 Nov ("in Pinterest, on the A Player Mode account,
 * connect the RSS feed for the faith board"), failed on arrival: `bk_claude_code` refused it
 * because the queue consumer handed the guard the INTAKE kind (`one_off`) instead of the SEAT
 * kind (`document`) — fixed in `src/worker/boss/backends/dispatch.ts`. Once that PR lands, the
 * fix is live but the task is still sitting `failed`; this requeues it so the job she asked for
 * on 1 Nov actually runs, rather than waiting for its duty (it has none — a one-time Chrome job)
 * or for her to notice and ask again.
 *
 * NAMED STOPS, EACH ITS OWN EXIT CODE, SO THIS CANNOT EXIT 0 HAVING DONE NOTHING:
 *   4  NO_PASSCODE     — not run through the vault.
 *   5  UNLOCK_FAILED   — the passcode the vault holds was refused.
 *   6  TASK_REFUSED    — requeued, and refused again (the refusal sentence is printed).
 *   7  TASK_UNKNOWN    — no task with that id.
 *   8  TASK_TIMED_OUT  — requeued, but neither dispatched nor refused inside the wait.
 *
 *   npm run -s vault:run -- node scripts/ops/requeue-task.mjs tsk_m6c2nxx17qyp6qr5
 */

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const POLL_MS = 3000;
const MAX_WAIT_MS = 120_000;

const say = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const stop = (code, tag, why) => { console.error(`NAMED STOP [${tag}] ${why}`); process.exit(code); };

let cookie = "";

async function unlock() {
  if (!process.env.BOSS_PASSCODE) {
    stop(4, "NO_PASSCODE", "this runs through the vault: npm run -s vault:run -- node scripts/ops/requeue-task.mjs <task_id>");
  }
  const res = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!res.ok) stop(5, "UNLOCK_FAILED", `Boss OS refused the passcode (${res.status}).`);
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function getTask(taskId) {
  const res = await fetch(`${ORIGIN}/api/boss/tasks/${encodeURIComponent(taskId)}`, { headers: { cookie } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET task ${taskId} failed: ${res.status}`);
  const json = await res.json();
  return json?.data ?? null;
}

async function requeue(taskId) {
  const res = await fetch(`${ORIGIN}/api/boss/tasks/${encodeURIComponent(taskId)}/requeue`, {
    method: "POST", headers: { cookie },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, error: json?.error ?? null };
}

/** Waits for the task to leave `failed`-pending-retry limbo: either dispatched, or refused again. */
export async function waitForOutcome(taskId, { fetchTask = getTask, pollMs = POLL_MS, maxWaitMs = MAX_WAIT_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const data = await fetchTask(taskId);
    if (!data?.task) return { outcome: "unknown" };
    const events = data.events ?? [];
    const dispatched = [...events].reverse().find((e) => e.event === "dispatched");
    if (dispatched && data.task.status !== "failed") {
      let detail = {};
      try { detail = JSON.parse(dispatched.detail ?? "{}"); } catch { detail = {}; }
      return { outcome: "dispatched", runId: detail.run_id ?? null, backendId: detail.backend_id ?? null, task: data.task };
    }
    if (data.task.status === "failed") {
      return { outcome: "failed", error: data.task.error ?? "(no reason recorded)", task: data.task };
    }
    await sleep(pollMs);
  }
  return { outcome: "timed_out" };
}

async function main() {
  const taskId = process.argv[2];
  if (!taskId) stop(7, "TASK_UNKNOWN", "usage: requeue-task.mjs <task_id> — no task id was given.");

  await unlock();

  const before = await getTask(taskId);
  if (!before?.task) stop(7, "TASK_UNKNOWN", `no task exists with id ${taskId}.`);

  const req = await requeue(taskId);
  if (!req.ok) {
    if (req.status === 404) stop(7, "TASK_UNKNOWN", `no task exists with id ${taskId}.`);
    stop(6, "TASK_REFUSED", `the requeue itself was refused (${req.status}): ${req.error ?? "no reason given"}`);
  }
  say(`requeued ${taskId}`);

  const out = await waitForOutcome(taskId);
  if (out.outcome === "dispatched") {
    say(`dispatched: run ${out.runId} on ${out.backendId}`);
    process.exit(0);
  }
  if (out.outcome === "failed") {
    stop(6, "TASK_REFUSED", `${taskId} was requeued and refused again: ${out.error}`);
  }
  if (out.outcome === "unknown") {
    stop(7, "TASK_UNKNOWN", `${taskId} could not be read back after requeuing.`);
  }
  stop(8, "TASK_TIMED_OUT", `${taskId} was requeued but is neither dispatched nor failed after ${MAX_WAIT_MS / 1000}s — check it by hand.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`requeue-task failed: ${err?.message ?? err}`);
    process.exitCode = 1;
  });
}
