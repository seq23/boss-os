-- The packet is partner-facing, and that changes what belongs in it.
--
-- ASKED RATHER THAN ASSUMED, and the answer moved three things. Her account of what the Wednesday
-- packet is FOR: "showing Scooter I did the work" — accountability between partners, evidence of a
-- week rather than an assertion about it. Not her private prep, which is what it had been built as.
--
-- ─── What comes out ─────────────────────────────────────────────────────────
--
-- Anchors kept, missed and unanswered. Those measure whether she held her own morning floor, which
-- is exactly the sort of thing a system should never put in a document a business partner reads.
-- The Night Gate keeps them; the packet does not, and the code says why so nobody helpfully adds
-- them back.
--
-- ─── What leads it ──────────────────────────────────────────────────────────
--
-- "What changed since last Wednesday", in her words — not the blocking asks, which is what I had put
-- first. A partner meeting opens on movement, and the window is now anchored to the previous
-- Wednesday rather than a rolling seven days, so "since we last spoke" means what it says.
--
-- ─── The flex section ───────────────────────────────────────────────────────
--
-- Her one addition: "need a flex section for anything we need to add one-off." Everything the packet
-- assembles is derived, and derived means it can only ever contain things the system already knows.
-- A one-off — a number he asked for, a document to bring, something said on a call — has no table
-- and never will. `section` separates the two: `raise` is something needing his decision, `misc` is
-- something to have in the room.
--
-- Same table rather than a new one: both are things she needs in front of her on Wednesday, they
-- share a lifecycle, and an item genuinely moves between the two as it firms up.

ALTER TABLE meeting_agenda_items ADD COLUMN section TEXT NOT NULL DEFAULT 'raise'; -- raise | misc

CREATE INDEX idx_agenda_section ON meeting_agenda_items(counterpart, section, status);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0191_boss_packet_sections');
