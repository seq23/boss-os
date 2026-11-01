#!/bin/bash
# Moves every Boss OS launchd job off her working checkout and onto the runtime checkout, and installs
# the job that keeps the runtime on origin/main (scripts/ops/runtime-sync.sh explains why).
#
#   bash scripts/ops/install-runtime.sh            # from any checkout; idempotent
#
# 1. Clones/syncs ~/.boss-os/runtime (npm ci included) — refuses to go on if that fails.
# 2. Installs com.seq.boss-runtime-sync, every 10 minutes.
# 3. Rewrites every ~/Library/LaunchAgents/com.seq.*.plist that runs from ~/GitHub/boss-os to run from
#    the runtime, lints it, and reloads it (bootout + bootstrap), then proves each is loaded.
# The installers (install-agent-launchd.sh and friends) write the runtime path themselves from now on.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RT="${BOSS_OS_RUNTIME:-$HOME/.boss-os/runtime}"
WORKING="${BOSS_OS_WORKING:-$HOME/GitHub/boss-os}"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/boss-runtime-sync"
mkdir -p "$LOGS"

bash "$HERE/runtime-sync.sh" | tail -3
[ "${PIPESTATUS[0]}" = "0" ] || { echo "NAMED STOP [RUNTIME_NOT_READY] $RT is not on origin/main; nothing repointed." >&2; exit 4; }

LABEL="com.seq.boss-runtime-sync"
PLIST="$AGENTS_DIR/$LABEL.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>bash $RT/scripts/ops/runtime-sync.sh</string>
  </array>
  <key>StartInterval</key><integer>600</integer>
  <key>StandardOutPath</key><string>$LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$LOGS/launchd.err</string>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF

FAILED=0 MOVED=0 DEFERRED=0
# A job running right now is left exactly as it is (bootout would kill it mid-run); the sync job names
# it every 10 minutes until this installer is run again.
running() { launchctl list 2>/dev/null | awk -v l="$1" '$3 == l && $1 != "-" { f = 1 } END { exit !f }'; }
reload() {
  local p="$1" label; label="$(basename "$p" .plist)"
  plutil -lint "$p" >/dev/null || { echo "NAMED STOP [PLIST_LINT] $label"; FAILED=$((FAILED + 1)); return; }
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$p" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "$p" 2>/dev/null
  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then echo "  loaded $label"; else echo "NAMED STOP [NOT_LOADED] $label"; FAILED=$((FAILED + 1)); fi
}

for p in "$AGENTS_DIR"/com.seq.*.plist; do
  [ -f "$p" ] || continue
  grep -qE "$WORKING([/<&\" ]|$)" "$p" || continue
  if running "$(basename "$p" .plist)"; then echo "  deferred $(basename "$p" .plist): running now"; DEFERRED=$((DEFERRED + 1)); continue; fi
  W="$WORKING" R="$RT" perl -pi -e 's#\Q$ENV{W}\E(?=[/<&" ]|$)#$ENV{R}#g' "$p"
  MOVED=$((MOVED + 1))
  reload "$p"
done
reload "$PLIST"

LEFT="$(grep -lE "$WORKING([/<&\" ]|$)" "$AGENTS_DIR"/com.seq.*.plist 2>/dev/null | wc -l | tr -d ' ')"
echo "Moved $MOVED job(s) to $RT; $LEFT still on $WORKING ($DEFERRED running now: run this again when they finish); $FAILED failed to load."
[ "$FAILED" = "0" ] && [ "$LEFT" = "0" ] || exit 5
