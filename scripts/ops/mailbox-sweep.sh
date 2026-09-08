#!/bin/bash
# Read the mailbox for meaning, once a week, and tell Boss OS what was found.
#
# MONIQUE'S DUTY, EXECUTED. `duty_mailbox_sweep` in Boss OS names her as the owner and names this
# script as its executor; `validate:duty-delivery` fails the build if the two stop agreeing. The
# duty is `executor = 'local_job'`, so the cron materialises nothing for it — reading the CONTENTS
# of her mail needs credentials the Claude Code runner strips on purpose, and this is the only thing
# that can do the work.
#
# WHY THIS IS THE SAME SHAPE AS kdp-watch.sh AND NOT A NEW GMAIL CLIENT. The alternative was a
# `format=full` extractor in scripts/ops, which would have meant widening `validate:gmail` — the
# guard that asserts every Gmail API caller in this repository requests four headers and nothing
# else. That guard is load-bearing and the exception list is deliberately one entry long. Running
# through `claude -p` and the Gmail connector she is already signed into means THIS REPOSITORY
# NEVER ACQUIRES A SECOND BODY-READING API CALLER: the reading happens inside the local process,
# the mail never touches this repo or this database, and what crosses is code names and composed
# prose. The rule for everyone else is not weakened by one character.
#
# SUNDAY 18:30, half an hour after Monique's network refresh at 18:00, and that order matters: the
# refresh rebuilds the touch list and the code-name map from mail metadata, and running the meaning
# pass first would produce "X has gone quiet" findings about people who wrote on Friday.
#
# RULE 0: this script may not exit 0 having done nothing. Either it swept and reported, or it exits
# non-zero with a named reason. A quiet week is a report of zero findings, never silence.

set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
PROMPT_FILE="${MAILBOX_SWEEP_PROMPT:-$REPO/scripts/ops/mailbox-sweep-prompt.md}"
MAP_FILE="${BOSS_OS_CONTACTS_DIR:-$HOME/.boss-os/contacts}/MAP.json"
OUT_DIR="${BOSS_OS_MAILBOX_DIR:-$HOME/.boss-os/mailbox}"

# THE MODEL IS NAMED, AND IT MATCHES THE DUTY ROW.
#
# `claude -p` with no --model runs the default, which is the most expensive one available — the
# thing that made one executive briefing cost $3.88. This runs four times a month over eighteen
# months of mail and is the most demanding local job in the system: it has to hold two sides of a
# possible deal in mind across a year. That is judgement rather than summarisation, and it is the
# same reason buyer sourcing keeps the better model deliberately — a wrong "these two should talk"
# costs her a phone call and some credibility.
MODEL="${MAILBOX_SWEEP_MODEL:-claude-sonnet-4-5-20250929}"
MAX_TURNS="${MAILBOX_SWEEP_MAX_TURNS:-80}"
LOG_DIR="$HOME/Library/Logs/mailbox-sweep"
LOCK="$LOG_DIR/.lock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"

mkdir -p "$LOG_DIR" "$OUT_DIR"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }

# Two runs in the same minute shared a log file once and the second inherited the first's sentinel.
# Seconds and pid in the name; a lock directory for the run itself.
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

# WITHOUT THE MAP THERE IS NO SWEEP, and that is a hard stop rather than a degraded run.
#
# Every person in a finding is named by code name. With no map the run would have to either invent
# names or use real addresses, and the second one is the leak this whole design exists to prevent.
# Refusing is the only safe answer, and it names the command that fixes it.
if [ ! -f "$MAP_FILE" ]; then
  say "NAMED STOP [NO_CONTACT_MAP] $MAP_FILE is missing."
  say "  Every finding names people by code name and the map is the only thing that can produce one."
  say "  Run: cd $REPO && npm run contacts:extract && npm run contacts:sync -- --commit"
  exit 6
fi

# Gmail here is a claude.ai connector, not a local MCP server. A lapsed login would make this job
# silently find nothing for ever — which is indistinguishable from a quiet mailbox and is exactly
# the failure this sweep exists to avoid.
if ! security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; then
  say "NAMED STOP [CLAUDE_NOT_AUTHENTICATED] cannot read credentials from the login keychain."
  say "  Mac may be at the login window with the keychain locked, or the session signed out."
  exit 10
fi

# THE PREVIOUS FILE IS REMOVED BEFORE THE RUN, NOT AFTER.
#
# `mailbox-report.mjs` refuses a findings file older than the run, which is the backstop. Deleting
# it here is the belt: a run that crashes halfway cannot leave last week's findings looking like
# this week's, and "nothing was written" is then unambiguous on disk as well as in the reporter.
rm -f "$OUT_DIR/findings.json"

say "=== mailbox sweep starting (model $MODEL) ==="
cd "$HOME" || { say "NAMED STOP [NO_HOME]"; exit 8; }

"$CLAUDE" -p "$(cat "$PROMPT_FILE")" \
  --model "$MODEL" --max-turns "$MAX_TURNS" --dangerously-skip-permissions >> "$RUN_LOG" 2>&1
RC=$?
say "=== claude exited rc=$RC ==="

if ! grep -q "MAILBOX-SWEEP-COMPLETE:" "$RUN_LOG"; then
  say "NAMED STOP [SWEEP_DID_NOT_COMPLETE] no sentinel in the log — the run started and never reached its end,"
  say "  so its silence is not evidence that the mailbox holds nothing."
  exit 9
fi

say "sentinel: $(grep -o 'MAILBOX-SWEEP-COMPLETE:.*' "$RUN_LOG" | tail -1)"
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"

# `;` NOT `&&`, AND THE EXIT CODE IS THE SWEEP'S. A Boss OS that is unreachable on a Sunday evening
# must not turn a completed sweep into a failed one — the mail was read either way. The report is a
# separate claim and fails separately, loudly, in this log.
if [ -d "$REPO" ]; then
  cd "$REPO" && npm run --silent vault:run -- node scripts/ops/mailbox-report.mjs >> "$RUN_LOG" 2>&1
  REPORT_RC=$?
  [ $REPORT_RC -eq 0 ] || say "NAMED STOP [REPORT_NOT_DELIVERED] rc=$REPORT_RC — the sweep ran; Boss OS was not told. See above."
else
  say "NAMED STOP [NO_REPO] $REPO — the sweep ran; Boss OS was not told."
fi

exit $RC
