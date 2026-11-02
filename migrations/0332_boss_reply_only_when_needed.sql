-- A reply only when it is needed, to everyone on their latest message (owner, 2 Nov 2026: "Every email
-- doesn't need a fucking reply"; "Make sure this is the case for boss os - Simone too"). Additive only:
-- nullable columns; no existing row or column is touched. Rules: src/shared/boss/mail/replyNeed.mjs.
--
--   lp_reply_drafts.reply_to      who the held reply goes to, JSON ["Name <address>"] (their latest message's writer)
--   lp_reply_drafts.reply_cc      everyone else on their latest message, minus us, JSON [...]
--   lp_reply_drafts.waiting_why   set when their message needs no reply (pass_along, reviewing, thanks,
--                                 auto_reply, fyi, nothing_asked): the thread waits on them, no draft
--   outreach_replies.reply_need   the same decision for a reply to Monique's outreach
ALTER TABLE lp_reply_drafts ADD COLUMN reply_to TEXT;
ALTER TABLE lp_reply_drafts ADD COLUMN reply_cc TEXT;
ALTER TABLE lp_reply_drafts ADD COLUMN waiting_why TEXT;
ALTER TABLE outreach_replies ADD COLUMN reply_need TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0332_boss_reply_only_when_needed');
