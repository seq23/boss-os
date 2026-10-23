#!/bin/bash
#
# One tail agent for boss-mail-tail.sh: runs `claude -p --model opus` with a 2 h hard cap, then
# folds the report (or, if the agent wrote none, an INCOMPLETE one naming its log) into Simone's
# morning email through boss-mail-tail-report.mjs under the Boss OS vault runner. Always clears the agent lock.
#   boss-mail-tail-run.sh <prompt> <tail.jsonl> <lockdir> <claude> <report.txt> <subjects>
set -uo pipefail
PROMPT_FILE="$1" TAIL_LOG="$2" FIXLOCK="$3" CLAUDE="$4" REPORT_FILE="$5" SUBJECT="${6:-your email}"
REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
STATE_DIR="$(dirname "$TAIL_LOG")"
REPORT_LOG="$STATE_DIR/report.log"
CAP_SECONDS="${BOSS_MAIL_TAIL_CAP_SECONDS:-7200}"

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

if [ ! -s "$REPORT_FILE" ] || ! grep -q "FRICTION_FIXED" "$REPORT_FILE"; then
  {
    echo "$SUBJECT"
    echo
    echo "INCOMPLETE: the tail agent ended (rc=$RC) without its report. Log on the Mac: $TAIL_LOG"
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
