/**
 * HER CALENDARS, INTO THE DIARY, WITHOUT A TOKEN THAT CAN BE REVOKED.
 *
 * ─── Why the secret iCal address and not the obvious mechanisms ────────────
 *
 * Every Google calendar — consumer or Workspace — publishes a private ICS URL under Settings,
 * Settings for my calendars, the calendar, Integrate calendar, "Secret address in iCal format". A
 * plain HTTPS GET returns the feed. Three things make it the right choice here:
 *
 *   · IT WORKS FOR CONSUMER ACCOUNTS. Domain-wide delegation cannot read an @gmail.com calendar,
 *     the same wall the KDP mail hit, and two of her four accounts are consumer ones.
 *   · THERE IS NO TOKEN TO REVOKE. She changed her Google password this morning and it killed the
 *     OAuth connector instantly. It does not touch these.
 *   · NO NEW ADMIN GRANT. The LP mail has been waiting on one of those since 19 August.
 *
 * ─── The URL is a secret and is treated as one ─────────────────────────────
 *
 * Anyone holding it can read that calendar in full. It is read from the vault, used, and NEVER
 * logged, never posted, and never put in an error message — which is why the failure paths below
 * report a status code rather than a caught exception, since a fetch error can carry the URL.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * A run that read no feed at all exits non-zero. A feed that is genuinely empty is reported as
 * empty and files nothing — "the calendar is clear" and "the job could not read it" must not render
 * the same way, and the endpoint refuses an empty batch for the same reason.
 */

import { parseIcs } from "./ics.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const HORIZON_DAYS = Number(process.env.CALENDAR_HORIZON_DAYS ?? 28);

const FEEDS = [
  { env: "CAL_ICS_SEQ_TAYLOR", label: "your personal calendar" },
  { env: "CAL_ICS_STAYLOR_SPRY", label: "spry.vc" },
  { env: "CAL_ICS_WESTPEEK", label: "westpeek.ventures" },
  { env: "CAL_ICS_CRYPTOCLEARR", label: "cryptoclearr" },
];

async function main() {
  const configured = FEEDS.filter((f) => process.env[f.env]);
  if (configured.length === 0) {
    console.error("NAMED STOP [NO_CALENDAR_FEEDS] not one secret calendar address is in the vault.");
    console.error("  This is not a failure of the diary: manual entry is the primary route and works.");
    console.error("  Today names each missing feed with the exact click path to copy its address.");
    process.exit(0);
  }

  if (!process.env.BOSS_PASSCODE) {
    console.error("NAMED STOP [NO_PASSCODE] run this through the vault: npm run calendar:sync");
    process.exit(4);
  }

  /*
   * MEASURED ON HER REAL FEEDS, 9 SEPTEMBER: 4,527 events on the personal calendar and NOT ONE
   * dated today or later; 835 on spry.vc with one upcoming; cryptoclearr empty. These are archives.
   * Her forward schedule is not in Google, which is why what she types is the spine of the diary and
   * this job is the supplement that catches whatever does get scheduled.
   */
  const events = [];
  let unexpanded = 0;
  let read = 0;
  for (const feed of configured) {
    try {
      const res = await fetch(process.env[feed.env], { headers: { accept: "text/calendar" } });
      if (!res.ok) {
        // The status, never the URL — the URL is the secret.
        console.error(`  ✗ ${feed.label}: the feed answered ${res.status}. If that is 404 the secret address was reset; copy the new one.`);
        continue;
      }
      const parsed = parseIcs(await res.text(), Date.now(), HORIZON_DAYS);
      events.push(...parsed.events);
      unexpanded += parsed.unexpanded;
      read += 1;
      console.log(`  ✓ ${feed.label}: ${parsed.events.length} event(s) in the next ${HORIZON_DAYS} days`);
    } catch {
      console.error(`  ✗ ${feed.label}: could not be reached from this machine.`);
    }
  }

  if (read === 0) {
    console.error("NAMED STOP [NO_FEED_READ] every configured feed failed, so nothing was filed.");
    console.error("  An empty diary and an unreadable calendar must not look the same, and this is the second one.");
    process.exit(6);
  }

  if (events.length === 0) {
    // A genuinely empty fortnight. Reported and NOT filed: the endpoint refuses an empty batch on
    // exactly this reasoning, so nothing here has to pretend it synced something.
    console.log(`Read ${read} feed(s) and found no events in the next ${HORIZON_DAYS} days. Nothing filed.`);
    return;
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/diary/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) throw new Error(`diary sync failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const { data } = await res.json();

  console.log(
    `Filed ${data.filed} of ${data.offered} events from ${read} feed(s).` +
    (unexpanded ? ` ${unexpanded} repeating event(s) use a rule this does not expand and appear once rather than being dropped.` : ""),
  );
}

main().catch((err) => {
  console.error(`calendar sync failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
