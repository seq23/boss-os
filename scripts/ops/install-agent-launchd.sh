#!/bin/bash
# Install the launch agent that lets Boss OS reach the owner's Mac.
#
# WHY THIS EXISTS. Boss OS can now dispatch a run to `bk_claude_code` — the consumer creates it, the
# guard admits it, and it sits in `backend_runs` with status 'running', awaiting a claim. Nothing
# claimed it, because nothing on this machine was running the agent. `scripts/sync-agent/runner.mjs`
# has existed for a while and no launchd job, cron entry or login item ever invoked it: "exists but
# nothing invokes it", which is the whole reason the Executive Intelligence Report never appeared.
#
# WHAT IT RUNS. `agent.mjs work-once` — claim AT MOST ONE run, execute it through Claude Code,
# report the evidence, exit. Not the `work` daemon: a one-shot on a timer leaves no long-lived
# process holding her session, and an empty queue costs one process start every fifteen minutes and
# nothing else. It matches the shape of the other three agents already on this machine.
#
# THE PASSCODE IS READ FROM THE VAULT AND NEVER WRITTEN ANYWHERE. `vault:run` puts BOSS_PASSCODE in
# the child's environment for the life of the process; the agent exchanges it for a session cookie
# and holds no credential of its own. The plist contains no secret, which is why it is safe to keep
# in version control.

set -euo pipefail

LABEL="com.seq.boss-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$HOME/GitHub/boss-os"
LOGS="$HOME/Library/Logs/boss-agent"

mkdir -p "$LOGS"

# INTERVAL, NOT A CALENDAR TIME, and that is deliberate. The report duty fires at 06:30 Central, but
# a run can be dispatched at any hour — a manual dispatch, a retry, a weekly duty. A job pinned to
# 06:35 would claim the report and leave everything else waiting until tomorrow.
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && npm run --silent vault:run -- node scripts/sync-agent/agent.mjs work-once</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>StandardOutPath</key><string>$LOGS/agent.log</string>
  <key>StandardErrorPath</key><string>$LOGS/agent.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed $LABEL — claiming one run every 15 minutes."
echo "Logs: $LOGS/agent.log"
echo
# RULE 0: an installer that installed nothing must not exit 0 looking pleased. launchctl load is
# silent on success AND on several kinds of failure, so the job is read back rather than assumed.
if launchctl list | grep -q "$LABEL"; then
  echo "Verified: launchd lists $LABEL."
else
  echo "NOT INSTALLED: launchd does not list $LABEL after load. Nothing will claim runs."
  exit 1
fi
