#!/bin/bash
# Install the launch agent that lets Boss OS reach the owner's Mac.
#
# WHY THIS EXISTS. Boss OS can now dispatch a run to `bk_claude_code` — the consumer creates it, the
# guard admits it, and it sits in `backend_runs` with status 'running', awaiting a claim. Nothing
# claimed it, because nothing on this machine was running the agent. `scripts/sync-agent/runner.mjs`
# has existed for a while and no launchd job, cron entry or login item ever invoked it: "exists but
# nothing invokes it", which is the whole reason the Executive Intelligence Report never appeared.
#
# WHAT IT RUNS, AND WHAT IT EMPHATICALLY DOES NOT. `agent.mjs work-once` — ask the cloud whether a
# run is waiting for this machine, and if one is, execute it through Claude Code and report the
# evidence. If nothing is queued it exits in about a second having done nothing. It does not watch,
# record, screenshot or observe anything; it has no eyes on the machine at all. The only thing it
# reads is a task Boss OS itself dispatched.
#
# One-shot on a timer rather than the `work` daemon: no long-lived process sits holding her session.
#
# THE SKY SNAPSHOT RUNS FIRST, and it is separated by `;` rather than `&&` on purpose: if it fails
# the run must still happen. The first real report filed three gaps because it went to the open web
# for planetary positions this system already computes to about an arcminute, and got 403s. It was
# right to refuse to invent them; it simply had no way to ask. `sky-snapshot.mjs` leaves SKY.json in
# the workspace so it never has to.
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

# THE DEVICE ID IS NOT A SECRET AND DOES NOT BELONG IN THE VAULT. It names which machine claimed a
# run so the evidence says where the work happened; anyone reading the audit log sees it anyway.
# `vault:run` carries secrets, this carries an identifier, and keeping them apart is what stops the
# vault turning into a config file.
DEVICE_ID="${BOSS_OS_DEVICE_ID:-dev_mac_seq}"

mkdir -p "$LOGS"

# FIVE TIMES A DAY, MATCHED TO WHEN WORK APPEARS — not a poll.
#
# The first draft ran every fifteen minutes, which is ninety-six process starts a day for a queue
# that receives ONE item on a normal morning. That is the same shape as the 96x/day runaway this
# system already replaced once, and the owner called it out before it ever ran.
#
# The report duty fires at 06:30 Central, so the first three slots cover it and two retries. The
# midday and evening slots catch anything dispatched by hand during the day. A run dispatched at
# 15:00 waits until 18:35 rather than for ever, and `npm run vault:run -- node
# scripts/sync-agent/agent.mjs work-once` claims it immediately if she does not want to wait.
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
    <string>cd $REPO && npm run --silent vault:run -- node scripts/ops/sky-snapshot.mjs; cd $REPO && npm run --silent vault:run -- node scripts/ops/gmail-metadata.mjs; cd $REPO && npm run --silent vault:run -- node scripts/sync-agent/agent.mjs work-once</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>35</integer></dict>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>50</integer></dict>
    <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>10</integer></dict>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>35</integer></dict>
    <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>35</integer></dict>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BOSS_OS_DEVICE_ID</key><string>$DEVICE_ID</string></dict>
  <key>StandardOutPath</key><string>$LOGS/agent.log</string>
  <key>StandardErrorPath</key><string>$LOGS/agent.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

# ─── The Wednesday packet reminder ───────────────────────────────────────────
#
# A SEPARATE JOB, because it runs on two weekdays rather than five times a day, and merging two
# schedules into one plist means the packet either fires five times a day or the agent runs twice a
# week. StartCalendarInterval takes a Weekday, so each job says plainly when it runs.
#
# WEDNESDAY 07:00 ONLY, WHICH WAS HER CALL. It also fired Tuesday at 17:00, on my reasoning that a
# blocking item needs hours to act on. Asked directly, she wanted Wednesday morning alone — and that
# follows from what the packet turned out to be FOR: showing him the week's work, which is read on
# the way into the meeting rather than acted on the night before.
PACKET_LABEL="com.seq.boss-packet"
PACKET_PLIST="$HOME/Library/LaunchAgents/$PACKET_LABEL.plist"

cat > "$PACKET_PLIST" <<PACKETEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$PACKET_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && npm run --silent packet:remind</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOGS/packet.log</string>
  <key>StandardErrorPath</key><string>$LOGS/packet.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PACKETEOF

launchctl unload "$PACKET_PLIST" 2>/dev/null || true
launchctl load "$PACKET_PLIST"

echo "Installed $LABEL — checks for queued work at 06:35, 06:50, 07:10, 12:35 and 18:35 Central."
echo "Device: $DEVICE_ID · logs: $LOGS/agent.log"
echo
# RULE 0: an installer that installed nothing must not exit 0 looking pleased. launchctl load is
# silent on success AND on several kinds of failure, so the jobs are read back rather than assumed.
#
# RETRIED, BECAUSE THE FIRST VERSION LIED IN THE OTHER DIRECTION. `launchctl list` did not yet show
# a job a fraction of a second after `launchctl load` returned, so the installer announced NOT
# INSTALLED for an agent that was in fact loaded — and a false alarm from a verifier is worse than
# no verifier, because it sends someone chasing a problem that does not exist and teaches them to
# ignore the next one.
# `launchctl print` asks about ONE service rather than scanning a list, and answers as soon as the
# job is registered. `launchctl list | grep` lagged by more than five seconds when both jobs were
# cycled in the same run — long enough for the installer to declare a correctly loaded agent missing.
loaded() { launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1; }

for _ in $(seq 1 20); do
  if loaded "$LABEL" && loaded "$PACKET_LABEL"; then break; fi
  sleep 1
done

missing=""
loaded "$LABEL" || missing="$missing $LABEL"
loaded "$PACKET_LABEL" || missing="$missing $PACKET_LABEL"

if [ -z "$missing" ]; then
  echo "Verified: launchd lists $LABEL and $PACKET_LABEL."
else
  echo "NOT INSTALLED:$missing — launchd does not list these after load."
  exit 1
fi
