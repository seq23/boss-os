# shellcheck shell=bash
# ONE RUN AT A TIME: a lock the KERNEL holds (22 Nov 2026). Sourced by the scripts/ops jobs that must never run twice.
#
#   hold_lock FILE   0 = this shell holds FILE until it exits, however it exits (normal end, crash, kill -9)
#                    1 = another run holds it (the caller steps aside, exit 0)
#                    2 = it cannot be locked at all (the caller's NAMED STOP)
#   lock_busy FILE   0 = a run holds FILE now, 1 = nobody does, 2 = it cannot tell. Never takes it.
#
# Why not `mkdir "$LOCK"` any more: a directory lock is a mutex only if the `mkdir` binary is one atomic mkdir(2). The
# ubuntu-26.04 runners ship uutils coreutils, whose mkdir checks for the path and then creates it, so several racers all
# "win" (8 racers on one path had 2-6 winners in 14 of 800 runs; main CI 21 Nov 2026, run 44989669473). Its pid file
# and stale reclaim were a second race: two ticks that both judge the holder dead both `rm -rf` and both re-take it.
# The agent-claim lock (#506) moved to flock(2) taken by perl, because macOS ships no `flock` binary and both her Mac
# and Linux ship perl. This is the same flock(2) through perl, shared by every job here.
#
# One difference from agent-claim, on purpose: these jobs start long children (ai-run, claude, Playwright and Chrome,
# caffeinate). A flock lives on the open file, so if this shell held the lock on one of its own fds, every child would
# inherit it and a child left running after the job ended would hold every later tick out, silently. So the lock is
# held by a small perl process that owns the only open file: it takes the lock, says so, and lets go the moment this
# shell is gone (it checks once a second). No child ever holds it, and nothing is left behind to judge stale.
hold_lock() {
  local file="$1" state=""
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 2
  # The holder reads this shell's pid ($$ is the main shell's, also inside the process substitution).
  exec 8< <(perl -MFcntl=:flock -MErrno -e '
    my ($file, $shell) = @ARGV; $| = 1;
    open(my $fh, ">>", $file) or do { print "error\n"; exit 2 };
    flock($fh, LOCK_EX | LOCK_NB) or do { print(($!{EWOULDBLOCK} ? "busy" : "error") . "\n"); exit 1 };
    print "held\n"; close STDOUT;
    sleep 1 while kill(0, $shell);
    exit 0;
  ' "$file" "$$" </dev/null 2>/dev/null)
  read -r -t 15 -u 8 state
  exec 8<&-
  case "$state" in
    held) return 0 ;;
    busy) return 1 ;;
    *) return 2 ;;
  esac
}

lock_busy() {
  [ -e "$1" ] || return 1
  perl -MFcntl=:flock -MErrno -e '
    open(my $fh, "<", $ARGV[0]) or exit 2;
    flock($fh, LOCK_EX | LOCK_NB) and exit 1;
    exit($!{EWOULDBLOCK} ? 0 : 2);
  ' "$1"
}
