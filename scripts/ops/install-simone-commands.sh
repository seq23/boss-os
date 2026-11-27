#!/bin/bash
# Simone's hands on her Mac (scripts/ops/simone-commands.mjs): every 10 minutes, 06:00–06:20 and 10:00–23:50 Central.
# Lookups through her own Drive and Gmail, drafts in her voice, bounce checks, and the plain notices
# the Worker laid out. Never sends to a third party: every email to a person waits for her Send.
# Called by install-agent-launchd.sh; safe to run on its own.
set -euo pipefail
"${LAUNCHD_RELOAD:-$HOME/bin/launchd-reload}" --seed >/dev/null
REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)}"  # the checkout this script lives in, symlinks followed (launchd: the runtime)
LABEL="com.seq.boss-simone-commands"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/simone-commands"
mkdir -p "$LOGS"

INTERVALS=""
# The Mac's day (her ruling 21 Nov 2026): 06:00-06:20, then from 10:00; the Mac is off 07:00-10:00 and no
# lookup starts in the forty minutes before it goes off.
for H in 6 10 11 12 13 14 15 16 17 18 19 20 21 22 23; do
  for M in 0 10 20 30 40 50; do
    [ "$H" = 6 ] && [ "$M" -gt 20 ] && continue
    INTERVALS="$INTERVALS    <dict><key>Hour</key><integer>$H</integer><key>Minute</key><integer>$M</integer></dict>
"
  done
done

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string><string>cd $REPO &amp;&amp; npm run --silent vault:run -- node scripts/ops/simone-commands.mjs</string></array>
  <key>StartCalendarInterval</key>
  <array>
$INTERVALS  </array>
  <key>StandardOutPath</key><string>$LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$LOGS/launchd.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
EOF

# Central hours, moved to the Mac's zone before launchd reads them (the one mover; 1 Nov 2026: this
# installer skipped it and Simone's commands ran 05:00-22:50 Central on an Eastern Mac).
node "$REPO/scripts/ops/plist-central.mjs" "$PLIST" || { echo "NAMED STOP [PLIST_TZ] could not move $PLIST to this Mac's zone; not loaded." >&2; exit 1; }
plutil -lint "$PLIST" >/dev/null
"${LAUNCHD_RELOAD:-$HOME/bin/launchd-reload}" "$PLIST" || exit 1   # the one reload (seq-bin): pauses kept, old schedule on failure
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || { echo "NOT INSTALLED: $LABEL"; exit 1; }
echo "Installed $LABEL — every 10 minutes 06:00–06:20 and 10:00–23:50 Central (simone-commands.mjs)."
