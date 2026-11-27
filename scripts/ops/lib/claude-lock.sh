# shellcheck shell=bash
# EVERY `claude -p` A JOB RUNS IS LOCKED TO ITS OWN LIST (24 Nov 2026, her "why cant u just do this now
# if it needs to be done"). Her own settings default to bypassPermissions, so a bare `claude -p` — or
# one with --dangerously-skip-permissions — runs with every tool and no prompt. A locked run is
#   claude -p … --permission-mode dontAsk --setting-sources= --settings <the job's own permissions file>
# `--setting-sources=` loads none of her user, project or local settings (no bypass default, no allow
# rule of hers); the file is the whole list; dontAsk refuses anything outside it without asking.
# scripts/validate/claude-runs-locked.mjs fails the build when a script runs claude any other way.
#
# A REFUSAL IS A NAMED STOP, NEVER "NOTHING FOUND". dontAsk refuses quietly and the model works around
# it, so a mailbox read that was refused looks exactly like a quiet mailbox. After the run, the job
# counts the refusals in the session's own transcript (lib/permission-denials.mjs) and stops by name.
#
#   claude_lock_args <settings-file>        prints the four flags (refuses a missing file or a space)
#   claude_denials <session-id|file> <log>  prints the refusal count, or "unknown" when the transcript
#                                           cannot be read (never 0); DENIED lines go to <log>

CLAUDE_LOCK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

claude_lock_args() {
  local settings="$1"
  [ -s "$settings" ] || { echo "NAMED STOP [NO_PERMISSIONS_FILE] $settings is missing; claude never runs without its allow list." >&2; return 6; }
  case "$settings" in *[[:space:]]*) echo "NAMED STOP [PERMISSIONS_PATH_SPACE] '$settings' has a space, which ai-run would split." >&2; return 6;; esac
  printf '%s' "--permission-mode dontAsk --setting-sources= --settings $settings"
}

claude_transcript() {
  local src="$1"
  if [ -f "$src" ]; then
    printf '%s\n' "$src"
  else
    find "$HOME/.claude/projects" -maxdepth 2 -name "$src.jsonl" 2>/dev/null | head -1
  fi
}

claude_denials() {
  local src="$1" log="$2" transcript out n
  transcript="$(claude_transcript "$src")"
  [ -n "$transcript" ] || { echo unknown; return 0; }
  grep -q '^{' "$transcript" 2>/dev/null || { echo unknown; return 0; } # empty or not JSON: nothing was read
  out="$(node "$CLAUDE_LOCK_LIB/permission-denials.mjs" "$transcript" 2>&1)"
  n="$(printf '%s\n' "$out" | sed -n 's/^denied=\([0-9][0-9]*\)$/\1/p')"
  [ -n "$n" ] || { echo unknown; return 0; }
  [ -n "$log" ] && printf '%s\n' "$out" | grep '^DENIED ' >> "$log"
  echo "$n"
}
