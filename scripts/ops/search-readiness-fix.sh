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
# Weekly, Tuesday 06:30 Central (07:30 until 1 Nov 2026), from Monday's 06:00 audit queue (owner, 25 Oct 2026): the schedule is the
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
REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"  # the checkout this script lives in, symlinks followed (launchd: the runtime)
MAX_ROUNDS="${SR_MAX_ROUNDS:-4}"
PARALLEL="${SR_PARALLEL:-3}"
LOG_DIR="$HOME/Library/Logs/boss-sr-fix"
STATE_DIR="$HOME/.boss-os/search-readiness"
STATUS="$STATE_DIR/fix-status.json"
# fix-status.json: the run in progress after each round, and every finished run of the last weeks
# (nextFixStatus, audit.mjs), so the Monday email sums real numbers even when it reads mid-run.
write_status() {
  node -e '
    const [status, started, fixed, left, prot, noRepo, done] = process.argv.slice(1);
    import(process.cwd() + "/src/shared/boss/searchReadiness/audit.mjs").then(async (m) => {
      const fs = await import("node:fs");
      let prev = null; try { prev = JSON.parse(fs.readFileSync(status, "utf8")); } catch {}
      const next = m.nextFixStatus(prev, { started: +started, fixed: +fixed, left: +left, protectedLeft: +prot, noRepo: +noRepo, done: done === "1" });
      fs.writeFileSync(status, JSON.stringify(next, null, 2));
      if (next.line) console.log(next.line);
    });' "$STATUS" "$@"
}
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
  # THE AI ALLOWANCE RESETS AT A KNOWN TIME, NOT "NOW" (28 Oct 2026). A pass that hit its usage limit
  # wrote the reset time here; starting a run before then just hits the same limit in seconds.
  if [ -f "$STATE_DIR/retry-after" ]; then
    local retry_at retry_epoch now_epoch
    retry_at="$(cat "$STATE_DIR/retry-after")"
    retry_epoch="$(date -j -f "%I:%M %p" "$retry_at" +%s 2>/dev/null)"
    now_epoch="$(date +%s)"
    if [ -n "$retry_epoch" ] && [ "$now_epoch" -lt "$retry_epoch" ]; then
      say "resume check: waiting until $retry_at (the AI allowance resets then)"
      return 0
    fi
    rm -f "$STATE_DIR/retry-after"
  fi
  old="$(mark_field pid)"
  say "resume check: unfinished run found (pid ${old:-?} is gone, last state: $(mark_field reason)); resuming it"
  # Through duty-run.sh, so her pause on the employee page is honoured and D1 hears the outcome.
  bash scripts/ops/duty-run.sh search-readiness-fix.sh -- bash scripts/ops/search-readiness-fix.sh --resume
  rc=$?
  if [ -f "$MARK" ] && [ "$(mark_field pid)" = "$old" ]; then
    # The run never started (the duty is paused or removed): stop asking, say so once.
    say "NAMED STOP [RESUME_NOT_STARTED] duty-run did not start the run (rc=$rc; the duty may be paused); the unfinished mark is cleared so this does not repeat. See $LOG_DIR/../boss-duty/."
    rm -f "$MARK" "$STATE_DIR/retry-after"
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
  # A RUN THAT ALREADY ENDED WITH WORK LEFT CAN BE HANDED BACK TO THE STANDING RESUME JOB (28 Oct
  # 2026): write the unfinished mark by hand, same shape resume_if_unfinished expects, so
  # com.seq.boss-sr-resume picks it up within 15 minutes instead of waiting for next Tuesday.
  if [ "${1:-}" = "--rearm" ]; then
    RUN_STARTED="$(date +%Y-%m-%dT%H:%M:%S)"
    mark "rearmed"
    say "REARMED"
    return 0
  fi
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
  P="$(plan)" || { say "NAMED STOP [NO_QUEUE] the audit left no fix queue to plan from"; report_stop NO_QUEUE "the audit left no fix queue to plan from."; rm -f "$MARK" "$STATE_DIR/retry-after"; exit 3; }
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
    RCS_COUNT="$(wc -l < "$RCS" | tr -d ' ')"
    # A ROUND WHERE EVERY PASS IS WAITING ON A SPENT AI ALLOWANCE DOES NOT BURN THE REMAINING ROUNDS
    # IN SECONDS (28 Oct 2026, SR_QUEUE_STALLED with 25 of 60 fixed: round 2's passes all exited 13 in
    # under a minute and the run spun to "fixed nothing" instead of waiting for the reset). The
    # retry-after file is only ever written by that cause, never by a genuine network blip (which
    # keeps retrying next round, unchanged below), so its presence is the signal.
    if [ "$NET_HIT" -gt 0 ] && [ "$NET_HIT" -eq "$RCS_COUNT" ] && [ -f "$STATE_DIR/retry-after" ]; then
      RETRY_AT="$(cat "$STATE_DIR/retry-after")"
      stop_unfinished AI_USAGE_EXHAUSTED "every pass this round is waiting on an AI usage reset (back at $RETRY_AT); the run resumes by itself after that."
    fi
    audit
    P="$(plan)" || break
    LEFT="$(echo "$P" | grep '^QUEUE' | field workable)"; LEFT="${LEFT:-$BEFORE}"
    say "after round $ROUND: $LEFT workable left (was $BEFORE)"
    # The run in progress is on the status file too, so a morning read mid-run says the real number.
    write_status "$START" "$(( START - LEFT ))" "$LEFT" 0 0 0
    if [ "$NET_HIT" -gt 0 ]; then
      say "round $ROUND: $NET_HIT pass(es) lost the network or hit a usage limit; that is not \"fixed nothing\", so the next round re-runs them"
      continue
    fi
    [ "$LEFT" -lt "$BEFORE" ] || { STALLED=1; say "round $ROUND fixed nothing; stopping until tomorrow rather than spinning"; break; }
  done

  Q="$(echo "$P" | grep '^QUEUE')"
  PROT="$(echo "$Q" | field protected)"; NOREPO="$(echo "$Q" | field no_repo)"
  FIXED=$(( START - LEFT )); [ "$FIXED" -ge 0 ] || FIXED=0
  write_status "$START" "$FIXED" "$LEFT" "${PROT:-0}" "${NOREPO:-0}" 1 | tee -a "$LOG"
  say "SR-QUEUE-COMPLETE: started=$START fixed=$FIXED left=$LEFT protected=${PROT:-0} no_repo=${NOREPO:-0}"
  # RULE 0, WITH WORK LEFT: never a quiet exit 0. Named, on Danielle's repair desk, and non-zero unless
  # the queue stalled (see below). The run did reach its end, so the mark is cleared.
  if [ "$LEFT" -gt 0 ]; then
    if [ "$STALLED" -eq 1 ]; then CODE=SR_QUEUE_STALLED; WHY="round $ROUND fixed nothing"; else CODE=SR_ROUNDS_SPENT; WHY="all $MAX_ROUNDS rounds ran"; fi
    say "NAMED STOP [$CODE] $LEFT workable briefs left ($WHY; $FIXED fixed of $START). See $LOG."
    report_stop "$CODE" "$LEFT workable briefs left ($WHY; $FIXED fixed of $START)."
    rm -f "$MARK" "$STATE_DIR/retry-after"
    # A STALLED QUEUE IS THE DUTY'S OWN END STATE, NOT A FAILED RUN (31 Oct 2026). The duty's success
    # criterion (migration 0305) is "round after round, until none is left OR A ROUND FIXES NOTHING".
    # Exiting 14 here recorded every such run as failed, so last_run_at never moved, the weekly duty
    # stayed due and re-ran EVERY morning on the same briefs (28-31 Oct, burning her AI seat), each
    # failure opened a "find why it failed" fix job, and Today said "never fired". The leftover is
    # already named above and on Danielle's repair desk (report_stop); the duty is done until Tuesday.
    # SR_ROUNDS_SPENT (every round still fixing when the rounds ran out) stays 14: that run is unfinished.
    [ "$STALLED" -eq 1 ] && exit 0
    exit 14
  fi
  rm -f "$MARK" "$STATE_DIR/retry-after"
  [ "$START" -gt 0 ] || say "NAMED STOP [QUEUE_EMPTY] nothing workable in the queue today; that is a result, not a skip."
  exit 0
}

main "$@"; exit $?
