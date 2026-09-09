-- The Wednesday meeting was in Google the whole time and nothing could read it.
--
-- ─── What was actually wrong, established by fixing it ─────────────────────
--
-- The Meetings tab showed nothing on a Wednesday, and the diagnosis at the time was that her
-- forward schedule simply was not in Google — three iCal feeds holding 4,527, 835 and 0 events with
-- ONE dated today or later. That was true of the feeds and it was not the whole truth.
--
-- Two separate things were in the way and both are now cleared:
--
--   1. Domain-wide delegation was not granted on westpeek.ventures or spry.vc. It is now, on both.
--      Gmail impersonation returns real profiles for each.
--   2. THE CALENDAR API WAS DISABLED IN THE GCP PROJECT, which returned 403 and looked exactly like
--      a missing scope. It was not a delegation gap at all. With the API enabled, the West Peek
--      calendar returns "Sequoia // Scooter Sync" recurring every Wednesday at 11:00 — the standing
--      meeting she has been describing all day, present in Google, unreadable by anything.
--
-- SO THE EMPTY MEETINGS TAB WAS NEVER A MISSING-MANUAL-ENTRY PROBLEM. That correction belongs on the
-- record: manual entry stays primary because she asked for it and because a diary must work when a
-- credential dies, but the calendar is a real source rather than a stub, and saying otherwise on a
-- screen would now be false.
--
-- ─── Two sources, deliberately, and the order is the lesson of the day ─────
--
-- The API is preferred: Google expands recurrence server-side, so the weekly sync arrives as dated
-- occurrences rather than as an RRULE to interpret. The iCal feeds STAY, because a service-account
-- grant is an OAuth-shaped thing and this morning demonstrated what happens to those — a password
-- change revoked the connector instantly. An iCal secret URL has no token to revoke. Keeping both is
-- not redundancy for its own sake; it is the one lesson of the day, applied.
--
-- A meeting in both sources is filed once. The upsert keys on the event's own id, and the diary
-- merges a typed entry with a calendar one at the same hour — hers wins, because a calendar entry
-- silently replacing the row she typed is the screen overruling her.

UPDATE credential_probes
   SET what_depends = 'Whether anything scheduled on your personal calendar appears in the diary. It holds 4,527 events going back to 2009 and almost nothing dated ahead, so it is a record of what happened rather than a diary of what is coming — which is why what you type is the spine and this is the supplement.',
       updated_at = unixepoch() * 1000
 WHERE id = 'cred_cal_seq_taylor';

UPDATE credential_probes
   SET what_depends = 'Whether West Peek meetings appear in the diary. This is where the standing Wednesday with Scooter actually lives — it was in Google all along and nothing could read it until the Calendar API was enabled in the project on 9 September.',
       updated_at = unixepoch() * 1000
 WHERE id = 'cred_cal_westpeek';

-- ─── The grant item, and why it did not clear itself ────────────────────────
--
-- `mai_wp_gmail_grant` was designed to disappear the morning the impersonation succeeded, and the
-- morning it succeeded it was STILL ON THE PACKET. The bug was ordering: `closeIfGranted` ran after
-- the SELECT that reads the items, so the read which first saw the grant go live still returned the
-- item and it cleared on the next one.
--
-- "Clears itself, but only the second time you look" is worse than not clearing at all, because the
-- first look is the one where she decides whether to raise it with him. Fixed in `today/packet.ts`
-- by closing before reading; this migration closes the row that is already stale so the fix does not
-- have to wait for a render nobody is watching.
UPDATE meeting_agenda_items
   SET status = 'dropped', updated_at = unixepoch() * 1000
 WHERE id = 'mai_wp_gmail_grant'
   AND status IN ('open', 'raised')
   AND EXISTS (SELECT 1 FROM credential_probes WHERE id = 'cred_westpeek_delegation' AND state = 'live');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0218_boss_the_calendar_can_be_read');
