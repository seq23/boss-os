/**
 * THE FINDINGS, POSTED — and the wire that makes Monique's ownership visible.
 *
 * `mailbox-sweep.sh` reads the contents of her mail on this machine. ALL OF THAT STAYS HERE. What
 * crosses is code names, a sentence of reasoning built from dates and counts, a suggested action,
 * and Gmail thread ids. This script sends the file the sweep wrote and nothing else: it does not
 * open the mailbox, the map, the log, or anything else on disk.
 *
 * ─── The refusal, which is the whole safety story ───────────────────────────
 *
 * Nothing containing an `@` is sent. The endpoint refuses it too, and that duplication is
 * deliberate: the server's refusal is the guarantee, this one is the legible error. A 400 in a
 * launchd log at 18:30 on a Sunday is not something anyone reads.
 *
 * THE WHOLE BATCH IS REFUSED, NOT THE OFFENDING ROW. A partial send would put some of a leaking
 * run's output into the cloud and report success. The one time this class of guard fired for real
 * it was because a collision suffix had been built from the first three characters of a real
 * address — so this fails closed on the entire payload.
 *
 * ─── Rule 0 ─────────────────────────────────────────────────────────────────
 *
 * This may not exit 0 having done nothing. A missing file, a stale file, or a refusal is a non-zero
 * exit with a named reason — because "the sweep found nothing" and "the sweep never ran" look
 * identical on a screen, and telling those two apart is the entire point of reporting at all.
 *
 * ZERO FINDINGS IS NOT NOTHING. An empty array from a run that genuinely read the mailbox is posted,
 * advances Monique's clock, and shows on the People screen as a swept week. That is the difference
 * between a quiet mailbox and a broken job, and it is why this script does not short-circuit on an
 * empty list.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DIR = process.env.BOSS_OS_MAILBOX_DIR ?? `${process.env.HOME}/.boss-os/mailbox`;
const FILE = join(DIR, "findings.json");

/*
 * HOW OLD A FINDINGS FILE MAY BE AND STILL COUNT AS THIS RUN'S.
 *
 * The sweep deletes it before starting, so this is the second of two guards rather than the only
 * one. It matters anyway: a manual invocation, or a sweep that crashed after writing, would
 * otherwise re-post last week's findings and put a fresh sweep on the screen that never happened.
 * Three hours is generous for a job whose leash is eighty turns.
 */
const MAX_AGE_MS = Number(process.env.BOSS_OS_MAILBOX_MAX_AGE_MS ?? 3 * 60 * 60 * 1000);

const KINDS = new Set(["missed_deal", "cooling_buyer", "unworked_intro", "connector"]);

/** Every field that reaches Boss OS. An address in any of them refuses the whole batch. */
const TEXT_FIELDS = [
  "subject_code", "counterpart_code", "headline", "because", "suggested_action", "subject_matter",
];

async function main() {
  let info;
  try {
    info = await stat(FILE);
  } catch {
    console.error(`NAMED STOP [NO_FINDINGS_FILE] ${FILE} was not written.`);
    console.error("  The sweep ran and produced no file, so Boss OS is told nothing rather than being");
    console.error("  told a stale week. Check the run log for what it did instead.");
    process.exit(6);
  }

  const ageMs = Date.now() - info.mtimeMs;
  if (ageMs > MAX_AGE_MS) {
    console.error(`NAMED STOP [STALE_FINDINGS] ${FILE} is ${Math.round(ageMs / 60000)} minutes old.`);
    console.error("  This run did not write it. Re-posting it would put a sweep on the screen that");
    console.error("  never happened, which is worse than an absent one.");
    process.exit(7);
  }

  let payload;
  try {
    payload = JSON.parse(await readFile(FILE, "utf8"));
  } catch (err) {
    console.error(`NAMED STOP [UNREADABLE_FINDINGS] ${err?.message ?? err}`);
    process.exit(8);
  }

  const findings = Array.isArray(payload?.findings) ? payload.findings : null;
  if (findings === null) {
    console.error("NAMED STOP [NO_FINDINGS_ARRAY] the file has no `findings` array.");
    console.error("  Zero findings is written as an empty array. An absent array is a malformed run.");
    process.exit(9);
  }

  for (const [i, f] of findings.entries()) {
    if (!KINDS.has(String(f?.kind))) {
      console.error(`NAMED STOP [BAD_KIND] finding ${i + 1} has kind "${f?.kind}".`);
      console.error(`  One of: ${[...KINDS].join(", ")}. Nothing was sent.`);
      process.exit(10);
    }
    for (const field of TEXT_FIELDS) {
      const v = f?.[field];
      if (typeof v === "string" && v.includes("@")) {
        console.error(`NAMED STOP [ADDRESS_IN_${field.toUpperCase()}] finding ${i + 1} carries an '@'.`);
        console.error("  Findings name people by code name and never quote the mail. THE WHOLE BATCH");
        console.error("  was refused — nothing was sent.");
        process.exit(11);
      }
    }
    /*
     * A FINDING WITHOUT A REASON AND AN ACTION IS AN OBSERVATION, and she has enough of those. The
     * endpoint drops these silently as part of a batch; refusing here names which one and why.
     */
    for (const field of ["headline", "because", "suggested_action", "subject_code"]) {
      if (typeof f?.[field] !== "string" || !f[field].trim()) {
        console.error(`NAMED STOP [INCOMPLETE_FINDING] finding ${i + 1} has no ${field}.`);
        console.error("  A finding needs a subject, a headline, a reason and one suggested action.");
        process.exit(12);
      }
    }
  }

  if (!process.env.BOSS_PASSCODE) {
    console.error("NAMED STOP [NO_PASSCODE] BOSS_PASSCODE is not in the environment.");
    console.error("  Run this through the vault: npm run vault:run -- node scripts/ops/mailbox-report.mjs");
    process.exit(13);
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/relationships/mailbox-findings`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ run_id: payload.run_id ?? null, findings }),
  });
  if (!res.ok) throw new Error(`mailbox findings failed (${res.status}): ${(await res.text()).slice(0, 300)}`);

  const body = await res.json();
  console.log(
    `Reported to Boss OS: ${body?.data?.written ?? 0} finding(s) written, ` +
    `${body?.data?.skipped ?? 0} incomplete and dropped, ` +
    `from ${payload.threads_read ?? "an unstated number of"} thread(s).`,
  );
  if (findings.length === 0) {
    console.log("Zero findings, and that is a report. Monique's clock advanced; the screen will say the mailbox was read.");
  }
}

main().catch((err) => {
  console.error(`mailbox report failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
