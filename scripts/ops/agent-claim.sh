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
# ─── Never two at once: a lock the KERNEL holds (22 Nov 2026) ─────────────────
#
# A briefing can run for fifteen minutes; a second Claude Code or Codex session on the same Mac while the first works is
# the failure. The lock is flock(2) on one file, through scripts/ops/lib/flock.sh, the one lock every scripts/ops job
# shares: a tick that finds it held exits silently; a small holder process owns the only open file and lets go the
# moment this shell ends, however it ends (normal exit: at once, through `release_lock`; crash or kill -9: within a
# second). Nothing is left behind to judge stale, so there is no holder record, no PID file, no start stamp and no
# takeover. No child of the run ever has the file open, so a process a run leaves behind cannot hold every later tick out.
#
# Why not `mkdir` any more: the lock was a directory made with the `mkdir` BINARY, which is only a mutex if that binary
# is one atomic mkdir(2). The ubuntu-26.04 runners ship uutils coreutils (`mkdir (uutils coreutils) 0.10.0`), which
# checks for the path and then creates it, so several racers all "win": 8 bare `mkdir` racers on one path had 2-6
# winners in 14 of 800 runs there, and this lock let two claims run at once (main CI 21 Nov 2026, run 44989669473,
# "two claims ran at the same moment", green on a rerun). Every earlier patch here (the gate, the holder stamp, the
# reused-PID guard) sat on that one assumption. #506 moved this file to flock(2) on its own fd 9; that lock now lives
# in the shared library, so there is one lock and one set of tests for it (tests/opsFlock.test.ts).
#
# BOSS_OS_CLAIM_HOUR overrides the clock for the hour guard, so the guard is testable on any machine at any time.
set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
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

LOCK_FILE="${BOSS_OS_HOME:-$HOME/.boss-os}/agent-claim.flock"
# shellcheck source=lib/flock.sh
. "$REPO/scripts/ops/lib/flock.sh"
LOCK_RC=0; hold_lock "$LOCK_FILE" || LOCK_RC=$?
case $LOCK_RC in
  0) trap release_lock EXIT ;;   # ours until this shell exits
  1) exit 0 ;;                   # a claim is already running; this tick has nothing to add
  *) echo "agent-claim: NAMED STOP [CLAIM_LOCK_UNAVAILABLE] could not take the lock on $LOCK_FILE; no claim this tick." >&2
     exit 3 ;;
esac

cd "$REPO" || exit 0

if [ "$mode" = "poll" ]; then
  # Is anything waiting? 0 = yes. Anything else (nothing waiting, an older Worker, an error) = do nothing this tick.
  # THE SERVICE PASS (docs/SERVICE_RULES.md, 6 Oct 2026): keys she emailed into the vault, DNS records
  # re-checked, Drive folders loaded. Cheap (a few HTTP calls), so it runs on every poll tick BEFORE the
  # peek, whether or not a run is waiting, and its outcome never stops the claim. Logged, never silent.
  npm run --silent vault:run -- node scripts/ops/service-tick.mjs >>"${BOSS_OS_HOME:-$HOME/.boss-os}/service-tick.log" 2>&1 || true

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

# PROPERTIES.json for the backlink prospecting run (13 Nov 2026: nothing ever wrote it, so every run
# was "blocked: missing PROPERTIES.json" and delivered zero rows). Rewritten when it is over a day old;
# `;` so a failed snapshot never stops the claim (the run then says what it is missing, and its floor fails it).
if [ -z "$(find "${BOSS_OS_LINKS_WORKSPACE:-$HOME/.boss-os/links}/PROPERTIES.json" -mmin -1440 2>/dev/null)" ]; then
  npm run --silent vault:run -- node scripts/ops/properties-snapshot.mjs >>"${BOSS_OS_HOME:-$HOME/.boss-os}/properties-snapshot.log" 2>&1 || true
fi

npm run --silent vault:run -- node scripts/sync-agent/agent.mjs work-once
