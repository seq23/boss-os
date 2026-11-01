#!/bin/bash
# Run one Boss OS job on a GitHub Actions runner instead of her Mac.
#
# ─── Why (owner-approved 1 Nov 2026) ────────────────────────────────────────
#
# "Move Boss OS jobs that don't need her Mac off the Mac", so a closed lid stops costing a run.
# The job itself is unchanged: the same npm script, the same duty-run.sh wrapper reporting to the same
# duty row, the same senders. Only the machine changes.
#
# ─── What this adds around the job ──────────────────────────────────────────
#
# 1. NOTHING THE JOB PRINTS REACHES THE PUBLIC LOG. The repo is public, so its Actions logs are too.
#    Jobs print names, addresses and owner email; all of it goes to a private log in R2
#    (boss-os-documents/job-state/logs/<job>/…). The public log gets one line: the exit code and, on a
#    failure, only the NAMED STOP's code in brackets. The duty row (private D1) gets the full reason
#    from duty-run.sh as it always has.
# 2. STATE A JOB KEEPS BETWEEN RUNS (`--state lp,preseed` = ~/.boss-os/lp, ~/.boss-os/preseed) is pulled
#    from R2 before the run and pushed back after, one tarball per directory, so the cloud run sees
#    what the last run left exactly as the Mac did. A directory with no tarball yet is a NAMED STOP:
#    a job that silently starts from empty state would re-send everything it already sent.
#
# RULE 0: a run whose log or state could not be saved exits non-zero by name — the work may have
# happened, but the next run would not know it.
#
#   bash scripts/ops/cloud-job.sh <job> [--state dir1,dir2] -- <command...>

set -uo pipefail

JOB="${1:-}"
[ -n "$JOB" ] || { echo "NAMED STOP [NO_JOB] usage: cloud-job.sh <job> [--state a,b] -- <command...>"; exit 2; }
shift
STATE_DIRS=""
if [ "${1:-}" = "--state" ]; then STATE_DIRS="${2:-}"; shift 2; fi
[ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "NAMED STOP [NO_COMMAND] cloud-job.sh $JOB was given nothing to run."; exit 2; }

if [ "${GITHUB_ACTIONS:-}" != "true" ] || [ "${BOSS_OS_CLOUD_RUN:-}" != "1" ]; then
  echo "NAMED STOP [NOT_A_CLOUD_RUN] cloud-job.sh runs only on GitHub Actions with BOSS_OS_CLOUD_RUN=1; on the Mac use duty-run.sh."
  exit 2
fi

BUCKET="boss-os-documents"
PREFIX="job-state"
STATE_HOME="$HOME/.boss-os"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
LOG="$RUNNER_TEMP/cloud-job-$JOB-$STAMP.log"
export BOSS_OS_REPO="${BOSS_OS_REPO:-$GITHUB_WORKSPACE}"
mkdir -p "$STATE_HOME"

R2LOG="$RUNNER_TEMP/cloud-job-r2.log"
# wrangler's own errors carry no job data, so a failed R2 call may print its last error line publicly.
r2() {
  npx --no-install wrangler r2 object "$@" --remote >"$R2LOG" 2>&1 && return 0
  echo "cloud-job $JOB: R2 $1 failed: $(grep -E 'ERROR|✘|rror' "$R2LOG" | tail -1 | cut -c1-200)"
  return 1
}

# ── pull state ──
IFS=',' read -r -a DIRS <<<"$STATE_DIRS"
for d in "${DIRS[@]}"; do
  [ -n "$d" ] || continue
  if ! r2 get "$BUCKET/$PREFIX/dirs/$d.tgz" --file "$RUNNER_TEMP/$d.tgz"; then
    echo "cloud-job $JOB: NAMED STOP [STATE_NOT_SEEDED] ~/.boss-os/$d has no copy in R2 yet; not run."
    exit 3
  fi
  tar -xzf "$RUNNER_TEMP/$d.tgz" -C "$STATE_HOME" || { echo "cloud-job $JOB: NAMED STOP [STATE_UNREADABLE] $d"; exit 3; }
done

# ── run ──
"$@" >>"$LOG" 2>&1
RC=$?

# ── push state ──
SAVE_RC=0
for d in "${DIRS[@]}"; do
  [ -n "$d" ] || continue
  tar -czf "$RUNNER_TEMP/$d.out.tgz" -C "$STATE_HOME" "$d" && r2 put "$BUCKET/$PREFIX/dirs/$d.tgz" --file "$RUNNER_TEMP/$d.out.tgz" || SAVE_RC=4
done

# ── private log ──
if ! r2 put "$BUCKET/$PREFIX/logs/$JOB/$STAMP.log" --file "$LOG"; then [ "$SAVE_RC" -eq 0 ] && SAVE_RC=5; fi

CODE="$(grep -oE 'NAMED STOP \[[A-Z_]+\]' "$LOG" | tail -1 | grep -oE '\[[A-Z_]+\]')"
if [ "$SAVE_RC" -ne 0 ]; then
  echo "cloud-job $JOB: exit $RC; NAMED STOP [$([ "$SAVE_RC" -eq 4 ] && echo STATE_NOT_SAVED || echo LOG_NOT_SAVED)]"
  exit "$SAVE_RC"
fi
echo "cloud-job $JOB: exit $RC${CODE:+ $CODE}; log job-state/logs/$JOB/$STAMP.log"
exit "$RC"
