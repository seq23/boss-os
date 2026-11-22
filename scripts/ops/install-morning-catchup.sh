#!/bin/bash
# THE MORNING CATCH-UP (scripts/ops/morning-catchup.mjs): 06:05 and 06:14 Central, before Simone's 06:40
# morning email, AND whenever the Mac comes up (RunAtLoad). The Mac's day (her ruling 21 Nov 2026): every
# morning job is done by 06:30 with twice its worst runtime to spare, and the Mac is off 07:00-10:00, so the
# after-the-email run (the long producers, for Today and tomorrow's email) moved from 06:45 to 10:10, and
# the 10:00 boot (RunAtLoad) usually gets there first.
#
# 3 Nov 2026 (repair rc_m6gtk44dhfjq6rvj): a reboot killed com.seq.boss-capital mid-chain, so
# capital:grid never ran and "deals"/"monique_found" missed the email. The 06:32 slot was the fix.
# 9 Nov 2026 (repair rc_m708yvvt99yvy416): the Mac was OFF from ~19:10 on 8 Nov until 07:36 on 9 Nov.
# launchd replays a calendar slot missed in sleep, never one missed across a shutdown, so neither the
# 05:30 capital chain nor this 06:32 catch-up ran, and "deals" missed the email again. RunAtLoad makes
# the Mac coming up run the catch-up: before 06:40 it saves the email; after, it writes Today and
# tomorrow's email (the run says which).
# 16 Nov 2026 (repair rc_m7j94r6q6f5dx58g): the Mac booted at 06:39, so RunAtLoad ran the catch-up BEFORE
# the email, where a long producer (the Monday sites:audit, "grid_repos") is refused, and nothing ran it
# again that day: the after-the-email run was reachable only by a late boot. A second slot, 06:45 Central
# (five minutes after the 06:40 email), is that after-email run; on a day with nothing missing it does nothing.
#
# Called by install-agent-launchd.sh; safe to run on its own, so this one job can be reinstalled
# without unloading every other job (and killing a scheduled one mid-run).
set -euo pipefail
"${LAUNCHD_RELOAD:-$HOME/bin/launchd-reload}" --seed >/dev/null
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
  <array>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>5</integer></dict>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>14</integer></dict>
    <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>10</integer></dict>
  </array>
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
"${LAUNCHD_RELOAD:-$HOME/bin/launchd-reload}" "$MORNCATCHUP_PLIST" || exit 1   # the one reload (seq-bin): pauses kept, old schedule on failure
launchctl print "gui/$(id -u)/$MORNCATCHUP_LABEL" >/dev/null 2>&1 || { echo "NOT INSTALLED: $MORNCATCHUP_LABEL"; exit 1; }
echo "Installed $MORNCATCHUP_LABEL — daily 06:05, 06:14 and 10:10 Central, and whenever the Mac comes up."

# THE SLOT CATCH-UP (scripts/ops/missed-slots.mjs), every 30 minutes and at load (20 Nov 2026). The
# 01:40 backup missed 16 and 20 Nov: the lid was closed, so the Mac slept through the slot, woke only
# briefly, and was then restarted; the morning catch-up above runs at its slots and at boot only, never on a
# wake from sleep. Every 30 minutes, any com.seq.* job whose daily (or weekly) slot today is past with
# no log since is started once; a daily job silent for 36 hours is named in the morning email.
SLOTS_LABEL="com.seq.boss-slot-catchup"
SLOTS_PLIST="$HOME/Library/LaunchAgents/$SLOTS_LABEL.plist"
cat > "$SLOTS_PLIST" <<SLOTSEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$SLOTS_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO &amp;&amp; node scripts/ops/missed-slots.mjs</string>
  </array>
  <key>StartInterval</key><integer>1800</integer>
  <key>StandardOutPath</key><string>$LOGS/slot-catchup.log</string>
  <key>StandardErrorPath</key><string>$LOGS/slot-catchup.err</string>
  <key>RunAtLoad</key><true/>
</dict></plist>
SLOTSEOF
lint_plist "$SLOTS_PLIST"   # the same mover: Central, and behind mac-window like every job
"${LAUNCHD_RELOAD:-$HOME/bin/launchd-reload}" "$SLOTS_PLIST" || exit 1   # the one reload (seq-bin): pauses kept, old schedule on failure
launchctl print "gui/$(id -u)/$SLOTS_LABEL" >/dev/null 2>&1 || { echo "NOT INSTALLED: $SLOTS_LABEL"; exit 1; }
echo "Installed $SLOTS_LABEL — every 30 minutes and whenever the Mac comes up."
