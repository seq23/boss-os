# shellcheck shell=bash
# ONE RUN AT A TIME: a lock the KERNEL holds (22 Nov 2026). Sourced by the scripts/ops jobs that must never run twice.
#
#   hold_lock FILE   0 = this shell holds FILE until it exits, however it exits (normal end, crash, kill -9)
#                    1 = another run holds it (the caller steps aside, exit 0)
#                    2 = it cannot be locked at all (the caller's NAMED STOP)
#   lock_busy FILE   0 = a run holds FILE now, 1 = nobody does, 2 = it cannot tell. Never takes it.
#                    On 0 it sets `trap release_lock EXIT`, so a normal exit frees the lock AT ONCE. A caller that
#                    sets its own EXIT trap later calls release_lock inside it (tests/opsFlock.test.ts holds every
#                    job to that).
#   release_lock     lets go now and waits until the lock is really free; says LOCK_LOST if the holder was killed
#
# THE SWITCH-OVER FROM THE OLD DIRECTORY LOCK (22 Nov 2026). Each lock FILE is its old directory's path plus
# ".flock". A run started by the old code holds that directory, with its pid inside, and never looks at FILE. So while
# such a directory exists, a live pid in it counts as busy (both calls) and a dead one is removed. Once every old run
# has ended no directory is left, and this costs one `[ -d ]`.
#
# Why not `mkdir "$LOCK"` any more: a directory lock is a mutex only if the `mkdir` binary is one atomic mkdir(2). The
# ubuntu-26.04 runners ship uutils coreutils, whose mkdir checks for the path and then creates it, so several racers all
# "win" (8 racers on one path had 2-6 winners in 14 of 800 runs; main CI 21 Nov 2026, run 44989669473). Its pid file
# and stale reclaim were a second race: two ticks that both judge the holder dead both `rm -rf` and both re-take it.
# flock(2) is taken through perl because macOS ships no `flock` binary and both her Mac and Linux ship perl. Every job
# here uses it, agent-claim included (its own fd-9 lock of #506 moved here, 22 Nov 2026).
#
# These jobs start long children (ai-run, claude, Playwright and Chrome, caffeinate). A flock lives on the open file,
# so if this shell held the lock on one of its own fds, every child would inherit it (unless each one closed it) and
# a child left running after the job ended would hold every later tick out, silently. So the lock is
# held by a small perl process that owns the only open file: it takes the lock, says so, and lets go the moment this
# shell is gone (it checks once a second). No child ever holds it, and nothing is left behind to judge stale.
hold_lock() {
  local file="$1" state=""
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 2
  # The holder reads this shell's pid ($$ is the main shell's, also inside the process substitution).
  exec 8< <(perl -MFcntl=:flock -MErrno -e '
    my ($file, $shell) = @ARGV; $| = 1; $SIG{TERM} = sub { exit 0 };  # release_lock: leave quietly, no "Terminated" line
    open(my $fh, ">>", $file) or do { print "error\n"; exit 2 };
    flock($fh, LOCK_EX | LOCK_NB) or do { print(($!{EWOULDBLOCK} ? "busy" : "error") . "\n"); exit 1 };
    print "held $$\n"; close STDOUT;
    sleep 1 while kill(0, $shell);
    exit 0;
  ' "$file" "$$" </dev/null 2>/dev/null)
  read -r -t 15 -u 8 state LOCK_HOLDER_PID
  exec 8<&-
  case "$state" in
    held) LOCK_HELD_FILE="$file" ;;
    busy) return 1 ;;
    *) return 2 ;;
  esac
  # Held, so no NEW run can start; an OLD-code run may still be inside the old directory lock.
  if old_lock_live "$file"; then release_lock; return 1; fi
  [ "${file%.flock}" != "$file" ] && [ -d "${file%.flock}" ] && rm -rf "${file%.flock}"
  trap release_lock EXIT
  return 0
}

# 0 when FILE's old directory lock (FILE minus ".flock") holds the pid of a live process.
old_lock_live() {
  local old="${1%.flock}" pid
  [ "$old" != "$1" ] && [ -d "$old" ] || return 1
  pid="$(cat "$old/pid" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Let go NOW, not within the holder's one-second look: a run that had just ended still looked "running" to the next
# check (CI shard 2/4 on #516; 20 of 20 local runs probed right after exit). hold_lock sets it as the EXIT trap. Waits
# (at most ~2 s) until the lock is really free, so the next run never finds it held by a holder on its way out.
# A holder already gone was killed from outside while this run worked: the run had no lock, and says so here.
release_lock() {
  [ -n "${LOCK_HOLDER_PID:-}" ] || return 0
  kill -0 "$LOCK_HOLDER_PID" 2>/dev/null || echo "NAMED STOP [LOCK_LOST] the holder of ${LOCK_HELD_FILE:-?} (pid $LOCK_HOLDER_PID) was killed while this run worked; another run could have started beside it" >&2
  kill "$LOCK_HOLDER_PID" 2>/dev/null
  local i=0
  while [ "$i" -lt 40 ] && lock_busy "${LOCK_HELD_FILE:-}"; do sleep 0.05; i=$((i + 1)); done
  LOCK_HOLDER_PID=""
}

lock_busy() {
  old_lock_live "$1" && return 0
  [ -e "$1" ] || return 1
  perl -MFcntl=:flock -MErrno -e '
    open(my $fh, "<", $ARGV[0]) or exit 2;
    flock($fh, LOCK_EX | LOCK_NB) and exit 1;
    exit($!{EWOULDBLOCK} ? 0 : 2);
  ' "$1"
}
