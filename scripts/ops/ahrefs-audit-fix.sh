#!/bin/bash
# The week's Ahrefs Site Audit reports, read, fixed at source, and opened as pull requests.
#
# DANIELLE'S DUTY, EXECUTED. `duty_site_audit_repair` in Boss OS names `emp_repo` as the owner and
# names this script as its executor; `validate:duty-delivery` fails the build if the two stop
# agreeing, and `validate:audit-fixer` fails it if this script stops honouring the off-limits list
# or acquires a merge.
#
# WHY THIS CANNOT BE AN AGENT IN THE CLOUD — three reasons, any one sufficient:
#   · It reads the CONTENTS of seq.taylor@gmail.com. The Claude Code runner strips every credential
#     matching KEY|TOKEN|SECRET|PASSCODE, deliberately, so a cloud agent cannot reach her mail.
#   · It needs working copies of her repositories, git and gh. A Worker has none of those.
#   · The fix has to be proven by each repository's OWN validators before a PR is opened, which
#     means actually running them.
#
# THURSDAY 06:00 CENTRAL, AND THE HOUR IS DERIVED RATHER THAN CHOSEN. Every Site Audit mail in the
# mailbox was timed: Thu 27 Aug 02:20–02:31 UTC, Thu 3 Sep 01:07–03:58, Thu 10 Sep 01:07–02:42.
# Ahrefs recrawls the account weekly and delivers overnight into Thursday UTC — Wednesday evening in
# her zone. 06:00 America/Chicago is 11:00 UTC, seven hours after the latest report ever observed.
# Running before the batch lands would grade last week's crawl and open PRs for findings already
# fixed, which is how an automated fixer teaches its owner to stop reading it.
#
# IT LANDS WHAT IT FIXES, THROUGH ~/bin/land AND NOTHING ELSE. This header used to say "IT MERGES
# NOTHING. She merges." That was wrong about her, and it was changed on her word: owner, 16 Oct 2026,
# "fix danielle's job so she can actually fix things". Her standing rules already said merge green
# PRs without asking (14 Sep), merge and deploy are ONE action through ~/bin/land (18 Sep), nothing
# waits on the owner (25 Sep), and repairs found in passing need no yes. A fixer that opens PRs and
# leaves them for her is a fixer whose every fix waits on her. So after the pass, every `fixed_pr`
# row goes through `site-audit-lib.mjs land`: `timeout 1800 gh pr checks <pr> --watch --fail-fast`,
# then `~/bin/land <pr>`, which refuses rather than guesses (not green, head moved, main red),
# watches main to a terminal state and deploys. No bare merge, no workflow dispatch, no deploy call
# lives here — `validate:audit-fixer` fails the build if one appears. Client repos are never
# branched at all (repoPolicy.mjs).
#
# WHY THE 15 AND 16 OCT PASSES FIXED NOTHING, AND WHAT CHANGED. projects=24 fixed=0 surfaced=10,
# then projects=10 fixed=0 surfaced=9 off_limits=1. Every finding was surfaced because (a) the mail
# carries no URLs and she cannot log into Ahrefs — now `site-crawl.py crawl` supplies them from her
# own crawl of the live site; (b) a dirty working tree was refused — now `audit-worktree.sh` cuts a
# fresh worktree off origin and never touches the owner's checkout; (c) LGCV was off limits as
# "under active heavy change" — removed, collisions are caught as IN_FLIGHT instead; (d) a crawl
# failure stopped at "check robots/DNS/origin" — now `site-crawl.py probe` checks from outside, and
# out-of-credits crawls are AHREFS_CRAWL_CREDITS rows, not site defects.
#
# RULE 0: this script may not exit 0 having done nothing. Either it read the audits and reported, or
# it exits non-zero with a NAMED reason. A quiet week is a report of one row saying so, never silence.
# And a pass that surfaced fixable defects with fixed=0, or opened a PR that did not land, exits RED
# with each reason named (`site-audit-lib.mjs verdict`, exit 12).

set -uo pipefail

# THE WHOLE BODY IS A FUNCTION, called on the last line (25 Oct 2026): bash reads a script as it runs
# it, so a file rewritten under a running pass shifted the bytes under it. A function is parsed whole.
main() {

REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"  # the checkout this script lives in, symlinks followed (launchd: the runtime)
PROMPT_FILE="${AHREFS_AUDIT_PROMPT:-${BOSS_DUTY_PROMPT_FILE:-$REPO/scripts/ops/ahrefs-audit-fix-prompt.md}}"
OUT_DIR="${BOSS_OS_SITE_AUDIT_DIR:-$HOME/.boss-os/site-audit}"
# A SCOPED PASS OWNS ITS REPO, NOT THE MACHINE (25 Oct 2026). search-readiness-fix.sh runs up to three
# repos at once, so a scoped pass gets its own findings file (and, below, its own lock): two passes
# writing one findings.json would land and report each other's rows. Exported so the reporter reads
# the same file. An unscoped run (the weekly Ahrefs pass) keeps the one shared path and global lock.
if [ -n "${SR_SCOPE_REPO:-}" ]; then
  OUT_DIR="$OUT_DIR/sr-$SR_SCOPE_REPO"
fi
export BOSS_OS_SITE_AUDIT_DIR="$OUT_DIR"

# THE MODEL IS NAMED, AND IT MATCHES THE DUTY ROW. Since 3 Nov 2026 it is the BRAIN step's model (the
# mail digest), handed to ai-run as AI_RUN_CLAUDE_MODEL; the repair itself runs on Codex's default.
#
# `claude -p` with no --model runs whatever the default is, so the model is always named. It was
# Sonnet; the owner's rule since 6 Oct 2026 is Opus for every agent (Haiku and Sonnet stay out), and
# this job is judgement over somebody else's repository. `validate:duty-delivery` and
# `validate:audit-fixer` assert this string equals the duty row's (migration 0287).
MODEL="${AHREFS_AUDIT_MODEL:-claude-opus-5}"
MAX_TURNS="${AHREFS_AUDIT_MAX_TURNS:-250}"
LOG_DIR="$HOME/Library/Logs/ahrefs-audit-fix"
LOCK="$LOG_DIR/.lock${SR_SCOPE_REPO:+-sr-$SR_SCOPE_REPO}"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"

mkdir -p "$LOG_DIR" "$OUT_DIR"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }

# THE SENTINEL MUST BE A RESULT, NOT THE PROMPT'S OWN TEMPLATE (28 Oct 2026). `codex exec` echoes the
# prompt it was given into the run log, and the prompt carries the completion sentinel as a template
# with literal `<n>` placeholders so the model knows the shape to fill in. A loose `grep -q
# "AHREFS-AUDIT-COMPLETE:"` matches that echo before the model ever runs, so a pass that did nothing
# (hit its usage limit in the first second) was judged as a finished one and sent on to land a
# findings file that was never written. Real numbers only.
has_sentinel() { grep -qE 'AHREFS-AUDIT-COMPLETE: projects=[0-9]' "$1"; }
# A SPENT AI ALLOWANCE IS "RETRY LATER", NOT "NOTHING LEFT TO TRY" (28 Oct 2026). Same message either
# runner prints when its usage is gone for the day.
usage_exhausted() { grep -qiE "usage limit|limit reached|out of (extra )?usage|rate.?limit|credit balance" "$1"; }

# Two runs in the same minute shared a log file once and the second inherited the first's sentinel.
# Seconds and pid in the name; a lock directory for the run itself.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
    say "NAMED STOP [ALREADY_RUNNING] pid $(cat "$LOCK/pid")"; exit 0
  fi
  say "stale lock; reclaiming"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || { say "FAILED to lock"; exit 3; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

# THE ENGINE IS ~/bin/ai-run IN THE ROLE src/shared/boss/aiRoles.mjs NAMES (owner, 3 Nov 2026: Codex
# is the worker, Claude the brain). Missing → a named stop the next run retries (exit 13).
AI_RUN="${AI_RUN_BIN:-$HOME/bin/ai-run}"
[ -x "$AI_RUN" ] || { say "NAMED STOP [AI_RUN_MISSING] $AI_RUN is not installed (seq-bin); the next run retries."; exit 13; }
[ -f "$PROMPT_FILE" ] || { say "NAMED STOP [NO_PROMPT_FILE] $PROMPT_FILE"; exit 5; }
command -v gh >/dev/null 2>&1 || { say "NAMED STOP [NO_GH_CLI] a fix that cannot open a PR is a fix nobody sees."; exit 6; }
# OFFLINE IS NOT LOGGED OUT (25 Oct 2026). `gh auth status` fails the same way for both, and an
# outage once turned every pass of a run into "GH_NOT_AUTHENTICATED". lib/net-wait.sh asks whether
# api.github.com answers at all: no answer waits (bounded, ~2 h, said in the log); an answer with gh
# still failing is the login stop. Exit 13 = the network, so the runner resumes rather than gives up.
# shellcheck source=lib/net-wait.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/net-wait.sh"
gh_ready; GH_RC=$?
[ "$GH_RC" -eq 0 ] || exit "$GH_RC"

# WHICH ENGINE DOES WHAT (owner, 3 Nov 2026), read from src/shared/boss/aiRoles.mjs — no choice here:
#   site_audit.repair      the pass itself (crawl, edit, validate, PRs)            → worker (Codex)
#   site_audit.mail_digest reading the week's Ahrefs mail (claude.ai Gmail connector,
#                          which Codex cannot reach), read-only, writing a digest  → brain (Claude)
# A Codex limit ends the pass as NAMED STOP [CODEX_LIMIT] (exit 13, retried by the next run). It is
# never handed to Claude.
role_of() { node "$REPO/scripts/ops/lib/ai-run.mjs" role "$1"; }
REPAIR_ROLE="$(role_of site_audit.repair)" || { say "NAMED STOP [NO_AI_ROLE] site_audit.repair"; exit 11; }
DIGEST_ROLE="$(role_of site_audit.mail_digest)" || { say "NAMED STOP [NO_AI_ROLE] site_audit.mail_digest"; exit 11; }

# ─── THE OFF-LIMITS REPOSITORY, READ FROM THE ONE LIST ──────────────────────
#
# NOT HARDCODED HERE. `src/shared/boss/siteAudit/repoPolicy.mjs` is the single source, and the
# ingest endpoint reads the same file — so the rule cannot be true in one place and stale in the
# other, which is this repository's most-named defect. Printed into the run log so the constraint
# the run actually operated under is visible after the fact rather than assumed.
NO_AUTO_FIX="$(node -e 'import("'"$REPO"'/src/shared/boss/siteAudit/repoPolicy.mjs").then(m=>console.log(m.NO_AUTO_FIX_REPOS.join(" ")))' 2>/dev/null)"
[ -n "$NO_AUTO_FIX" ] || { say "NAMED STOP [NO_POLICY] could not read the off-limits list; refusing to run without it."; exit 11; }
say "off limits to the fixer: $NO_AUTO_FIX"

# THE PREVIOUS FILE IS REMOVED BEFORE THE RUN, NOT AFTER.
#
# `ahrefs-audit-report.mjs` refuses a findings file older than the run, which is the backstop.
# Deleting it here is the belt: a run that crashes halfway cannot leave last week's findings looking
# like this week's, and "nothing was written" is then unambiguous on disk as well as in the reporter.
rm -f "$OUT_DIR/findings.json" "$OUT_DIR/scope.json"

# A QUEUE PASS'S EVIDENCE IS WRITTEN BEFORE IT STARTS (26 Oct 2026). It reads no mailbox, so what it
# looked at is the queue and the briefs it was handed. The reporter sends this snapshot as `searched`
# (evidence.mjs `queueEvidence`), so the evidence never depends on how the model worded its own.
if [ -n "${SR_SCOPE_REPO:-}" ]; then
  node "$REPO/scripts/ops/site-audit-lib.mjs" scope "$SR_SCOPE_REPO" "${SR_SCOPE_BRIEFS:-}" > "$OUT_DIR/scope.json" 2>>"$RUN_LOG" \
    || say "NAMED STOP [NO_SCOPE_SNAPSHOT] the queue could not be read before the pass; the reporter will read it again."
fi

say "=== ahrefs audit pass starting (repair on ai-run --role $REPAIR_ROLE) ==="
cd "$HOME" || { say "NAMED STOP [NO_HOME]"; exit 8; }

# THE PROMPT'S PATHS FOLLOW $REPO. It names ~/GitHub/boss-os/scripts/ops/… for the crawler, the
# worktree helper and the IN_FLIGHT check; on 16 Oct the owner's checkout there was on a docs branch
# without those scripts, so the run would have called files that did not exist. Rewritten to the
# checkout this runner was started from, which is the one that has them.
PROMPT_TEXT="$(sed "s#~/GitHub/boss-os#$REPO#g" "$PROMPT_FILE" | sed "s#~/.boss-os/site-audit/findings.json#$OUT_DIR/findings.json#g")"
# ─── ONE REPO OF THE SEARCH READINESS QUEUE, WHEN THE DAILY QUEUE RUN ASKS (25 Oct 2026) ─────────
# scripts/ops/search-readiness-fix.sh works the whole queue one repository at a time so no single
# pass runs out of turns half way through 242 briefs. SR_SCOPE_REPO narrows THIS pass to section 1b,
# that repo's briefs only; everything else in the prompt (off-limits list, worktrees, validators,
# land) still applies. Protected briefs are skipped here: they are fixed only on their own.
if [ -n "${SR_SCOPE_REPO:-}" ]; then
  PROMPT_TEXT="$PROMPT_TEXT

## THIS PASS IS SCOPED (daily Search Readiness queue run)

Work ONLY section 1b, and ONLY the briefs in ~/.boss-os/search-readiness/fix-queue.json whose
\`repo\` is \`$SR_SCOPE_REPO\`. Do not read the Ahrefs mail this pass. Fix EVERY such brief that is not
\`protected\` — batch them into as few PRs as the repo's own validators allow, and get each green.
Skip any brief with \`protected\` set; record it as off_limits with the reason (it is fixed only on its own pass). Record every brief in
findings.json as section 1b says. End with the usual completion sentinel."
  if [ -n "${SR_SCOPE_BRIEFS:-}" ]; then
    PROMPT_TEXT="$PROMPT_TEXT
Narrower still: work ONLY the briefs whose \`id\` is one of: $SR_SCOPE_BRIEFS. The rest of this repo's
briefs go to the next pass. Open the PR and get it green before you finish, so nothing is lost."
  fi
  say "scoped pass: Search Readiness queue, repo $SR_SCOPE_REPO"
fi
# THE MAIL PASS: the brain reads the mail and writes the digest; the worker repairs from it.
if [ -z "${SR_SCOPE_REPO:-}" ] && { [ -z "${AHREFS_DIGEST:-}" ] || [ ! -s "$AHREFS_DIGEST" ]; }; then
  AHREFS_DIGEST="$OUT_DIR/ahrefs-digest.md"
  rm -f "$AHREFS_DIGEST"
  AI_RUN_CLAUDE_MODEL="$MODEL" "$AI_RUN" --role "$DIGEST_ROLE" --out "$AHREFS_DIGEST" -- "Read seq.taylor@gmail.com through the Gmail connector for the Ahrefs Site Audit report emails of the last 8 days (from Ahrefs, subject containing Site Audit). Change nothing and fix nothing. Reply with ONLY a markdown digest: for each project, the site, the crawl date, the health score, and every issue named with its count and severity, exactly as the mail says. If there were none, reply exactly: NO AHREFS SITE AUDIT MAIL THIS WEEK." >> "$RUN_LOG" 2>&1
  DIGEST_RC=$?
  if [ ! -s "$AHREFS_DIGEST" ]; then
    say "NAMED STOP [NO_DIGEST] the brain step (rc=$DIGEST_RC) wrote no Ahrefs digest; the next run retries."
    exit 13
  fi
  say "digest written by ai-run --role $DIGEST_ROLE: $AHREFS_DIGEST"
fi
if [ -n "${AHREFS_DIGEST:-}" ] && [ -s "$AHREFS_DIGEST" ] && [ -z "${SR_SCOPE_REPO:-}" ]; then
  PROMPT_TEXT="$PROMPT_TEXT
Do NOT read Gmail this pass. This week's Ahrefs reports are summarised in $AHREFS_DIGEST: read it in
place of the mail, find the exact URLs on each live site, and fix at source as section 1 says."
  say "mail pass from digest: $AHREFS_DIGEST"
fi
"$AI_RUN" --role "$REPAIR_ROLE" --network --cwd "$HOME" --out "$RUN_LOG" -- "$PROMPT_TEXT" >> "$RUN_LOG" 2>&1
RC=$?
say "=== ai-run --role $REPAIR_ROLE exited rc=$RC ==="
if [ "$RC" -eq 75 ] || grep -q 'NAMED STOP \[CODEX_LIMIT\]' "$RUN_LOG"; then
  CODEX_LIMIT_LINE="$(grep -o 'NAMED STOP \[CODEX_LIMIT\].*' "$RUN_LOG" | tail -1)"
  CODEX_RESETS="${CODEX_LIMIT_LINE#*resets }"
  [ "$CODEX_RESETS" = "$CODEX_LIMIT_LINE" ] && CODEX_RESETS="unknown"
fi

SENTINEL_OK=1
if ! has_sentinel "$RUN_LOG"; then
  SENTINEL_OK=0
elif [ ! -f "$OUT_DIR/findings.json" ]; then
  SENTINEL_OK=0
  say "NAMED STOP [AUDIT_DID_NOT_COMPLETE] the sentinel printed but findings.json was never written — treating this as unfinished, not a quiet success."
fi

if [ "$SENTINEL_OK" -eq 0 ]; then
  # A SPENT AI ALLOWANCE IS RETRY-LATER, NOT "NOTHING LEFT TO TRY" (28 Oct 2026). Every runner this
  # pass could use is out of usage: salvage what ran, write when it resets, and exit 13 so the caller
  # (search-readiness-fix.sh) treats this round as blocked rather than as a round that fixed nothing.
  USAGE_EXHAUSTED=0
  if [ -n "${CODEX_RESETS:-}" ] && ! has_sentinel "$RUN_LOG"; then
    # A CODEX LIMIT WAITS (owner, 3 Nov 2026): a named note, retried by the next run, never Claude.
    USAGE_EXHAUSTED=1
    say "NAMED STOP [CODEX_LIMIT] resets $CODEX_RESETS — this pass waits for the reset; the next scheduled run retries it. Not handed to Claude."
    mkdir -p "$HOME/.boss-os/search-readiness"
    echo "$CODEX_RESETS" > "$HOME/.boss-os/search-readiness/retry-after"
  elif ! has_sentinel "$RUN_LOG" && usage_exhausted "$RUN_LOG"; then
    USAGE_EXHAUSTED=1
    RETRY_LINE="$(grep -o 'try again at [0-9][0-9:]* *[AaPp][Mm]' "$RUN_LOG" | tail -1)"
    RETRY_AT="${RETRY_LINE#try again at }"
    say "NAMED STOP [AI_USAGE_EXHAUSTED] every runner available to this pass is out of usage${RETRY_AT:+; it says to try again at $RETRY_AT}."
    if [ -n "$RETRY_AT" ]; then
      mkdir -p "$HOME/.boss-os/search-readiness"
      echo "$RETRY_AT" > "$HOME/.boss-os/search-readiness/retry-after"
    fi
  else
    say "NAMED STOP [AUDIT_DID_NOT_COMPLETE] no sentinel in the log — the run started and never reached"
    say "  its end, so its silence is not evidence that there was nothing to fix."
  fi
  # NOTHING IT DID IS LOST (25 Oct 2026). Round 1 of the first full Search Readiness run hit its
  # turn limit with 63 files changed and none committed, and the runner moved on. Every worktree
  # this pass cut is committed, pushed and opened as a DRAFT "Salvaged:" PR, which the next scoped
  # pass for that repo continues (prompt: "Never lose finished work"). The pass start is read back
  # from RUN_LOG's own name. (The body is a function now, so edits anywhere are safe to land.)
  # A PASS THAT LOST THE NETWORK waits for it first, so its salvage can push, then exits 13: the
  # runner re-plans that chunk instead of counting it as "fixed nothing".
  NET_LOST=0
  if [ "$USAGE_EXHAUSTED" -eq 0 ] && ! net_up; then
    NET_LOST=1
    wait_for_network "saving this pass's work" || say "the network is still down; salvaging what can be saved locally"
  fi
  SINCE="$(basename "$RUN_LOG" | sed -E 's/^([0-9]{4})-([0-9]{2})-([0-9]{2})-([0-9]{6}).*/\1\2\3-\4/')"
  node "$REPO/scripts/ops/salvage-pass-worktrees.mjs" --since "$SINCE" ${SR_SCOPE_REPO:+--repo "$SR_SCOPE_REPO"} 2>&1 | tee -a "$RUN_LOG" | sed 's/^/  /'
  [ "${PIPESTATUS[0]}" -eq 0 ] || say "NAMED STOP [SALVAGE_FAILED] a worktree of this pass could not be saved; see the SALVAGE lines above."
  if [ "$USAGE_EXHAUSTED" -eq 1 ]; then
    exit 13
  fi
  if [ "$NET_LOST" -eq 1 ]; then
    say "NAMED STOP [NETWORK_LOST_MID_PASS] the pass ended because the network went away, not because the work was done; the runner re-runs it."
    exit 13
  fi
  exit 9
fi

say "sentinel: $(grep -oE 'AHREFS-AUDIT-COMPLETE: projects=[0-9].*' "$RUN_LOG" | tail -1)"
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"

# LAND EVERY FIX. Deterministic, not left to the model: checks to green, then ~/bin/land.
node "$REPO/scripts/ops/site-audit-lib.mjs" land "$OUT_DIR/findings.json" 2>&1 | tee -a "$RUN_LOG" | grep '^LAND ' || true

# Report even when the pass's verdict is red. Delivery and repair are separate claims; check both
# before exiting so a completed pass whose report never arrived cannot quietly succeed.
REPORT_RC=1
if [ -d "$REPO" ]; then
  (cd "$REPO" && npm run --silent vault:run -- node scripts/ops/ahrefs-audit-report.mjs >> "$RUN_LOG" 2>&1)
  REPORT_RC=$?
  [ $REPORT_RC -eq 0 ] || say "NAMED STOP [REPORT_NOT_DELIVERED] rc=$REPORT_RC — the pass ran; Boss OS was not told. See above."
else
  say "NAMED STOP [NO_REPO] $REPO — the pass ran; Boss OS was not told."
fi

# RULE 0, THE VERDICT. Fixable defects left with fixed=0, a PR that did not land, a row with no
# crawl behind it: RED, every reason named.
node "$REPO/scripts/ops/site-audit-lib.mjs" verdict "$OUT_DIR/findings.json" 2>&1 | tee -a "$RUN_LOG"
VERDICT_RC=${PIPESTATUS[0]}
[ $RC -ne 0 ] && exit $RC
[ $VERDICT_RC -eq 0 ] || { say "NAMED STOP [AUDIT_PASS_RED] see the AUDIT-VERDICT lines above."; exit 12; }
[ $REPORT_RC -eq 0 ] || exit "$REPORT_RC"
exit 0
}

main "$@"; exit $?
