#!/bin/bash
# The Search Readiness fix queue, worked to EMPTY — one repository at a time (owner, 25 Oct 2026).
#
# Her question: "why can't all 242 be fixed now?" Nothing stopped it but the shape: the queue was
# read once a week by Danielle's Thursday repair run, inside one pass with a turn limit across every
# repo. So this job refreshes the queue, then runs ONE scoped pass of ahrefs-audit-fix.sh per repo
# (SR_SCOPE_REPO), re-audits, and goes round again until no workable brief is left or a round fixes
# nothing. Workable = names a repo and is not on a protected page. The Spry Labs download page
# (protected) and the no_repo briefs are what may be left, and the morning line says so in words.
#
# Weekly, Tuesday 07:30 Central, from Monday's 06:00 audit queue (owner, 25 Oct 2026): the schedule is the
# duty row duty_search_readiness_repair (migration 0305); launchd ticks daily and asks it. The status
# file it writes is what the next Monday email reads. By hand: bash scripts/ops/search-readiness-fix.sh
#
# UP TO THREE REPOS AT ONCE (owner via coordinator, 25 Oct 2026). One pass at a time took ~45 min
# per 10-brief chunk and ~24 chunks, about 18 hours. Different repos never collide: each pass cuts
# its own worktree in its own repo and (scoped) has its own lock and findings file in
# ahrefs-audit-fix.sh. So each round runs a worker per repo, at most SR_PARALLEL (3) at a time, and
# each worker runs that repo's chunks one after another, so one repo never has two passes at once.
# The 10-brief chunk, the per-pass PR and the land are unchanged.
#
# The whole body is a function called on the last line. Bash reads a script as it runs it; a file
# rewritten under a running copy (a pull of main mid-run) shifted the bytes under it. A function is
# parsed whole before it runs, so landing a change mid-run is safe for every copy started after this.
#
# RULE 0: it never exits 0 having done nothing it can explain. Every stop is a NAMED STOP line.
set -u
REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
MAX_ROUNDS="${SR_MAX_ROUNDS:-4}"
PARALLEL="${SR_PARALLEL:-3}"
LOG_DIR="$HOME/Library/Logs/boss-sr-fix"
STATUS="$HOME/.boss-os/search-readiness/fix-status.json"
mkdir -p "$LOG_DIR" "$(dirname "$STATUS")"
LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S).log"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
cd "$REPO" || { say "NAMED STOP [NO_REPO] $REPO"; exit 2; }

# One repo's chunks of this round, one pass after another (never two passes on one repo at once).
repo_worker() {
  local round="$1" r="$2" lines="$3" n ids rr
  while read -r rr n ids; do
    [ -n "$rr" ] || continue
    say "round $round: $rr ($n briefs)"
    SR_SCOPE_REPO="$rr" SR_SCOPE_BRIEFS="$ids" bash scripts/ops/ahrefs-audit-fix.sh >> "$LOG" 2>&1 < /dev/null
    say "  $rr pass exited rc=$?"
  done <<< "$lines"
}

# A pass from before this runner (one global lock, $AUDIT_LOCK) may still be working some repo.
# Its repo is not recorded, so wait for it rather than risk a second pass on the same repo.
wait_for_unscoped_pass() {
  local lock="$HOME/Library/Logs/ahrefs-audit-fix/.lock" waited=0
  while [ -f "$lock/pid" ] && kill -0 "$(cat "$lock/pid" 2>/dev/null)" 2>/dev/null; do
    [ "$waited" -eq 0 ] && say "waiting for the pass already running (pid $(cat "$lock/pid")) to finish before starting"
    waited=1; sleep 30
  done
}

main() {

  audit() { npm run --silent sites:audit >> "$LOG" 2>&1 || say "audit pass returned non-zero (see log); planning from the queue it left"; }
  plan() { node scripts/ops/search-readiness-audit.mjs --plan 2>>"$LOG"; }
  field() { sed -n "s/.*$1=\([0-9]*\).*/\1/p"; }

  wait_for_unscoped_pass
  audit
  P="$(plan)" || { say "NAMED STOP [NO_QUEUE] the audit left no fix queue to plan from"; exit 3; }
  START="$(echo "$P" | grep '^QUEUE' | field workable)"; START="${START:-0}"
  say "queue: $(echo "$P" | grep '^QUEUE')"
  LEFT="$START"
  for ROUND in $(seq 1 "$MAX_ROUNDS"); do
    # One pass per CHUNK (at most 10 briefs of one repo), so no pass runs out of turns before it lands.
    CHUNKS="$(echo "$P" | awk '/^CHUNK /{print $2" "$3" "$4}')"
    [ -n "$CHUNKS" ] || break
    BEFORE="$LEFT"
    # One worker per repo, in the plan's order (largest first, so the longest repo starts first),
    # at most $PARALLEL at a time. `jobs -rp` and a short sleep, not `wait -n`: /bin/bash on macOS
    # is 3.2, which has no `wait -n`.
    for R in $(echo "$CHUNKS" | awk '!seen[$1]++{print $1}'); do
      while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$PARALLEL" ]; do sleep 5; done
      repo_worker "$ROUND" "$R" "$(echo "$CHUNKS" | awk -v r="$R" '$1==r')" &
    done
    wait
    audit
    P="$(plan)" || break
    LEFT="$(echo "$P" | grep '^QUEUE' | field workable)"; LEFT="${LEFT:-$BEFORE}"
    say "after round $ROUND: $LEFT workable left (was $BEFORE)"
    [ "$LEFT" -lt "$BEFORE" ] || { say "round $ROUND fixed nothing; stopping until tomorrow rather than spinning"; break; }
  done

  Q="$(echo "$P" | grep '^QUEUE')"
  PROT="$(echo "$Q" | field protected)"; NOREPO="$(echo "$Q" | field no_repo)"
  FIXED=$(( START - LEFT )); [ "$FIXED" -ge 0 ] || FIXED=0
  node -e '
    const [status, started, fixed, left, prot, noRepo] = process.argv.slice(1);
    import(process.cwd() + "/src/shared/boss/searchReadiness/audit.mjs").then(async (m) => {
      const line = m.queueRunLine({ started: +started, fixed: +fixed, left: +left, protectedLeft: +prot, noRepo: +noRepo });
      const fs = await import("node:fs");
      fs.writeFileSync(status, JSON.stringify({ at: new Date().toISOString(), started: +started, fixed: +fixed, left: +left, protected: +prot, no_repo: +noRepo, line }, null, 2));
      console.log(line);
    });' "$STATUS" "$START" "$FIXED" "$LEFT" "${PROT:-0}" "${NOREPO:-0}" | tee -a "$LOG"
  say "SR-QUEUE-COMPLETE: started=$START fixed=$FIXED left=$LEFT protected=${PROT:-0} no_repo=${NOREPO:-0}"
  [ "$START" -gt 0 ] || say "NAMED STOP [QUEUE_EMPTY] nothing workable in the queue today; that is a result, not a skip."
  exit 0
}

main "$@"; exit $?
