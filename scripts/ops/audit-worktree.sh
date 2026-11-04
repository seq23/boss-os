#!/bin/bash
# A FRESH WORKTREE OFF origin/<default> FOR DANIELLE'S FIX — never the owner's checkout.
#
#   audit-worktree.sh <repo-name-or-path>     prints the worktree path as its last line
#
# WHY (owner, 16 Oct 2026: "fix danielle's job so she can actually fix things"). The first version of
# this duty refused any repository with uncommitted changes and surfaced the finding instead. On
# 16 Oct that turned p-n-p's timestamp-only reports/validation/*.json into "somebody is working in
# there" and a fix nobody made. A worktree is cut from origin, so the owner's checkout — dirty or
# not, on whatever branch — is never read from, written to, stashed or switched.
#
# CLIENT REPOS ARE REFUSED HERE TOO (exit 20, NAMED STOP [CLIENT_REPO]), from the one list in
# src/shared/boss/siteAudit/repoPolicy.mjs, so no branch is ever cut in one.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${AUDIT_GITHUB_ROOT:-$HOME/GitHub}"
PRUNE_ONLY=false
if [ "${1:-}" = --prune-only ]; then PRUNE_ONLY=true; shift; fi
ARG="${1:-}"
[ -n "$ARG" ] || { echo "NAMED STOP [NO_REPO_ARG] usage: audit-worktree.sh <repo>" >&2; exit 2; }
case "$ARG" in /*) DIR="$ARG" ;; *) DIR="$ROOT/$ARG" ;; esac
NAME="$(basename "$DIR")"

if ! node -e 'import(process.argv[1]).then(m=>process.exit(m.mayAutoFix(process.argv[2])?0:1))' \
     "$HERE/../../src/shared/boss/siteAudit/repoPolicy.mjs" "$NAME"; then
  echo "NAMED STOP [CLIENT_REPO] $NAME is off limits to the fixer; report it, never branch it." >&2
  exit 20
fi
git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1 || { echo "NAMED STOP [NOT_A_REPO] $DIR" >&2; exit 3; }

git -C "$DIR" fetch -q origin || { echo "NAMED STOP [FETCH_FAILED] $NAME" >&2; exit 4; }
DEFAULT="$(git -C "$DIR" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
[ -n "$DEFAULT" ] || DEFAULT="$(git -C "$DIR" ls-remote --symref origin HEAD 2>/dev/null | awk '/^ref:/{sub("refs/heads/","",$2);print $2}')"
[ -n "$DEFAULT" ] || DEFAULT=main

# Only registered audit worktrees of this repository qualify. Never force removal:
# git rechecks cleanliness, and a locked worktree is preserved too.
COMMON="$(git -C "$DIR" rev-parse --path-format=absolute --git-common-dir)"
for OLD in "$ROOT/.wt-danielle-${NAME}-"*; do
  [ -d "$OLD" ] && [ ! -L "$OLD" ] || continue
  [ "$(git -C "$OLD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$COMMON" ] || continue
  OLD_BRANCH="$(git -C "$OLD" symbolic-ref -q --short HEAD)" || continue
  case "$OLD_BRANCH" in danielle/site-audit-*) ;; *) continue ;; esac
  STATUS="$(git -C "$OLD" status --porcelain --untracked-files=all)" || { echo "kept $OLD (status failed)" >&2; continue; }
  DIRTY=$(printf '%s\n' "$STATUS" | awk 'NF { n++ } END { print n+0 }')
  # --remotes=origin compares against EVERY origin branch, not just the default.
  UNPUSHED="$(git -C "$OLD" rev-list --count HEAD --not --remotes=origin)" || { echo "kept $OLD (history failed)" >&2; continue; }
  if [ "$DIRTY" -ne 0 ] || [ "$UNPUSHED" -ne 0 ]; then
    echo "kept $OLD (dirty $DIRTY / unpushed $UNPUSHED)" >&2
    continue
  fi
  if git -C "$DIR" worktree remove "$OLD"; then
    # The all-origin reachability check above is stronger than branch -d's upstream check.
    git -C "$DIR" branch -D "$OLD_BRANCH" >&2
  else
    echo "kept $OLD (worktree removal failed)" >&2
  fi
done
$PRUNE_ONLY && exit 0

STAMP="$(date +%Y%m%d-%H%M%S)"
WT="${ROOT}/.wt-danielle-${NAME}-${STAMP}"
BRANCH="danielle/site-audit-${STAMP}"
git -C "$DIR" worktree add -q "$WT" -b "$BRANCH" "origin/$DEFAULT" >&2 \
  || { echo "NAMED STOP [WORKTREE_FAILED] $NAME" >&2; exit 5; }
# The repo's installed tooling, without an install: validators run from the worktree.
[ -d "$DIR/node_modules" ] && [ ! -e "$WT/node_modules" ] && ln -s "$DIR/node_modules" "$WT/node_modules"
echo "$WT"
