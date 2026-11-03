/**
 * THE CAPITAL CHAIN RESUMES ITSELF (3 Nov 2026) — same defect class as `com.seq.boss-sr-resume`
 * (25 Oct 2026), owner-approved, mirrored here rather than invented fresh.
 *
 * `com.seq.boss-capital` is one launchd job, five `;`-chained steps (scan, extract, ledger-hunt,
 * grid, match), daily 05:30 Central. Nothing watched the chain itself: on 3 Nov 2026 the Mac
 * kernel-panicked (watchdog timeout) mid-chain and the whole day's `monique_found` morning section
 * — step 4 of 5 — never ran, silently, because launchd's next chance was 24 hours later.
 *
 * The fix is a marker file, not a code fix to the panic (a reboot cannot be fixed in code): a run
 * writes `UNFINISHED_PATH` at `--start` and removes it at `--done`; while it exists, a step died
 * between the two without exiting cleanly. `com.seq.boss-capital-resume` (install-agent-launchd.sh)
 * is a launchd `KeepAlive` `PathState` on that path, throttled to 15 minutes, which kickstarts the
 * chain again when the recorded pid is dead and today's attempts are not spent.
 *
 * AT MOST MAX_RESUMES RESUMES A DAY, then a NAMED STOP and the record is cleared — a KeepAlive job
 * watching a file it can never clear would loop on it forever.
 *
 * Pure. No node imports: `resumeDecision` is what tests/capitalChain.test.ts drives directly.
 * `scripts/ops/capital-chain.mjs` is the only thing that touches the filesystem or launchctl.
 */

export const UNFINISHED_PATH = ".boss-os/capital/chain-unfinished.json"; // relative to $HOME; the caller joins it
export const MAX_RESUMES = 2;

/**
 * `record` — `{ chain, day, pid, started_at, attempts }` read from UNFINISHED_PATH, or null/undefined
 * when no run is unfinished. `today` — "YYYY-MM-DD" in Central, the caller's clock. `pidAlive` — the
 * caller's own `kill -0` on `record.pid`. `now` — the caller's current time, carried through for
 * whatever a future rule needs; today's rule does not read it.
 *
 * Returns `{ action: "none" | "wait" | "resume" | "stale", reason }`.
 */
export function resumeDecision({ record, today, pidAlive, now } = {}) {
  void now;
  if (!record) return { action: "none", reason: "no unfinished capital-chain run" };
  if (pidAlive) return { action: "wait", reason: `the chain is still running (pid ${record.pid})` };
  if (record.day !== today) return { action: "stale", reason: `the unfinished run is from ${record.day}, not today (${today}); nothing retries a lost day` };
  if ((record.attempts ?? 0) >= MAX_RESUMES) return { action: "stale", reason: `both resumes are spent for ${today} (${MAX_RESUMES} of ${MAX_RESUMES})` };
  return { action: "resume", reason: `resume ${(record.attempts ?? 0) + 1} of ${MAX_RESUMES} for ${today}` };
}
