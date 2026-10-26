# Sourced, never run: "is the network down?" told apart from "is gh logged out?" (25 Oct 2026).
#
# THE DEFECT. During the ~18:30–20:00 outage on 25 Oct 2026 every Search Readiness pass stopped with
# "NAMED STOP [GH_NOT_AUTHENTICATED] run: gh auth login", because `gh auth status` fails offline
# exactly as it fails logged out. The whole run then ended and nothing restarted it. gh was logged in
# all along. So the fixer and the runner ask a second question before naming a login stop: does
# api.github.com answer AT ALL? Any HTTP status (even 401/403) means the network is up and the
# failure really is the login; no answer (curl's 000) means wait, with a bounded backoff, and say so.
#
# Knobs (tests shrink them): SR_NET_PROBE_URL, SR_NET_WAIT_MAX_S (default 7200 = two hours),
# SR_NET_WAIT_STEP_S (first wait, 30 s, doubling), SR_NET_WAIT_CAP_S (longest single wait, 600 s).
# The caller defines `say`. `source` reads this whole file before running it, so landing a change
# under a running copy is safe.

net_up() {
  local code
  code="$(curl -sS -m "${SR_NET_PROBE_TIMEOUT_S:-10}" -o /dev/null -w '%{http_code}' "${SR_NET_PROBE_URL:-https://api.github.com}" 2>/dev/null)"
  [ -n "$code" ] && [ "$code" != "000" ]
}

# wait_for_network <what is waiting>: 0 as soon as the network answers, 1 when the budget is spent.
wait_for_network() {
  local what="${1:-this run}" max="${SR_NET_WAIT_MAX_S:-7200}" step="${SR_NET_WAIT_STEP_S:-30}"
  local cap="${SR_NET_WAIT_CAP_S:-600}" waited=0 left
  net_up && return 0
  while [ "$waited" -lt "$max" ]; do
    left=$(( max - waited )); [ "$step" -le "$left" ] || step="$left"
    say "waiting for the network: api.github.com does not answer; $what tries again in ${step}s (${waited}s of ${max}s waited). This is the network, not the gh login."
    sleep "$step"
    waited=$(( waited + step ))
    if net_up; then say "the network is back after ${waited}s; $what carries on"; return 0; fi
    step=$(( step * 2 )); [ "$step" -le "$cap" ] || step="$cap"
  done
  return 1
}

# gh_ready: 0 when gh is logged in; 7 when it really is not (the network answered); 13 when the
# network stayed down for the whole wait. Never a GH_NOT_AUTHENTICATED stop while offline.
gh_ready() {
  while ! gh auth status >/dev/null 2>&1; do
    if net_up; then
      say "NAMED STOP [GH_NOT_AUTHENTICATED] run: gh auth login (api.github.com answered, so this is the login, not the network)"
      return 7
    fi
    if ! wait_for_network "the gh login check"; then
      say "NAMED STOP [NETWORK_UNREACHABLE] api.github.com did not answer for ${SR_NET_WAIT_MAX_S:-7200}s; the gh login was never the problem. The run resumes by itself when the network is back."
      return 13
    fi
  done
  return 0
}
