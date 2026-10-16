-- 0286 — A ROUTE-READY BUSINESS THAT SENDS NOTHING SAYS SO (16 Oct 2026).
--
-- Memphis Senior Care Homes joined the catalog on 13 Oct with its route proven but no postal
-- address (the firm's address had been set on 9 Oct only on the businesses that existed then). The
-- tick refused it every hour for two days and nothing told anyone: a stage that exited 0 having done
-- nothing. Two fixes in code (outreach/engine.ts): a business with no address inherits the one every
-- other business shares, and a route-ready business refused inside the sending window for a missing
-- precondition records a NAMED STOP here, which Today shows her until a tick sends or the cause is
-- fixed. Additive only.
ALTER TABLE outreach_domain_state ADD COLUMN stop_reason TEXT;
ALTER TABLE outreach_domain_state ADD COLUMN stop_at INTEGER;
