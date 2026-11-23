#!/bin/bash
# NOELLE, THE GROWTH DIRECTOR (plan artifact 8LfYgMaHj7XLVB1fJ1vYxM; brief ~/Work/tasks/noelle-rebuild-brief.md).
#
# launchd com.seq.boss-noelle ticks every 30 minutes through mac-window LIGHT (10:00-21:59 Central).
# Each tick asks scripts/ops/noelle.mjs `due` whether to run: once a day at today's slot (slotFor: a time
# between 10:00 and 20:58 that varies by day, never on the hour; Thursday after 14:00 is the weekly run),
# and never starting after 21:00. A run that stopped (out of Claude credits, a read that failed) is tried
# again by a tick two hours on, as its own slot, at most three times a day; else tomorrow's slot runs.
#
# THE STEPS (each in noelle.mjs, each through the vault):
#   context → her Claude session (ai-run --role brain: Claude only, never a free model) → plan (the
#   Worker re-checks every action) → act (P&P Studio: render on GitHub, a fresh reviewer per piece, one
#   remake, queue with idem_key) → done (notices, failures, calls).
#
# SHE HAS NO TOOLS. scripts/ops/noelle-permissions.json is the whole permission list: allow is empty,
# every built-in tool denied, the claude.ai connectors off, no plugin; `--setting-sources=` loads none of
# her own settings and `--strict-mcp-config` loads no MCP server. `npm run validate:noelle` fails the
# build on any change to that. Her only output is a JSON plan between two sentinels.
#
# RULE 0: every path prints an OUTPUT line or a NAMED STOP; nothing done is never exit 0, except a tick
# that is not due (WAIT), which says why.

set -uo pipefail

main() {

REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"
PROMPT_FILE="${NOELLE_PROMPT:-$REPO/scripts/ops/noelle-prompt.md}"
SETTINGS="$REPO/scripts/ops/noelle-permissions.json"
MODEL="${NOELLE_MODEL:-claude-opus-5}"
# No tools, so one turn writes the plan; two leave room for a model that thinks aloud first.
MAX_TURNS="${NOELLE_MAX_TURNS:-2}"
LOG_DIR="$HOME/Library/Logs/noelle"
RUNS="$HOME/.boss-os/noelle/runs"
LOCK="$LOG_DIR/.lock.flock"

mkdir -p "$LOG_DIR" "$RUNS"
DAY="${NOELLE_DAY:-$(TZ=America/Chicago date +%F)}"
NOW="${NOELLE_NOW:-$(TZ=America/Chicago date +%H:%M)}"
MARK="$RUNS/$DAY.json"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "${RUN_LOG:-$LOG_DIR/ticks.log}"; }
usage_exhausted() { grep -qiE "CLAUDE_LIMIT|usage limit|limit reached|out of (extra )?usage|credit balance" "$1"; }
step() { (cd "$REPO" && npm run --silent vault:run -- node scripts/ops/noelle.mjs "$@") 2>&1 | tee -a "$RUN_LOG"; return "${PIPESTATUS[0]}"; }

source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib/flock.sh"
LOCK_RC=0; hold_lock "$LOCK" || LOCK_RC=$?
case $LOCK_RC in
  0) ;;
  1) say "WAIT another run holds $LOCK"; exit 0 ;;
  *) say "NAMED STOP [LOCK_FAILED] cannot lock $LOCK"; exit 3 ;;
esac

DUE="$(node "$REPO/scripts/ops/noelle.mjs" due "$DAY" "$NOW" "$MARK")" || { say "NAMED STOP [NOELLE_DUE_FAILED] the tick could not read today's slot"; exit 3; }
case "$DUE" in
  WAIT*) say "$DUE"; exit 0 ;;
  RUN*) ;;
  *) say "NAMED STOP [NOELLE_DUE_FAILED] $DUE"; exit 3 ;;
esac
read -r _ SLOT KIND TRY RESUME <<< "$DUE"
RUN_LOG="$LOG_DIR/$DAY-${SLOT/:/}-$$.log"
WORK="$RUNS/$DAY-${SLOT/:/}"
mkdir -p "$WORK"
# Every end of a started run is recorded: on this Mac (the next tick reads it) and, before a plan, on Boss OS.
stopped() { # <code> <line> <exit>
  node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" stopped "$1" "$TRY"
  say "$2"
  step stop "$2" "$WORK" "$SLOT" >/dev/null || say "the stop could not be recorded on Boss OS (the 22:05 watch names a day with no run)"
  echo "OUTPUT 0 (stopped: $1)"
  exit "$3"
}

AI_RUN="${AI_RUN_BIN:-$HOME/bin/ai-run}"
[ -x "$AI_RUN" ] || stopped AI_RUN_MISSING "NAMED STOP [AI_RUN_MISSING] $AI_RUN is not installed (seq-bin)" 13
[ -f "$PROMPT_FILE" ] || stopped NO_PROMPT_FILE "NAMED STOP [NO_PROMPT_FILE] $PROMPT_FILE" 5
[ -s "$SETTINGS" ] || stopped NO_PERMISSIONS_FILE "NAMED STOP [NO_PERMISSIONS_FILE] her session never runs without its empty allow list" 6
case "$SETTINGS" in *[[:space:]]*) stopped PERMISSIONS_PATH_SPACE "NAMED STOP [PERMISSIONS_PATH_SPACE] '$SETTINGS' has a space, which ai-run would split" 6;; esac
[[ "$MAX_TURNS" =~ ^[1-9][0-9]*$ ]] || stopped BAD_MAX_TURNS "NAMED STOP [BAD_MAX_TURNS] NOELLE_MAX_TURNS='$MAX_TURNS'" 5
ROLE="$(node "$REPO/scripts/ops/lib/ai-run.mjs" role growth.noelle)" || stopped NO_AI_ROLE "NAMED STOP [NO_AI_ROLE] growth.noelle" 11
[ "$ROLE" = "brain" ] || stopped NOT_CLAUDE "NAMED STOP [NOT_CLAUDE] growth.noelle must be the brain role (Claude only), got $ROLE" 11
node "$REPO/scripts/validate/noelle-no-tools.mjs" >> "$RUN_LOG" 2>&1 || stopped PERMISSIONS_NOT_EMPTY "NAMED STOP [PERMISSIONS_NOT_EMPTY] her session would have tools; refusing to run" 6

say "=== Noelle $KIND run, slot $SLOT, try $TRY${RESUME:+ (resume)} ==="
CTX_ARGS=("$WORK"); [ "$KIND" = "weekly" ] && CTX_ARGS+=(weekly)
step context "${CTX_ARGS[@]}" || stopped NO_CONTEXT "NAMED STOP [NO_CONTEXT] the reads could not be gathered; $(grep -h 'NAMED STOP' "$RUN_LOG" | tail -1)" 13
[ -s "$WORK/context.txt" ] || stopped NO_CONTEXT "NAMED STOP [NO_CONTEXT] the context step wrote nothing" 13

export NOELLE_AI_RUN="$AI_RUN" NOELLE_ROLE="$ROLE" NOELLE_MODEL="$MODEL" NOELLE_SETTINGS="$SETTINGS"
PROMPT_TEXT="$(cat "$PROMPT_FILE")

$(cat "$WORK/context.txt")"
PLAN_LOG="$WORK/plan.log"
cd "$HOME" || stopped NO_HOME "NAMED STOP [NO_HOME]" 8
ENABLE_CLAUDEAI_MCP_SERVERS=false AI_RUN_CLAUDE_MODEL="$MODEL" \
AI_RUN_CLAUDE_ARGS="--max-turns $MAX_TURNS --permission-mode dontAsk --setting-sources= --settings $SETTINGS --strict-mcp-config" \
"$AI_RUN" --role "$ROLE" --network --cwd "$HOME" --out "$PLAN_LOG" -- "$PROMPT_TEXT" >> "$RUN_LOG" 2>&1
RC=$?
say "=== her session (ai-run --role $ROLE, $MODEL) exited rc=$RC ==="
if [ "$RC" -eq 76 ] || { [ -f "$PLAN_LOG" ] && ! grep -q "NOELLE-PLAN-END" "$PLAN_LOG" && usage_exhausted "$RUN_LOG"; }; then
  stopped CLAUDE_LIMIT "NAMED STOP [CLAUDE_LIMIT] out of Claude credits before her plan; $(node -e 'import("'"$REPO"'/scripts/ops/noelle.mjs").then(m=>console.log(m.RESUME_WORDS))')" 76
fi
grep -q "NOELLE-PLAN-END" "$PLAN_LOG" 2>/dev/null || stopped NO_PLAN "NAMED STOP [NO_PLAN] her session ended (rc=$RC) without a plan between the sentinels" 9

# plan: the Worker re-checks it. Exit 10 is a replay of a slot already planned: nothing is acted twice.
step plan "$PLAN_LOG" "$WORK" "$SLOT"; PRC=$?
if [ "$PRC" -eq 10 ]; then node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" done REPLAY "$TRY"; echo "OUTPUT 0 (replay of $SLOT)"; exit 0; fi
[ "$PRC" -eq 0 ] || stopped PLAN_REFUSED "NAMED STOP [PLAN_REFUSED] rc=$PRC $(grep -h 'NAMED STOP' "$RUN_LOG" | tail -1)" "$PRC"

# act, then done ALWAYS (a stopped act still reports what it queued and what failed).
step act "$WORK"; ARC=$?
step done "$WORK"; DRC=$?
if [ "$ARC" -eq 76 ]; then
  node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" stopped CLAUDE_LIMIT "$TRY"
  say "NAMED STOP [CLAUDE_LIMIT] the run stopped part-way; $(grep -h 'OUTPUT' "$RUN_LOG" | tail -2 | tr '\n' ' ')"
  exit 76
fi
[ "$DRC" -eq 0 ] || { node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" stopped DONE_FAILED "$TRY"; say "NAMED STOP [DONE_FAILED] rc=$DRC"; exit "$DRC"; }
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"
# 9 (nothing to render) and 12 (calendar not read) are recorded stops on the run, not a broken job. Any
# other act failure is retried by a later tick (its queued pieces are dropped then as taken days).
case "$ARC" in
  0|9|12) node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" done "" "$TRY"; exit 0 ;;
  *) node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" stopped "ACT_FAILED" "$TRY"; say "NAMED STOP [ACT_FAILED] rc=$ARC"; exit "$ARC" ;;
esac
}

main "$@"; exit $?
