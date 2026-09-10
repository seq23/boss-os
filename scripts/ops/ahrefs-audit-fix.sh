#!/bin/bash
# The week's Ahrefs Site Audit reports, read, fixed at source, and opened as pull requests.
#
# DANIELLE'S DUTY, EXECUTED. `duty_site_audit_repair` in Boss OS names `emp_repo` as the owner and
# names this script as its executor; `validate:duty-delivery` fails the build if the two stop
# agreeing, and `validate:audit-fixer` fails it if this script stops honouring the off-limits list
# or acquires a merge.
#
# WHY THIS CANNOT BE AN AGENT IN THE CLOUD — three reasons, any one sufficient:
#   · It reads the CONTENTS of seq.taylor@gmail.com. The Claude Code runner strips every credential
#     matching KEY|TOKEN|SECRET|PASSCODE, deliberately, so a cloud agent cannot reach her mail.
#   · It needs working copies of her repositories, git and gh. A Worker has none of those.
#   · The fix has to be proven by each repository's OWN validators before a PR is opened, which
#     means actually running them.
#
# THURSDAY 06:00 CENTRAL, AND THE HOUR IS DERIVED RATHER THAN CHOSEN. Every Site Audit mail in the
# mailbox was timed: Thu 27 Aug 02:20–02:31 UTC, Thu 3 Sep 01:07–03:58, Thu 10 Sep 01:07–02:42.
# Ahrefs recrawls the account weekly and delivers overnight into Thursday UTC — Wednesday evening in
# her zone. 06:00 America/Chicago is 11:00 UTC, seven hours after the latest report ever observed.
# Running before the batch lands would grade last week's crawl and open PRs for findings already
# fixed, which is how an automated fixer teaches its owner to stop reading it.
#
# IT MERGES NOTHING. No merge, no deploy, no release dispatch. She merges. That is a rule about what
# this job is FOR, not a limitation: a fixer that lands its own work removes the one place a person
# looks at what it did.
#
# RULE 0: this script may not exit 0 having done nothing. Either it read the audits and reported, or
# it exits non-zero with a NAMED reason. A quiet week is a report of one row saying so, never silence.

set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
PROMPT_FILE="${AHREFS_AUDIT_PROMPT:-$REPO/scripts/ops/ahrefs-audit-fix-prompt.md}"
OUT_DIR="${BOSS_OS_SITE_AUDIT_DIR:-$HOME/.boss-os/site-audit}"

# THE MODEL IS NAMED, AND IT MATCHES THE DUTY ROW.
#
# `claude -p` with no --model runs the default, which is the most expensive one available — the
# thing that made one executive briefing cost $3.88. Deciding which source file causes a 404 across
# somebody else's repository is judgement rather than classification, which is why this is Sonnet
# and not Haiku, and `validate:duty-delivery` asserts this string equals the duty row's.
MODEL="${AHREFS_AUDIT_MODEL:-claude-sonnet-4-5-20250929}"
MAX_TURNS="${AHREFS_AUDIT_MAX_TURNS:-120}"
LOG_DIR="$HOME/Library/Logs/ahrefs-audit-fix"
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
command -v gh >/dev/null 2>&1 || { say "NAMED STOP [NO_GH_CLI] a fix that cannot open a PR is a fix nobody sees."; exit 6; }
gh auth status >/dev/null 2>&1 || { say "NAMED STOP [GH_NOT_AUTHENTICATED] run: gh auth login"; exit 7; }

# Gmail here is a claude.ai connector, not a local MCP server. A lapsed login would make this job
# silently find nothing for ever — indistinguishable from a week with no findings, which is the one
# confusion this whole duty is written to prevent.
if ! security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; then
  say "NAMED STOP [CLAUDE_NOT_AUTHENTICATED] cannot read credentials from the login keychain."
  say "  Mac may be at the login window with the keychain locked, or the session signed out."
  say "  Danielle's duty stays overdue and Today will say so, which is correct."
  exit 10
fi

# ─── THE OFF-LIMITS REPOSITORY, READ FROM THE ONE LIST ──────────────────────
#
# NOT HARDCODED HERE. `src/shared/boss/siteAudit/repoPolicy.mjs` is the single source, and the
# ingest endpoint reads the same file — so the rule cannot be true in one place and stale in the
# other, which is this repository's most-named defect. Printed into the run log so the constraint
# the run actually operated under is visible after the fact rather than assumed.
NO_AUTO_FIX="$(node -e 'import("'"$REPO"'/src/shared/boss/siteAudit/repoPolicy.mjs").then(m=>console.log(m.NO_AUTO_FIX_REPOS.join(" ")))' 2>/dev/null)"
[ -n "$NO_AUTO_FIX" ] || { say "NAMED STOP [NO_POLICY] could not read the off-limits list; refusing to run without it."; exit 11; }
say "off limits to the fixer: $NO_AUTO_FIX"

# THE PREVIOUS FILE IS REMOVED BEFORE THE RUN, NOT AFTER.
#
# `ahrefs-audit-report.mjs` refuses a findings file older than the run, which is the backstop.
# Deleting it here is the belt: a run that crashes halfway cannot leave last week's findings looking
# like this week's, and "nothing was written" is then unambiguous on disk as well as in the reporter.
rm -f "$OUT_DIR/findings.json"

say "=== ahrefs audit pass starting (model $MODEL) ==="
cd "$HOME" || { say "NAMED STOP [NO_HOME]"; exit 8; }

"$CLAUDE" -p "$(cat "$PROMPT_FILE")" \
  --model "$MODEL" --max-turns "$MAX_TURNS" --dangerously-skip-permissions >> "$RUN_LOG" 2>&1
RC=$?
say "=== claude exited rc=$RC ==="

if ! grep -q "AHREFS-AUDIT-COMPLETE:" "$RUN_LOG"; then
  say "NAMED STOP [AUDIT_DID_NOT_COMPLETE] no sentinel in the log — the run started and never reached"
  say "  its end, so its silence is not evidence that there was nothing to fix."
  exit 9
fi

say "sentinel: $(grep -o 'AHREFS-AUDIT-COMPLETE:.*' "$RUN_LOG" | tail -1)"
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"

# `;` NOT `&&`, AND THE EXIT CODE IS THE PASS'S. A Boss OS that is unreachable on a Thursday morning
# must not turn a completed pass into a failed one — the audits were read and the PRs are open
# either way. The report is a separate claim and fails separately, loudly, in this log.
if [ -d "$REPO" ]; then
  cd "$REPO" && npm run --silent vault:run -- node scripts/ops/ahrefs-audit-report.mjs >> "$RUN_LOG" 2>&1
  REPORT_RC=$?
  [ $REPORT_RC -eq 0 ] || say "NAMED STOP [REPORT_NOT_DELIVERED] rc=$REPORT_RC — the pass ran; Boss OS was not told. See above."
else
  say "NAMED STOP [NO_REPO] $REPO — the pass ran; Boss OS was not told."
fi

exit $RC
