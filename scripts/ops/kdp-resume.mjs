/**
 * She said yes — so start, rather than waiting for Friday.
 *
 * ─── What "continue to finish" has to mean in practice ─────────────────────
 *
 * "if i say apprpved she should continue to finish". Simone's watcher runs Mon/Wed/Fri at 09:23, so
 * an approval given on a Wednesday afternoon would otherwise sit until Friday morning. Approving
 * something and watching nothing happen for two days is, from her side, indistinguishable from the
 * inbox that applied nothing — which is the defect this whole mechanism exists to end.
 *
 * The agent launch job already runs five times a day. This rides on it: ask Boss OS whether the
 * covers have been approved and not yet acted on, and if so, run the watch NOW. On a normal day it
 * makes one HTTPS request, finds nothing, and exits in about a second.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * "Nothing to resume" is a real answer and exits 0 saying so. Every other outcome — unreachable,
 * unauthenticated, the watch itself failing — exits non-zero with a named reason, because a resume
 * that silently did not happen looks exactly like one that did.
 */

import { spawnSync } from "node:child_process";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const REPO = process.env.BOSS_OS_REPO ?? `${process.env.HOME}/GitHub/boss-os`;

async function main() {
  if (!process.env.BOSS_PASSCODE) {
    console.error("NAMED STOP [NO_PASSCODE] run this through the vault: npm run kdp:resume");
    process.exit(4);
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/kdp`, { headers: { cookie } });
  if (!res.ok) throw new Error(`could not read the publishing state (${res.status})`);
  const { data } = await res.json();

  const covers = data?.covers ?? null;
  if (!covers) {
    console.log("No cover batch has been put to her yet. Nothing to resume.");
    return;
  }
  if (covers.state !== "approved") {
    console.log(`The covers are "${covers.state}", not approved. Nothing to resume.`);
    return;
  }

  /*
   * ONCE, NOT EVERY TICK. The watcher's own report is what marks the work as moved: once it posts a
   * determination after the approval, `last_activity_at` is newer than `resumed_at` and this stops
   * firing. Without that test this would launch the watch five times a day for ever after a single
   * approval, which is the 96x/day runaway shape this system has already had to remove once.
   */
  const lastCheck = data?.latest?.checked_at ?? 0;
  if (lastCheck > (covers.resumed_at ?? 0)) {
    console.log("Simone has already run since the approval. Nothing to resume.");
    return;
  }
  if ((data?.counts?.blocked ?? 0) === 0) {
    console.log("Nothing is blocked any more. Nothing to resume.");
    return;
  }

  console.log("The covers were approved and Simone has not run since. Starting the watch now.");
  const run = spawnSync("bash", [`${REPO}/scripts/ops/kdp-watch.sh`], { stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`NAMED STOP [WATCH_FAILED] the watch exited ${run.status}. Its own log says why, and it reports its own failure to Boss OS.`);
    process.exit(run.status ?? 1);
  }
}

main().catch((err) => {
  console.error(`kdp resume failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
