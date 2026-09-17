#!/usr/bin/env node
/**
 * "Is this duty due right now?" — the question a daily launchd tick asks before doing any work.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 *
 * `com.seq.boss-ahrefs-audit` named ONE moment a week — Thursday 06:00 — and, measured on 13 Sep
 * 2026, had `runs = 0` and "(never exited)". The plist was written on 11 Sep at 18:06, after that
 * week's window, so its first occurrence was still ahead of it. Nothing was broken. That is the
 * point: a schedule with one chance to fire looks identical whether it is waiting or dead, and on a
 * laptop that sleeps on battery the difference matters. A machine shut down through the one moment
 * loses the whole period. That cost is why the tick is daily and this check exists: a slept-through
 * Thursday costs a DAY, because the next morning's tick finds the duty still due.
 *
 * So the calendar entry fires DAILY and cheaply, and this decides whether there is work to do. The
 * duty row's `next_due_at` is the only clock; there is no second schedule to fall out of step with.
 *
 * ─── Rule 0, and the one permitted exception to it ─────────────────────────
 *
 * This repository's rule is that no stage may exit 0 having done nothing. A daily tick on a weekly
 * duty does nothing on six days out of seven, and that is correct — so it exits 0 and SAYS
 * WHICH DAY IT IS AND WHEN THE WORK IS NEXT DUE. A named stop a human can read is the exception;
 * silence is not.
 *
 * Exit codes: 0 = due, run it. 10 = not due, deliberately and with a reason. Anything else is a
 * real failure and the caller must treat it as one — an unreachable Boss OS must NOT be read as
 * "not due", because that would silently retire the job.
 *
 *   LOCAL_JOB=ahrefs-audit-fix.sh npm run vault:run -- node scripts/ops/duty-due.mjs
 */

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";

const NOT_DUE = 10;

async function main() {
  const localJob = process.env.LOCAL_JOB ?? process.argv[2];
  if (!localJob) {
    console.error("NAMED STOP [NO_LOCAL_JOB] duty-due needs the script name whose duty is being asked about.");
    process.exit(2);
  }
  if (!process.env.BOSS_PASSCODE) {
    console.error("NAMED STOP [NO_PASSCODE] this runs through the vault, and nothing else can reach Boss OS.");
    process.exit(4);
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) {
    console.error(`NAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${unlock.status}).`);
    process.exit(5);
  }
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/duties/due/${encodeURIComponent(localJob)}`, {
    headers: { cookie },
  });
  if (!res.ok) {
    /*
     * UNREACHABLE IS NOT "NOT DUE", and conflating them is how a job retires itself quietly. An
     * outage on the 1st would skip the month and nothing would ever say so, which is precisely the
     * shape — "runs but inert" — this whole mechanism exists to make impossible.
     */
    console.error(`NAMED STOP [DUE_UNKNOWN] ${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.error("  Boss OS could not say whether this is due. That is a failure, not a skip.");
    process.exit(6);
  }

  const { data } = await res.json();
  if (data.due) {
    console.log(`${data.duty_id} is due — ${data.reason}.`);
    process.exit(0);
  }

  console.log(`SKIPPED [NOT_DUE] ${data.duty_id}: ${data.reason}. Nothing to do today, and that is the answer.`);
  process.exit(NOT_DUE);
}

main().catch((err) => {
  console.error(`NAMED STOP [DUE_CHECK_THREW] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(7);
});
