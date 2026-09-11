#!/bin/bash
# Run a launchd job, and tell the duty row in D1 that it happened.
#
# ─── The defect this closes, in her words ───────────────────────────────────
#
#   "I DONT CARE IF ITS LAUNCHD OR D1 - THOSE SHOULD BE LINKED ANYWAY."
#
# Monique's duties ran correctly from launchd on her Mac - capital.log shows the buyer work firing
# and emailing her - while standing_duties.last_run_at read NULL, because the D1 cron is not what
# executes them. A session read the null and told her the duties had never run. She caught it.
#
# CONFIRMED against production, 11 September 2026: ten duties carry executor = 'local_job' and only
# THREE had ever recorded a run. Those three are exactly the three whose job happens to post to an
# endpoint that hardcodes their duty id. The other seven ran for days and read as never having run.
#
# ─── Why there is no second list ────────────────────────────────────────────
#
# The obvious fix is a table of "launchd label -> duty id", and it drifts the first time anything is
# renamed - two components each keeping their own list with no link, which is this repository's
# most-produced defect.
#
# THE DUTY ROW ALREADY NAMES ITS SCRIPT, in task_input.$.local_job, and has since 0201. So this
# wrapper reports the SCRIPT NAME - which it must know anyway, because it was told to run it - and
# the server resolves that against the list that already exists. Nothing new is written down.
#
# scripts/validate/a-launchd-run-reaches-its-duty.mjs proves both directions offline: every
# duty-run.sh invocation in the installer names a real duty, and every local_job duty is named by
# exactly one invocation.
#
# ─── What it reports, and what it refuses to ────────────────────────────────
#
# ON SUCCESS: outcome=ok. The server moves last_run_at and advances next_due_at.
# ON FAILURE: outcome=failed, with the last thing the job printed. The server writes last_outcome
#   and last_failure_reason and DOES NOT touch last_run_at or next_due_at - the duty last ran when
#   it last worked, and it is still due, because the work did not happen.
#
# IT NEVER STAMPS ON SCHEDULE. A run that did not happen must still look like it did not happen;
# stamping at launch is what would have hidden the exact confusion this exists to end.
#
# RULE 0: this may not exit 0 having done nothing. If the job cannot even be started, that is a
# failure and it is reported as one.
#
#   bash scripts/ops/duty-run.sh <local_job> -- <command...>

set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
LOG_DIR="$HOME/Library/Logs/boss-duty"
mkdir -p "$LOG_DIR"

LOCAL_JOB="${1:-}"
if [ -z "$LOCAL_JOB" ]; then
  echo "NAMED STOP [NO_LOCAL_JOB] usage: duty-run.sh <local_job> -- <command...>" >&2
  exit 2
fi
shift
if [ "${1:-}" = "--" ]; then shift; fi
if [ $# -eq 0 ]; then
  echo "NAMED STOP [NO_COMMAND] duty-run.sh $LOCAL_JOB was given nothing to run." >&2
  exit 2
fi

RUN_LOG="$LOG_DIR/$LOCAL_JOB-$(date +%Y-%m-%d-%H%M%S)-$$.log"
STARTED_AT=$(( $(date +%s) * 1000 ))

echo "[$(date +%H:%M:%S)] duty-run: $LOCAL_JOB" | tee -a "$RUN_LOG"

# The job's own output goes to the run log AND to launchd's stdout, so nothing is hidden by this
# wrapper existing. The exit code is the job's, not the tee's.
"$@" > >(tee -a "$RUN_LOG") 2>&1
RC=${PIPESTATUS[0]}
FINISHED_AT=$(( $(date +%s) * 1000 ))

if [ "$RC" -eq 0 ]; then
  OUTCOME="ok"
  REASON=""
else
  OUTCOME="failed"
  # THE LAST THING IT PRINTED, which is what makes a red row actionable rather than merely red.
  # Named stops are preferred over the final line, because a named stop is the sentence the job
  # wrote for exactly this moment.
  REASON="$(grep -o 'NAMED STOP \[[A-Z_]*\].*' "$RUN_LOG" | tail -1)"
  [ -n "$REASON" ] || REASON="$(tail -3 "$RUN_LOG" | tr '\n' ' ')"
  [ -n "$REASON" ] || REASON="the job exited $RC and printed nothing."
fi

# ─── REPORTED SECOND, AND ITS FAILURE IS ITS OWN ────────────────────────────
#
# `;` not `&&`, and the exit code below is the JOB'S. A Boss OS that is unreachable at 09:23 must
# not turn a completed run into a failed one - the work happened either way. The report is a
# separate claim and it fails separately and loudly, in this log.
if [ -d "$REPO" ]; then
  cd "$REPO" && LOCAL_JOB="$LOCAL_JOB" OUTCOME="$OUTCOME" REASON="$REASON" EXIT_CODE="$RC" \
    STARTED_AT="$STARTED_AT" FINISHED_AT="$FINISHED_AT" \
    npm run --silent vault:run -- node scripts/ops/duty-ran.mjs >> "$RUN_LOG" 2>&1
  RRC=$?
  [ $RRC -eq 0 ] || echo "NAMED STOP [RUN_NOT_RECORDED] rc=$RRC - $LOCAL_JOB ran and D1 was not told. See $RUN_LOG." | tee -a "$RUN_LOG" >&2
else
  echo "NAMED STOP [NO_REPO] $REPO - $LOCAL_JOB ran and D1 was not told." | tee -a "$RUN_LOG" >&2
fi

exit $RC
