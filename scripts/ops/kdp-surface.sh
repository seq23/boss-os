#!/bin/bash
# Read everything Amazon sent about her books and decide what each one means.
#
# SIMONE'S STANDING KDP DUTY. `duty_kdp_surface` names her as the owner and this script as its
# executor; `validate:duty-delivery` fails the build if the two stop agreeing.
#
# WHY THIS EXISTS BESIDE kdp-watch.sh RATHER THAN INSIDE IT. That one chases ONE case to resolution
# and ends the day the seven books are Live. This is permanent: Simone owns the Kindle surface, and
# that case is an incident inside the ownership rather than the ownership itself. Her words: "u need
# to make sure simone has a dedicated task for handling anything related to KDP".
#
# 09:30, SEVEN MINUTES AFTER THE CASE WATCH, so on Mon/Wed/Fri the two never race for the same Gmail
# session and the case run's determination is already filed when this looks. Daily rather than
# Mon/Wed/Fri because a title taken down on a Saturday should not wait until Monday.
#
# RULE 0: this may not exit 0 having done nothing. Either it triaged and reported — and a day with no
# mail is a real triage that reports an empty list — or it exits non-zero with a named reason.

set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
PROMPT_FILE="${KDP_SURFACE_PROMPT:-$REPO/scripts/ops/kdp-surface-prompt.md}"

# THE MODEL IS NAMED AND MATCHES THE DUTY ROW. Deciding whether a message is promotional, an update
# or a problem is classification rather than judgement. `claude -p` with no --model runs the most
# expensive one available, which is what made a single briefing cost $3.88.
# duty_kdp_surface carries the same string in $.requested.model and
# scripts/validate/duties-deliver-somewhere.mjs fails the build if they disagree.
MODEL="${KDP_SURFACE_MODEL:-claude-haiku-4-5-20251001}"
LOG_DIR="$HOME/Library/Logs/kdp-surface"
LOCK="$LOG_DIR/.lock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"

mkdir -p "$LOG_DIR" "$HOME/.boss-os/kdp"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }

if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
    say "NAMED STOP [ALREADY_RUNNING] pid $(cat "$LOCK/pid")"; exit 0
  fi
  say "stale lock; reclaiming"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || { say "FAILED to lock"; exit 3; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

CLAUDE="$(command -v claude || echo /opt/homebrew/bin/claude)"
[ -x "$CLAUDE" ] || { say "NAMED STOP [NO_CLAUDE_CLI] $CLAUDE"; exit 4; }
[ -f "$PROMPT_FILE" ] || { say "NAMED STOP [NO_PROMPT_FILE] $PROMPT_FILE"; exit 5; }

# The connector is what reads the mailbox, and it is revoked by any Google password change. The daily
# credential prober is what makes that visible before this job needs it; this check only catches the
# CLI having no credentials at all, which is a different and simpler failure.
if ! security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; then
  say "NAMED STOP [CLAUDE_NOT_AUTHENTICATED] the Claude CLI has no credentials in the login keychain."
  say "  Today already carries the connector's state as a credential alert with the reconnect steps."
  exit 10
fi

say "=== KDP surface triage starting ==="
rm -f "$HOME/.boss-os/kdp/surface.json"
cd "$HOME" || { say "NAMED STOP [NO_HOME]"; exit 8; }

"$CLAUDE" -p "$(cat "$PROMPT_FILE")" --model "$MODEL" --dangerously-skip-permissions >> "$RUN_LOG" 2>&1
RC=$?
say "=== claude exited rc=$RC ==="

if ! grep -q "KDP-SURFACE-COMPLETE:" "$RUN_LOG"; then
  say "NAMED STOP [TRIAGE_DID_NOT_COMPLETE] no sentinel in the log — the run started and never reached its end, so its silence is not evidence that nothing arrived."
  exit 9
fi

say "sentinel: $(grep -o 'KDP-SURFACE-COMPLETE:.*' "$RUN_LOG" | tail -1)"
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"

# `;` NOT `&&`, AND THE EXIT CODE IS THE RUN'S. A Boss OS unreachable at 09:30 must not turn a
# completed triage into a failed one — the mail was read either way.
if [ -d "$REPO" ]; then
  cd "$REPO" && npm run --silent vault:run -- node scripts/ops/kdp-surface-report.mjs >> "$RUN_LOG" 2>&1
  RRC=$?
  [ $RRC -eq 0 ] || say "NAMED STOP [TRIAGE_NOT_DELIVERED] rc=$RRC — the mail was read; Boss OS was not told. See above."
else
  say "NAMED STOP [NO_REPO] $REPO — the mail was read; Boss OS was not told."
fi

exit $RC
