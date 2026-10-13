-- 0283 — OUTREACH READS THE EXCLUSIVE SEAT (13 Oct 2026).
--
-- A business with an exclusive routing seat (Memphis Senior Care Homes) picks its pitch at send
-- time from the public seat JSON its site publishes. The last value read is kept here so a failed
-- read uses it (never read = the seat counts as open). The JSON names no facility, so the owner
-- names the seat holder by domain (PUT /api/outreach/business/:key { seat_holder_domain }), and
-- outreach never writes to it. Additive only.
ALTER TABLE outreach_domain_state ADD COLUMN seat_holder_domain TEXT;
ALTER TABLE outreach_domain_state ADD COLUMN seat_active INTEGER;
ALTER TABLE outreach_domain_state ADD COLUMN seat_end TEXT;
ALTER TABLE outreach_domain_state ADD COLUMN seat_read_at INTEGER;
ALTER TABLE outreach_domain_state ADD COLUMN seat_detail TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0283_boss_outreach_reads_the_exclusive_seat');
