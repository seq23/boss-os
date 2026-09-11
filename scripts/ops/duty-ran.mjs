#!/usr/bin/env node
/**
 * The half of `duty-run.sh` that needs a credential: telling D1 the run happened.
 *
 * Split out rather than curled from the shell for one reason — the passcode. `vault:run` puts
 * BOSS_PASSCODE in this process's environment for the life of the call and nothing writes it down;
 * a curl in a shell script would have the same secret on a command line, where `ps` can read it.
 *
 * ─── IT REPORTS A SCRIPT NAME, NEVER A DUTY ID ─────────────────────────────
 *
 * That is the whole of the no-second-list design. The wrapper knows which script it ran, because it
 * ran it. The duty row knows which script it wants run, in `task_input.$.local_job`, and has since
 * 0201. The join happens on the server against the list that already exists, so there is nothing
 * new to keep in step and nothing to drift. A caller that named its own duty id could name the
 * wrong one and nothing would ever know.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * Every path exits non-zero with a named reason except the one where D1 actually recorded the run.
 * A report that silently did not happen looks exactly like one that did, which is the failure this
 * whole mechanism was built to remove.
 */

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";

const env = (k) => {
  const v = process.env[k];
  return v === undefined || v === "" ? null : v;
};

async function main() {
  const localJob = env("LOCAL_JOB");
  const outcome = env("OUTCOME");
  if (!localJob) {
    console.error("NAMED STOP [NO_LOCAL_JOB] nothing said which script ran, so no duty can be resolved.");
    process.exit(2);
  }
  if (outcome !== "ok" && outcome !== "failed") {
    console.error(`NAMED STOP [NO_OUTCOME] "${outcome}" is not ok or failed. A wrapper that cannot say which is itself a failure.`);
    process.exit(3);
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

  const res = await fetch(`${ORIGIN}/api/boss/duties/ran`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      local_job: localJob,
      outcome,
      // A failed run has to say why, and the endpoint refuses one that does not. The wrapper
      // prefers a NAMED STOP line over the last three lines of output, because a named stop is the
      // sentence the job wrote for exactly this moment.
      reason: env("REASON") ?? (outcome === "failed" ? `the job exited ${env("EXIT_CODE") ?? "non-zero"} and printed nothing.` : null),
      exit_code: env("EXIT_CODE") ? Number(env("EXIT_CODE")) : null,
      started_at: env("STARTED_AT") ? Number(env("STARTED_AT")) : null,
      source: process.argv.includes("--manual") ? "manual" : "launchd",
    }),
  });

  if (!res.ok) {
    console.error(`NAMED STOP [NOT_RECORDED] ${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.error("  The job ran. D1 does not know it. The two will disagree until this is fixed.");
    process.exit(6);
  }
  const { data } = await res.json();
  console.log(
    outcome === "ok"
      ? `Recorded against ${data.duty_id}: ran, and its clock moved.`
      : `Recorded against ${data.duty_id}: FAILED. last_run_at was deliberately left where it was — the duty is still due.`,
  );
}

main().catch((err) => {
  console.error(`NAMED STOP [REPORT_FAILED] ${err?.message ?? err}`);
  process.exitCode = 1;
});
