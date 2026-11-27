#!/usr/bin/env bash
set -u

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/flock.sh"
hold_lock "${BOSS_OS_CAPITAL_DIR:-$HOME/.boss-os/capital}/scan.flock"
case $? in
  0) node "$script_dir/interest-ledger.mjs" "$@" ;;
  1) echo "NAMED STOP [CAPITAL_SCAN_BUSY] Another scan owns the current window." >&2; exit 75 ;;
  *) echo "NAMED STOP [CAPITAL_SCAN_LOCK] The scan window could not be locked." >&2; exit 75 ;;
esac
