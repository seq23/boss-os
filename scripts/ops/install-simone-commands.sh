#!/bin/bash
# Simone's hands on her Mac (scripts/ops/simone-commands.mjs): every 10 minutes, 06:00–23:00 Central.
# Lookups through her own Drive and Gmail, drafts in her voice, bounce checks, and the plain notices
# the Worker laid out. Never sends to a third party: every email to a person waits for her Send.
# Called by install-agent-launchd.sh; safe to run on its own.
set -euo pipefail
REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
LABEL="com.seq.boss-simone-commands"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/simone-commands"
mkdir -p "$LOGS"

INTERVALS=""
for H in 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23; do
  for M in 0 10 20 30 40 50; do
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

plutil -lint "$PLIST" >/dev/null
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
launchctl list | grep -q "$LABEL" || { echo "NOT INSTALLED: $LABEL"; exit 1; }
echo "Installed $LABEL — every 10 minutes 06:00–23:00 Central (simone-commands.mjs)."
