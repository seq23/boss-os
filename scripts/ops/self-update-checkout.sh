#!/bin/bash
# THE SCHEDULED AUDIT RUNS CURRENT CODE — a fast-forward of its own checkout, or nothing.
#
# 26 Oct 2026. `com.seq.boss-sites-audit` runs `npm run sites:audit` in /Users/.../GitHub/boss-os and
# nothing updates that checkout. It sat at #147 while main held the corrected aplayermode.com mapping,
# so the run measured the apex against a repo that never served it and wrote five fix briefs for files
# that were there all along. `definitionChoice` fixed the DATA (checklist.json and sites.json are read
# from origin every run); this fixes the CODE, which is loaded before any of that can run.
#
# It is deliberately timid, because this is her working checkout:
#   * only on the default branch, only with a clean tree (no staged, unstaged or untracked change),
#   * only a strict fast-forward (origin's head must be a descendant of HEAD) — never a merge,
#     never a rebase, never a branch switch, never a reset, never a stash, never a commit,
#   * any doubt, including no network: it says why and exits 0. The audit always runs.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 0
say() { echo "CHECKOUT: $*"; }

git rev-parse --git-dir >/dev/null 2>&1 || { say "not a git checkout; left alone"; exit 0; }
DEFAULT="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
[ -n "$DEFAULT" ] || DEFAULT=main
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
[ "$BRANCH" = "$DEFAULT" ] || { say "on $BRANCH, not $DEFAULT; left alone"; exit 0; }
[ -z "$(git status --porcelain 2>/dev/null)" ] || { say "uncommitted work here; left alone"; exit 0; }

git fetch -q --no-tags origin "$DEFAULT" 2>/dev/null || { say "could not reach origin; running the code that is here"; exit 0; }
HEAD_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/$DEFAULT" 2>/dev/null)"
[ -n "$REMOTE_SHA" ] || { say "origin/$DEFAULT is unknown; left alone"; exit 0; }
[ "$HEAD_SHA" != "$REMOTE_SHA" ] || { say "already at origin/$DEFAULT ($(git rev-parse --short HEAD))"; exit 0; }
git merge-base --is-ancestor "$HEAD_SHA" "$REMOTE_SHA" 2>/dev/null || { say "this checkout has commits origin does not; left alone"; exit 0; }

BEHIND="$(git rev-list --count "$HEAD_SHA..$REMOTE_SHA")"
if git merge --ff-only -q "origin/$DEFAULT" 2>/dev/null; then
  say "fast-forwarded $BEHIND commit(s) to origin/$DEFAULT ($(git rev-parse --short HEAD)); the run uses current code"
else
  say "fast-forward refused by git; running the code that is here"
fi
exit 0
