#!/bin/bash
# HER SCHEDULED JOBS RUN FROM A CHECKOUT NOBODY WORKS IN — ~/.boss-os/runtime, held at origin/main.
#
# 1 Nov 2026. Every launchd job ran its scripts from ~/GitHub/boss-os, her working checkout. Sessions
# and their agents kept branching it in place (`git checkout -b …` at 07:48, 10:05, 11:27 and 12:54
# that day — the last by a subagent of the Boss OS mail tail, which ran with that checkout as its cwd),
# so for hours at a time ~45 jobs ran a feature branch or half-edited files. Nothing said so.
#
# The fix is structural, not a rule: launchd runs from a SEPARATE clone that no person or agent is
# told to work in, and this job (com.seq.boss-runtime-sync, every 10 min) puts it back on origin/main:
#   * missing        → cloned from her working checkout's origin URL, then npm ci;
#   * off main/dirty → whatever was there is SAVED to ~/.boss-os/runtime-salvage/<stamp>/ (diff,
#                      untracked files, branch name, unpushed commits as a bundle), then reset — a
#                      job's stray edit can never pin the runtime to stale code again;
#   * behind         → hard reset to origin/main (no merge, nothing of anyone's is lost: see above);
#   * lockfile moved → npm ci, so code and node_modules always match.
#   * any launchd plist still pointing at ~/GitHub/boss-os → repointed and reloaded (a running job waits
#                      for a later tick); only a repoint that fails is named.
# Every problem is a NAMED line in the log and one line in the morning email's "notices" section.
#
#   BOSS_OS_RUNTIME (default ~/.boss-os/runtime)   BOSS_OS_WORKING (default ~/GitHub/boss-os)
#   BOSS_OS_RUNTIME_SALVAGE (default ~/.boss-os/runtime-salvage)   BOSS_OS_LAUNCH_AGENTS (default ~/Library/LaunchAgents)
#   BOSS_OS_RUNTIME_NO_NPM=1 skips npm ci; BOSS_OS_RUNTIME_NO_LAUNCHCTL=1 rewrites plists without reloading (tests only).
#
# Exit: 0 = runtime is on origin/main; 3 = could not reach origin (runtime left as it was, said so);
# 4 = clone / reset / npm ci failed (NAMED STOP). The whole body is one function so a reset that
# rewrites this very file mid-run cannot change what bash executes.
set -uo pipefail

main() {
  local RT="${BOSS_OS_RUNTIME:-$HOME/.boss-os/runtime}"
  local WORKING="${BOSS_OS_WORKING:-$HOME/GitHub/boss-os}"
  local SALVAGE_ROOT="${BOSS_OS_RUNTIME_SALVAGE:-$HOME/.boss-os/runtime-salvage}"
  local AGENTS_DIR="${BOSS_OS_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}"
  local STAMP; STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  local NOTES=()
  say() { echo "RUNTIME: $*"; }
  note() { say "$1"; NOTES+=("$1"); }

  if [ ! -d "$RT/.git" ]; then
    local URL; URL="${BOSS_OS_RUNTIME_ORIGIN:-$(git -C "$WORKING" remote get-url origin 2>/dev/null)}"
    [ -n "$URL" ] || { note "NAMED STOP [RUNTIME_NO_ORIGIN] no runtime at $RT and no origin URL to clone it from"; finish 4; return; }
    mkdir -p "$(dirname "$RT")"
    git clone -q "$URL" "$RT" || { note "NAMED STOP [RUNTIME_CLONE_FAILED] could not clone $URL into $RT"; finish 4; return; }
    say "cloned $URL into $RT"
  fi
  cd "$RT" || { note "NAMED STOP [RUNTIME_MISSING] $RT"; finish 4; return; }

  if ! git fetch -q --no-tags origin main 2>/dev/null; then
    say "could not reach origin; the runtime stays at $(git rev-parse --short HEAD 2>/dev/null)"
    finish 3; return
  fi
  local TARGET; TARGET="$(git rev-parse origin/main)"
  local BRANCH; BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  local DIRTY; DIRTY="$(git status --porcelain --untracked-files=all 2>/dev/null)"
  local AHEAD=0
  [ "$BRANCH" = "HEAD" ] || AHEAD="$(git rev-list --count "origin/main..HEAD" 2>/dev/null || echo 0)"

  if [ "$BRANCH" != "main" ] || [ -n "$DIRTY" ] || [ "$AHEAD" != "0" ]; then
    local S="$SALVAGE_ROOT/$STAMP"
    mkdir -p "$S"
    printf 'branch: %s\nhead: %s\nahead_of_origin_main: %s\n' "$BRANCH" "$(git rev-parse HEAD)" "$AHEAD" > "$S/where.txt"
    git diff HEAD > "$S/changes.diff" 2>/dev/null
    git ls-files --others --exclude-standard -z | xargs -0 tar -cf "$S/untracked.tar" 2>/dev/null
    [ "$AHEAD" = "0" ] || git bundle create -q "$S/commits.bundle" "origin/main..HEAD" 2>/dev/null
    note "NAMED STOP [RUNTIME_WAS_DIRTY] the jobs' checkout was on '$BRANCH' with $(printf '%s' "$DIRTY" | grep -c .) changed file(s) and $AHEAD unpushed commit(s); saved to $S and put back on main"
  fi

  local OLD_LOCK; OLD_LOCK="$(git rev-parse -q --verify HEAD:package-lock.json 2>/dev/null)"
  if ! { git checkout -q -f -B main "$TARGET" && git reset -q --hard "$TARGET" && git clean -qfd; }; then
    note "NAMED STOP [RUNTIME_RESET_FAILED] could not put $RT on origin/main ${TARGET:0:7}"
    finish 4; return
  fi
  local NEW_LOCK; NEW_LOCK="$(git rev-parse -q --verify HEAD:package-lock.json 2>/dev/null)"

  if [ -z "${BOSS_OS_RUNTIME_NO_NPM:-}" ] && [ -f package.json ]; then
    if [ ! -d node_modules ] || [ "$OLD_LOCK" != "$NEW_LOCK" ] || [ "$(cat node_modules/.runtime-lock 2>/dev/null)" != "$NEW_LOCK" ]; then
      if npm ci --no-audit --no-fund --silent >/dev/null 2>&1; then
        echo "$NEW_LOCK" > node_modules/.runtime-lock
        say "npm ci done for lockfile ${NEW_LOCK:0:7}"
      else
        note "NAMED STOP [RUNTIME_NPM_CI_FAILED] npm ci failed in $RT at ${TARGET:0:7}; jobs run with the previous node_modules"
        finish 4; return
      fi
    fi
  fi

  # A plist still pointing at her working checkout is the defect coming back (an old installer, a job
  # that was running when install-runtime.sh ran): repoint it here and reload it. A job running right
  # now is left until a later tick (bootout would kill it); only a repoint that FAILS reaches her email.
  if [ -d "$AGENTS_DIR" ]; then
    local P L
    for P in "$AGENTS_DIR"/com.seq.*.plist; do
      [ -f "$P" ] || continue
      grep -qE "$WORKING([/<&\" ]|$)" "$P" 2>/dev/null || continue
      L="$(basename "$P" .plist)"
      if [ -z "${BOSS_OS_RUNTIME_NO_LAUNCHCTL:-}" ] && launchctl list 2>/dev/null | awk -v l="$L" '$3 == l && $1 != "-" { f = 1 } END { exit !f }'; then
        say "$L still runs from $WORKING; it is running now, so it is repointed on a later tick"
        continue
      fi
      W="$WORKING" R="$RT" perl -pi -e 's#\Q$ENV{W}\E(?=[/<&" ]|$)#$ENV{R}#g' "$P"
      if [ -n "${BOSS_OS_RUNTIME_NO_LAUNCHCTL:-}" ]; then say "repointed $L to $RT (not reloaded: no launchctl)"; continue; fi
      if plutil -lint "$P" >/dev/null 2>&1 && { launchctl bootout "gui/$(id -u)/$L" 2>/dev/null; launchctl bootstrap "gui/$(id -u)" "$P" 2>/dev/null; launchctl print "gui/$(id -u)/$L" >/dev/null 2>&1; }; then
        say "repointed $L to $RT and reloaded it"
      else
        note "NAMED STOP [PLIST_REPOINT_FAILED] $L was moved to $RT but did not load again; run scripts/ops/install-runtime.sh"
      fi
    done
  fi

  say "on origin/main ${TARGET:0:7}"
  finish 0
}

# One line per problem into the morning email's "notices" section (best effort — the log has it too).
finish() {
  local RC="$1" N
  if [ "${#NOTES[@]}" -gt 0 ] && [ -f "${RT:-}/src/shared/boss/mail/morning.mjs" ]; then
    for N in "${NOTES[@]}"; do
      node --input-type=module -e 'const [m, l] = process.argv.slice(1); const { addMorningLines } = await import(m); addMorningLines("notices", { lines: [l] });' \
        "$RT/src/shared/boss/mail/morning.mjs" "Boss OS jobs' checkout: ${N#NAMED STOP }" >/dev/null 2>&1 || say "could not add the note to the morning email"
    done
  fi
  EXIT_CODE="$RC"
}

EXIT_CODE=0
main "$@"
exit "$EXIT_CODE"
