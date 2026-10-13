-- 0283 — OUTREACH READS THE EXCLUSIVE SEAT, AND EVERY GUIDE SENDS FROM ONE ADDRESS (13 Oct 2026).
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


-- ONE SENDER FOR EVERY GUIDE (owner, 13 Oct 2026). Every Industry Guides property now sends From the
-- umbrella address, so a route is proven per SENDER, and a business is ready only when its route was
-- proven for the sender it uses now. The side businesses keep their proven senders; the five guides
-- return to awaiting_route until the umbrella address is proven once for all six.
ALTER TABLE outreach_domain_state ADD COLUMN route_sender TEXT;
UPDATE outreach_domain_state SET route_sender = 'st@time-2-read.com' WHERE business_key = 'time2read' AND route_state = 'ready';
UPDATE outreach_domain_state SET route_sender = 'hello@aplayermode.com' WHERE business_key = 'aplayermode' AND route_state = 'ready';
UPDATE outreach_domain_state SET route_sender = 'hello@approvalprep.com' WHERE business_key = 'approvalprep' AND route_state = 'ready';
UPDATE outreach_domain_state SET route_sender = 'hello@weddingchecklistpdf.com' WHERE business_key = 'weddingchecklist' AND route_state = 'ready';
UPDATE outreach_domain_state SET route_state = 'awaiting_route', route_detail = 'Sender changed to the umbrella address (0283); waiting for its one route proof.'
 WHERE business_key IN ('uscisexam', 'dentistryguides', 'hormonesivhair', 'neuroevalguides', 'theaccidentguides');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0283_boss_outreach_seat_and_one_guides_sender');
