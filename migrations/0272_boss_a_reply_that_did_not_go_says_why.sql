-- A REPLY THAT DID NOT GO SAYS WHY, AND A REPLY THAT WAS NEVER DUE SAYS THAT INSTEAD.
--
-- ─── The two defects this closes, which looked like one ─────────────────────
--
-- `boss_inbound_mail.replied_at` was the whole record of whether she was answered. It is set only
-- on a successful `message.reply()` in the Worker's `email()` handler; the failure branch did
-- `console.error("boss inbound reply failed", err)` and nothing else. Workers Logs keep three days,
-- so by the time anybody asked "why did that one not get answered?" the reason no longer existed
-- anywhere. Nobody has ever been able to see WHY a specific reply failed — only that it did.
--
-- AND `replied_at IS NULL` WAS NOT ONE FACT, IT WAS THREE. Measured against production on
-- 22 September 2026, fourteen authorised arrivals had a null `replied_at`. TWELVE of them were
-- never sent over SMTP at all: they were typed into Boss OS from her own session and reached
-- `handleBossInboundMail` through `POST /api/boss/intake/mail`, which hands the reply back in the
-- HTTP response and has no `ForwardableEmailMessage` to reply with. Their message ids say so
-- plainly — `<iml_…@boss-os-console>`. Those rows were never failures; they were rows where no
-- reply was ever due, wearing the same shape as a failure. The "cluster of 7 in a row on
-- 2026-09-12" that has been read as an outage was seven console messages in a row.
--
-- That left exactly ONE genuine SMTP reply failure in the whole table
-- (`iml_m351xdg27p30hj5k`, 2026-09-22 17:16:45, "Fwd: Shorts lane #simone", iPhone Mail), and no
-- record anywhere of what Cloudflare said about it. Hence both columns below: one that says which
-- of the three things happened, and one that carries the reason when it failed.
--
-- ─── Why a state column rather than more nullable timestamps ────────────────
--
-- `replied_at` stays exactly as it is and keeps its meaning (the moment a reply was accepted).
-- `reply_state` is the thing a query can group by without having to know that a console message
-- has a message id ending in `@boss-os-console`. A NULL `reply_state` on a new row would be the
-- same ambiguity coming straight back, so every write path sets it, and the backfill below leaves
-- no row without one.

ALTER TABLE boss_inbound_mail ADD COLUMN reply_state TEXT;
ALTER TABLE boss_inbound_mail ADD COLUMN reply_error TEXT;

-- ─── Backfill: every existing row gets the truest state its own data supports ──
--
-- Order matters; each statement excludes what the ones before it already claimed.

-- 1. It was sent. `replied_at` is the proof and it is Cloudflare's own acceptance.
UPDATE boss_inbound_mail SET reply_state = 'sent' WHERE replied_at IS NOT NULL;

-- 2. She typed it here, so the answer went back on screen in the HTTP response and no SMTP reply
--    was ever attempted. The console mints its own message id in exactly this shape
--    (`consoleMessageId` in intake/inboundMail.ts), which is why this is a fact and not a guess.
UPDATE boss_inbound_mail
   SET reply_state = 'shown_on_screen'
 WHERE reply_state IS NULL AND message_id LIKE '%@boss-os-console>';

-- 3. A refused sender is answered with silence ON PURPOSE — replying would confirm the address is
--    live. Not a failure, and it must never be counted as one.
UPDATE boss_inbound_mail
   SET reply_state = 'none_due'
 WHERE reply_state IS NULL AND outcome = 'REFUSED_SENDER';

-- 4. Everything left is an authorised SMTP arrival that should have been answered and has no record
--    of having been. It is named as unknown rather than as failed, because the reason was thrown
--    away by the code this migration accompanies and inventing one here would be the same defect in
--    a different table.
UPDATE boss_inbound_mail
   SET reply_state = 'unknown_before_0272',
       reply_error = 'The reply failed before 0272 and the reason was only ever written to console.error, which is gone. Nothing was recorded; nothing is inferred here.'
 WHERE reply_state IS NULL;

CREATE INDEX IF NOT EXISTS idx_boss_inbound_mail_reply_state
  ON boss_inbound_mail(reply_state, received_at DESC);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0272_boss_a_reply_that_did_not_go_says_why');
