/**
 * THE DETERMINATION, POSTED — because for five days it landed in a log file and stopped there.
 *
 * `kdp-watch.sh` has been running Mon/Wed/Fri since 2 September and it works: the 7 September run
 * correctly found that the case had fanned into four threads and that she had already answered the
 * newest one herself. Boss OS knew none of that. The sentinel went to
 * `~/Library/Logs/kdp-watch/latest.log`, which is a file she has never opened and has no reason to.
 * Simone owns the duty; this is the wire that makes her ownership visible.
 *
 * ─── What it sends, and what it refuses to ──────────────────────────────────
 *
 * The watcher reads subjects and bodies. It has to — you cannot tell from From/To/Date whether a
 * support agent resolved a case. ALL OF THAT STAYS ON THIS MACHINE. What crosses is a sentinel, a
 * determination in the run's own words, a next action, and four counts. This script sends the file
 * the run wrote and nothing else: it does not open the mailbox, the log, or anything else on disk.
 *
 * The endpoint refuses any determination containing an `@`, and this refuses it first, so a bad
 * report fails here with a legible reason rather than as an HTTP 400 in a launchd log.
 *
 * ─── Rule 0 ─────────────────────────────────────────────────────────────────
 *
 * This may not exit 0 having done nothing. A missing file, a stale file, or a refusal is a
 * non-zero exit with a named reason — because "no determination arrived" and "everything is fine"
 * look identical on the screen, and that confusion is the entire failure this instrument prevents.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DIR = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
const FILE = join(DIR, "determination.json");
const SOURCE = process.argv.includes("--manual") ? "manual" : "launchd";

/*
 * HOW OLD A DETERMINATION MAY BE AND STILL COUNT AS THIS RUN'S.
 *
 * The file is written by the watcher and never deleted, so without this a run that CRASHED before
 * writing would silently re-post the previous run's determination — and the screen would show a
 * fresh check that never happened. That is worse than no check at all: it is a lie with a
 * timestamp. Two hours is generous for a job with a ten-minute leash.
 */
const MAX_AGE_MS = Number(process.env.BOSS_OS_KDP_MAX_AGE_MS ?? 2 * 60 * 60 * 1000);

const SENTINELS = new Set([
  "no-reply", "replied", "needs-her", "cleared", "published", "nudged", "stalled",
]);

async function main() {
  let info;
  try {
    info = await stat(FILE);
  } catch {
    console.error(`NAMED STOP [NO_DETERMINATION] ${FILE} was not written.`);
    console.error("  The watcher ran and did not produce a determination, so Boss OS is told nothing");
    console.error("  rather than being told a stale one. Check the run log for what it did instead.");
    process.exit(6);
  }

  const ageMs = Date.now() - info.mtimeMs;
  if (ageMs > MAX_AGE_MS) {
    console.error(
      `NAMED STOP [STALE_DETERMINATION] ${FILE} is ${Math.round(ageMs / 60000)} minutes old.`,
    );
    console.error("  This run did not write one. Re-posting the last one would put a check on the");
    console.error("  screen that never happened, which is worse than an absent one.");
    process.exit(7);
  }

  let payload;
  try {
    payload = JSON.parse(await readFile(FILE, "utf8"));
  } catch (err) {
    console.error(`NAMED STOP [UNREADABLE_DETERMINATION] ${err?.message ?? err}`);
    process.exit(8);
  }

  if (!SENTINELS.has(String(payload?.sentinel ?? ""))) {
    console.error(`NAMED STOP [BAD_SENTINEL] "${payload?.sentinel}" is not one of: ${[...SENTINELS].join(", ")}`);
    process.exit(9);
  }

  /*
   * REFUSED HERE AS WELL AS AT THE ENDPOINT, and that duplication is deliberate. The server's
   * refusal is the guarantee; this one is the legible error. A 400 in a launchd log at 09:23 on a
   * Wednesday is not something anyone reads.
   */
  for (const field of ["determination", "next_action"]) {
    const v = payload?.[field];
    if (typeof v === "string" && v.includes("@")) {
      console.error(`NAMED STOP [ADDRESS_IN_${field.toUpperCase()}] the determination carries an '@'.`);
      console.error("  Determinations describe what support said and never quote it. Nothing was sent.");
      process.exit(10);
    }
  }

  if (!process.env.BOSS_PASSCODE) {
    console.error("NAMED STOP [NO_PASSCODE] BOSS_PASSCODE is not in the environment.");
    console.error("  Run this through the vault: npm run vault:run -- node scripts/ops/kdp-report.mjs");
    process.exit(11);
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/kdp/check`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      sentinel: payload.sentinel,
      determination: payload.determination ?? null,
      next_action: payload.next_action ?? null,
      needs_owner: payload.needs_owner === true,
      days_since_support: payload.days_since_support ?? null,
      nudges_unanswered: payload.nudges_unanswered ?? null,
      threads_seen: payload.threads_seen ?? null,
      published_title_ref: payload.published_title_ref ?? null,
      source: SOURCE,
    }),
  });
  if (!res.ok) throw new Error(`kdp check failed (${res.status}): ${(await res.text()).slice(0, 300)}`);

  console.log(`Reported to Boss OS: ${payload.sentinel}${payload.needs_owner ? " — needs her" : ""}.`);
}

main().catch((err) => {
  console.error(`kdp report failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
