#!/bin/bash
# Put Boss OS on her desktop as an application, rather than a tab she has to find.
#
# WHY THIS IS NOT COSMETIC. Boss OS is a browser tab among thirty, which means opening it is a
# decision she makes rather than a thing she does. The whole system exists to remove decisions at
# 6am, and it starts with a bookmark she has to remember. An icon in the Dock is the difference
# between a system she uses and one she means to.
#
# TWO APPS, BECAUSE THEY ARE GENUINELY DIFFERENT MACHINES:
#
#   Boss OS         — the deployed Worker, her real data, needs the internet.
#   Boss OS (Local) — a Worker running on this laptop against a local database, no network at all.
#
# THE LOCAL ONE IS NOT AN OFFLINE COPY OF HER DATA and the app says so on first launch. It runs the
# same code against a SEPARATE, EMPTY database in .wrangler/state. That distinction has to be
# obvious, because an app that looked like Boss OS and quietly showed a different database would be
# the worst possible failure — she would trust an empty screen.
#
# A CHROME APP WINDOW, not a full browser: no tabs, no address bar, its own Dock icon, its own
# window in Mission Control. `--app=` has done this for years and needs nothing installed.

set -euo pipefail

REPO="${BOSS_OS_REPO:-$HOME/GitHub/boss-os}"
ORIGIN="${BOSS_OS_ORIGIN:-https://boss.sequoiataylor.com}"
APPS="$HOME/Applications"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

mkdir -p "$APPS"

# A dedicated profile keeps the app window signed in independently of her everyday browsing, so
# clearing cookies in Chrome does not sign her out of her own operating system.
PROFILE="$HOME/.boss-os/chrome-profile"

make_app() {
  local name="$1" command="$2" emoji="$3"
  local dir="$APPS/$name.app/Contents"
  rm -rf "$APPS/$name.app"
  mkdir -p "$dir/MacOS" "$dir/Resources"

  cat > "$dir/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundleDisplayName</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>com.seq.$(echo "$name" | tr '[:upper:] ()' '[:lower:]--' )</string>
  <key>CFBundleExecutable</key><string>run</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><false/>
</dict></plist>
PLIST

  printf '%s\n' '#!/bin/bash' "$command" > "$dir/MacOS/run"
  chmod +x "$dir/MacOS/run"
  echo "  $emoji $APPS/$name.app"
}

# ─── The cloud app ───────────────────────────────────────────────────────────
make_app "Boss OS" "exec \"$CHROME\" --app=\"$ORIGIN\" --user-data-dir=\"$PROFILE\" --no-first-run" "☁️"

# ─── The local app ───────────────────────────────────────────────────────────
#
# It starts the Worker, WAITS FOR IT TO ANSWER, and only then opens a window. Opening the browser
# first shows a connection error for several seconds every single launch, which reads as broken.
#
# The server is left running after the window closes, deliberately: quitting it on window close
# would kill the database mid-write if she closed the window during a save.
LOCAL_CMD='PORT=8787
cd '"$REPO"'
if ! curl -sf "http://127.0.0.1:$PORT/api/boss/health" >/dev/null 2>&1; then
  osascript -e "display notification \"Starting the local Worker — this takes a few seconds.\" with title \"Boss OS (Local)\"" || true
  nohup npm run dev >"$HOME/.boss-os/local-worker.log" 2>&1 &
  for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:$PORT/api/boss/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi
if ! curl -sf "http://127.0.0.1:$PORT/api/boss/health" >/dev/null 2>&1; then
  osascript -e "display alert \"Boss OS (Local) did not start\" message \"See ~/.boss-os/local-worker.log. Run npm run migrate:local once if this is the first time.\"" || true
  exit 1
fi
exec "'"$CHROME"'" --app="http://127.0.0.1:$PORT" --user-data-dir="'"$PROFILE"'-local" --no-first-run'

make_app "Boss OS (Local)" "$LOCAL_CMD" "💻"

echo
echo "Two apps installed in ~/Applications. Drag either to the Dock."
echo
echo "  Boss OS          — your real data, needs the internet."
echo "  Boss OS (Local)  — this laptop only, no network, SEPARATE EMPTY DATABASE."
echo
echo "Before the local one works the first time:  cd $REPO && npm run migrate:local"

# RULE 0: an installer that installed nothing must not exit 0 looking pleased.
missing=""
for n in "Boss OS" "Boss OS (Local)"; do
  [ -x "$APPS/$n.app/Contents/MacOS/run" ] || missing="$missing \"$n\""
done
if [ -n "$missing" ]; then
  echo "NOT INSTALLED:$missing"
  exit 1
fi
if [ ! -x "$CHROME" ]; then
  # Named rather than silently producing an app that fails on first click.
  echo
  echo "WARNING: Google Chrome is not at $CHROME, so both apps will fail to open a window."
  exit 1
fi
echo
echo "Verified: both app bundles are executable and Chrome is where they expect it."
