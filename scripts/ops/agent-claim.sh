#!/bin/bash
# Ask Boss OS whether a run is waiting for this Mac, and take it. ONE place, so the fixed-time job and the
# five-minute poll can never run two copies at once.
#
#   agent-claim.sh                      claim now (the fixed-time job: six slots a day, any hour)
#   agent-claim.sh --waking-hours-only  claim only between 06:00 and 22:00 local (the five-minute poll)
#
# ─── Why this exists (1 Oct 2026) ───────────────────────────────────────────
#
# "why is there a 18:35 check? if i press the button to run on demand?" The Run-now button queues a task in the
# cloud; the cloud cannot push work to this Mac, so the Mac has to ask. It asked six times a day, so a run queued
# at 14:00 waited until 18:35. The poll below asks every five minutes in the waking day, which is what makes the
# button mean "now".
#
# ─── Why it is not the 96-a-day runaway the installer's comment warns about ──
#
# That runaway (migration 0172) was a Worker cron WRITING a snapshot on every tick, so the database grew with each
# run. An idle check here makes three requests (unlock, then one claim per seat) and WRITES NOTHING: the claim
# route writes only when it actually claims. It is bounded to the waking day, and it never overlaps.
#
# ─── Never two at once ──────────────────────────────────────────────────────
#
# A briefing can run for fifteen minutes. Without a lock the next five-minute tick would start a second agent, and a
# second Claude Code or Codex session on the same Mac while the first works. A directory is the lock (mkdir is
# atomic) and it records the PID of its holder: a lock whose holder is no longer alive is a crash, not a run, and is
# taken over rather than blocking claims for ever. A copy that finds a live holder exits at once and silently.
#
# BOSS_OS_CLAIM_HOUR overrides the clock for the hour guard, so the guard is testable on any machine at any time.
set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOCK_DIR="${BOSS_OS_HOME:-$HOME/.boss-os}/agent-claim.lock"

if [ "${1:-}" = "--waking-hours-only" ]; then
  hour="${BOSS_OS_CLAIM_HOUR:-$(date +%H)}"
  hour=$((10#$hour))
  if [ "$hour" -lt 6 ] || [ "$hour" -ge 22 ]; then
    exit 0
  fi
fi

mkdir -p "$(dirname "$LOCK_DIR")"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    exit 0                      # a claim is already running; this tick has nothing to add
  fi
  rm -rf "$LOCK_DIR"            # the holder is gone: a crash left the lock behind
  mkdir "$LOCK_DIR" 2>/dev/null || exit 0
fi
echo "$$" > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT

cd "$REPO" && npm run --silent vault:run -- node scripts/sync-agent/agent.mjs work-once
