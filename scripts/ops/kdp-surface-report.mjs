/**
 * THE TRIAGE, POSTED. Dispositions and sentences, never the mail.
 *
 * Simone reads Amazon's mail inside `claude -p` on her Mac and everything she reads stays there.
 * This carries what crosses: for each message a bucket, one sentence, an opaque title reference and
 * what she did about it.
 *
 * ─── An empty list is a real report ────────────────────────────────────────
 *
 * A quiet day still files `{"items": []}`, because that is what advances the duty's clock. Without
 * it, "nothing arrived" and "the job stopped running" would look identical on the screen — which is
 * the confusion this whole system spent the day removing.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * A missing file, a stale one or a refusal is a non-zero exit with a named reason. The file being
 * absent means the run did not write one, and re-posting yesterday's would put a triage on the
 * screen that never happened.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DIR = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
const FILE = join(DIR, "surface.json");
const MAX_AGE_MS = Number(process.env.BOSS_OS_KDP_MAX_AGE_MS ?? 2 * 60 * 60 * 1000);
const SOURCE = process.argv.includes("--manual") ? "manual" : "launchd";

async function main() {
  let info;
  try {
    info = await stat(FILE);
  } catch {
    console.error(`NAMED STOP [NO_TRIAGE] ${FILE} was not written.`);
    console.error("  A quiet day still writes an empty items array, so an absent file means the run");
    console.error("  did not finish rather than that nothing arrived.");
    process.exit(6);
  }

  if (Date.now() - info.mtimeMs > MAX_AGE_MS) {
    console.error(`NAMED STOP [STALE_TRIAGE] ${FILE} is ${Math.round((Date.now() - info.mtimeMs) / 60000)} minutes old.`);
    console.error("  Re-posting the last one would put a triage on the screen that never happened.");
    process.exit(7);
  }

  let payload;
  try {
    payload = JSON.parse(await readFile(FILE, "utf8"));
  } catch (err) {
    console.error(`NAMED STOP [UNREADABLE_TRIAGE] ${err?.message ?? err}`);
    process.exit(8);
  }

  const items = Array.isArray(payload?.items) ? payload.items : null;
  if (!items) {
    console.error("NAMED STOP [NO_ITEMS_ARRAY] the file has no items array. An empty one is valid; a missing one is malformed.");
    process.exit(9);
  }

  // Refused here as well as at the endpoint: the server's refusal is the guarantee, this one is the
  // legible error. A 400 in a launchd log at 09:30 is not something anyone reads.
  for (const it of items) {
    for (const field of ["note", "action_taken"]) {
      if (typeof it?.[field] === "string" && it[field].includes("@")) {
        console.error(`NAMED STOP [ADDRESS_IN_${field.toUpperCase()}] a triage note carries an '@'. Nothing was sent.`);
        process.exit(10);
      }
    }
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

  const res = await fetch(`${ORIGIN}/api/boss/kdp/mail`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ items, source: SOURCE }),
  });
  if (!res.ok) throw new Error(`kdp mail failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const { data } = await res.json();

  console.log(
    items.length === 0
      ? "Reported to Boss OS: nothing arrived. The duty's clock advanced, which is what silence needs to mean something."
      : `Reported to Boss OS: ${data.recorded} message(s)${data.problems ? `, ${data.problems} of them a problem with a title` : ", none of them a problem"}.`,
  );
}

main().catch((err) => {
  console.error(`kdp surface report failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
