-- Correcting an agenda item that was built on a truncated read.
--
-- WHAT I GOT WRONG. 0189 seeded an item saying the outreach log "runs to 22 August, and has written
-- nothing since — 16 days", and asked whether the agent was still running at all.
--
-- It is running. The Sent Log holds 542 rows and its latest is today. The earlier figure came from a
-- Drive markdown export that silently truncated the sheet, and a conclusion was drawn from the part
-- that came back rather than from the sheet. Reading it through the Sheets API — the same path the
-- sync uses — gives the real numbers.
--
-- The item is corrected rather than deleted, because the useful half survived: his AI Outreach tab
-- genuinely ends on 5 August and is 475 rows behind. That is a real thing to raise, and it is now
-- the only claim the item makes.
--
-- WHY THIS IS ITS OWN MIGRATION. She would have walked into a meeting and told her partner the
-- outreach agent had stopped. A wrong fact in a packet is worse than a missing one: the packet is
-- read as prepared, so its errors are repeated aloud with confidence.

UPDATE meeting_agenda_items
   SET title = 'His AI Outreach tab is 475 rows behind',
       detail = 'The Sent Log holds 542 rows, latest today. His AI Outreach tab ends 5 August at 67 rows — so he has been reading a five-week-old picture. The sync now exists and is append-only; it needs one decision about whether to backfill all 475 at once or start from a date. CORRECTION: an earlier version of this item said the outreach agent had stopped writing on 22 August. That was wrong — it came from a truncated export, and the agent is running normally.',
       priority = 1,
       updated_at = unixepoch() * 1000
 WHERE id = 'mai_wp_tracker_stale';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0190_boss_correct_tracker_item');
