#!/bin/bash
# Watch KDP Case #51496198 for a support reply and act on it.
#
# SIMONE'S DUTY, EXECUTED. `duty_kdp_publication` in Boss OS names her as the owner and names this
# script as its executor; `validate:duty-delivery` fails the build if the two stop agreeing. The
# duty is `executor = 'local_job'`, so the cron materialises nothing for it — reading her mailbox
# needs credentials the Claude Code runner strips, and this is the only thing that can do the work.
#
# THE CANONICAL COPY IS THIS FILE, IN THE REPO. `~/bin/kdp-watch.sh` is a symlink to it, installed
# by scripts/ops/install-agent-launchd.sh. It lived only in ~/bin until 7 September, which meant
# nothing installed it, nothing repaired it, and nothing could tell it had drifted.
#
# Runs under launchd, independent of any chat session. Same shape as ci-sweep.sh,
# including the lessons that cost real debugging there:
#   - completion is proven by a SENTINEL, not by output length (a quiet day is
#     a one-line answer and would trip a byte threshold)
#   - log filenames carry seconds AND pid, because two runs in the same minute
#     shared a file and the second inherited the first's sentinel
#
# RULE 0: this script may not exit 0 having done nothing. Either it checked and
# reported, or it exits non-zero with a named reason.

set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
PROMPT_FILE="${KDP_WATCH_PROMPT:-$REPO/scripts/ops/kdp-watch-prompt.md}"

# THE MODEL IS NAMED, AND IT MATCHES THE DUTY ROW.
#
# `claude -p` with no --model runs the default, which is the most expensive one available. That is
# what made a single executive briefing cost $3.88 — the envelope had supported a model flag the
# whole time and nothing was setting it. This job runs thirteen times a month and mostly finds
# nothing; reading four threads and deciding whether a reply resolves a case does not need Opus.
#
# duty_kdp_publication carries the same string in $.requested.model and
# scripts/validate/duties-deliver-somewhere.mjs fails the build if these two ever disagree.
MODEL="${KDP_WATCH_MODEL:-claude-haiku-4-5-20251001}"
LOG_DIR="$HOME/Library/Logs/kdp-watch"
LOCK="$LOG_DIR/.lock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"

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

CLAUDE="$(command -v claude || echo /opt/homebrew/bin/claude)"
[ -x "$CLAUDE" ] || { say "NAMED STOP [NO_CLAUDE_CLI] $CLAUDE"; exit 4; }
[ -f "$PROMPT_FILE" ] || { say "NAMED STOP [NO_PROMPT_FILE] $PROMPT_FILE"; exit 5; }

# Gmail here is a claude.ai connector, not a local MCP server. It was confirmed
# reachable from a headless run on 2026-09-02, but a lapsed login would make this
# job silently find "no reply" forever — which is indistinguishable from good news
# and is exactly the failure this watcher exists to avoid.
if ! security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; then
  say "NAMED STOP [CLAUDE_NOT_AUTHENTICATED] cannot read credentials from the login keychain."
  say "  Mac may be at the login window with the keychain locked, or the session signed out."
  exit 10
fi

say "=== KDP case watch starting ==="
cd "$HOME" || { say "NAMED STOP [NO_HOME]"; exit 8; }

"$CLAUDE" -p "$(cat "$PROMPT_FILE")" --model "$MODEL" --dangerously-skip-permissions >> "$RUN_LOG" 2>&1
RC=$?
say "=== claude exited rc=$RC ==="

if ! grep -q "KDP-WATCH-COMPLETE:" "$RUN_LOG"; then
  say "NAMED STOP [WATCH_DID_NOT_COMPLETE] no sentinel in the log — the run started but never reached its end, so its silence is not evidence that no reply arrived."
  exit 9
fi

STATE=$(grep -o 'KDP-WATCH-COMPLETE:.*' "$RUN_LOG" | tail -1)
say "sentinel: $STATE"
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"

# ─── Tell Boss OS, which for five days nothing did ───────────────────────────
#
# The sentinel above used to be the end of the line: it landed in a log file she has never opened
# and Boss OS learned nothing. Simone owned a duty whose determinations were invisible, which is
# ownership written where nothing can read it.
#
# `;` NOT `&&`, AND THE EXIT CODE IS THE WATCHER'S. A Boss OS that is unreachable at 09:23 must not
# turn a completed check into a failed run — the check happened, the mail was read, the reply was
# or was not sent. The report is a separate claim and fails separately, loudly, in this log.
if [ -d "$REPO" ]; then
  cd "$REPO" && npm run --silent vault:run -- node scripts/ops/kdp-report.mjs >> "$RUN_LOG" 2>&1
  REPORT_RC=$?
  [ $REPORT_RC -eq 0 ] || say "NAMED STOP [REPORT_NOT_DELIVERED] rc=$REPORT_RC — the check ran; Boss OS was not told. See above."
else
  say "NAMED STOP [NO_REPO] $REPO — the check ran; Boss OS was not told."
fi

exit $RC
