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
# RULE 0: it never exits 0 having done nothing it can explain. Every stop is a NAMED STOP line.
set -u
REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
MAX_ROUNDS="${SR_MAX_ROUNDS:-4}"
LOG_DIR="$HOME/Library/Logs/boss-sr-fix"
STATUS="$HOME/.boss-os/search-readiness/fix-status.json"
mkdir -p "$LOG_DIR" "$(dirname "$STATUS")"
LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S).log"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
cd "$REPO" || { say "NAMED STOP [NO_REPO] $REPO"; exit 2; }

audit() { npm run --silent sites:audit >> "$LOG" 2>&1 || say "audit pass returned non-zero (see log); planning from the queue it left"; }
plan() { node scripts/ops/search-readiness-audit.mjs --plan 2>>"$LOG"; }
field() { sed -n "s/.*$1=\([0-9]*\).*/\1/p"; }

audit
P="$(plan)" || { say "NAMED STOP [NO_QUEUE] the audit left no fix queue to plan from"; exit 3; }
START="$(echo "$P" | grep '^QUEUE' | field workable)"; START="${START:-0}"
say "queue: $(echo "$P" | grep '^QUEUE')"
LEFT="$START"
for ROUND in $(seq 1 "$MAX_ROUNDS"); do
  REPOS="$(echo "$P" | awk '/^REPO /{print $2}')"
  [ -n "$REPOS" ] || break
  BEFORE="$LEFT"
  for R in $REPOS; do
    say "round $ROUND: $R ($(echo "$P" | awk -v r="$R" '$1=="REPO"&&$2==r{print $3}') briefs)"
    SR_SCOPE_REPO="$R" bash scripts/ops/ahrefs-audit-fix.sh >> "$LOG" 2>&1
    say "  $R pass exited rc=$?"
  done
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
