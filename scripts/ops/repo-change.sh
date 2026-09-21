#!/bin/bash
# Danielle's repo-change lane — one tick on her Mac.
#
# TASK KIND `repo_change`; EXECUTOR `repo-change.sh`. `validate:duty-delivery` fails the build if the
# kind stops naming this script or this script stops naming the kind, and `validate:repo-lane`
# fails it if this lane ever lands without a recorded green and her recorded reply, or acquires a
# merge outside ~/bin/land.
#
# WHAT ONE TICK IS. `repo-change.mjs` asks Boss OS what is claimable, records what `gh pr checks`
# says about any open PR, claims ONE phase at a time and runs it as a fresh `claude -p` on the
# phase's model — Opus plans, Sonnet builds, the cheapest rung lands — with the turn cap and the
# wall-clock cap the shared module names. On a normal tick nothing is claimable and it exits 7
# saying so in under two seconds: NAMED STOP [NOTHING_CLAIMABLE], which is the ordinary state and
# is loud about being ordinary. It never exits 0 having silently done nothing.
#
# WHY THIS RUNS HERE AND NOT IN A WORKER. It needs working copies, git, gh, the repo's own
# validators, a browser for screenshots, ~/bin/land and the Drive service account — none of which a
# Worker has, and the Claude Code agent runner strips every credential on purpose.
#
# THE SAME WRAPPER DISCIPLINE AS ahrefs-audit-fix.sh: a lock so two ticks cannot overlap, a log per
# run with seconds and pid in the name, the vault for BOSS_PASSCODE / BOSS_OS_MAIL_KEY /
# GSC_SERVICE_ACCOUNT_JSON, `caffeinate` so a 90-minute build is not killed by the lid, and a hard
# `timeout` on the whole tick above the per-phase caps the runner enforces.
#
# IT MERGES THROUGH ~/bin/land AND NOTHING ELSE. The LAND phase runs `~/bin/land <pr>`, which
# verifies green, merges, watches main and deploys per repo — or refuses. No `gh pr merge`, no
# `gh workflow run`, no bare `wrangler deploy` appears in this lane, and the validator reads this
# file, the runner and the prompt to make sure of it.

set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
LOG_DIR="$HOME/Library/Logs/repo-change"
LOCK="$LOG_DIR/.lock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"
# The whole tick: three phases could in principle run back to back (plan, then — only if she has
# already replied — nothing; build then land in one tick when CI is fast). 3 hours covers the
# per-phase caps in src/shared/boss/repoChange/lane.mjs with room; the runner kills a phase at its
# own cap long before this.
TICK_TIMEOUT="${REPO_CHANGE_TICK_TIMEOUT:-3h}"
NOTHING_CLAIMABLE=7

mkdir -p "$LOG_DIR"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }

if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
    say "NAMED STOP [ALREADY_RUNNING] pid $(cat "$LOCK/pid") — a phase is in progress; this tick steps aside."; exit 0
  fi
  say "stale lock; reclaiming"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || { say "NAMED STOP [LOCK_FAILED]"; exit 3; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

[ -d "$REPO" ] || { say "NAMED STOP [NO_REPO] $REPO"; exit 8; }
CLAUDE="$(command -v claude || echo /opt/homebrew/bin/claude)"
[ -x "$CLAUDE" ] || { say "NAMED STOP [NO_CLAUDE_CLI] $CLAUDE"; exit 4; }
[ -f "$REPO/scripts/ops/repo-change-prompt.md" ] || { say "NAMED STOP [NO_PROMPT_FILE]"; exit 5; }
command -v gh >/dev/null 2>&1 || { say "NAMED STOP [NO_GH_CLI] a build that cannot open a PR is a build nobody sees."; exit 6; }
gh auth status >/dev/null 2>&1 || { say "NAMED STOP [GH_NOT_AUTHENTICATED] run: gh auth login"; exit 7; }
[ -x "$HOME/bin/land" ] || { say "NAMED STOP [NO_LAND] ~/bin/land is the only thing that may merge and deploy, and it is missing."; exit 9; }
if ! security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; then
  say "NAMED STOP [CLAUDE_NOT_AUTHENTICATED] the login keychain has no Claude Code credential; the Mac may be at the login window."
  exit 10
fi
TIMEOUT="$(command -v timeout || command -v gtimeout || true)"
[ -n "$TIMEOUT" ] || { say "NAMED STOP [NO_TIMEOUT] coreutils timeout is missing (brew install coreutils); a lane with no wall-clock cap does not run."; exit 11; }

say "=== repo-change tick starting (task kind: repo_change) ==="
cd "$REPO" || exit 8

# caffeinate -i: no idle sleep while the tick runs; it exits with the tick. The vault injects the
# passcode, the mail key and the Drive credential into the child and nothing is written anywhere.
caffeinate -i "$TIMEOUT" "$TICK_TIMEOUT" \
  npm run --silent vault:run -- node scripts/ops/repo-change.mjs "$@" >> "$RUN_LOG" 2>&1
RC=$?

ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"
case "$RC" in
  0) say "=== tick complete ===" ;;
  "$NOTHING_CLAIMABLE") say "=== $(grep -o 'NAMED STOP \[NOTHING_CLAIMABLE\].*' "$RUN_LOG" | tail -1) ===" ;;
  124) say "NAMED STOP [TICK_TIMED_OUT] the tick hit $TICK_TIMEOUT and was stopped; the claim lapses on its lease and the next tick retries." ;;
  *) say "NAMED STOP [TICK_FAILED] rc=$RC — $(grep -o 'NAMED STOP \[[A-Z_]*\].*' "$RUN_LOG" | tail -1)" ;;
esac
exit $RC
