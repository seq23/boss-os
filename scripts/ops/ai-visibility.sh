#!/bin/bash
# THE AI ANSWERS LOOP'S WEEKLY READ (her ask, 22 Nov 2026: "build the ai visibility loop"; weekly by her yes).
#
# `duty_ai_visibility` (migration 0377) names this script. Once a week a LOCKED Claude session reads
# OpenSEO's weekly run for each of the six selling sites through the openseo plugin, and code records
# it: scripts/ops/ai-visibility-report.mjs (context, then post), src/shared/boss/growth/aiAnswers.mjs
# (the one reading of a site's week), POST /api/boss/growth/ai-week (every count recomputed there).
#
# WHY THE MAC: the OpenSEO plugin is a Claude plugin signed in on her Mac, read through ~/bin/ai-run
# (her ruling 22 Nov 2026: ai-run jobs stay on the Mac). No OpenSEO HTTP call lives in any repo code.
#
# TUESDAY 12:00 CENTRAL, CLASS LIGHT, AND THE HOUR IS DERIVED. All six OpenSEO weekly checks are set to
# Tuesday 04:00 UTC (22:00 Monday Central) and take minutes. 12:00 Central is 14 hours later (the brief
# asks for at least 6), inside the Mac's LIGHT window (10:00-21:59 Central, `npm run mac-day:check`):
# one short read-only session and two small node steps, no render, no build.
#
# MONEY: THE SESSION CAN ONLY READ. scripts/ops/ai-visibility-permissions.json is the whole permission
# list (`--setting-sources=` loads none of her own settings): nine read-only OpenSEO tools, every other
# OpenSEO tool and every file, shell and web tool denied, the claude.ai connectors switched off.
# `npm run validate:ai-visibility` fails the build on any other allow entry. The session prints
# OpenSEO's credits before and after; the report refuses a run where they moved.
#
# RULE 0: this may not exit 0 having done nothing. No sentinel with a real number → NAMED STOP exit 9;
# no site read → exit 9 from the report; a money proof missing → exit 10.

set -uo pipefail

main() {

REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"
PROMPT_FILE="${AI_VISIBILITY_PROMPT:-$REPO/scripts/ops/ai-visibility-prompt.md}"
SETTINGS="$REPO/scripts/ops/ai-visibility-permissions.json"
# The model is named (the BRAIN step's model, as every Claude duty): a judgement over answers, not a build.
MODEL="${AI_VISIBILITY_MODEL:-claude-opus-5}"
# Six sites × (tracker, estimate, run, results pages, sources) plus two whoami calls.
MAX_TURNS="${AI_VISIBILITY_MAX_TURNS:-120}"
LOG_DIR="$HOME/Library/Logs/ai-visibility"
LOCK="$LOG_DIR/.lock.flock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"
WORK="$LOG_DIR/run-$$"

mkdir -p "$LOG_DIR" "$WORK"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }
# A RESULT, NOT THE PROMPT'S TEMPLATE: the prompt names the sentinel with "<number …>", never a digit.
has_sentinel() { grep -qE 'AI-VISIBILITY-COMPLETE: sites=[0-9]' "$1"; }
usage_exhausted() { grep -qiE "usage limit|limit reached|out of (extra )?usage|rate.?limit|credit balance" "$1"; }

source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib/flock.sh"
LOCK_RC=0; hold_lock "$LOCK" || LOCK_RC=$?
case $LOCK_RC in
  0) ;;
  1) say "NAMED STOP [ALREADY_RUNNING] another run holds $LOCK"; exit 0 ;;
  *) say "NAMED STOP [LOCK_FAILED] cannot lock $LOCK"; exit 3 ;;
esac

AI_RUN="${AI_RUN_BIN:-$HOME/bin/ai-run}"
[ -x "$AI_RUN" ] || { say "NAMED STOP [AI_RUN_MISSING] $AI_RUN is not installed (seq-bin); the next run retries."; exit 13; }
[ -f "$PROMPT_FILE" ] || { say "NAMED STOP [NO_PROMPT_FILE] $PROMPT_FILE"; exit 5; }
[ -s "$SETTINGS" ] || { say "NAMED STOP [NO_PERMISSIONS_FILE] $SETTINGS is missing; the session never runs without its allow list."; exit 6; }
case "$SETTINGS" in *[[:space:]]*) say "NAMED STOP [PERMISSIONS_PATH_SPACE] '$SETTINGS' has a space, which ai-run would split."; exit 6;; esac
[[ "$MAX_TURNS" =~ ^[1-9][0-9]*$ ]] || { say "NAMED STOP [BAD_MAX_TURNS] AI_VISIBILITY_MAX_TURNS='$MAX_TURNS'"; exit 5; }
ROLE="$(node "$REPO/scripts/ops/lib/ai-run.mjs" role ai_visibility.read)" || { say "NAMED STOP [NO_AI_ROLE] ai_visibility.read"; exit 11; }
node "$REPO/scripts/validate/ai-visibility-reads-only.mjs" >> "$RUN_LOG" 2>&1 || { say "NAMED STOP [PERMISSIONS_NOT_READ_ONLY] the allow list is not the nine read tools; refusing to run."; exit 6; }

# Step 1: the context the session cannot fetch for itself (it has no file or web tools).
(cd "$REPO" && npm run --silent vault:run -- node scripts/ops/ai-visibility-report.mjs context "$WORK/context.txt" "$WORK/state.json") 2>&1 | tee -a "$RUN_LOG"
[ "${PIPESTATUS[0]}" -eq 0 ] && [ -s "$WORK/state.json" ] || { say "NAMED STOP [NO_CONTEXT] the sites' pages and lanes could not be read; the next run retries."; exit 13; }

say "=== AI answers read starting (ai-run --role $ROLE, $MODEL, ≤$MAX_TURNS turns) ==="
cd "$HOME" || { say "NAMED STOP [NO_HOME]"; exit 8; }
PROMPT_TEXT="$(cat "$PROMPT_FILE")

$(cat "$WORK/context.txt")"
ENABLE_CLAUDEAI_MCP_SERVERS=false AI_RUN_CLAUDE_MODEL="$MODEL" \
AI_RUN_CLAUDE_ARGS="--max-turns $MAX_TURNS --permission-mode dontAsk --setting-sources= --settings $SETTINGS" \
"$AI_RUN" --role "$ROLE" --network --cwd "$HOME" --out "$RUN_LOG" -- "$PROMPT_TEXT" >> "$RUN_LOG" 2>&1
RC=$?
say "=== ai-run --role $ROLE exited rc=$RC ==="

if ! has_sentinel "$RUN_LOG"; then
  if usage_exhausted "$RUN_LOG"; then say "NAMED STOP [AI_USAGE_EXHAUSTED] the reading session is out of usage; the next run retries."; echo "OUTPUT 0 sites_read"; exit 13; fi
  say "NAMED STOP [AI_VISIBILITY_DID_NOT_COMPLETE] no sentinel: the session never reached its end, so nothing it printed is a week."
  echo "OUTPUT 0 sites_read"
  exit 9
fi
say "sentinel: $(grep -oE 'AI-VISIBILITY-COMPLETE: sites=[0-9]+' "$RUN_LOG" | tail -1)"
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"

# Step 2: code reads the blocks, checks them against each site's own pages and posts the week.
(cd "$REPO" && npm run --silent vault:run -- node scripts/ops/ai-visibility-report.mjs post "$RUN_LOG" "$WORK/state.json") 2>&1 | tee -a "$RUN_LOG"
REPORT_RC=${PIPESTATUS[0]}
rm -rf "$WORK"
[ "$REPORT_RC" -eq 0 ] || { say "NAMED STOP [AI_VISIBILITY_REPORT] rc=$REPORT_RC — see the NAMED STOP lines above."; exit "$REPORT_RC"; }
exit 0
}

main "$@"; exit $?
