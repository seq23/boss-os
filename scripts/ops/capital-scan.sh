#!/usr/bin/env bash
set -u

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/flock.sh"
job=interest-ledger.mjs
case "${1:-}" in
  --grid) job=interest-grid.mjs; shift ;;
  --extract) job=interest-extract.mjs; shift ;;
  --ledger-hunt) job=ledger-hunt.mjs; shift ;;
  --buyer-hunt) job=buyer-hunt.mjs; shift ;;
  --seller-hunt) job=seller-hunt.mjs; shift ;;
  --filing-hunt) job=filing-hunt.mjs; shift ;;
esac
hold_lock "${BOSS_OS_CAPITAL_DIR:-$HOME/.boss-os/capital}/scan.flock"
case $? in
  0) node "$script_dir/$job" "$@" ;;
  1) echo "NAMED STOP [CAPITAL_SCAN_BUSY] Another capital job holds the scan and research files." >&2; exit 75 ;;
  *) echo "NAMED STOP [CAPITAL_SCAN_LOCK] The scan window could not be locked." >&2; exit 75 ;;
esac
