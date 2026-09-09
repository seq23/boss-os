/**
 * THE DIGEST, POSTED — counts and one sentence, never a name.
 *
 * `lp-replies.sh` reads the West Peek mailbox inside `claude -p` on her Mac. Everything it reads
 * stays there. This carries the one thing that leaves: how many replies came in, which of six
 * buckets each fell into, one composed sentence, and the PATH of the suppression file Twin reads.
 *
 * ─── The privacy split, which is the interesting part ──────────────────────
 *
 * Suppressing someone in Twin needs their real address; Boss OS shows code names and refuses an
 * `@`. Both are right and they do not conflict, because they are about different files. The
 * addresses go to `~/.boss-os/lp/suppress.txt` and are never posted. This refuses an address before
 * the endpoint does, so a bad report fails with a legible reason rather than as an HTTP 400 in a
 * launchd log at 07:45 on a Tuesday.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * This may not exit 0 having done nothing. A missing file, a stale one, or a refusal is a non-zero
 * exit with a named reason — because "no digest arrived" and "a quiet day" render identically, and
 * that confusion is the whole failure this instrument prevents.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DIR = process.env.BOSS_OS_LP_DIR ?? `${process.env.HOME}/.boss-os/lp`;
const FILE = join(DIR, "digest.json");

/*
 * The file is written by the run and never deleted, so without this a run that crashed before
 * writing would silently re-post yesterday's digest — a day on the screen that never happened,
 * which is worse than an absent one because it is a lie with a date on it.
 */
const MAX_AGE_MS = Number(process.env.BOSS_OS_LP_MAX_AGE_MS ?? 2 * 60 * 60 * 1000);

async function main() {
  let info;
  try {
    info = await stat(FILE);
  } catch {
    console.error(`NAMED STOP [NO_DIGEST] ${FILE} was not written.`);
    console.error("  The run happened and produced no digest, so Boss OS is told nothing rather than");
    console.error("  being told a stale one. Check the run log for what it did instead.");
    process.exit(6);
  }

  if (Date.now() - info.mtimeMs > MAX_AGE_MS) {
    console.error(`NAMED STOP [STALE_DIGEST] ${FILE} is ${Math.round((Date.now() - info.mtimeMs) / 60000)} minutes old.`);
    console.error("  This run did not write one. Re-posting the last would put a day on the screen that never happened.");
    process.exit(7);
  }

  let payload;
  try {
    payload = JSON.parse(await readFile(FILE, "utf8"));
  } catch (err) {
    console.error(`NAMED STOP [UNREADABLE_DIGEST] ${err?.message ?? err}`);
    process.exit(8);
  }

  if (typeof payload?.summary === "string" && payload.summary.includes("@")) {
    console.error("NAMED STOP [ADDRESS_IN_SUMMARY] the digest carries an '@'.");
    console.error("  Digests report how many and of what kind. The addresses Twin needs are in the");
    console.error("  suppression file on this machine and never cross. Nothing was sent.");
    process.exit(10);
  }

  if (!process.env.BOSS_PASSCODE) {
    console.error("NAMED STOP [NO_PASSCODE] run this through the vault.");
    process.exit(11);
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/lp/digest`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`lp digest failed (${res.status}): ${(await res.text()).slice(0, 300)}`);

  console.log(
    `Reported to Boss OS: ${payload.total_read} replies` +
    `${payload.opt_outs ? `, ${payload.opt_outs} opt-out(s) written to the suppression file for Twin` : ""}.`,
  );
}

main().catch((err) => {
  console.error(`lp report failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
