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
STATE_DIR="$HOME/.boss-os/search-readiness"
STATUS="$STATE_DIR/fix-status.json"
# THE RUN RESUMES BY ITSELF (25 Oct 2026). A network outage stopped every pass at 18:20 that day, the
# run ended "fixed=0 left=316" with exit 0, and nothing restarted it until a person did at 20:10.
# MARK says "a run is unfinished" from the moment one starts until it reaches its end; RUN_LOCK holds
# the pid of the live one. com.seq.boss-sr-resume (install-agent-launchd.sh) is a launchd KeepAlive on
# MARK's path: while MARK exists launchd runs `--resume-if-unfinished` at most every 15 minutes, which
# resumes a run whose pid is dead (clearing its stale lock) and never starts a second beside a live one.
MARK="$STATE_DIR/run-unfinished.json"
RUN_LOCK="$STATE_DIR/run.lock"
mkdir -p "$LOG_DIR" "$STATE_DIR"
LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S).log"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
cd "$REPO" || { say "NAMED STOP [NO_REPO] $REPO"; exit 2; }
# shellcheck source=lib/net-wait.sh
source "$REPO/scripts/ops/lib/net-wait.sh"

# One repo's chunks of this round, one pass after another (never two passes on one repo at once).
# Each pass's exit code goes to $RCS, so a pass that lost the network (13) is told apart from one
# that fixed nothing.
repo_worker() {
  local round="$1" r="$2" lines="$3" n ids rr rc
  while read -r rr n ids; do
    [ -n "$rr" ] || continue
    say "round $round: $rr ($n briefs)"
    SR_SCOPE_REPO="$rr" SR_SCOPE_BRIEFS="$ids" bash scripts/ops/ahrefs-audit-fix.sh >> "$LOG" 2>&1 < /dev/null
    rc=$?
    say "  $rr pass exited rc=$rc"
    echo "$rr $rc" >> "$RCS"
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

mark_field() { [ -f "$MARK" ] && sed -n "s/.*\"$1\": *\"\{0,1\}\([^\",}]*\).*/\1/p" "$MARK" | head -1; }
mark() {
  printf '{"pid": %s, "started": "%s", "reason": "%s", "reported": "%s", "log": "%s"}\n' \
    "$$" "${RUN_STARTED:-$(date +%Y-%m-%dT%H:%M:%S)}" "$1" "${REPORTED:-}" "$LOG" > "$MARK.tmp" && mv "$MARK.tmp" "$MARK"
}

# The launchd KeepAlive entry point. Cheap and local: a file test and a kill -0, nothing on the network.
resume_if_unfinished() {
  local pid old rc
  [ -f "$MARK" ] || { say "resume check: no unfinished Search Readiness run"; return 0; }
  pid="$(cat "$RUN_LOCK/pid" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    say "resume check: the run is alive (pid $pid); not starting a second one"; return 0
  fi
  if [ -d "$RUN_LOCK" ]; then say "resume check: stale run lock (pid ${pid:-none} is dead); clearing it"; rm -rf "$RUN_LOCK"; fi
  old="$(mark_field pid)"
  say "resume check: unfinished run found (pid ${old:-?} is gone, last state: $(mark_field reason)); resuming it"
  # Through duty-run.sh, so her pause on the employee page is honoured and D1 hears the outcome.
  bash scripts/ops/duty-run.sh search-readiness-fix.sh -- bash scripts/ops/search-readiness-fix.sh --resume
  rc=$?
  if [ -f "$MARK" ] && [ "$(mark_field pid)" = "$old" ]; then
    # The run never started (the duty is paused or removed): stop asking, say so once.
    say "NAMED STOP [RESUME_NOT_STARTED] duty-run did not start the run (rc=$rc; the duty may be paused); the unfinished mark is cleared so this does not repeat. See $LOG_DIR/../boss-duty/."
    rm -f "$MARK"
  fi
  return "$rc"
}

take_run_lock() {
  local pid
  if ! mkdir "$RUN_LOCK" 2>/dev/null; then
    pid="$(cat "$RUN_LOCK/pid" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then say "NAMED STOP [ALREADY_RUNNING] pid $pid"; exit 0; fi
    say "stale run lock (pid ${pid:-none} is dead); reclaiming"; rm -rf "$RUN_LOCK"
    mkdir "$RUN_LOCK" 2>/dev/null || { say "NAMED STOP [NO_RUN_LOCK] $RUN_LOCK"; exit 3; }
  fi
  echo $$ > "$RUN_LOCK/pid"
  trap 'rm -rf "$RUN_LOCK" "${RCS:-}"' EXIT
}

# Each stop with work left is reported ONCE (per stop code, across resumes) to the repair path.
report_stop() {
  local code="$1" sentence="$2"
  if [ "${REPORTED:-}" = "$code" ]; then say "  (already reported to Danielle: $code)"; return 0; fi
  if npm run --silent vault:run -- node scripts/ops/sr-run-stopped.mjs "$code" "$sentence" >> "$LOG" 2>&1; then
    REPORTED="$code"; say "  reported to Danielle's repair desk: $code"
  else
    say "  NAMED STOP [SR_STOP_NOT_REPORTED] Boss OS was not told about $code; the next resume tries again (see log)."
  fi
}

# The network stayed down past the whole wait: the run is UNFINISHED, not over. The mark stays,
# the stop is reported, and the KeepAlive tick resumes it.
stop_unfinished() {
  say "NAMED STOP [$1] $2"
  mark "$1"
  report_stop "$1" "$2"
  mark "$1"
  exit 13
}
net_gate() {
  wait_for_network "$1" || stop_unfinished NETWORK_UNREACHABLE "api.github.com did not answer for ${SR_NET_WAIT_MAX_S:-7200}s ($1). This is the network, not the gh login; the run resumes by itself within 15 minutes of the network coming back."
}

main() {
  if [ "${1:-}" = "--resume-if-unfinished" ]; then resume_if_unfinished; return $?; fi
  take_run_lock
  REPORTED="$(mark_field reported)"
  [ "${1:-}" = "--resume" ] && say "resuming an unfinished run (last state: $(mark_field reason))"
  RUN_STARTED="$(date +%Y-%m-%dT%H:%M:%S)"
  mark running
  RCS="$LOG_DIR/.rcs-$$"

  audit() { net_gate "the audit"; npm run --silent sites:audit >> "$LOG" 2>&1 || say "audit pass returned non-zero (see log); planning from the queue it left"; }
  plan() { node scripts/ops/search-readiness-audit.mjs --plan 2>>"$LOG"; }
  field() { sed -n "s/.*$1=\([0-9]*\).*/\1/p"; }

  wait_for_unscoped_pass
  audit
  P="$(plan)" || { say "NAMED STOP [NO_QUEUE] the audit left no fix queue to plan from"; report_stop NO_QUEUE "the audit left no fix queue to plan from."; rm -f "$MARK"; exit 3; }
  START="$(echo "$P" | grep '^QUEUE' | field workable)"; START="${START:-0}"
  say "queue: $(echo "$P" | grep '^QUEUE')"
  LEFT="$START"; STALLED=0; ROUND=0
  for ROUND in $(seq 1 "$MAX_ROUNDS"); do
    # One pass per CHUNK (at most 10 briefs of one repo), so no pass runs out of turns before it lands.
    CHUNKS="$(echo "$P" | awk '/^CHUNK /{print $2" "$3" "$4}')"
    [ -n "$CHUNKS" ] || break
    BEFORE="$LEFT"
    : > "$RCS"
    # One worker per repo, in the plan's order (largest first, so the longest repo starts first),
    # at most $PARALLEL at a time. `jobs -rp` and a short sleep, not `wait -n`: /bin/bash on macOS
    # is 3.2, which has no `wait -n`.
    for R in $(echo "$CHUNKS" | awk '!seen[$1]++{print $1}'); do
      while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$PARALLEL" ]; do sleep 5; done
      repo_worker "$ROUND" "$R" "$(echo "$CHUNKS" | awk -v r="$R" '$1==r')" &
    done
    wait
    NET_HIT="$(awk '$2==13' "$RCS" | wc -l | tr -d ' ')"
    audit
    P="$(plan)" || break
    LEFT="$(echo "$P" | grep '^QUEUE' | field workable)"; LEFT="${LEFT:-$BEFORE}"
    say "after round $ROUND: $LEFT workable left (was $BEFORE)"
    if [ "$NET_HIT" -gt 0 ]; then
      say "round $ROUND: $NET_HIT pass(es) lost the network; that is not \"fixed nothing\", so the next round re-runs them"
      continue
    fi
    [ "$LEFT" -lt "$BEFORE" ] || { STALLED=1; say "round $ROUND fixed nothing; stopping until tomorrow rather than spinning"; break; }
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
  # RULE 0, WITH WORK LEFT: never a quiet exit 0. Named, non-zero (duty-run records it as failed and the
  # duty stays due), and on Danielle's repair desk. The run did reach its end, so the mark is cleared.
  if [ "$LEFT" -gt 0 ]; then
    if [ "$STALLED" -eq 1 ]; then CODE=SR_QUEUE_STALLED; WHY="round $ROUND fixed nothing"; else CODE=SR_ROUNDS_SPENT; WHY="all $MAX_ROUNDS rounds ran"; fi
    say "NAMED STOP [$CODE] $LEFT workable briefs left ($WHY; $FIXED fixed of $START). See $LOG."
    report_stop "$CODE" "$LEFT workable briefs left ($WHY; $FIXED fixed of $START)."
    rm -f "$MARK"
    exit 14
  fi
  rm -f "$MARK"
  [ "$START" -gt 0 ] || say "NAMED STOP [QUEUE_EMPTY] nothing workable in the queue today; that is a result, not a skip."
  exit 0
}

main "$@"; exit $?
