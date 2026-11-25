#!/bin/bash
# NOELLE, THE DIRECTOR OF GROWTH (24 Nov 2026, her words: "go - scheduled job that wakes up as a full agent";
# brief ~/Work/tasks/noelle-builds-brief.md). What wakes is full Claude Code as Noelle (scripts/ops/noelle/persona.md
# on top of the whole rules file), working in her own home ~/Work/noelle (her working directory is the run folder:
# the sandbox refuses .git/hooks and .git/config under it, which would stop every clone), with builder-level tools, the skills (read by
# path) and one fresh `reviewer` per PR she opens. Her run is SANDBOXED and LOCKED (redesign 24 Nov 2026: safety by
# taking access away): --permission-mode dontAsk --setting-sources= --settings ~/.boss-os/noelle/settings.json
# (scripts/ops/noelle-permissions.json, filled in by lib/noelle-sandbox.sh), so none of Sequoia's own settings load,
# Claude Code's OS sandbox holds every command she runs (writes only in ~/Work/noelle and her run folder, home reads
# denied, network only to her hosts), and her GitHub writes go through the credentialed broker. Her guard
# (scripts/ops/noelle-guard.mjs) holds only what is judged by name: one reviewer per PR, 3 PRs, the handoff, land.
#
# launchd com.seq.boss-noelle ticks every 30 minutes, 10:00-22:59 Central (mac-window ANY holds 07:00-09:59):
#   - a call from Sequoia (her email to boss@ that passed the owner check, or her message on Noelle's Boss OS
#     page) is claimed on the next tick from 10:00 to 22:59: answered within 30 minutes (H3c). Outside that the
#     Worker has already told her "Noelle is on it at 10:00 Central";
#   - otherwise her daily run starts once at today's slot (slotFor: 10:00-20:58, Thursday after 14:00 is the
#     weekly run), never after 21:00; a stopped run is retried two hours on, at most three times a day.
# One run at a time (the lock); 200 turns; at ~200K context she writes her handoff and ends (her guard).
#
# A Claude usage limit stops scheduled work and releases an owner call to the existing answer ladder.
# The ladder answers on Workers AI or Gemini. A later scheduled tick can resume the build on Claude.
#
# RULE 0: her last line `OUTPUT: <n> done …` or `NAMED STOP [CODE]` decides (noelle.mjs finish); nothing done is
# never exit 0, except a tick that is not due (WAIT/HELD), which says why.

set -uo pipefail

main() {

REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"
NHOME="${NOELLE_HOME:-$HOME/Work/noelle}"
GUARD="$REPO/scripts/ops/noelle-guard.mjs"
MODEL="${NOELLE_MODEL:-claude-opus-5}"
MAX_TURNS="${NOELLE_MAX_TURNS:-200}"
LOG_DIR="$HOME/Library/Logs/noelle"
RUNS="$HOME/.boss-os/noelle/runs"
LOCK="$LOG_DIR/.lock.flock"

mkdir -p "$LOG_DIR" "$RUNS"
DAY="${NOELLE_DAY:-$(TZ=America/Chicago date +%F)}"
NOW="${NOELLE_NOW:-$(TZ=America/Chicago date +%H:%M)}"
MARK="$RUNS/$DAY.json"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "${RUN_LOG:-$LOG_DIR/ticks.log}"; }
step() { (cd "$REPO" && npm run --silent vault:run -- node scripts/ops/noelle.mjs "$@") 2>&1 | tee -a "$RUN_LOG"; return "${PIPESTATUS[0]}"; }
local_step() { node "$REPO/scripts/ops/noelle.mjs" "$@" 2>&1 | tee -a "$RUN_LOG"; return "${PIPESTATUS[0]}"; }

source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib/flock.sh"
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib/claude-lock.sh"
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib/noelle-sandbox.sh"
LOCK_RC=0; hold_lock "$LOCK" || LOCK_RC=$?
case $LOCK_RC in
  0) ;;
  1) say "WAIT another Noelle run holds $LOCK (one run at a time)"; exit 0 ;;
  *) say "NAMED STOP [LOCK_FAILED] cannot lock $LOCK"; exit 3 ;;
esac

DUE="$(node "$REPO/scripts/ops/noelle.mjs" due "$DAY" "$NOW" "$MARK")" || { say "NAMED STOP [NOELLE_DUE_FAILED] the tick could not read today's slot"; exit 3; }
case "$DUE" in
  HELD*) say "${DUE#HELD }"; exit 0 ;;
  WAIT*|RUN*) ;;
  *) say "NAMED STOP [NOELLE_DUE_FAILED] $DUE"; exit 3 ;;
esac

# A call from Sequoia goes first: one call, one run, one reply. A failed claim never blocks the schedule.
CALL=""
if [ -z "${NOELLE_NO_CALLS:-}" ] && [ "$(node "$REPO/scripts/ops/noelle.mjs" window "$NOW")" = "OPEN" ]; then
  CLAIM="$( (cd "$REPO" && npm run --silent vault:run -- node scripts/ops/noelle.mjs call-claim "$RUNS") 2>&1 | tail -1)"
  case "$CLAIM" in
    CALL\ *) read -r _ SLOT WORK <<< "$CLAIM"; CALL=1; KIND=daily; TRY=1; RESUME=""; MARK="$WORK/mark.json" ;;
    NONE) ;;
    *) say "the call check failed (the schedule carries on): $CLAIM" ;;
  esac
fi
if [ -z "$CALL" ]; then
  case "$DUE" in WAIT*) say "$DUE"; exit 0 ;; esac
  read -r _ SLOT KIND TRY RESUME <<< "$DUE"
  WORK="$RUNS/$DAY-${SLOT/:/}"
fi
RUN_LOG="$LOG_DIR/$DAY-${SLOT//:/}-$$.log"
mkdir -p "$WORK"
NOELLE_RUN_ID="noelle-${WORK##*/}-$TRY"; export NOELLE_RUN_ID

# Every end of a started run is recorded: on this Mac (the next tick reads it) and on Boss OS.
stopped() { # <code> <line> <exit>
  node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" stopped "$1" "$TRY"
  say "$2"
  step stop "$2" "$SLOT" "$KIND" >/dev/null || say "the stop could not be recorded on Boss OS (the 22:05 watch names a day with no run)"
  [ -n "$CALL" ] && { step call-release "$WORK" "$2" || say "the call could not be released; the next claim returns it after 3 hours [CALL_RUN_LOST]"; }
  echo "OUTPUT 0 (stopped: $1)"
  exit "$3"
}

AI_RUN="${AI_RUN_BIN:-$HOME/bin/ai-run}"
[ -x "$AI_RUN" ] || stopped AI_RUN_MISSING "NAMED STOP [AI_RUN_MISSING] $AI_RUN is not installed (seq-bin)" 13
[[ "$MAX_TURNS" =~ ^[1-9][0-9]*$ ]] || stopped BAD_MAX_TURNS "NAMED STOP [BAD_MAX_TURNS] NOELLE_MAX_TURNS='$MAX_TURNS'" 5
case "$NHOME$WORK" in *[[:space:]]*) stopped PATH_SPACE "NAMED STOP [PATH_SPACE] her home or run folder has a space, which ai-run would split" 6;; esac
ROLE="$(node "$REPO/scripts/ops/lib/ai-run.mjs" role growth.noelle)" || stopped NO_AI_ROLE "NAMED STOP [NO_AI_ROLE] growth.noelle" 11
[ "$ROLE" = "brain" ] || stopped NOT_CLAUDE "NAMED STOP [NOT_CLAUDE] growth.noelle must be the brain role (Claude), got $ROLE" 11
# Her guard proves itself before every run: a guard that lets a hard stop through means no run.
node "$GUARD" --self-test >> "$RUN_LOG" 2>&1 || stopped GUARD_BROKEN "NAMED STOP [GUARD_BROKEN] her guard's self-test failed; she does not run without it" 6

# Her sandbox, rebuilt from the repo every run, in ~/.boss-os/noelle where her run can neither write nor read it
# (lib/noelle-sandbox.sh): the settings with the sandbox block, her gitconfig, her two brokers and her guard's state.
SETTINGS="$(noelle_prepare "$REPO" "$NHOME" "$WORK" "$NOELLE_RUN_ID" 2>>"$RUN_LOG")" || stopped NO_SETTINGS "NAMED STOP [NO_SETTINGS] her sandboxed settings could not be written; $(grep -h 'NAMED STOP' "$RUN_LOG" | tail -1)" 6
CLAUDE_LOCK="$(claude_lock_args "$SETTINGS" 2>>"$RUN_LOG")" || stopped NO_PERMISSIONS_FILE "NAMED STOP [NO_PERMISSIONS_FILE] her permissions file could not be used; she never runs unlocked" 6
# No GitHub credential reaches her run (owner, 24 Nov 2026: "u do it why do u need me for any of this?"): inside her
# sandbox git and gh are logged out. She pushes and opens PRs only through noelle-tool push-branch / open-pr, outside it.
unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN

say "=== Noelle ${CALL:+called }$KIND run, slot $SLOT, try $TRY${RESUME:+ (resume)} ==="
export NOELLE_HOME="$NHOME" NOELLE_REPO="$REPO" NOELLE_GUARD_DIR="$HOME/.boss-os/noelle/guard"
if ! local_step persona "$WORK"; then
  WHY="$(grep -h 'NAMED STOP' "$RUN_LOG" | tail -1)"
  case "$WHY" in
    *'[OWNER_NOTES_UNREAD]'*) stopped OWNER_NOTES_UNREAD "$WHY" 6 ;;
    *) stopped NO_PERSONA "$WHY" 6 ;;
  esac
fi

if [ -n "$CALL" ]; then
  KICK="This is a light wake. Use the owner notes, handoff and the relevant playbook, then reply and rewrite the handoff."
else
  step reads "$WORK" || stopped NO_READS "NAMED STOP [NO_READS] her reads could not be gathered; $(grep -h 'NAMED STOP' "$RUN_LOG" | tail -1)" 13
  KICK="This is your $KIND run. Use the owner notes, handoff, latest note, playbooks and today's summary. Rewrite the handoff when you end."
fi

SESSION_LOG="$WORK/session.log"
SID="$(uuidgen | tr 'A-Z' 'a-z')" || stopped NO_SESSION_ID "NAMED STOP [NO_SESSION_ID] uuidgen failed" 6
ENABLE_CLAUDEAI_MCP_SERVERS=false AI_RUN_CLAUDE_MODEL="$MODEL" \
AI_RUN_CLAUDE_ARGS="$CLAUDE_LOCK --strict-mcp-config --session-id $SID --max-turns $MAX_TURNS --output-format json --agents $WORK/agents.json --append-system-prompt-file $WORK/persona-full.md" \
"$AI_RUN" --role "$ROLE" --network --cwd "$WORK" --out "$SESSION_LOG" -- "$KICK" >> "$RUN_LOG" 2>&1
RC=$?
say "=== her session (Claude, $MODEL) exited rc=$RC ==="
# Every refusal by her list, counted from her own transcript: a number or "unknown" is a stop, never 0.
DENIED="$(claude_denials "$SID" "$RUN_LOG")"

FINISH_MODE=""
[ "$RC" -ne 76 ] || FINISH_MODE="usage-limited"
step finish "$WORK" "$SESSION_LOG" "$SLOT" "$KIND" "$DENIED" "$FINISH_MODE"; FRC=$?
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"
[ -n "$CALL" ] && exit "$FRC"
case "$FRC" in
  0) node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" "done" "" "$TRY"; exit 0 ;;
  6) node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" stopped SAME_FAILURE_TWICE 3; exit 6 ;;
  *) node "$REPO/scripts/ops/noelle.mjs" mark "$MARK" stopped RUN_STOPPED "$TRY"; exit "$FRC" ;;
esac
}

main "$@"; exit $?
