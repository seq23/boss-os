#!/bin/bash
#
# Installs launchd com.seq.boss-mail-tail: the tail on her Boss OS mail (boss-mail-tail.sh), every
# 15 minutes. Called by install-agent-launchd.sh, and runnable alone so installing it never reloads
# (and so never kills) the Mac's other lanes mid-run.
set -euo pipefail
REPO="${BOSS_OS_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
MT_LABEL="com.seq.boss-mail-tail"
MT_PLIST="$HOME/Library/LaunchAgents/$MT_LABEL.plist"
MT_LOGS="$HOME/Library/Logs/boss-mail-tail"
mkdir -p "$MT_LOGS"
chmod +x "$REPO/scripts/ops/boss-mail-tail.sh" "$REPO/scripts/ops/boss-mail-tail-run.sh" "$REPO/scripts/ops/boss-mail-tail-report.mjs"
cat > "$MT_PLIST" <<MTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$MT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>bash $REPO/scripts/ops/boss-mail-tail.sh</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>EnvironmentVariables</key>
  <dict><key>BOSS_OS_REPO</key><string>$REPO</string></dict>
  <key>StandardOutPath</key><string>$MT_LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$MT_LOGS/launchd.err</string>
  <key>RunAtLoad</key><true/>
  <key>AbandonProcessGroup</key><true/>
</dict></plist>
MTEOF
plutil -lint "$MT_PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$MT_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$MT_PLIST"
echo "Installed $MT_LABEL — every 15 minutes (boss-mail-tail.sh; report from simone@sequoiataylor.com)."
