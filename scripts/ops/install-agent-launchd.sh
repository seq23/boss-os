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
# KDP-RESUME RIDES ON THIS JOB RATHER THAN GETTING ITS OWN.
#
# "if i say apprpved she should continue to finish". Simone's watch runs Mon/Wed/Fri at 09:23, so an
# approval given on Wednesday afternoon would sit until Friday — and approving something and
# watching nothing happen for two days is, from her side, the inbox that applied nothing.
#
# THE CALENDAR SYNC RIDES ON IT TOO, five times a day, which is the right cadence for a diary: a
# meeting moved at 10am should not still read as 9am at 4pm. It is one fetch per configured feed and
# exits in about a second when none is configured, which is the state until she copies the secret
# addresses in.
#
# `kdp-resume.mjs` asks Boss OS whether she has approved a cover batch that has not been acted on
# yet, and starts the watch if so. On a normal day it makes one request, finds nothing, and exits in
# about a second. `;` between the steps, not `&&`: a failing sky snapshot must not stop the resume,
# and a failing resume must not stop the agent claiming work.

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
    <string>cd $REPO && npm run --silent vault:run -- node scripts/ops/sky-snapshot.mjs; cd $REPO && npm run --silent vault:run -- node scripts/ops/gmail-metadata.mjs; cd $REPO && npm run --silent vault:run -- node scripts/ops/calendar-sync.mjs; cd $REPO && npm run --silent vault:run -- node scripts/ops/kdp-resume.mjs; cd $REPO && npm run --silent vault:run -- node scripts/sync-agent/agent.mjs work-once</string>
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

# ─── The weekly network refresh ──────────────────────────────────────────────
#
# The contact extraction was a command she had to remember to type, which means someone silent for
# 200 days stays at 200 in the record until she happens to re-run it. The whole instrument exists to
# catch decay she cannot see, and it was itself decaying between runs.
#
# Sunday 18:00: after the week, before the Monday morning gate reads the touch list. It reads the
# mailbox and syncs the code-named list — the mapping never leaves this machine, and nothing about
# it is sent anywhere.
NETWORK_LABEL="com.seq.boss-network"
NETWORK_PLIST="$HOME/Library/LaunchAgents/$NETWORK_LABEL.plist"

cat > "$NETWORK_PLIST" <<NETEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$NETWORK_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && npm run --silent contacts:extract && npm run --silent contacts:sync -- --commit</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOGS/network.log</string>
  <key>StandardErrorPath</key><string>$LOGS/network.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
NETEOF

launchctl unload "$NETWORK_PLIST" 2>/dev/null || true
launchctl load "$NETWORK_PLIST"
echo "Installed $NETWORK_LABEL — Sunday 18:00 Central."

# ─── The weekly property read ────────────────────────────────────────────────
#
# Camille's Search Console analysis and Danielle's shipping heartbeat, in one job because they answer
# halves of the same question: are her assets shipping, and is anyone finding them.
#
# BOTH ARE LOCAL JOBS AND NEITHER CAN BE AN AGENT. The Claude Code runner strips every credential
# from its environment on purpose, so it cannot reach Search Console and cannot use her `gh` auth.
# Agents research the open web; local jobs read her accounts. That split is the architecture.
#
# Monday 07:00, before the week: a performance read on Friday is one she cannot act on until Monday
# anyway, and by then it is stale.
PROPS_LABEL="com.seq.boss-properties"
PROPS_PLIST="$HOME/Library/LaunchAgents/$PROPS_LABEL.plist"

cat > "$PROPS_PLIST" <<PROPSEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$PROPS_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && npm run --silent spry:heartbeat; npm run --silent properties</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOGS/properties.log</string>
  <key>StandardErrorPath</key><string>$LOGS/properties.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PROPSEOF

launchctl unload "$PROPS_PLIST" 2>/dev/null || true
launchctl load "$PROPS_PLIST"
echo "Installed $PROPS_LABEL — Monday 07:00 Central."

# ─── Simone's publication chase ──────────────────────────────────────────────
#
# Seven authored books cannot be published: a server-side flag on the KDP account, with Amazon case
# #51496198 as the only route to it. `duty_kdp_publication` names Simone as the owner and this job
# as the executor, because determining whether a support reply resolves a case needs the SUBJECTS
# AND BODIES of her mail — and the Claude Code runner strips every credential from an agent's
# environment on purpose. Agents research the open web; local jobs read her accounts.
#
# THE SCRIPT AND PROMPT LIVED ONLY IN ~/bin UNTIL 7 SEPTEMBER. They worked, and nothing installed
# them, nothing repaired them, and nothing could tell if they had drifted from what the duty row
# said. The repo copies are now canonical and ~/bin holds symlinks, so there is one of each.
#
# MON/WED/FRI 09:23, WHICH IS NOT ARBITRARY. KDP support replies on weekdays, so a weekend check
# finds the same nothing twice; every-other-day as a 48-hour interval would drift against the clock
# and re-fire on wake, and a day-of-month rule breaks across a month boundary.
KDP_LABEL="com.seq.kdp-watch"
KDP_PLIST="$HOME/Library/LaunchAgents/$KDP_LABEL.plist"
KDP_LOGS="$HOME/Library/Logs/kdp-watch"

mkdir -p "$KDP_LOGS" "$HOME/bin"
chmod +x "$REPO/scripts/ops/kdp-watch.sh"

# ONE COPY OF EACH, AND THE REPO HOLDS IT. `ln -sfn` replaces whatever is at these paths, including
# the older real files — which is the point: two components each keeping their own copy of one
# prompt is the drift this repository names by name.
ln -sfn "$REPO/scripts/ops/kdp-watch.sh" "$HOME/bin/kdp-watch.sh"
ln -sfn "$REPO/scripts/ops/kdp-watch-prompt.md" "$HOME/bin/kdp-watch-prompt.md"

cat > "$KDP_PLIST" <<KDPEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$KDP_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>$REPO/scripts/ops/kdp-watch.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>23</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>23</integer></dict>
    <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>23</integer></dict>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BOSS_OS_REPO</key><string>$REPO</string></dict>
  <key>StandardOutPath</key><string>$KDP_LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$KDP_LOGS/launchd.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
KDPEOF

launchctl unload "$KDP_PLIST" 2>/dev/null || true
launchctl load "$KDP_PLIST"
echo "Installed $KDP_LABEL — Mon/Wed/Fri 09:23 Central."

# ─── Simone's standing KDP triage ────────────────────────────────────────────
#
# "u need to make sure simone has a dedicated task for handling anything related to KDP so she needs
# to check for any KDP emails and read them and determine if she needs to take action."
#
# SEPARATE FROM THE CASE WATCH ABOVE, AND DAILY RATHER THAN MON/WED/FRI. The case watch chases one
# support thread to resolution and ends the day the seven books are Live; this is permanent, and a
# title taken down on a Saturday should not wait until Monday to be noticed.
#
# 09:30 — seven minutes after the case watch, so on Mon/Wed/Fri the two never race for the same Gmail
# session and the case run's determination is already filed when this looks at the wider surface.
SURFACE_LABEL="com.seq.kdp-surface"
SURFACE_PLIST="$HOME/Library/LaunchAgents/$SURFACE_LABEL.plist"
SURFACE_LOGS="$HOME/Library/Logs/kdp-surface"

mkdir -p "$SURFACE_LOGS"
chmod +x "$REPO/scripts/ops/kdp-surface.sh"
ln -sfn "$REPO/scripts/ops/kdp-surface.sh" "$HOME/bin/kdp-surface.sh"
ln -sfn "$REPO/scripts/ops/kdp-surface-prompt.md" "$HOME/bin/kdp-surface-prompt.md"

cat > "$SURFACE_PLIST" <<SURFEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$SURFACE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>$REPO/scripts/ops/kdp-surface.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BOSS_OS_REPO</key><string>$REPO</string></dict>
  <key>StandardOutPath</key><string>$SURFACE_LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$SURFACE_LOGS/launchd.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
SURFEOF

launchctl unload "$SURFACE_PLIST" 2>/dev/null || true
launchctl load "$SURFACE_PLIST"
echo "Installed $SURFACE_LABEL — daily 09:30 Central."

# ─── Monique's mailbox sweep ─────────────────────────────────────────────────
#
# The "missed connections" feature that has been the first outstanding item in OPERATIONS.md since
# it was written: an old buyer asked about a company, recent mail shows somebody has access to it,
# and nothing ever connected the two. `duty_mailbox_sweep` names Monique as the owner and this job
# as the executor, for the same reason Simone's does — matching a past enquiry against present
# supply needs SUBJECTS AND BODIES, and the Claude Code runner strips every credential from an
# agent's environment on purpose.
#
# SUNDAY 18:30, HALF AN HOUR AFTER THE NETWORK REFRESH AT 18:00, and the order is the whole reason
# for the gap. The refresh rebuilds the touch list and the code-name map from mail metadata; the
# sweep names every person by code name and reasons about who has gone quiet. Running the meaning
# pass against a week-old map would produce findings about people who wrote on Friday and would have
# no code name at all for anyone new.
MAILBOX_LABEL="com.seq.boss-mailbox"
MAILBOX_PLIST="$HOME/Library/LaunchAgents/$MAILBOX_LABEL.plist"
MAILBOX_LOGS="$HOME/Library/Logs/mailbox-sweep"

mkdir -p "$MAILBOX_LOGS" "$HOME/.boss-os/mailbox"
chmod +x "$REPO/scripts/ops/mailbox-sweep.sh"

# One copy of each, and the repo holds it.
ln -sfn "$REPO/scripts/ops/mailbox-sweep.sh" "$HOME/bin/mailbox-sweep.sh"
ln -sfn "$REPO/scripts/ops/mailbox-sweep-prompt.md" "$HOME/bin/mailbox-sweep-prompt.md"

cat > "$MAILBOX_PLIST" <<MBXEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$MAILBOX_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>$REPO/scripts/ops/mailbox-sweep.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BOSS_OS_REPO</key><string>$REPO</string></dict>
  <key>StandardOutPath</key><string>$MAILBOX_LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$MAILBOX_LOGS/launchd.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
MBXEOF

launchctl unload "$MAILBOX_PLIST" 2>/dev/null || true
launchctl load "$MAILBOX_PLIST"
echo "Installed $MAILBOX_LABEL — Sunday 18:30 Central."

# ─── Monique's LP reply digest ───────────────────────────────────────────────
#
# "an employee can keep track of all the opt outs and replies and send me an inbox daily summary to
# deliver to the twin agent". Daily rather than weekly because an LP who asked for the deck on
# Tuesday and hears nothing until Sunday is an LP you have lost.
#
# INSTALLED WHILE DORMANT, ON PURPOSE. Nothing can read sequoia@westpeek.ventures until Scooter
# grants domain-wide delegation on that domain, and the script checks the credential register and
# stops with a named reason rather than starting a run that would fail at its first tool call. It
# begins working on its own the morning after he grants it — no reinstall, nobody remembering.
#
# 07:45: after the 07:10 agent tick, before the day starts.
LP_LABEL="com.seq.boss-lp"
LP_PLIST="$HOME/Library/LaunchAgents/$LP_LABEL.plist"
LP_LOGS="$HOME/Library/Logs/lp-replies"

mkdir -p "$LP_LOGS" "$HOME/.boss-os/lp"
chmod +x "$REPO/scripts/ops/lp-replies.sh"
ln -sfn "$REPO/scripts/ops/lp-replies.sh" "$HOME/bin/lp-replies.sh"
ln -sfn "$REPO/scripts/ops/lp-replies-prompt.md" "$HOME/bin/lp-replies-prompt.md"

cat > "$LP_PLIST" <<LPEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LP_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>$REPO/scripts/ops/lp-replies.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>45</integer></dict>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BOSS_OS_REPO</key><string>$REPO</string></dict>
  <key>StandardOutPath</key><string>$LP_LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$LP_LOGS/launchd.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
LPEOF

launchctl unload "$LP_PLIST" 2>/dev/null || true
launchctl load "$LP_PLIST"
echo "Installed $LP_LABEL — daily 07:45 Central, dormant until the West Peek grant exists."

# ─── Toni's credential prober ────────────────────────────────────────────────
#
# She changed her Google password. Google revokes every OAuth refresh token the instant that
# happens, so the claude.ai Gmail connector died silently and Simone's KDP watch ran blind for days
# before a human noticed. There is no gradual signal to watch for and no renewal window to
# anticipate — the only thing that catches it is something that USES each credential on a schedule
# and says what it found.
#
# 06:15, TWENTY MINUTES BEFORE THE FIRST AGENT TICK AND THREE HOURS BEFORE THE KDP WATCH. The point
# is that a dead login is on her screen BEFORE the duty that needs it fails, rather than being
# inferred afterwards from a job that produced nothing.
#
# It costs about a cent a day: the connector cannot be checked from Node at all — it is an OAuth
# grant held by claude.ai, not a secret on this machine — so one very short Haiku run makes one
# Gmail call and prints one word. Named rather than hidden, and cheap against days of blind running.
CRED_LABEL="com.seq.boss-credentials"
CRED_PLIST="$HOME/Library/LaunchAgents/$CRED_LABEL.plist"

cat > "$CRED_PLIST" <<CREDEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$CRED_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && npm run --silent credentials:check</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>15</integer></dict>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BOSS_OS_REPO</key><string>$REPO</string></dict>
  <key>StandardOutPath</key><string>$LOGS/credentials.log</string>
  <key>StandardErrorPath</key><string>$LOGS/credentials.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
CREDEOF

launchctl unload "$CRED_PLIST" 2>/dev/null || true
launchctl load "$CRED_PLIST"
echo "Installed $CRED_LABEL — daily 06:15 Central."

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
  if loaded "$LABEL" && loaded "$PACKET_LABEL" && loaded "$NETWORK_LABEL" && loaded "$PROPS_LABEL" && loaded "$KDP_LABEL" && loaded "$MAILBOX_LABEL" && loaded "$CRED_LABEL" && loaded "$LP_LABEL" && loaded "$SURFACE_LABEL"; then break; fi
  sleep 1
done

missing=""
loaded "$LABEL" || missing="$missing $LABEL"
loaded "$PACKET_LABEL" || missing="$missing $PACKET_LABEL"
loaded "$NETWORK_LABEL" || missing="$missing $NETWORK_LABEL"
loaded "$PROPS_LABEL" || missing="$missing $PROPS_LABEL"
loaded "$KDP_LABEL" || missing="$missing $KDP_LABEL"
loaded "$MAILBOX_LABEL" || missing="$missing $MAILBOX_LABEL"
loaded "$CRED_LABEL" || missing="$missing $CRED_LABEL"
loaded "$LP_LABEL" || missing="$missing $LP_LABEL"
loaded "$SURFACE_LABEL" || missing="$missing $SURFACE_LABEL"

# THE SYMLINKS ARE VERIFIED TOO. An installer that loaded a job pointing at a prompt that is not
# there would exit 0 having installed something inert, which is Rule 0's exact prohibition.
[ -L "$HOME/bin/kdp-watch-prompt.md" ] || missing="$missing ~/bin/kdp-watch-prompt.md(symlink)"
[ -f "$REPO/scripts/ops/kdp-watch-prompt.md" ] || missing="$missing scripts/ops/kdp-watch-prompt.md"
[ -L "$HOME/bin/mailbox-sweep-prompt.md" ] || missing="$missing ~/bin/mailbox-sweep-prompt.md(symlink)"
[ -f "$REPO/scripts/ops/mailbox-sweep-prompt.md" ] || missing="$missing scripts/ops/mailbox-sweep-prompt.md"
[ -L "$HOME/bin/lp-replies-prompt.md" ] || missing="$missing ~/bin/lp-replies-prompt.md(symlink)"
[ -f "$REPO/scripts/ops/lp-replies-prompt.md" ] || missing="$missing scripts/ops/lp-replies-prompt.md"
[ -L "$HOME/bin/kdp-surface-prompt.md" ] || missing="$missing ~/bin/kdp-surface-prompt.md(symlink)"
[ -f "$REPO/scripts/ops/kdp-surface-prompt.md" ] || missing="$missing scripts/ops/kdp-surface-prompt.md"

if [ -z "$missing" ]; then
  echo "Verified: launchd lists $LABEL, $PACKET_LABEL, $NETWORK_LABEL, $PROPS_LABEL, $KDP_LABEL, $MAILBOX_LABEL, $CRED_LABEL, $LP_LABEL and $SURFACE_LABEL."
else
  echo "NOT INSTALLED:$missing — launchd does not list these after load."
  exit 1
fi
