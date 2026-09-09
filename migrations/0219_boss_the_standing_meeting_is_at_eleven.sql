-- The standing Wednesday was seeded at the wrong hour, and the real one was readable all along.
--
-- ─── Two corrections, and the second is the interesting one ────────────────
--
-- 1. THE EPOCH WAS WRONG. 0213 seeded `dia_standing_scooter` at 1788994800000, described in its own
--    comment as "09:00 America/Chicago". That epoch is 23:00 UTC, which is 18:00 Chicago. The
--    comment and the number disagreed and the number is what rendered — six o'clock in the evening,
--    on her screen, for a morning meeting.
--
-- 2. AND NINE O'CLOCK WAS A GUESS IN THE FIRST PLACE. The Calendar API, readable since the API was
--    enabled in the GCP project, answers the question directly:
--
--        "start": { "dateTime": "2026-09-09T11:00:00-05:00", "timeZone": "America/New_York" }
--
--    "Sequoia // Scooter Sync", weekly. So it is 11:00, not 09:00, and the packet job's 07:00 slot
--    is four hours before it rather than two — which is fine, and worth knowing rather than
--    assuming.
--
-- ─── The disagreement inside that answer, recorded so it is not rediscovered ─
--
-- THE OFFSET AND THE ZONE LABEL DO NOT AGREE. New York is at -04:00 in September; the stored offset
-- is -05:00. RFC 3339 makes the offset authoritative, so the instant is 16:00 UTC — and the iCal
-- feed for the same calendar carries only `TZID=America/New_York`, so anything honouring the label
-- faithfully lands an hour away from the same meeting.
--
-- That is why the diary merges on the DAY and the TITLE rather than on the hour, and why the
-- Calendar API is the preferred source while the iCal feed is the resilience layer. Both readings
-- are defensible; they differ; one meeting must still appear once.
--
-- 1789012800000 is 2026-09-09T16:00:00Z, which is 11:00 America/Chicago.
UPDATE diary_entries
   SET scheduled_at = 1789012800000,
       duration_min = 45,
       note = 'The standing weekly with Scooter — "Sequoia // Scooter Sync" on the West Peek calendar, 11:00, 45 minutes. Its packet is on the agenda page every Wednesday; the link is on this row when one has been filed.',
       updated_at = unixepoch() * 1000
 WHERE id = 'dia_standing_scooter';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0219_boss_the_standing_meeting_is_at_eleven');
