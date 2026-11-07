#!/bin/bash
# Put a new KeepMyProof Kindle draft on kdp-register.json through a PR, landed by ~/bin/land.
#
# WHY A PR. The register is the one list of her titles (kdp-line-counts.mjs counts it into the spry
# brain); it lives in the repo, and the runtime checkout is never edited in place. So the monthly
# run adds the draft's row in a throwaway worktree off origin/main, opens a PR that touches ONLY the
# register, and lands it with ~/bin/land (green checks, merge, main watched) — one bounded call.
#
#   bash scripts/ops/kdp-register-pr.sh <folder>
# Exit 0 landed or already there · 2 NAMED STOP (no draft / diff outside the register / PR or land refused)
set -uo pipefail
FOLDER="${1:?usage: kdp-register-pr.sh <folder>}"
REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"
WT="$(mktemp -d "${TMPDIR:-/tmp}/kdp-register-XXXXXX")"
BR="kdp-register-kmp-$FOLDER-$(date +%Y%m%d%H%M%S)"
cleanup() { git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1; rm -rf "$WT"; }
trap cleanup EXIT
git -C "$REPO" fetch -q origin main || { echo "NAMED STOP [REGISTER_PR_NO_FETCH] could not fetch origin/main; the next run retries." >&2; exit 2; }
rmdir "$WT" && git -C "$REPO" worktree add -q -b "$BR" "$WT" origin/main || { echo "NAMED STOP [REGISTER_PR_NO_WORKTREE]" >&2; exit 2; }
OUT="$(node "$WT/scripts/ops/kdp-kmp-draft.mjs" --register-only --folder "$FOLDER" --register "$WT/scripts/ops/kdp-register.json")" || { echo "$OUT" >&2; exit 2; }
echo "$OUT"
case "$OUT" in *"already there"*) echo "OUTPUT 0 kmp-register-rows $FOLDER (already on the register)"; exit 0;; esac
CHANGED="$(git -C "$WT" status --short | awk '{print $2}')"
[ "$CHANGED" = "scripts/ops/kdp-register.json" ] || { echo "NAMED STOP [REGISTER_PR_TOUCHES_MORE] the change is not the register alone: $CHANGED" >&2; exit 2; }
git -C "$WT" add scripts/ops/kdp-register.json && git -C "$WT" commit -q -m "KDP register: KeepMyProof $FOLDER Kindle draft (monthly run)" \
  && git -C "$WT" push -q -u origin "$BR" || { echo "NAMED STOP [REGISTER_PR_NOT_PUSHED]" >&2; exit 2; }
PR="$(cd "$WT" && gh pr create --fill --base main --head "$BR" 2>/dev/null | grep -o '[0-9]*$')"
[ -n "$PR" ] || { echo "NAMED STOP [REGISTER_PR_NOT_OPENED] branch $BR is pushed; open and land it by hand." >&2; exit 2; }
"$HOME/bin/land" "$PR" || { echo "NAMED STOP [REGISTER_PR_NOT_LANDED] PR #$PR did not land; the next monthly run sees the row missing and tries again." >&2; exit 2; }
echo "OUTPUT 1 kmp-register-rows $FOLDER (PR #$PR landed)"
