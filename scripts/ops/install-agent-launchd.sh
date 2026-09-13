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

# ─── Monique's weekly people note ────────────────────────────────────────────
#
# "id rather monique just send me deliverables she suggests about people to speak to (no codenames
#  needed)" — 9 September 2026, on scrapping the People tab.
#
# Monday 07:15, fifteen minutes after the property read and thirteen hours after Sunday's contact
# extraction refreshed the file it reads. Monday because a conversation recommended on a Monday can
# still happen inside the same week, and WEEKLY rather than daily because a daily list of people to
# ring is precisely the artefact she deleted.
#
# LOCAL BECAUSE THE NAMES ARE LOCAL. It reads ~/.boss-os/sourcing/CONTACTS.json, which holds real
# names and addresses and never leaves this machine; the email carries the names, and Boss OS gets a
# notice with counts in it and nothing else.
PEOPLE_LABEL="com.seq.boss-people"
PEOPLE_PLIST="$HOME/Library/LaunchAgents/$PEOPLE_LABEL.plist"

cat > "$PEOPLE_PLIST" <<PEOPLEEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$PEOPLE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && bash $REPO/scripts/ops/duty-run.sh people-worth-a-call.mjs -- npm run --silent people:recommend -- --send</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>15</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOGS/people.log</string>
  <key>StandardErrorPath</key><string>$LOGS/people.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PEOPLEEOF

launchctl unload "$PEOPLE_PLIST" 2>/dev/null || true
launchctl load "$PEOPLE_PLIST"
echo "Installed $PEOPLE_LABEL — Monday 07:15 Central (people-worth-a-call.mjs)."

# ─── Monique's brokerage desk: the daily supply watch and the monthly note ───
#
# `duty_inbound_supply` and `duty_interest_nudge`. Both are `local_job` for the same reason, and it
# is the strongest reason in this file: the interest ledger holds NAMED COUNTERPARTIES, the companies
# they trade and the sizes they trade them in, at a FINRA-registered broker-dealer. None of it may
# reach the cloud database — not code-named, not counted — so the reading, the extraction and the
# matching all happen here and only an email leaves the machine.
#
# DAILY AT 07:45, and daily rather than weekly because new supply is perishable in a way nothing else
# in this system is: a block offered on Tuesday is often gone by Friday, and a weekly sweep meets
# half of it after it has filled. It scans only since the last scan, so a normal morning is a few
# hundred messages and a few cents.
#
# `;` NOT `&&` BETWEEN THE THREE STEPS. The scan reads the mailbox, the extract turns candidates into
# ledger rows, the match crosses them. A failing match must not make a completed scan look like a
# failed one — the mail was read either way, and each step says its own named stop in this log.
#
# THE MONTHLY NOTE RIDES ON THE FIRST OF THE MONTH AT 07:30, fifteen minutes before the daily scan,
# so it reasons over yesterday's settled ledger rather than racing a scan that is mid-write.
CAPITAL_LABEL="com.seq.boss-capital"
CAPITAL_PLIST="$HOME/Library/LaunchAgents/$CAPITAL_LABEL.plist"

mkdir -p "$HOME/.boss-os/capital"

cat > "$CAPITAL_PLIST" <<CAPEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$CAPITAL_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && npm run --silent capital:scan; cd $REPO && bash $REPO/scripts/ops/duty-run.sh interest-extract.mjs -- npm run --silent capital:extract; cd $REPO && npm run --silent capital:match -- --send --pointer</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>45</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOGS/capital.log</string>
  <key>StandardErrorPath</key><string>$LOGS/capital.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
CAPEOF

launchctl unload "$CAPITAL_PLIST" 2>/dev/null || true
launchctl load "$CAPITAL_PLIST"
echo "Installed $CAPITAL_LABEL — daily 07:45 Central (interest-ledger.mjs, interest-extract.mjs, interest-match.mjs)."

NUDGE_LABEL="com.seq.boss-capital-nudge"
NUDGE_PLIST="$HOME/Library/LaunchAgents/$NUDGE_LABEL.plist"

cat > "$NUDGE_PLIST" <<NUDGEEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$NUDGE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && bash $REPO/scripts/ops/duty-run.sh interest-match.mjs -- npm run --silent capital:match -- --nudge --send</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Day</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOGS/capital-nudge.log</string>
  <key>StandardErrorPath</key><string>$LOGS/capital-nudge.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
NUDGEEOF

launchctl unload "$NUDGE_PLIST" 2>/dev/null || true
launchctl load "$NUDGE_PLIST"
echo "Installed $NUDGE_LABEL — the 1st at 07:30 Central (interest-match.mjs --nudge)."

# ─── The weekly buyer hunt, against her live book ────────────────────────────
#
# Nothing in this system had ever hunted buyers for what she is actually trying to SELL.
# `buyer-hunt.mjs` is 369 lines of EDGAR N-PORT work and it was reachable from one place: someone
# typing `npm run capital:buyers`. None of the 14 standing duties named it.
#
# Tuesday 07:00 Central, ahead of the 07:15 and 07:45 jobs, because this is the one whose output is a
# list of people to call. It reads a book filed by email over the weekend against a ledger the Sunday
# mailbox sweep refreshed.
#
# TWO DUTIES, ONE PLIST, AND THE ORDER IS THE ARGUMENT. `filing-hunt.mjs` is Danielle's research half
# and runs FIRST, at 06:50 by its duty row; `buyer-hunt.mjs` is Monique's mailbox half and renders the
# combined email at 07:00. Running them the other way round would put last week's filings in this
# week's email and nothing would say so. Each is wrapped separately so each can go red on its own —
# EDGAR unreachable for a week is Danielle's row failing, and it must not hide behind a mailbox half
# that worked fine.
#
# WRAPPED IN duty-run.sh SO THE RUN REACHES `duty_buyer_hunt` IN D1 — "I DONT CARE IF ITS LAUNCHD OR
# D1 - THOSE SHOULD BE LINKED ANYWAY." The token below and `task_input.$.local_job` in migration 0230
# are the same string, and validate:launchd-duty-link proves it in both directions.
#
# `--from-boss` FIRST, and its failure is not this job's failure. It runs whatever she asked for by
# email ("#monique find me a seller of $1B+ OpenAI"); exit 7 is the NAMED STOP for "nothing queued",
# which is the ordinary week and must not turn the scheduled hunt red. Then the book hunt runs, and
# THAT is the one whose exit code the duty row is told about.
BUYERS_LABEL="com.seq.boss-capital-buyers"
BUYERS_PLIST="$HOME/Library/LaunchAgents/$BUYERS_LABEL.plist"

cat > "$BUYERS_PLIST" <<BUYERSEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$BUYERS_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && npm run --silent capital:hunts -- --send; cd $REPO && bash $REPO/scripts/ops/duty-run.sh filing-hunt.mjs -- npm run --silent capital:filings; cd $REPO && bash $REPO/scripts/ops/duty-run.sh buyer-hunt.mjs -- npm run --silent capital:buyers -- --send</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOGS/capital-buyers.log</string>
  <key>StandardErrorPath</key><string>$LOGS/capital-buyers.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
BUYERSEOF

launchctl unload "$BUYERS_PLIST" 2>/dev/null || true
launchctl load "$BUYERS_PLIST"
echo "Installed $BUYERS_LABEL — Tuesdays 07:00 Central (buyer-hunt.mjs, duty_buyer_hunt)."

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
# ─── Danielle's daily pass over the grid ────────────────────────────────────
#
# 06:20, ahead of the 06:45 sourcing sweep and well ahead of anything she reads. The side-hustle slot
# in today's contract reads what this found; an examination that ran after the contract was built
# would put yesterday's news in front of her every morning.
#
# WRAPPED IN duty-run.sh SO THE RUN REACHES `duty_grid_watch` IN D1 — "I DONT CARE IF ITS LAUNCHD OR
# D1 — THOSE SHOULD BE LINKED ANYWAY." The token here and the token in the duty row's
# task_input.$.local_job are the same string, and `validate:launchd-duty-link` proves it in both
# directions, offline.
#
# READ-ONLY. It opens no branch, no PR and no commit in any grid repository, and it never touches a
# west-peek repo — the exclusions are named in src/shared/boss/grid.mjs and applied by the run.
GRID_LABEL="com.seq.boss-grid"
cat > "$HOME/Library/LaunchAgents/$GRID_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$GRID_LABEL</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-lc</string>
      <string>cd $REPO && bash $REPO/scripts/ops/duty-run.sh grid-watch.mjs -- npm run --silent grid:post</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>20</integer></dict>
    <key>StandardOutPath</key><string>$LOGS/grid.log</string>
    <key>StandardErrorPath</key><string>$LOGS/grid.log</string>
    <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST
launchctl unload "$HOME/Library/LaunchAgents/$GRID_LABEL.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/$GRID_LABEL.plist"

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
    <string>bash $REPO/scripts/ops/duty-run.sh kdp-watch.sh -- bash $REPO/scripts/ops/kdp-watch.sh</string>
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
    <string>bash $REPO/scripts/ops/duty-run.sh kdp-surface.sh -- bash $REPO/scripts/ops/kdp-surface.sh</string>
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

# ─── Simone ACTING: the covers she approved, put up, and Publish pressed ─────
#
# THE JOB THAT DID NOT EXIST, AND ITS ABSENCE COST TWO DAYS.
#
# On 9 September at 14:00 seven replacement covers were raised in her Inbox. At 14:30 she approved
# them. `approvals/resume.ts` fired its `kdp_cover_upload` handler, stamped `executed_at`, wrote
# `execution_status = 'executed'` — and its entire effect was a sentence on the deliverable saying
# what Simone would do on her NEXT RUN. No run does it. The two KDP jobs above are `claude -p`
# processes that read Amazon and report, and a scheduled `claude -p` has no browser tools at all.
#
# So this is not a missing approval or a missing consumer. It is a consumer that recorded an
# intention, stamped a receipt, and handed off to a scheduled run THAT WAS NEVER SCHEDULED. This
# stanza is that run, and `validate:approval-promise` now fails the build if a resume handler ever
# again promises work to a job nothing installs.
#
# 09:45, after the case watch (09:23) and the triage (09:30), so the three never race for a session
# and this one runs with the day's determination already filed.
#
# IT ASKS HER FOR NOTHING. Her approval is found and acted on; no judgement call is raised and
# nothing she has not approved is ever published.
PUBLISH_LABEL="com.seq.kdp-publish"
PUBLISH_PLIST="$HOME/Library/LaunchAgents/$PUBLISH_LABEL.plist"
PUBLISH_LOGS="$HOME/Library/Logs/kdp-publish"
mkdir -p "$PUBLISH_LOGS" "$HOME/bin"
chmod +x "$REPO/scripts/ops/kdp-publish.sh" 2>/dev/null || true
ln -sfn "$REPO/scripts/ops/kdp-publish.sh" "$HOME/bin/kdp-publish.sh"

cat > "$PUBLISH_PLIST" <<PUBEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$PUBLISH_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>bash $REPO/scripts/ops/duty-run.sh kdp-publish.sh -- bash $REPO/scripts/ops/kdp-publish.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>45</integer></dict>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BOSS_OS_REPO</key><string>$REPO</string></dict>
  <key>StandardOutPath</key><string>$PUBLISH_LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$PUBLISH_LOGS/launchd.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PUBEOF

launchctl unload "$PUBLISH_PLIST" 2>/dev/null || true
launchctl load "$PUBLISH_PLIST"
echo "Installed $PUBLISH_LABEL — daily 09:45 Central."

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
    <string>bash $REPO/scripts/ops/duty-run.sh mailbox-sweep.sh -- bash $REPO/scripts/ops/mailbox-sweep.sh</string>
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

# ─── Danielle's monthly Ahrefs audit pass ────────────────────────────────────
#
# MONTHLY, per her instruction of 13 Sep 2026: "fix it so danielle does this ahref sweep on a
# schedule (1x per month is fine)". The duty row carries the cadence (migration 0232); this fires
# the tick that asks whether it is due.
#
# 06:00 CENTRAL, AND THE HOUR IS DERIVED. Every Site Audit mail from sa@ahrefs.com was timed before
# this was chosen: Thu 27 Aug 02:20-02:31 UTC, Thu 3 Sep 01:07-03:58, Thu 10 Sep 01:07-02:42.
# Ahrefs recrawls the account and delivers overnight UTC, which is the previous evening here. 06:00
# Central is 11:00 UTC - seven hours after the latest arrival ever observed, and the start of her
# day, so a PR she has to merge is waiting when she opens the machine. Running BEFORE the batch
# lands would grade the previous crawl.
#
# ─── DAILY TICK, MONTHLY WORK, AND WHY IT IS NOT A WIDER SCHEDULE ────────────
#
# MEASURED 13 Sep 2026: this job was LOADED with runs = 0 and last exit code "(never exited)". It
# had never fired once, and the log directory was empty. The cause is benign - the plist file is
# dated 11 Sep 18:06, AFTER that week's Thursday 06:00 window, so its first occurrence had simply
# not come round - and that is exactly why the design had to change rather than the schedule widen.
#
# A StartCalendarInterval naming ONE moment a week had one chance to fire, and it looks identical
# whether it is waiting or dead. She runs a laptop that sleeps on battery. launchd does re-fire a
# missed calendar entry when the machine WAKES, so ordinary sleep was already covered - but a
# machine shut down through the moment loses the whole period, and at a monthly cadence that is a
# month, from a job whose whole value is that it keeps happening.
#
# So the entry fires EVERY DAY at 06:00 and `duty-run.sh --only-if-due` asks the duty row whether
# there is work. `next_due_at` is the only clock, so there is no second schedule to drift. On
# twenty-nine days out of thirty the tick exits 0 in under a second having deliberately done
# nothing AND SAID SO in its log; on the day the work is due, it runs. A missed day now costs a day
# instead of a month, and a day that launchd misses entirely is picked up by tomorrow's.
#
# AN UNREACHABLE BOSS OS IS A FAILURE, NOT A SKIP - duty-due.mjs exits 10 for "not due" and
# something else for "could not tell", and the wrapper keeps them apart. Conflating them would let
# an outage on the 1st retire the job in silence.
#
# THE FLAG COMES AFTER THE SCRIPT NAME so validate:launchd-duty-link still reads the local_job
# immediately after `duty-run.sh` and the launchd-to-duty link stays provable offline.
#
# A LOCAL JOB AND NOT AN AGENT, for three separate reasons: it reads the contents of her mailbox,
# which the Claude Code runner cannot; it needs working copies, git and gh, which a Worker has none
# of; and it proves each fix with that repository's own validators, which means running them.
AHREFS_LABEL="com.seq.boss-ahrefs-audit"
AHREFS_PLIST="$HOME/Library/LaunchAgents/$AHREFS_LABEL.plist"
AHREFS_LOGS="$HOME/Library/Logs/ahrefs-audit-fix"

mkdir -p "$AHREFS_LOGS" "$HOME/.boss-os/site-audit"
chmod +x "$REPO/scripts/ops/ahrefs-audit-fix.sh"

ln -sfn "$REPO/scripts/ops/ahrefs-audit-fix.sh" "$HOME/bin/ahrefs-audit-fix.sh"
ln -sfn "$REPO/scripts/ops/ahrefs-audit-fix-prompt.md" "$HOME/bin/ahrefs-audit-fix-prompt.md"

cat > "$AHREFS_PLIST" <<AHREOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$AHREFS_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>bash $REPO/scripts/ops/duty-run.sh ahrefs-audit-fix.sh --only-if-due -- bash $REPO/scripts/ops/ahrefs-audit-fix.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BOSS_OS_REPO</key><string>$REPO</string></dict>
  <key>StandardOutPath</key><string>$AHREFS_LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$AHREFS_LOGS/launchd.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
AHREOF

launchctl unload "$AHREFS_PLIST" 2>/dev/null || true
launchctl load "$AHREFS_PLIST"
echo "Installed $AHREFS_LABEL — daily 06:00 Central tick, monthly work (asks the duty row)."

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
    <string>bash $REPO/scripts/ops/duty-run.sh lp-replies.sh -- bash $REPO/scripts/ops/lp-replies.sh</string>
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

# ─── The two things Scooter reads on a Wednesday ─────────────────────────────
#
# "i want positive replies to be weekly before wednesday and LP replies can happen daily and she
#  needs to update the google sheet for scooter weekly before wednesday"
#
# BOTH WERE BUILT AND SCHEDULED BY NOTHING. `lp-positive.mjs` and `lp-tracker-sync.mjs` are committed,
# registered as npm scripts, and ran only when a human typed the command — "exists but nothing
# invokes it", the defect class this repository names by name. His tab fell 29 rows behind within
# 48 hours of being brought current by hand.
#
# TUESDAY, NOT WEDNESDAY. The Sequoia // Scooter Sync is Wednesdays at 11:00 Central, so "before
# Wednesday" means "with time to read it before that meeting". A job that fires at 07:45 on Wednesday
# and fails leaves her walking into the 11:00 with nothing and no time to fix it; Tuesday leaves a
# whole day to notice and re-run by hand.
#
# 07:15 THEN 08:15, AROUND THE DAILY LP READ AT 07:45. The sheet goes first because its deadline
# belongs to somebody else's calendar. The positive-replies note goes after the daily read, so it
# works on a mailbox whose daily pass is finished rather than racing it for the same Gmail session.
#
# `&&` INSIDE THE SHEET JOB, NOT `;`. Outcomes grade the rows the append just added, so an append
# that failed must not be followed by a run that writes a Status across a sheet still missing rows.
SHEET_LABEL="com.seq.boss-scooter-sheet"
SHEET_PLIST="$HOME/Library/LaunchAgents/$SHEET_LABEL.plist"

cat > "$SHEET_PLIST" <<SHEETEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$SHEET_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && bash $REPO/scripts/ops/duty-run.sh lp-tracker-sync.mjs -- bash -c 'npm run --silent lp:sync -- --commit &amp;&amp; npm run --silent lp:outcomes -- --commit'</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>15</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOGS/scooter-sheet.log</string>
  <key>StandardErrorPath</key><string>$LOGS/scooter-sheet.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
SHEETEOF

launchctl unload "$SHEET_PLIST" 2>/dev/null || true
launchctl load "$SHEET_PLIST"
echo "Installed $SHEET_LABEL — Tuesday 07:15 Central (lp-tracker-sync.mjs then lp-outcomes.mjs)."

POSITIVE_LABEL="com.seq.boss-lp-positive"
POSITIVE_PLIST="$HOME/Library/LaunchAgents/$POSITIVE_LABEL.plist"

cat > "$POSITIVE_PLIST" <<POSEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$POSITIVE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO && bash $REPO/scripts/ops/duty-run.sh lp-positive.mjs -- npm run --silent lp:positive -- --email</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>15</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOGS/lp-positive.log</string>
  <key>StandardErrorPath</key><string>$LOGS/lp-positive.err</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
POSEOF

launchctl unload "$POSITIVE_PLIST" 2>/dev/null || true
launchctl load "$POSITIVE_PLIST"
echo "Installed $POSITIVE_LABEL — Tuesday 08:15 Central (lp-positive.mjs --email)."

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

# ─── ONE LIST, BUILT AS IT IS CHECKED ────────────────────────────────────────
#
# This verifier used to keep THREE lists: the `loaded &&` wait above, these checks, and a hardcoded
# sentence at the bottom naming the labels. Adding com.seq.kdp-publish exposed it immediately — the
# job installed, the check passed, and the summary did not mention it, which is the "two components
# each keeping their own list" defect inside the very script that installs the fix for it.
#
# `want` is now the single list. Every label checked is appended, and the summary prints what was
# checked rather than what somebody remembered to type.
missing=""
checked=""
require_loaded() { checked="$checked $1"; loaded "$1" || missing="$missing $1"; }
require_loaded "$LABEL"
require_loaded "$PACKET_LABEL"
require_loaded "$NETWORK_LABEL"
require_loaded "$PROPS_LABEL"
# ADDED WITH THE JOB, NOT AFTERWARDS. The first run installed com.seq.boss-people and then printed a
# "Verified" line that did not mention it — the installer and its own verifier each keeping their own
# list of jobs, which is the defect this file's comments warn about, inside this file.
require_loaded "$PEOPLE_LABEL"
require_loaded "$KDP_LABEL"
require_loaded "$MAILBOX_LABEL"
require_loaded "$CRED_LABEL"
require_loaded "$LP_LABEL"
require_loaded "$SURFACE_LABEL"
# The acting KDP job. Added here at the same time as its stanza, because this verifier keeps its own
# list and a job installed but unverified is the half-wired state that lets an absence go unnoticed —
# which is how kdp-publish came not to exist for two days in the first place.
require_loaded "$PUBLISH_LABEL"
# ADDED WITH THE JOBS, NOT AFTERWARDS — for the second time, and the note above is why. Four jobs
# were installed on 9 September and the "Verified" line named none of them: it loaded them, said
# nothing about them, and would have kept reporting a clean install if any had failed to load.
require_loaded "$CAPITAL_LABEL"
require_loaded "$NUDGE_LABEL"
require_loaded "$SHEET_LABEL"
require_loaded "$POSITIVE_LABEL"
# ADDED WITH THE JOB, FOR THE THIRD TIME, AND THE TWO NOTES ABOVE ARE WHY.
require_loaded "$GRID_LABEL"

# THE SYMLINKS ARE VERIFIED TOO. An installer that loaded a job pointing at a prompt that is not
# there would exit 0 having installed something inert, which is Rule 0's exact prohibition.
[ -L "$HOME/bin/kdp-watch-prompt.md" ] || missing="$missing ~/bin/kdp-watch-prompt.md(symlink)"
[ -f "$REPO/scripts/ops/kdp-watch-prompt.md" ] || missing="$missing scripts/ops/kdp-watch-prompt.md"
[ -L "$HOME/bin/mailbox-sweep-prompt.md" ] || missing="$missing ~/bin/mailbox-sweep-prompt.md(symlink)"
[ -f "$REPO/scripts/ops/mailbox-sweep-prompt.md" ] || missing="$missing scripts/ops/mailbox-sweep-prompt.md"
[ -L "$HOME/bin/ahrefs-audit-fix.sh" ] || missing="$missing ~/bin/ahrefs-audit-fix.sh(symlink)"
[ -L "$HOME/bin/ahrefs-audit-fix-prompt.md" ] || missing="$missing ~/bin/ahrefs-audit-fix-prompt.md"
[ -f "$REPO/scripts/ops/ahrefs-audit-fix-prompt.md" ] || missing="$missing scripts/ops/ahrefs-audit-fix-prompt.md"
[ -L "$HOME/bin/lp-replies-prompt.md" ] || missing="$missing ~/bin/lp-replies-prompt.md(symlink)"
[ -f "$REPO/scripts/ops/lp-replies-prompt.md" ] || missing="$missing scripts/ops/lp-replies-prompt.md"
[ -L "$HOME/bin/kdp-surface-prompt.md" ] || missing="$missing ~/bin/kdp-surface-prompt.md(symlink)"
[ -f "$REPO/scripts/ops/kdp-surface-prompt.md" ] || missing="$missing scripts/ops/kdp-surface-prompt.md"

if [ -z "$missing" ]; then
  echo "Verified: launchd lists$checked."
else
  echo "NOT INSTALLED:$missing — launchd does not list these after load."
  exit 1
fi
