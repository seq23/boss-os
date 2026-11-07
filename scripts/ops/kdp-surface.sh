#!/bin/bash
# Read everything Amazon sent about her books and decide what each one means.
#
# SIMONE'S STANDING KDP DUTY. `duty_kdp_surface` names her as the owner and this script as its
# executor; `validate:duty-delivery` fails the build if the two stop agreeing.
#
# WHY THIS EXISTS BESIDE kdp-watch.sh RATHER THAN INSIDE IT. That one chases ONE case to resolution
# and ends the day the seven books are Live. This is permanent: Simone owns the Kindle surface, and
# that case is an incident inside the ownership rather than the ownership itself. Her words: "u need
# to make sure simone has a dedicated task for handling anything related to KDP".
#
# 09:30, SEVEN MINUTES AFTER THE CASE WATCH, so on Mon/Wed/Fri the two never race for the same Gmail
# session and the case run's determination is already filed when this looks. Daily rather than
# Mon/Wed/Fri because a title taken down on a Saturday should not wait until Monday.
#
# RULE 0: this may not exit 0 having done nothing. Either it triaged and reported — and a day with no
# mail is a real triage that reports an empty list — or it exits non-zero with a named reason.

set -uo pipefail

REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"  # the checkout this script lives in, symlinks followed (launchd: the runtime)
PROMPT_FILE="${KDP_SURFACE_PROMPT:-${BOSS_DUTY_PROMPT_FILE:-$REPO/scripts/ops/kdp-surface-prompt.md}}"

# THE MODEL IS NAMED AND MATCHES THE DUTY ROW. Deciding whether a message is promotional, an update
# or a problem is classification rather than judgement. `claude -p` with no --model runs the most
# expensive one available, which is what made a single briefing cost $3.88.
# duty_kdp_surface carries the same string in $.requested.model and
# scripts/validate/duties-deliver-somewhere.mjs fails the build if they disagree.
MODEL="${KDP_SURFACE_MODEL:-claude-haiku-4-5-20251001}"
LOG_DIR="$HOME/Library/Logs/kdp-surface"
LOCK="$LOG_DIR/.lock"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S)-$$.log"

mkdir -p "$LOG_DIR" "$HOME/.boss-os/kdp"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN_LOG"; }

if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
    say "NAMED STOP [ALREADY_RUNNING] pid $(cat "$LOCK/pid")"; exit 0
  fi
  say "stale lock; reclaiming"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || { say "FAILED to lock"; exit 3; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

# THE ENGINE IS ~/bin/ai-run IN THE ROLE src/shared/boss/aiRoles.mjs NAMES ("kdp_surface"; owner, 3 Nov 2026).
AI_RUN="${AI_RUN_BIN:-$HOME/bin/ai-run}"
[ -x "$AI_RUN" ] || { say "NAMED STOP [AI_RUN_MISSING] $AI_RUN is not installed (seq-bin); the next run retries."; exit 4; }
AI_ROLE="$(node "$REPO/scripts/ops/lib/ai-run.mjs" role kdp_surface)" || { say "NAMED STOP [NO_AI_ROLE] kdp_surface"; exit 4; }
[ -f "$PROMPT_FILE" ] || { say "NAMED STOP [NO_PROMPT_FILE] $PROMPT_FILE"; exit 5; }

# The connector is what reads the mailbox, and it is revoked by any Google password change. The daily
# credential prober is what makes that visible before this job needs it; this check only catches the
# CLI having no credentials at all, which is a different and simpler failure.
if ! security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; then
  say "NAMED STOP [CLAUDE_NOT_AUTHENTICATED] the Claude CLI has no credentials in the login keychain."
  say "  Today already carries the connector's state as a credential alert with the reconnect steps."
  exit 10
fi

say "=== KDP surface triage starting ==="
rm -f "$HOME/.boss-os/kdp/surface.json"
cd "$HOME" || { say "NAMED STOP [NO_HOME]"; exit 8; }

# ─── WHAT IS STILL OPEN, HANDED TO THE RUN BEFORE IT READS ANY MAIL ─────────
#
# 17–20 Sep 2026: four runs said quiet or blocked while a flagged title sat inside Amazon's five-day
# window, because "newer_than:2d" found nothing new and nothing re-read what was still open. The
# open problems — with her answer on them, if she replied — are written here through the vault, and
# the prompt reads them FIRST. An open problem is never "already reported".
OPEN_FILE="$HOME/.boss-os/kdp/open.json"
rm -f "$OPEN_FILE"
if [ -d "$REPO" ]; then
  ( cd "$REPO" && npm run --silent vault:run -- node scripts/ops/kdp-open.mjs "$OPEN_FILE" ) >> "$RUN_LOG" 2>&1 \
    || say "NAMED STOP [OPEN_LIST_UNREAD] could not read the open problems from Boss OS; the run proceeds on mail alone and the report step will still chase what is due."
fi

# ─── SIMONE SIGNS IN HERSELF, BEFORE SHE READS ANYTHING ───────────────────────
#
# Her ruling, 21 Sep 2026: "i shouldn't have to approve browser sign in — she should use browser
# tools and sign in." The vault's KDP_ACCOUNT_EMAIL / KDP_ACCOUNT_PASSWORD reach kdp-signin.mjs
# through the governed launch and nowhere else; the one-time code is read from her Gmail through
# the connector; a CAPTCHA or phone push is the one case that stays hers (signin.json says so, and
# the prompt turns it into a STOP email with the exact line). The model never asks her to sign in.
rm -f "$HOME/.boss-os/kdp/signin.json"
if [ -d "$REPO" ]; then
  ( cd "$REPO" && npm run --silent vault:run -- node scripts/ops/kdp-signin.mjs ) >> "$RUN_LOG" 2>&1 \
    || say "NAMED STOP [SIGNIN_NOT_OK] Simone could not sign in to KDP herself — see the KDP-SIGNIN line above; the run proceeds and the report step tells her only if it is truly hers."
fi

# ─── UNITS SOLD, READ IN CODE — NOT LEFT TO A PARAGRAPH IN THE PROMPT ─────────
#
# Owner ruling, 1 Nov 2026: "nothing runs unmeasured". Until 2 Nov the only instruction to write
# ~/.boss-os/kdp/units.json was English inside the prompt below, and nothing checked it happened.
# This reads it in code, after sign-in and before the model, exactly where kdp-open and kdp-signin
# already sit. A page that could not be read writes a NAMED reason instead of a number
# (scripts/ops/kdp-units.mjs); the Scorecard shows "No number" on either a missing file or a reason.
rm -f "$HOME/.boss-os/kdp/units.json"
if [ -d "$REPO" ]; then
  ( cd "$REPO" && node scripts/ops/kdp-units.mjs ) >> "$RUN_LOG" 2>&1 \
    || say "NAMED STOP [UNITS_NOT_READ] units sold could not be read today — see the KDP-UNITS line above; the Scorecard shows the KDP row as No number until a later run reads it."
fi

# ─── BOOKS PER LINE, INTO THE SPRY BRAIN (owner, 7 Nov 2026) ──────────────────
# One Numbers row per Kindle line (ApprovalPrep, Dream Wedding, A Player Mode, KeepMyProof), counted
# from kdp-register.json by code; an unreadable register writes "not read: <reason>", never 0.
if [ -d "$REPO" ]; then
  ( cd "$REPO" && npm run --silent vault:run -- node scripts/ops/kdp-line-counts.mjs ) >> "$RUN_LOG" 2>&1 \
    || say "NAMED STOP [LINE_COUNTS_NOT_RECORDED] the Kindle book counts did not reach the spry brain — see the lines above; the next monthly run writes them again."
fi

# ─── THE NEXT KEEPMYPROOF KINDLE BOOK, DRAFTED (owner, 7 Nov 2026) ─────────────────────────────
# One front-door book per KeepMyProof folder, in kdp-books/keepmyproof.json's order, one per monthly
# run until all five exist: kdp-kmp-draft.mjs --next (free models first, Claude review, claim gate),
# then its row on the register by a landed PR, then its card in her Inbox (kdp_new_title). Nothing
# reaches Amazon until she approves; the upload is a visible run she is present for.
# OUTPUT 1 = a book drafted; ALL_FIVE_DRAFTED is the duty's end; any other stop fails this run.
KMP_RC=0
# The register as it is on origin/main (where kdp-register-pr.sh lands rows), never a stale checkout's:
# a stale copy would pick a folder already drafted and raise a second card for it.
KMP_REG="$(mktemp)"
if git -C "$REPO" fetch -q origin main && git -C "$REPO" show origin/main:scripts/ops/kdp-register.json > "$KMP_REG"; then
  KMP_OUT="$( cd "$REPO" && BOSS_OS_KDP_REGISTER="$KMP_REG" npm run --silent vault:run -- node scripts/ops/kdp-kmp-draft.mjs --next --review 2>&1 )"; KMP_RC=$?
else
  KMP_OUT="NAMED STOP [REGISTER_UNREAD] could not read the register from origin/main"; KMP_RC=2
fi
rm -f "$KMP_REG"
echo "$KMP_OUT" >> "$RUN_LOG"
KMP_FOLDER="$(echo "$KMP_OUT" | sed -n 's/^OUTPUT 1 kmp-kindle-drafts //p' | tail -1)"
if [ -n "$KMP_FOLDER" ]; then
  ( cd "$REPO" && bash scripts/ops/kdp-register-pr.sh "$KMP_FOLDER" ) >> "$RUN_LOG" 2>&1 || KMP_RC=2
  ( cd "$REPO" && npm run --silent vault:run -- node scripts/ops/kdp-kmp-raise.mjs --folder "$KMP_FOLDER" ) >> "$RUN_LOG" 2>&1 || KMP_RC=2
  say "KeepMyProof Kindle draft: $KMP_FOLDER (register rc and Inbox card above)"
elif echo "$KMP_OUT" | grep -q 'ALL_FIVE_DRAFTED'; then
  say "NAMED STOP [ALL_FIVE_DRAFTED] all five KeepMyProof Kindle books are drafted; this step has nothing left to do."
else
  say "NAMED STOP [KMP_DRAFT_FAILED] rc=$KMP_RC — see the KeepMyProof lines above; the next monthly run tries again."
fi

AI_RUN_CLAUDE_MODEL="$MODEL" "$AI_RUN" --role "$AI_ROLE" --out "$RUN_LOG" < "$PROMPT_FILE"
RC=$?
say "=== ai-run --role $AI_ROLE exited rc=$RC ==="

# ─── ONE POSTER. THE SENTINEL COMES FROM THE FILE, NOT FROM THE MODEL ────────
#
# Until 21 Sep 2026 there were two: the prompt told the model to run the report script (it has no
# vault, so it ended on "NEEDS YOU: run the report command" and no sentinel — or printed "blocked"
# while the wrapper posted "nothing arrived"). The model's only product is the file; the wrapper is
# the one thing that posts, emails, chases and records the sentinel — derived from the file's
# contents (quiet / noted / acted / needs-her / blocked), never from the model's closing sentence.
if [ ! -f "$HOME/.boss-os/kdp/surface.json" ]; then
  say "NAMED STOP [TRIAGE_DID_NOT_COMPLETE] no surface.json — the run started and never wrote its file, so its silence is not evidence that nothing arrived."
  ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"
  exit 9
fi

if [ ! -d "$REPO" ]; then
  say "NAMED STOP [NO_REPO] $REPO — the mail was read; Boss OS was not told."
  ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"
  exit 8
fi
cd "$REPO" && npm run --silent vault:run -- node scripts/ops/kdp-surface-report.mjs >> "$RUN_LOG" 2>&1
RRC=$?
if [ $RRC -ne 0 ]; then
  say "NAMED STOP [TRIAGE_NOT_DELIVERED] rc=$RRC — see above. The mail was read; something seeing it should have produced did not happen."
fi
SENTINEL="$(grep -o 'KDP-SURFACE-COMPLETE:.*' "$RUN_LOG" | tail -1)"
[ -n "$SENTINEL" ] && say "sentinel: $SENTINEL" || say "NAMED STOP [NO_SENTINEL] the report step printed no sentinel."
ln -sf "$RUN_LOG" "$LOG_DIR/latest.log"

[ $RC -eq 0 ] || exit $RC
[ $RRC -eq 0 ] || exit $RRC
# A failed KeepMyProof draft fails the run, so duty-run.sh records it on the duty row (seen on Today).
exit $KMP_RC
