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

# ─── A RUN THAT CANNOT RUN MUST STILL REACH HER SCREEN ───────────────────────
#
# THE FAILURE THIS CLOSES, IN ONE SENTENCE: the notification shared its failure mode with the work.
#
# `kdp-watch-prompt.md` told the run to email her whenever something needed her, and that email goes
# through the SAME claude.ai Gmail connector it reads the mailbox with. She changed her Google
# password, Google revoked the grant instantly, and the one condition that most needed to reach her
# — "I cannot read your mail at all" — was the exact condition that could not send. Meanwhile every
# named stop below simply exited, so Boss OS was told nothing either, and Today went on showing a
# week-old sentence.
#
# The Boss OS report is the channel that survived. It survived by luck. This makes it structural:
# every stop reports first and exits second, over HTTPS with a passcode from the vault, sharing
# nothing with the mailbox it could not read.
#
# WHAT IT POSTS. `needs-her`, because a revoked credential or a missing installation is hers and
# only hers to repair; `run_outcome: could-not-run`, so the screen says nothing was learned rather
# than showing the same silence a quiet week at Amazon produces; and a named reason. NO '@' MAY
# APPEAR IN ANY OF THESE STRINGS — the endpoint refuses one, and refusing here is the difference
# between a legible failure and a 400 in a log nobody reads.
report_stop() {
  local code="$1" reason="$2" action="$3"
  say "NAMED STOP [$code] $reason"
  mkdir -p "$HOME/.boss-os/kdp"
  cat > "$HOME/.boss-os/kdp/determination.json" <<STOPEOF
{
  "sentinel": "needs-her",
  "run_outcome": "could-not-run",
  "determination": "The watcher could not run: $reason",
  "next_action": "$action",
  "needs_owner": true,
  "days_since_support": null,
  "nudges_unanswered": null,
  "threads_seen": 0,
  "published_title_ref": null
}
STOPEOF
  if [ -d "$REPO" ]; then
    cd "$REPO" && npm run --silent vault:run -- node scripts/ops/kdp-report.mjs >> "$RUN_LOG" 2>&1 \
      && say "  reported to Boss OS: it will say on Today that this run could not happen and why." \
      || say "  AND COULD NOT REPORT IT EITHER. Nothing on any screen knows this run failed."

    # AND A PUSH ON A TRANSPORT GOOGLE CANNOT REVOKE. Resend has its own key; a password change
    # cannot touch it. Second, never first — Boss OS is the channel of record and this is the thing
    # that tells her to go and look on a day she otherwise would not. `;` not `&&`: a refused send
    # must not turn a reported stop into an unreported one.
    cd "$REPO" && npm run --silent notify -- \
      --subject "KDP watch could not run" \
      --body "$reason

What to do: $action

This is on Today under Critical Alerts, which is the record. This email is only the nudge." >> "$RUN_LOG" 2>&1 \
      || say "  (the email push also failed; Boss OS still has it)"
  else
    say "  AND COULD NOT REPORT IT EITHER: no repo at $REPO."
  fi
}

CLAUDE="$(command -v claude || echo /opt/homebrew/bin/claude)"
if [ ! -x "$CLAUDE" ]; then
  report_stop "NO_CLAUDE_CLI" "the Claude CLI is not installed or not executable on this machine." \
    "Reinstall the Claude CLI on her Mac, then run npm run kdp:check to catch up."
  exit 4
fi
if [ ! -f "$PROMPT_FILE" ]; then
  report_stop "NO_PROMPT_FILE" "the watcher prompt file is missing, so there is nothing to run." \
    "Run bash scripts/ops/install-agent-launchd.sh to restore the symlink, then npm run kdp:check."
  exit 5
fi

# Gmail here is a claude.ai connector, not a local MCP server. A lapsed login would make this job
# silently find "no reply" forever — indistinguishable from good news, and exactly the failure this
# watcher exists to avoid.
#
# THIS KEYCHAIN TEST IS NOT A LIVENESS TEST AND NEVER WAS. It proves the CLI has credentials stored,
# not that the Gmail grant behind them is still valid — and the grant is what actually died: Google
# revokes every OAuth refresh token the moment the account password changes, which is what happened.
# The keychain entry sat there looking healthy throughout. `npm run credentials:check` is the probe
# that answers the real question, daily, by making the call.
if ! security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; then
  report_stop "CLAUDE_NOT_AUTHENTICATED" "the Claude CLI has no credentials in the login keychain." \
    "Sign in to the Claude CLI on her Mac. If the Mac is at the login window the keychain is locked; unlock it and the next run recovers on its own."
  exit 10
fi

say "=== KDP case watch starting ==="
cd "$HOME" || { report_stop "NO_HOME" "the home directory is not reachable, so the run cannot start." "This is a machine fault rather than anything to do with Amazon. Check the Mac."; exit 8; }

"$CLAUDE" -p "$(cat "$PROMPT_FILE")" --model "$MODEL" --dangerously-skip-permissions >> "$RUN_LOG" 2>&1
RC=$?
say "=== claude exited rc=$RC ==="

if ! grep -q "KDP-WATCH-COMPLETE:" "$RUN_LOG"; then
  # A revoked Gmail connector lands here: the run starts, the first tool call is refused, and it
  # stops without a sentinel. Reported rather than exited, because "the run died" and "nothing has
  # happened at Amazon" are opposite facts that used to render identically.
  report_stop "WATCH_DID_NOT_COMPLETE" "the run started and never reached its sentinel, so its silence is not evidence that no reply arrived. The usual cause is the claude.ai Gmail connector no longer being authorised, which Google revokes whenever the account password changes." \
    "Open claude.ai, then Settings, then Connectors, and reconnect Google Gmail. Then run npm run kdp:check."
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
