#!/usr/bin/env bash
# Monique's comment watch, from launchd — the wrapper around youtube-comment-watch.mjs.
#
#   duty-run.sh youtube-comment-watch.sh -- bash ~/GitHub/boss-os/scripts/ops/youtube-comment-watch.sh
#
# THE SAME WRAPPER DISCIPLINE AS ahrefs-audit-fix.sh: a lock so two slots cannot overlap, a log per
# run with seconds and pid in the name, the vault for BOSS_PASSCODE / BOSS_OS_MAIL_KEY, `caffeinate`
# so the lid cannot end it, and a hard `timeout` on the whole run.
#
# TWO SLOTS A DAY, ONE SWEEP A WEEK. The runner itself asks Boss OS whether the duty is due before
# it sweeps (Wednesday 14:00 America/Chicago — see the duty's cadence_note for why that hour); the
# act half runs on every slot so her reply is applied the same day, never a week later. A slot
# with nothing pending and no sweep due prints NOTHING_PENDING and exits 0: named, not silent.
#
# NO MODEL RUNS HERE. Classification happens inside how-we-know's own routed lane; this script
# invokes that repo's CLI and reads the JSON it writes. The channel's credentials never leave that
# repo's .secrets/.
set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
LOG_DIR="$HOME/Library/Logs/youtube-comment-watch"
LOCK="$LOG_DIR/.lock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"
TIMEOUT_MIN="${COMMENT_WATCH_TIMEOUT_MIN:-20}"
mkdir -p "$LOG_DIR"

say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }

if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
    say "NAMED STOP [ALREADY_RUNNING] pid $(cat "$LOCK/pid")"; exit 0
  fi
  say "stale lock; reclaiming"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || { say "FAILED to lock"; exit 3; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

[ -d "$REPO" ] || { say "NAMED STOP [NO_REPO] $REPO is not here."; exit 8; }
cd "$REPO" || exit 8
TIMEOUT="$(command -v gtimeout || command -v timeout || true)"

say "comment watch: $*"
if [ -n "$TIMEOUT" ]; then
  caffeinate -i "$TIMEOUT" "${TIMEOUT_MIN}m" \
    npm run --silent vault:run -- node scripts/ops/youtube-comment-watch.mjs "$@" >> "$RUN_LOG" 2>&1
else
  caffeinate -i \
    npm run --silent vault:run -- node scripts/ops/youtube-comment-watch.mjs "$@" >> "$RUN_LOG" 2>&1
fi
RC=$?
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"

if [ "$RC" -eq 124 ]; then
  say "NAMED STOP [TIMED_OUT] the run exceeded ${TIMEOUT_MIN} minutes and was killed."
  exit 124
fi
if [ "$RC" -ne 0 ]; then
  say "$(grep -E 'NAMED STOP \[[A-Z_]+\]' "$RUN_LOG" | tail -1 || echo "NAMED STOP [FAILED] exit $RC; see $RUN_LOG")"
  exit "$RC"
fi
grep -q "COMMENT-WATCH-COMPLETE" "$RUN_LOG" || { say "NAMED STOP [DID_NOT_COMPLETE] exit 0 without the completion sentinel; see $RUN_LOG"; exit 9; }
say "done (rc 0)"
exit 0
