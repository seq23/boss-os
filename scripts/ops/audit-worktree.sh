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

STAMP="$(date +%Y%m%d-%H%M%S)"
WT="${ROOT}/.wt-danielle-${NAME}-${STAMP}"
BRANCH="danielle/site-audit-${STAMP}"
git -C "$DIR" worktree add -q "$WT" -b "$BRANCH" "origin/$DEFAULT" >&2 \
  || { echo "NAMED STOP [WORKTREE_FAILED] $NAME" >&2; exit 5; }
# The repo's installed tooling, without an install: validators run from the worktree.
[ -d "$DIR/node_modules" ] && [ ! -e "$WT/node_modules" ] && ln -s "$DIR/node_modules" "$WT/node_modules"
echo "$WT"
