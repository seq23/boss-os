#!/bin/bash
# Simone puts the approved covers up and presses Publish.
#
# SIMONE'S THIRD KDP DUTY, AND THE ONLY ONE THAT ACTS. `duty_kdp_publish` names her as the owner and
# this script as its executor; `validate:duty-delivery` fails the build if the two stop agreeing.
#
# ─── Why it is a separate job from the other two ────────────────────────────
#
# `kdp-watch.sh` chases the support case and `kdp-surface.sh` triages the mail. Both are `claude -p`
# runs, and a scheduled `claude -p` process has NO browser tools at all — proven 9 September 2026,
# and a property of the sandbox rather than a bug. Neither could ever have uploaded a cover.
#
# This one runs Playwright directly against Simone's own persistent Chrome profile. Different
# executable, different requirements, so it is its own duty rather than a flag on an existing one.
#
# 09:45, after the case watch (09:23) and the triage (09:30), so the three never race for a session
# and this one runs with the day's determination already filed.
#
# ─── IT DOES NOT ASK HER FOR ANYTHING ───────────────────────────────────────
#
# She approved these covers on 9 September. This run finds that verdict and acts on it; it raises no
# judgement call and it publishes nothing she has not approved. If the approval is missing, sent
# back, or for a different batch, it stops and says which — it does not ask again.
#
# RULE 0: this may not exit 0 having done nothing. The publisher reports every outcome to Boss OS
# before it exits, including the outcomes where it could not start, so a run that could not run does
# not render as a quiet day.

set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
LOG_DIR="$HOME/Library/Logs/kdp-publish"
LOCK="$LOG_DIR/.lock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"

mkdir -p "$LOG_DIR"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }

# Two runs uploading covers to the same bookshelf at once is the one collision that could put the
# wrong image on a book, so the lock is not a nicety here.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
    say "NAMED STOP [ALREADY_RUNNING] pid $(cat "$LOCK/pid")"; exit 0
  fi
  say "stale lock; reclaiming"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || { say "FAILED to lock"; exit 3; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

if [ ! -d "$REPO" ]; then
  say "NAMED STOP [NO_REPO] $REPO — nothing to run and nothing to report with."
  exit 5
fi

# NOTHING IS PUBLISHED IF THERE IS NOTHING BLOCKED. Checked by the publisher itself against her
# approval and the live bookshelf; this is only the early exit that keeps a finished lane quiet.
say "=== KDP publish starting ==="
cd "$REPO" || { say "NAMED STOP [NO_REPO_CD]"; exit 5; }

npm run --silent vault:run -- node scripts/ops/kdp-publish.mjs "$@" >> "$RUN_LOG" 2>&1
RC=$?
say "=== publisher exited rc=$RC ==="

ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"
grep -o 'KDP-PUBLISH:.*' "$RUN_LOG" | tail -5 | tee -a /dev/stderr

exit $RC
