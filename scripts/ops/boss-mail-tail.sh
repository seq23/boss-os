#!/bin/bash
#
# THE TAIL ON HER BOSS OS MAIL (owner, 22 Oct 2026): every job she emails to Boss OS gets one bounded
# headless tail agent that follows it to done, fixes friction at the root in the right repo, logs it,
# and emails her a short report from Boss OS's own sender. Modelled on her partner tail
# (~/bin/scooter-watch.sh), which does the same for the fund's mailbox; nothing here reads or names
# the fund's systems — this is Boss OS's own D1 and its own sender.
#
# TRIGGER: a row in boss-os D1 `boss_inbound_mail` that she sent (authorised = 1) to any
# @sequoiataylor.com address (boss@ or a name@ inbox), received after this tail's first tick, whose
# outcome opened or failed to open work (TAILED_OUTCOMES below). Replies that steer an existing job
# (PLAN_ANSWERED, SECRET_STORED, …) are not new jobs; the original job's tail covers them.
#
# ONE AGENT AT A TIME: `claude -p --model opus`, 2 h hard cap (a watchdog kills it and the report
# says INCOMPLETE). Mail that arrives while one runs queues for the next free tick, never dropped.
# REPORT: boss-mail-tail-report.mjs folds the report into ONE line under "Done for you" in Simone's
# morning email (owner, 23 Oct 2026: "#simone Tail" stops as a standalone email); an INCOMPLETE run is
# a fix job for the team. It sends nothing itself.
#
# launchd com.seq.boss-mail-tail, every 15 min (install-boss-mail-tail.sh). Stop it:
#   launchctl bootout gui/$(id -u)/com.seq.boss-mail-tail
set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
LOG_DIR="$HOME/Library/Logs/boss-mail-tail"
STATE_DIR="$LOG_DIR/state"
mkdir -p "$STATE_DIR"
RUN_LOG="$LOG_DIR/$(date -u +%Y%m%dT%H%M%SZ).log"
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log" 2>/dev/null || true
exec > >(tee -a "$RUN_LOG") 2>&1
# Keep two weeks of tick logs.
find "$LOG_DIR" -maxdepth 1 -name '2*.log' -mtime +14 -delete 2>/dev/null || true

LOCK="$LOG_DIR/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  HOLDER="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$HOLDER" ] && kill -0 "$HOLDER" 2>/dev/null; then echo "[lock] a tick is running (pid $HOLDER)"; exit 0; fi
  echo "[lock] stale lock (pid ${HOLDER:-none}) — broken"; rm -rf "$LOCK"; mkdir "$LOCK" || exit 1
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK" 2>/dev/null' EXIT

START_FILE="$STATE_DIR/started_at_ms"
TAILED_FILE="$STATE_DIR/tailed-mail-ids.txt"
FIXLOG="$STATE_DIR/fix-log.md"
touch "$TAILED_FILE" "$FIXLOG"
# The window starts at the first tick (no backfill), or at BOSS_MAIL_TAIL_SINCE_MS when given.
if [ ! -s "$START_FILE" ]; then
  echo "${BOSS_MAIL_TAIL_SINCE_MS:-$(( $(date +%s) * 1000 ))}" > "$START_FILE"
  echo "[tail] first tick — window starts now"
fi
SINCE_MS="$(cat "$START_FILE")"
TAILED_OUTCOMES="'TRIAGED','ROUTED','DEFAULTED','FOLLOWED_UP','NOT_ADMITTED','NEEDS_CLARITY','DUTY_CREATED','DUTY_DRAFTED','DUTY_REFUSED','DUTY_NOT_UNDERSTOOD','BOOK_NOT_READ','AMBIGUOUS'"

query() {
  (cd "$REPO" && node scripts/vault/vault.mjs run -- npx wrangler d1 execute boss-os --remote --env production --json \
    --command "SELECT id, received_at, to_addr, subject, outcome, task_id, employee_id FROM boss_inbound_mail WHERE authorised = 1 AND to_addr LIKE '%@sequoiataylor.com' AND received_at > $SINCE_MS AND outcome IN ($TAILED_OUTCOMES) ORDER BY received_at" 2>>"$RUN_LOG")
}
RAW="$(query)"
ROWS="$(printf '%s' "$RAW" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if not (isinstance(d, list) and d and d[0].get("success", True)): sys.exit(1)
for r in d[0].get("results", []):
    print("\t".join(str(r.get(k) or "").replace("\t", " ").replace("\n", " ") for k in ("id", "received_at", "to_addr", "subject", "outcome", "task_id", "employee_id")))
' 2>/dev/null)" || { echo "[tail] D1 query failed — a failed check, not zero mail"; exit 1; }
echo "[tail] $(printf '%s' "$ROWS" | grep -c . || true) tailed-outcome row(s) since the window started"

PENDING="$(printf '%s\n' "$ROWS" | awk -F'\t' -v tailed="$TAILED_FILE" 'BEGIN{while((getline l < tailed)>0) t[l]=1} $1!="" && !($1 in t)')"
COUNT="$(printf '%s' "$PENDING" | grep -c . || true)"
FIXLOCK="$STATE_DIR/.agent-lock"
if [ "$COUNT" -eq 0 ]; then echo "[tail] nothing new"; exit 0; fi
if [ -d "$FIXLOCK" ] && kill -0 "$(cat "$FIXLOCK/pid" 2>/dev/null)" 2>/dev/null; then
  echo "[tail] $COUNT email(s) queued behind the agent running since $(cat "$FIXLOCK/started_at" 2>/dev/null)"; exit 0
fi
rm -rf "$FIXLOCK"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TAIL_LOG="$STATE_DIR/tail-$STAMP.jsonl"
PROMPT_FILE="$STATE_DIR/tail-$STAMP.prompt.txt"
REPORT_FILE="$STATE_DIR/report-$STAMP.txt"
EVENTS="$(printf '%s\n' "$PENDING" | awk -F'\t' '{printf "  - mail %s | to %s | outcome %s | task %s | seat %s | subject: %s\n", $1, $3, $5, ($6==""?"(none)":$6), ($7==""?"(none)":$7), $4}')"
SUBJECTS="$(printf '%s\n' "$PENDING" | awk -F'\t' '{print $4}' | paste -sd ';' - | sed 's/;/; /g')"

cat > "$PROMPT_FILE" <<PROMPT
You are the tail on Sequoia's Boss OS mail. She emailed Boss OS; $COUNT email(s):
$EVENTS

Boss OS is her personal OS: repo $REPO (Worker + D1 at boss.sequoiataylor.com, PUBLIC repo — never
write personal data into it). Read STATUS.md and docs/boss/OPERATIONS.md first. Query production D1
read-only:
  cd $REPO && npm run vault:run -- npx wrangler d1 execute boss-os --remote --env production --json --command "..."
Tables: boss_inbound_mail (outcome, why, task_id, employee_id), tasks (status, input, output),
task_events, repo_changes (phase, failure, pr_url), research_pages (state), duty_drafts,
standing_duties, owned_deliverables, audit_log.

SCOPE — every job each email opened: its boss_inbound_mail row; every task whose
json_extract(input,'\$.mail_id') is that mail id (an untagged email may have been split into several
jobs by Simone's triage); the repo_changes / research_pages / duty_drafts rows hanging off them. Follow
each to a terminal state: done and delivered, or correctly waiting on HER decision. Re-check every
few minutes; you have up to 2 hours in total — use it when a real fix needs it, never pad idle tailing.

CORRECT (leave alone): a job waiting on her approval, her answer or a secret only she holds, with an
email that told her in plain English what is needed and the exact reply that clears it.

FRICTION (fix at the root): the wrong seat took the work; work split badly or not at all; a job that
errored, retried without progress, or sat unclaimed; a "blocked" that was really an infrastructure
wait; a question back to her for something her email already said; a repo the lane refused when she
named it plainly; a reply that opened a stray new job instead of reaching its own; a block email
missing its plain-English reason or the exact reply that clears it; anything that ran and did nothing.

Fix in the repo that owns the defect (usually $REPO; a job's own target repo when the defect is
there): root cause, fix at source, never weaken or skip a test, guard the fix with a test, open a PR,
run 'gh pr checks <pr>' yourself and land it with '$HOME/bin/land <pr>' (it watches main and
deploys). Agents never spend money. Never echo a secret. Check open PRs and branches for a sibling
fix before building one; never discard work you did not write.

RECORD:
  a. APPEND to $FIXLOG (never overwrite), under 150 words:
     ## <UTC time> — <mail id(s)>
     - **Her email:** <subject> → <seat(s)>
     - **What Boss OS did:** <job states reached>
     - **Friction:** <what, or "none">
     - **Fix:** <PR link, or "none needed"> — CONFIRMED or SUSPECTED
  b. FINISH by writing a plain-text report to $REPORT_FILE. It is NOT emailed: its second line becomes
     one line under "Done for you" in Simone's morning email (owner, 23 Oct 2026). First line: her
     subject(s). Second line: ONE plain sentence saying where her job ended, in everyday words — no PR
     numbers, codes, commands, paths or jargon (e.g. "Danielle fixed the footer link and it is live.").
     Then, for the record only, who had each job, friction found, fixes landed (PR links), and a last
     line "FRICTION_FIXED: <n>". No tables, no markdown.
PROMPT

mkdir -p "$FIXLOCK"
date -u +%Y-%m-%dT%H:%M:%SZ > "$FIXLOCK/started_at"
printf '%s\n' "$PENDING" | awk -F'\t' '{print $1}' >> "$TAILED_FILE"
CLAUDE="${BOSS_MAIL_TAIL_CLAUDE_BIN:-$(command -v claude || echo /opt/homebrew/bin/claude)}"
nohup bash "$REPO/scripts/ops/boss-mail-tail-run.sh" "$PROMPT_FILE" "$TAIL_LOG" "$FIXLOCK" "$CLAUDE" "$REPORT_FILE" "$SUBJECTS" </dev/null >/dev/null 2>&1 &
echo "$!" > "$FIXLOCK/pid"
disown "$!" 2>/dev/null
echo "[tail] agent dispatched (pid $(cat "$FIXLOCK/pid")) for $COUNT email(s): $SUBJECTS"
exit 0
