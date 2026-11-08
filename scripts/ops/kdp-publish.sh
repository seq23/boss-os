#!/bin/bash
# Simone puts the approved covers up and presses Publish.
#
# SIMONE'S THIRD KDP DUTY, AND THE ONLY ONE THAT ACTS. `duty_kdp_publish` names her as the owner and
# this script as its executor; `validate:duty-delivery` fails the build if the two stop agreeing.
#
# ─── Why it is a separate job from the other two ────────────────────────────
#
# `kdp-watch.sh` chases the support case and `kdp-surface.sh` triages the mail. Both are `claude -p`
# runs, and a scheduled `claude -p` process has NO browser tools at all — proven 9 September 2026,
# and a property of the sandbox rather than a bug. Neither could ever have uploaded a cover.
#
# This one runs Playwright directly against Simone's own persistent Chrome profile. Different
# executable, different requirements, so it is its own duty rather than a flag on an existing one.
#
# 09:45 Central DAILY since 8 Nov 2026 (migration 0357; it was the 1st of the month, which left an
# approved book waiting up to a month). On the 1st it still runs after the triage (09:30). With
# nothing approved it opens no window and sends nothing.
#
# ─── IT DOES NOT ASK HER FOR ANYTHING ───────────────────────────────────────
#
# She approved these covers on 9 September. This run finds that verdict and acts on it; it raises no
# judgement call and it publishes nothing she has not approved. If the approval is missing, sent
# back, or for a different batch, it stops and says which — it does not ask again.
#
# RULE 0: this may not exit 0 having done nothing. The publisher reports every outcome to Boss OS
# before it exits, including the outcomes where it could not start, so a run that could not run does
# not render as a quiet day.

set -uo pipefail

REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"  # the checkout this script lives in, symlinks followed (launchd: the runtime)
LOG_DIR="$HOME/Library/Logs/kdp-publish"
LOCK="$LOG_DIR/.lock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"

mkdir -p "$LOG_DIR"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }

# Two runs uploading covers to the same bookshelf at once is the one collision that could put the
# wrong image on a book, so the lock is not a nicety here.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
    say "NAMED STOP [ALREADY_RUNNING] pid $(cat "$LOCK/pid")"; exit 0
  fi
  say "stale lock; reclaiming"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || { say "FAILED to lock"; exit 3; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

if [ ! -d "$REPO" ]; then
  say "NAMED STOP [NO_REPO] $REPO — nothing to run and nothing to report with."
  exit 5
fi

# NOTHING IS PUBLISHED IF THERE IS NOTHING BLOCKED. Checked by the publisher itself against her
# approval and the live bookshelf; this is only the early exit that keeps a finished lane quiet.
say "=== KDP publish starting ==="
cd "$REPO" || { say "NAMED STOP [NO_REPO_CD]"; exit 5; }

# ─── SALES FIRST (KDP strategy, spry brain 8 Nov 2026) ───────────────────────
# Units and Kindle Unlimited pages per title, read in code from the KDP reports before anything is
# published, so a publish stop never costs the week's numbers. An unread page writes a named reason
# (scripts/ops/kdp-units.mjs); the Scorecard shows "No number", never 0.
node scripts/ops/kdp-units.mjs >> "$RUN_LOG" 2>&1 \
  || say "NAMED STOP [UNITS_NOT_READ] sales could not be read this week — see the KDP-UNITS line; the Scorecard shows No number until a later run reads it."

npm run --silent vault:run -- node scripts/ops/kdp-publish.mjs "$@" >> "$RUN_LOG" 2>&1
RC=$?
say "=== publisher exited rc=$RC ==="

ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"
grep -o 'KDP-PUBLISH:.*' "$RUN_LOG" | tail -5 | tee -a /dev/stderr

# ─── NEW TITLES SHE APPROVED (kdp_new_title; the KeepMyProof books, owner 7 Nov 2026) ──────────
# Simone publishes them on her own, every day while the saved Amazon sign-in lasts (owner, 8 Nov 2026:
# "Yes, publish on her own"). kdp-new-title.mjs --unattended reads the bookshelf first, emails her a
# heads-up 30 minutes before it opens Chrome, signs in to Amazon for her (her ruling 8 Nov 2026; the
# existing kdp-signin.mjs steps, never a picture check), keeps the window open for her
# on any stop and emails her the one thing to do, and emails the Amazon link when the book is Live.
# With nothing approved it opens nothing and says so.
npm run --silent vault:run -- node scripts/ops/kdp-new-title.mjs --unattended >> "$RUN_LOG" 2>&1
NRC=$?
say "=== new titles exited rc=$NRC ==="
grep -o 'KDP-NEW-TITLE:.*' "$RUN_LOG" | tail -3 | tee -a /dev/stderr
# ─── HER MONDAY LINE: sales, KU pages and companion-page visits, on the run's OUTPUT line ────────
npm run --silent vault:run -- node scripts/ops/kdp-week.mjs >> "$RUN_LOG" 2>&1 || say "NAMED STOP [WEEK_NOT_READ] see the KDP-WEEK line."
WEEK="$(grep -o 'KDP-WEEK: .*' "$RUN_LOG" | tail -1 | sed 's/^KDP-WEEK: //' | cut -c1-54)"
# For duty-run.sh: the census line, and the named stop that names the failure (it reads the last of each).
N="$(grep -E '^OUTPUT [0-9]+ kindle-titles-submitted' "$RUN_LOG" | tail -1 | awk '{print $2}')"
echo "OUTPUT ${N:-0} kindle titles submitted · ${WEEK:-sales not read}" | tee -a "$RUN_LOG"
grep -o 'NAMED STOP \[[A-Z_]*\].*' "$RUN_LOG" | tail -1 >&2

# The run failed if either half failed; the publisher's own code wins when both did.
[ "$RC" -eq 0 ] && RC=$NRC
exit $RC
