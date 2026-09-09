-- The standing meeting was seeded at the wrong hour twice, by hand, in a row.
--
-- ─── The record, because this is a pattern rather than a slip ──────────────
--
--   0213 wrote 1788994800000 and called it "09:00 America/Chicago". It is 23:00 UTC — six in the
--        evening, Chicago — and the screen showed a morning meeting at 6pm.
--   0219 corrected it to 1789012800000 and called it "16:00 UTC". It is 04:00 UTC the following
--        day, which rendered as eleven at NIGHT.
--
-- And this repository already had the same defect on file: 0202 seeded `blocked_since` as
-- 1756771200000, described as 2 September 2026, and it was 2 September 2025 — so the first thing the
-- escalation ladder ever said was that Simone had been blocked for 371 days.
--
-- THREE TIMES IS NOT CARELESSNESS, IT IS A BAD TOOL. A hand-computed epoch is unreadable, so it
-- cannot be reviewed — the comment beside it is the only thing anyone checks, and the comment is
-- what is being tested against nothing. The number and the sentence drift and only the number runs.
--
-- ─── So the number is computed rather than typed ───────────────────────────
--
-- SQLite reads an ISO instant directly, and `unixepoch('2026-09-09T16:00:00Z') * 1000` is both the
-- value and its own documentation: wrong by a year or by a timezone, it is wrong VISIBLY, in a form
-- a reader can check without a calculator. Every wall-clock seed from here on is written this way.
--
-- 16:00Z is 11:00 America/Chicago, which is what the Calendar API actually says the meeting is:
-- "Sequoia // Scooter Sync", 2026-09-09T11:00:00-05:00, weekly, 45 minutes.
UPDATE diary_entries
   SET scheduled_at = unixepoch('2026-09-09T16:00:00Z') * 1000,
       updated_at = unixepoch() * 1000
 WHERE id = 'dia_standing_scooter';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0220_boss_stop_typing_epochs_by_hand');
