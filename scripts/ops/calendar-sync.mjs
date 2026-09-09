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

/*
 * ── TWO SOURCES, AND THE ORDER IS THE ARGUMENT ────────────────────────────
 *
 * THE CALENDAR API IS PREFERRED. It was returning 403 and that was never a delegation gap — the
 * Google Calendar API was simply disabled in the GCP project. With it on and `calendar.readonly`
 * granted, `sequoia@westpeek.ventures` returns the real thing, including "Sequoia // Scooter Sync"
 * recurring every Wednesday at 11:00. THAT MEETING WAS IN GOOGLE THE WHOLE TIME and nothing could
 * read it — the empty Meetings tab on a Wednesday was never a missing-manual-entry problem.
 *
 * THE iCal FEEDS STAY AS THE RESILIENCE LAYER. A service-account grant is an OAuth-shaped thing and
 * this morning proved what happens to those: she changed her Google password and the connector died
 * instantly. An iCal secret URL has no token to revoke. Keeping both is not redundancy for its own
 * sake — it is the one lesson of the day, applied.
 *
 * A meeting present in both is filed once: the upsert keys on the event's own id, and the API and
 * the feed report the SAME id for the same event, so the second source updates the first rather
 * than duplicating it.
 */
const CAL_SUBJECTS = (process.env.CALENDAR_SUBJECTS ?? "sequoia@westpeek.ventures,staylor@spry.vc")
  .split(",").map((s) => s.trim()).filter(Boolean);
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A signed assertion for one impersonated calendar. Written out for the same reason every other
 *  credential path here is: a dependency on this path is a supply-chain surface. */
async function calendarToken(creds, subject) {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email, sub: subject, scope: CAL_SCOPE,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(signer.sign(creds.private_key))}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange for the calendar failed with status ${res.status}`);
  return (await res.json()).access_token;
}

/**
 * The events on one impersonated calendar, inside the horizon.
 *
 * `singleEvents=true` IS THE WHOLE REASON THIS IS SIMPLER THAN THE ICS PATH. Google expands
 * recurrence server-side and returns each occurrence with its own id, so the weekly Scooter sync
 * arrives as three dated events rather than as one event and an RRULE to interpret. The ICS parser
 * still has to do that work itself, which is why it exists and why it is tested.
 */
async function readCalendar(creds, subject, horizonDays) {
  const token = await calendarToken(creds, subject);
  const u = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  u.searchParams.set("timeMin", new Date(Date.now() - 86_400_000).toISOString());
  u.searchParams.set("timeMax", new Date(Date.now() + horizonDays * 86_400_000).toISOString());
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("orderBy", "startTime");
  u.searchParams.set("maxResults", "100");

  const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`the calendar answered ${res.status}`);
  const items = (await res.json()).items ?? [];

  return items
    .filter((e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date))
    .map((e) => {
      const start = Date.parse(e.start.dateTime ?? `${e.start.date}T09:00:00Z`);
      const end = e.end?.dateTime ? Date.parse(e.end.dateTime) : null;
      return {
        calendar_uid: e.id,
        title: String(e.summary ?? "(no title)").slice(0, 200),
        scheduled_at: start,
        duration_min: end && end > start ? Math.round((end - start) / 60000) : null,
        location: e.location ? String(e.location).slice(0, 200) : null,
      };
    })
    .filter((e) => Number.isFinite(e.scheduled_at));
}

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

  /*
   * ── THE CALENDAR API FIRST ────────────────────────────────────────────────
   *
   * Preferred over the feeds because Google expands recurrence itself and because it is the source
   * that actually holds her standing Wednesday. It fails soft: a 403 or a revoked grant leaves the
   * iCal path below untouched, which is the entire point of keeping two.
   */
  const rawCreds = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (rawCreds) {
    let creds = null;
    try { creds = JSON.parse(rawCreds); } catch { creds = null; }
    for (const subject of creds ? CAL_SUBJECTS : []) {
      try {
        const found = await readCalendar(creds, subject, HORIZON_DAYS);
        events.push(...found);
        read += 1;
        console.log(`  ✓ calendar ${subject}: ${found.length} event(s) in the next ${HORIZON_DAYS} days`);
      } catch (err) {
        // The status, not the exception: a thrown error here can carry a signed assertion.
        console.error(`  ✗ calendar ${subject}: ${String(err?.message ?? err).slice(0, 120)}`);
      }
    }
  } else {
    console.log("  · no service account in the environment, so the calendar API was not tried.");
  }
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
