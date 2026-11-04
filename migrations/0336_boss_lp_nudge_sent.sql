-- 0336 — the LP nudge can be sent and is remembered (4 Nov 2026 repair).
--
-- lpNudgeItems (shared/boss/lp/plan.mjs) offered "one gentle nudge, once" and filtered on
-- `nudged_at`, but no such column existed and nothing could send the nudge: the Decide card had only
-- "Open their thread to send it". She typed the ask to Simone instead, and triage handed "send this
-- email" to research. Now the card's one tap (routes/lpTap.ts `do=nudge`) and her words "nudge
-- <address>" (lp/nudge.ts) both send it in their thread and stamp `nudged_at`; "Not this one"
-- (`do=nonudge`) stamps it with no send. Additive only.
ALTER TABLE lp_reply_drafts ADD COLUMN nudged_at INTEGER;
ALTER TABLE lp_reply_drafts ADD COLUMN nudge_sent INTEGER;
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0336_boss_lp_nudge_sent');
