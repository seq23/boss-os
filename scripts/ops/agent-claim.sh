#!/bin/bash
# Ask Boss OS whether a run is waiting for this Mac, and take it. ONE place, so the fixed-time job and the
# five-minute poll can never run two copies at once.
#
#   agent-claim.sh         claim now (the fixed-time job: six slots a day, any hour; its own chain has already refreshed the data)
#   agent-claim.sh --poll  the five-minute poll: only 06:00-22:00 local; peek first; refresh the briefing's data only if work is
#                          waiting; then claim
#
# ─── Why this exists (1 Oct 2026) ───────────────────────────────────────────
#
# "why is there a 18:35 check? if i press the button to run on demand?" The Run-now button queues a task in the
# cloud; the cloud cannot push work to this Mac, so the Mac has to ask. It asked six times a day, so a run queued
# at 14:00 waited until 18:35. The poll asks every five minutes in the waking day, which is what makes the button
# mean "now".
#
# ─── Why it is not the 96-a-day runaway the installer's comment warns about ──
#
# That runaway (migration 0172) was a Worker cron WRITING a snapshot on every tick. An idle poll here is `peek`: one
# unlock and one READ, no writes, and NOTHING fetched from any feed. Only when a run is actually waiting does it
# refresh the market and sky files (exactly as the fixed-time chain does before every claim) and claim.
#
# ─── The briefing's data is fresh before the claim (review of #61) ──────────
#
# The fixed job runs sky-snapshot and market-snapshot before it claims, and the briefing prompt reads SKY.json and
# MARKETS.json. A poll that claimed the 06:00 briefing without them would write it from yesterday's files. So the poll
# peeks, and if something is waiting refreshes both before claiming. A file written in the last ten minutes is not
# refetched, which bounds feed traffic if an unclaimable run is ever stuck waiting.
#
# ─── Never two at once, and the lock is ownership-safe (review of #61) ──────
#
# A briefing can run for fifteen minutes; a second Claude Code or Codex session on the same Mac while the first works is
# the failure. The lock is a directory holding "<pid>|<process start time>" (the start time guards against a reused PID).
# EVERY change to the lock happens inside a short-lived GATE directory, so two contenders cannot interleave a check with a
# removal: a contender that finds a dead or empty lock takes it over INSIDE the gate, where nobody else is looking, and
# the release removes the lock only if it is still its own. A gate left by a process that died inside it expires after a
# minute. (Residual: two contenders that both arrive more than a minute after a crash mid-gate could each clear the stale
# gate; that needs a crash inside a few-millisecond window and a simultaneous pair. The cost would be one overlap, not a loss.)
#
# BOSS_OS_CLAIM_HOUR overrides the clock for the hour guard, so the guard is testable on any machine at any time.
set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOCK_DIR="${BOSS_OS_HOME:-$HOME/.boss-os}/agent-claim.lock"
GATE_DIR="$LOCK_DIR.gate"
WORKSPACE="${BOSS_OS_REPORT_WORKSPACE:-$HOME/.boss-os/reports}"
FRESH_MINUTES=10

mode="fixed"
[ "${1:-}" = "--poll" ] && mode="poll"

if [ "$mode" = "poll" ]; then
  hour="${BOSS_OS_CLAIM_HOUR:-$(date +%H)}"
  hour=$((10#$hour))
  if [ "$hour" -lt 6 ] || [ "$hour" -ge 22 ]; then
    exit 0
  fi
fi

started_of() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//;s/ *$//'; }

# Is the holder recorded in the lock still the process that wrote it? An empty or unreadable record is NOT alive.
holder_alive() {
  local rec pid started
  rec="$(cat "$LOCK_DIR/holder" 2>/dev/null || true)"
  pid="${rec%%|*}"
  started="${rec#*|}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [ -z "$started" ] && return 0
  [ "$(started_of "$pid")" = "$started" ]
}

have_gate=0
have_lock=0
release() {
  [ "$have_gate" = 1 ] && rmdir "$GATE_DIR" 2>/dev/null
  if [ "$have_lock" = 1 ]; then
    # Remove the lock only if it is still ours.
    rec="$(cat "$LOCK_DIR/holder" 2>/dev/null || true)"
    [ "${rec%%|*}" = "$$" ] && rm -rf "$LOCK_DIR"
  fi
}
trap release EXIT

mkdir -p "$(dirname "$LOCK_DIR")"

# Take the gate: wait briefly for another contender's few-millisecond critical section.
for _ in $(seq 1 30); do
  if mkdir "$GATE_DIR" 2>/dev/null; then have_gate=1; break; fi
  sleep 0.1
done
if [ "$have_gate" != 1 ]; then
  # A gate older than a minute belongs to a process that died inside it.
  if [ -n "$(find "$GATE_DIR" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
    rm -rf "$GATE_DIR"
    mkdir "$GATE_DIR" 2>/dev/null && have_gate=1
  fi
fi
[ "$have_gate" = 1 ] || exit 0

# INSIDE THE GATE: acquire, taking over a dead or empty lock. No one else can look at or change the lock until the gate is released.
if mkdir "$LOCK_DIR" 2>/dev/null; then
  have_lock=1
elif holder_alive; then
  :                              # a claim is already running; this tick has nothing to add
else
  rm -rf "$LOCK_DIR"             # the holder is gone (or never wrote itself down): a crash left the lock behind
  mkdir "$LOCK_DIR" 2>/dev/null && have_lock=1
fi
if [ "$have_lock" = 1 ]; then
  echo "$$|$(started_of $$)" > "$LOCK_DIR/holder"
fi
rmdir "$GATE_DIR" 2>/dev/null && have_gate=0
[ "$have_lock" = 1 ] || exit 0

cd "$REPO" || exit 0

if [ "$mode" = "poll" ]; then
  # Is anything waiting? 0 = yes. Anything else (nothing waiting, an older Worker, an error) = do nothing this tick.
  npm run --silent vault:run -- node scripts/sync-agent/agent.mjs peek >/dev/null 2>&1 || exit 0

  # Something is waiting: refresh the briefing's data before the claim, as the fixed-time chain does. A file written in the last
  # FRESH_MINUTES is not refetched. `;` between the steps: a failing snapshot must not stop the claim.
  if [ -z "$(find "$WORKSPACE/SKY.json" -mmin -"$FRESH_MINUTES" 2>/dev/null)" ]; then
    npm run --silent vault:run -- node scripts/ops/sky-snapshot.mjs
  fi
  if [ -z "$(find "$WORKSPACE/MARKETS.json" -mmin -"$FRESH_MINUTES" 2>/dev/null)" ]; then
    node scripts/ops/market-snapshot.mjs
  fi
fi

npm run --silent vault:run -- node scripts/sync-agent/agent.mjs work-once
