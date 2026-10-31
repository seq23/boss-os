-- LP scheduling, one tap (owner, 31 Oct 2026). Additive only: six nullable columns on
-- lp_reply_drafts; no existing row or column is touched.
--
--   offered_slots     the times her held reply offers, JSON [{start, zone}] (src/shared/boss/lp/schedule.mjs)
--   picked_start      the offered time the LP picked, when the held reply confirms it (ms)
--   picked_zone       the zone that time is offered in (her zone that day)
--   invite_event_id   the calendar invite her Send tap made (src/worker/boss/lp/schedule.ts)
--   invite_for_start  the picked time that invite is for: one invite per picked time, never two
--   invite_sent_at    when it went

ALTER TABLE lp_reply_drafts ADD COLUMN offered_slots TEXT;
ALTER TABLE lp_reply_drafts ADD COLUMN picked_start INTEGER;
ALTER TABLE lp_reply_drafts ADD COLUMN picked_zone TEXT;
ALTER TABLE lp_reply_drafts ADD COLUMN invite_event_id TEXT;
ALTER TABLE lp_reply_drafts ADD COLUMN invite_for_start INTEGER;
ALTER TABLE lp_reply_drafts ADD COLUMN invite_sent_at INTEGER;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0322_boss_lp_scheduling');
