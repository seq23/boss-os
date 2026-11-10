#!/bin/bash
# THE MORNING CATCH-UP (scripts/ops/morning-catchup.mjs): 06:32 Central, eight minutes before Simone's
# 06:40 morning email, AND whenever the Mac comes up (RunAtLoad).
#
# 3 Nov 2026 (repair rc_m6gtk44dhfjq6rvj): a reboot killed com.seq.boss-capital mid-chain, so
# capital:grid never ran and "deals"/"monique_found" missed the email. The 06:32 slot was the fix.
# 9 Nov 2026 (repair rc_m708yvvt99yvy416): the Mac was OFF from ~19:10 on 8 Nov until 07:36 on 9 Nov.
# launchd replays a calendar slot missed in sleep, never one missed across a shutdown, so neither the
# 05:30 capital chain nor this 06:32 catch-up ran, and "deals" missed the email again. RunAtLoad makes
# the Mac coming up run the catch-up: before 06:40 it saves the email; after, it writes Today and
# tomorrow's email (the run says which).
#
# Called by install-agent-launchd.sh; safe to run on its own, so this one job can be reinstalled
# without unloading every other job (and killing a scheduled one mid-run).
set -euo pipefail
REPO="${BOSS_OS_REPO:-${BOSS_OS_RUNTIME:-$HOME/.boss-os/runtime}}"  # launchd runs the runtime checkout, never her working one
LOGS="$HOME/Library/Logs/boss-agent"
mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
MORNCATCHUP_LABEL="com.seq.boss-morning-catchup"
MORNCATCHUP_PLIST="$HOME/Library/LaunchAgents/$MORNCATCHUP_LABEL.plist"

cat > "$MORNCATCHUP_PLIST" <<MORNCATCHUPEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$MORNCATCHUP_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO &amp;&amp; npm run --silent morning:catchup</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>32</integer></dict>
  <key>StandardOutPath</key><string>$LOGS/morning-catchup.log</string>
  <key>StandardErrorPath</key><string>$LOGS/morning-catchup.err</string>
  <key>RunAtLoad</key><true/>
</dict></plist>
MORNCATCHUPEOF

# Central hours, moved to the Mac's zone before launchd reads them (the one mover).
lint_plist() {
  node "$REPO/scripts/ops/plist-central.mjs" "$1" || { echo "NAMED STOP [PLIST_TZ] could not move $1 to this Mac's zone; not loaded." >&2; exit 1; }
  plutil -lint "$1" >/dev/null || { echo "NAMED STOP [PLIST_MALFORMED] $1 is not a valid property list; not loaded." >&2; exit 1; }
}
lint_plist "$MORNCATCHUP_PLIST"
launchctl unload "$MORNCATCHUP_PLIST" 2>/dev/null || true
launchctl load "$MORNCATCHUP_PLIST"
launchctl list | grep -q "$MORNCATCHUP_LABEL" || { echo "NOT INSTALLED: $MORNCATCHUP_LABEL"; exit 1; }
echo "Installed $MORNCATCHUP_LABEL — daily 06:32 Central, and whenever the Mac comes up."
