#!/bin/bash
#
# One tail agent for boss-mail-tail.sh: runs `claude -p --model opus` with a 2 h hard cap, then
# folds the report (or, if the agent wrote none, an INCOMPLETE one naming its log) into Simone's
# morning email through boss-mail-tail-report.mjs under the Boss OS vault runner. Always clears the agent lock.
#
# THE HARNESS KILLS A BACKGROUND TASK 10 MINUTES AFTER THE AGENT'S LAST TURN (owner incident,
# 1 Nov 2026): the 17:48Z run handed its fix to a background subagent and ended its own turn; the
# harness killed it at the 10-minute mark, the process exited rc=0, and no report was written.
# CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 lifts that ceiling in print mode — a background task now
# runs until it finishes or this script's own CAP_SECONDS watchdog fires, whichever is sooner. If
# the report is still missing after that (a legacy run, or a path that ends some other way), ONE
# bounded --resume asks that same session to write it; failing that, any uncommitted worktree the
# agent cut (boss-mail-tail.sh now works in one, never in $REPO itself) is salvaged rather than
# lost, and the branch it lands on is named in the INCOMPLETE report.
#   boss-mail-tail-run.sh <prompt> <tail.jsonl> <lockdir> <claude> <report.txt> <subjects> <since>
set -uo pipefail
PROMPT_FILE="$1" TAIL_LOG="$2" FIXLOCK="$3" CLAUDE="$4" REPORT_FILE="$5" SUBJECT="${6:-your email}" SINCE="${7:-}"
REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"  # the checkout this script lives in, symlinks followed (launchd: the runtime)
LIB="$REPO/scripts/ops/lib/tail-report.mjs"
STATE_DIR="$(dirname "$TAIL_LOG")"
REPORT_LOG="$STATE_DIR/report.log"
CAP_SECONDS="${BOSS_MAIL_TAIL_CAP_SECONDS:-7200}"
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0

(cd "$REPO" && exec "$CLAUDE" -p "$(cat "$PROMPT_FILE")" --model opus --output-format stream-json --verbose --dangerously-skip-permissions) >> "$TAIL_LOG" 2>&1 &
AGENT=$!
( sleep "$CAP_SECONDS"; kill -0 "$AGENT" 2>/dev/null && { pkill -TERM -P "$AGENT" 2>/dev/null; kill "$AGENT"; echo "INCOMPLETE — stopped at the ${CAP_SECONDS}s cap" >> "$REPORT_FILE"; } ) &
WATCHDOG=$!
# A FINISHED AGENT CAN OUTLIVE ITS ANSWER. The first live tail (22 Oct 2026) wrote its report and its
# stream's final "result" event, then sat for 15 more minutes holding a background shell open, and the
# report waited with it. So: once the result event is in the log, allow 60 s, then end the process.
( while kill -0 "$AGENT" 2>/dev/null; do
    if grep -q '"type":"result"' "$TAIL_LOG" 2>/dev/null; then sleep 60; pkill -TERM -P "$AGENT" 2>/dev/null; kill "$AGENT" 2>/dev/null; break; fi
    sleep 15
  done ) &
FINISHER=$!
wait "$AGENT"; RC=$?
kill "$WATCHDOG" "$FINISHER" 2>/dev/null
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) agent rc=$RC log=$TAIL_LOG" >> "$REPORT_LOG"

STATE="$(node "$LIB" state "$REPORT_FILE" 2>/dev/null || echo missing)"
if [ "$STATE" != "complete" ]; then
  SESSION_ID="$(node "$LIB" session-id "$TAIL_LOG" 2>/dev/null || true)"
  PLAN="$(node "$LIB" plan "$STATE" "$SESSION_ID" "" 2>/dev/null || echo salvage)"
  ACTION="${PLAN%% *}"
  if [ "$ACTION" = "resume" ] && [ -n "$SESSION_ID" ]; then
    RESUME_CAP="${BOSS_MAIL_TAIL_RESUME_CAP_SECONDS:-600}"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) resuming $SESSION_ID (${RESUME_CAP}s) to recover its report" >> "$REPORT_LOG"
    (cd "$REPO" && exec timeout "$RESUME_CAP" "$CLAUDE" -p \
      "Finish by writing the plain-text report to $REPORT_FILE exactly as your instructions said (first line her subject(s); second line one plain sentence on where her job ended; then the record; last line FRICTION_FIXED: <n>). If the fix is still in flight, say so there as in flight — never omit it." \
      --resume "$SESSION_ID" --model opus --output-format stream-json --verbose --dangerously-skip-permissions) >> "$TAIL_LOG" 2>&1
    STATE="$(node "$LIB" state "$REPORT_FILE" 2>/dev/null || echo missing)"
  fi
fi

SALVAGED_BRANCH=""
if [ "$STATE" != "complete" ] && [ -n "$SINCE" ]; then
  SALVAGE_OUT="$(cd "$HOME/GitHub" 2>/dev/null && node "$REPO/scripts/ops/salvage-pass-worktrees.mjs" --since "$SINCE" --repo boss-os 2>&1)"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $SALVAGE_OUT" >> "$REPORT_LOG"
  SALVAGED_BRANCH="$(printf '%s\n' "$SALVAGE_OUT" | grep -o '^SALVAGED boss-os [^ ]*' | awk '{print $3}' | head -1)"
fi

if [ "$STATE" != "complete" ]; then
  {
    echo "$SUBJECT"
    echo
    echo "INCOMPLETE: the tail agent ended (rc=$RC) without its report. Log on the Mac: $TAIL_LOG"
    if [ -n "$SALVAGED_BRANCH" ]; then
      echo "Its unfinished work was saved on branch $SALVAGED_BRANCH — the next fix job continues there, never rebuilds it."
    fi
    echo "FRICTION_FIXED: 0"
  } >> "$REPORT_FILE"
fi
if OUT="$(cd "$REPO" && node scripts/vault/vault.mjs run -- node scripts/ops/boss-mail-tail-report.mjs "$REPORT_FILE" "$SUBJECT" 2>&1)"; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $OUT" >> "$REPORT_LOG"
else
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) FAILED to fold $REPORT_FILE into the morning email: $OUT" >> "$REPORT_LOG"
  /usr/bin/osascript -e "display notification \"Tail report not folded — see $REPORT_LOG\" with title \"Boss OS tail\" sound name \"Basso\"" >/dev/null 2>&1
fi
rm -rf "$FIXLOCK"
rm -f "$PROMPT_FILE"
