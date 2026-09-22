#!/bin/bash
# Read yesterday's LP replies, categorise them, and hand the opt-outs to Twin.
#
# MONIQUE'S DUTY, EXECUTED. `duty_lp_replies` in Boss OS names her as the owner and this script as
# its executor; `validate:duty-delivery` fails the build if the two stop agreeing. The duty is
# `executor = 'local_job'` because reading `sequoia@westpeek.ventures` needs a credential the Claude
# Code runner strips on purpose. Same shape as kdp-watch.sh and mailbox-sweep.sh, including the
# lessons that cost real debugging there: completion is proven by a SENTINEL rather than by output
# length, and log filenames carry seconds AND pid because two runs in one minute shared a file once.
#
# ─── IT REFUSES TO RUN UNTIL THE GRANT EXISTS, AND SAYS SO ────────────────────
#
# Scooter has to add domain-wide delegation on westpeek.ventures and nobody else can. Until he does,
# nothing can read that mailbox — so this checks the credential register FIRST and stops with a
# named reason rather than starting a run that would fail at its first tool call.
#
# A JOB THAT ERRORED EVERY MORNING FOR THREE WEEKS WHILE HE GOT ROUND TO IT WOULD BE NOISE, and
# noise on a daily surface is how a screen stops being read. This is quiet, and the reason it is
# quiet is on Today as a credential alert with his exact steps.
#
# RULE 0: this script may not exit 0 having done nothing. Either it read and reported, or it exits
# non-zero — or it stops for the one named reason above, which is a real and honest state.

set -uo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
PROMPT_FILE="${LP_REPLIES_PROMPT:-$REPO/scripts/ops/lp-replies-prompt.md}"
# The origin is read by the Node step below straight from BOSS_OS_ORIGIN; a shell copy here was
# never used by anything.
OUT_DIR="${BOSS_OS_LP_DIR:-$HOME/.boss-os/lp}"

# THE MODEL IS NAMED, AND IT MATCHES THE DUTY ROW.
#
# `claude -p` with no --model runs the most expensive one available — what made a single briefing
# cost $3.88. Putting each reply in one of six buckets is classification, not judgement.
# duty_lp_replies carries the same string in $.requested.model and
# scripts/validate/duties-deliver-somewhere.mjs fails the build if these two ever disagree.
MODEL="${LP_REPLIES_MODEL:-claude-haiku-4-5-20251001}"
LOG_DIR="$HOME/Library/Logs/lp-replies"
LOCK="$LOG_DIR/.lock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"

mkdir -p "$LOG_DIR" "$OUT_DIR"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }

if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
    say "NAMED STOP [ALREADY_RUNNING] pid $(cat "$LOCK/pid")"; exit 0
  fi
  say "stale lock; reclaiming"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || { say "FAILED to lock"; exit 3; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

CLAUDE="$(command -v claude || echo /opt/homebrew/bin/claude)"
[ -x "$CLAUDE" ] || { say "NAMED STOP [NO_CLAUDE_CLI] $CLAUDE"; exit 4; }
[ -f "$PROMPT_FILE" ] || { say "NAMED STOP [NO_PROMPT_FILE] $PROMPT_FILE"; exit 5; }

# ─── The gate: is the delegation actually granted? ───────────────────────────
#
# ASKED OF THE PROBER RATHER THAN ASSUMED, and asked of the register rather than re-tested here —
# `credential-check.mjs` attempts the impersonation every morning and this reads its answer. Two
# components each keeping their own list with no link between them is the defect this repository
# names by name, and re-implementing the JWT dance in bash would be a textbook instance.
cd "$REPO" || { say "NAMED STOP [NO_REPO] $REPO"; exit 6; }
STATE=$(npm run --silent vault:run -- node -e '
(async()=>{
  const O = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
  const u = await fetch(O+"/api/boss/auth/unlock",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({passcode:process.env.BOSS_PASSCODE})});
  if(!u.ok){ console.log("unreachable"); return; }
  const cookie=(u.headers.get("set-cookie")||"").split(";")[0];
  const r = await fetch(O+"/api/boss/credentials",{headers:{cookie}});
  if(!r.ok){ console.log("unreachable"); return; }
  const j = await r.json();
  const p = (j.data.probes||[]).find(x=>x.id==="cred_westpeek_delegation");
  console.log(p ? p.state : "absent");
})();' 2>/dev/null | tail -1)

if [ "$STATE" != "live" ]; then
  say "NAMED STOP [DELEGATION_NOT_GRANTED] the West Peek delegation reads \"$STATE\", so this mailbox cannot be read yet."
  say "  Scooter has to grant it — it is on the Wednesday packet with his exact steps, and Today carries it as a credential alert."
  say "  This job wakes on its own the morning after he does it. Nothing here is broken."
  exit 0
fi

say "=== LP reply digest starting ==="

# ─── The window, which is 2d every day and wider exactly once ────────────────
#
# The daily run looks back two days: enough to survive a missed morning, small enough that a day of
# replies is a cheap read. But the grant landed three weeks after Twin started sending, so the FIRST
# run has three weeks of never-read replies behind it — and a 2d window on that day would file a
# digest saying "nothing came in" over an unread backlog, which is worse than not running at all.
#
# LP_REPLIES_WINDOW widens it for that one run. It is substituted into the prompt text rather than
# templated into the file, so the prompt on disk stays literally correct and nothing can leak an
# unsubstituted placeholder into a real search.
WINDOW="${LP_REPLIES_WINDOW:-2d}"
PROMPT_TEXT="$(cat "$PROMPT_FILE")"
if [ "$WINDOW" != "2d" ]; then
  PROMPT_TEXT="${PROMPT_TEXT//newer_than:2d/newer_than:$WINDOW}"
  say "backfill window: $WINDOW (not the daily 2d)"
fi

cd "$HOME" || { say "NAMED STOP [NO_HOME]"; exit 8; }

"$CLAUDE" -p "$PROMPT_TEXT" --model "$MODEL" --dangerously-skip-permissions >> "$RUN_LOG" 2>&1
RC=$?
say "=== claude exited rc=$RC ==="

if ! grep -q "LP-REPLIES-COMPLETE:" "$RUN_LOG"; then
  say "NAMED STOP [RUN_DID_NOT_COMPLETE] no sentinel in the log — the run started and never reached its end, so its silence is not evidence that nothing came in."
  exit 9
fi

SENTINEL=$(grep -o 'LP-REPLIES-COMPLETE:.*' "$RUN_LOG" | tail -1)
say "sentinel: $SENTINEL"
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"

# `;` NOT `&&`, AND THE EXIT CODE IS THE RUN'S. A Boss OS that is unreachable at 07:45 must not turn
# a completed read into a failed one — the mail was read either way. The report is a separate claim
# and fails separately, loudly, in this log.
if echo "$SENTINEL" | grep -q "filed"; then
  cd "$REPO" && npm run --silent vault:run -- node scripts/ops/lp-report.mjs >> "$RUN_LOG" 2>&1
  RRC=$?
  [ $RRC -eq 0 ] || say "NAMED STOP [DIGEST_NOT_DELIVERED] rc=$RRC — the mail was read; Boss OS was not told. See above."
else
  say "Nothing to file. No digest posted and no Inbox item raised, which is the correct output for a quiet day."
fi

exit $RC
