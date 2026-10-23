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
# IT LANDS WHAT IT FIXES, THROUGH ~/bin/land AND NOTHING ELSE. This header used to say "IT MERGES
# NOTHING. She merges." That was wrong about her, and it was changed on her word: owner, 16 Oct 2026,
# "fix danielle's job so she can actually fix things". Her standing rules already said merge green
# PRs without asking (14 Sep), merge and deploy are ONE action through ~/bin/land (18 Sep), nothing
# waits on the owner (25 Sep), and repairs found in passing need no yes. A fixer that opens PRs and
# leaves them for her is a fixer whose every fix waits on her. So after the pass, every `fixed_pr`
# row goes through `site-audit-lib.mjs land`: `timeout 1800 gh pr checks <pr> --watch --fail-fast`,
# then `~/bin/land <pr>`, which refuses rather than guesses (not green, head moved, main red),
# watches main to a terminal state and deploys. No bare merge, no workflow dispatch, no deploy call
# lives here — `validate:audit-fixer` fails the build if one appears. Client repos are never
# branched at all (repoPolicy.mjs).
#
# WHY THE 15 AND 16 OCT PASSES FIXED NOTHING, AND WHAT CHANGED. projects=24 fixed=0 surfaced=10,
# then projects=10 fixed=0 surfaced=9 off_limits=1. Every finding was surfaced because (a) the mail
# carries no URLs and she cannot log into Ahrefs — now `site-crawl.py crawl` supplies them from her
# own crawl of the live site; (b) a dirty working tree was refused — now `audit-worktree.sh` cuts a
# fresh worktree off origin and never touches the owner's checkout; (c) LGCV was off limits as
# "under active heavy change" — removed, collisions are caught as IN_FLIGHT instead; (d) a crawl
# failure stopped at "check robots/DNS/origin" — now `site-crawl.py probe` checks from outside, and
# out-of-credits crawls are AHREFS_CRAWL_CREDITS rows, not site defects.
#
# RULE 0: this script may not exit 0 having done nothing. Either it read the audits and reported, or
# it exits non-zero with a NAMED reason. A quiet week is a report of one row saying so, never silence.
# And a pass that surfaced fixable defects with fixed=0, or opened a PR that did not land, exits RED
# with each reason named (`site-audit-lib.mjs verdict`, exit 12).

set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
PROMPT_FILE="${AHREFS_AUDIT_PROMPT:-${BOSS_DUTY_PROMPT_FILE:-$REPO/scripts/ops/ahrefs-audit-fix-prompt.md}}"
OUT_DIR="${BOSS_OS_SITE_AUDIT_DIR:-$HOME/.boss-os/site-audit}"

# THE MODEL IS NAMED, AND IT MATCHES THE DUTY ROW.
#
# `claude -p` with no --model runs whatever the default is, so the model is always named. It was
# Sonnet; the owner's rule since 6 Oct 2026 is Opus for every agent (Haiku and Sonnet stay out), and
# this job is judgement over somebody else's repository. `validate:duty-delivery` and
# `validate:audit-fixer` assert this string equals the duty row's (migration 0287).
MODEL="${AHREFS_AUDIT_MODEL:-claude-opus-5}"
MAX_TURNS="${AHREFS_AUDIT_MAX_TURNS:-250}"
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

# THE PROMPT'S PATHS FOLLOW $REPO. It names ~/GitHub/boss-os/scripts/ops/… for the crawler, the
# worktree helper and the IN_FLIGHT check; on 16 Oct the owner's checkout there was on a docs branch
# without those scripts, so the run would have called files that did not exist. Rewritten to the
# checkout this runner was started from, which is the one that has them.
"$CLAUDE" -p "$(sed "s#~/GitHub/boss-os#$REPO#g" "$PROMPT_FILE")" \
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

# LAND EVERY FIX. Deterministic, not left to the model: checks to green, then ~/bin/land.
node "$REPO/scripts/ops/site-audit-lib.mjs" land "$OUT_DIR/findings.json" 2>&1 | tee -a "$RUN_LOG" | grep '^LAND ' || true

# `;` NOT `&&`. A Boss OS that is unreachable must not turn a completed pass into a failed one — the
# report is a separate claim and fails separately, loudly, in this log.
if [ -d "$REPO" ]; then
  (cd "$REPO" && npm run --silent vault:run -- node scripts/ops/ahrefs-audit-report.mjs >> "$RUN_LOG" 2>&1)
  REPORT_RC=$?
  [ $REPORT_RC -eq 0 ] || say "NAMED STOP [REPORT_NOT_DELIVERED] rc=$REPORT_RC — the pass ran; Boss OS was not told. See above."
else
  say "NAMED STOP [NO_REPO] $REPO — the pass ran; Boss OS was not told."
fi

# RULE 0, THE VERDICT. Fixable defects left with fixed=0, a PR that did not land, a row with no
# crawl behind it: RED, every reason named.
node "$REPO/scripts/ops/site-audit-lib.mjs" verdict "$OUT_DIR/findings.json" 2>&1 | tee -a "$RUN_LOG"
VERDICT_RC=${PIPESTATUS[0]}
[ $RC -ne 0 ] && exit $RC
[ $VERDICT_RC -eq 0 ] || { say "NAMED STOP [AUDIT_PASS_RED] see the AUDIT-VERDICT lines above."; exit 12; }
exit 0
