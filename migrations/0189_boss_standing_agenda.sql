-- Things to raise with a person the next time you see them.
--
-- HER ASK: "make sure this is reminded to me some kind of way by one of my employees — maybe i
-- should have a packet prepared before each meeting on wed with scooter showing what ive done for
-- the week and anything i need to discuss with him."
--
-- The trigger was a real item that would otherwise have evaporated: ask Scooter to grant the same
-- Google permission for the West Peek sending address, which is what unblocks reading LP replies
-- and the opt-out defect the register has carried since 19 August. That item exists nowhere. It was
-- said in a conversation and would have been remembered on Wednesday or not at all.
--
-- ─── Why a table rather than an open loop ──────────────────────────────────
--
-- `open_loops` is time-shaped: a thing to do, ageing, that she closes. This is person-shaped: a
-- thing to SAY, that has no deadline and cannot be actioned alone — it waits for the next time
-- those two people are in a room. Filing it as a loop would make it overdue every day until the
-- meeting, which trains her to ignore overdue loops.
--
-- ─── Why it is not just a note in the calendar ─────────────────────────────
--
-- Because the system can add to it. When the sourcing sweep finds something that needs his sign-off,
-- or a duty stalls on an access grant only he can give, that item belongs on this list the moment
-- it is discovered rather than when she happens to remember it at 6am on Wednesday.
--
-- ─── Names ─────────────────────────────────────────────────────────────────
--
-- `counterpart` is a key, not a person record. Her rule keeps client and counterparty names out of
-- the OS; her own business partner is neither, and a first name attached to a standing meeting is
-- what makes the list readable. Nothing here links to `people`, and no LP, buyer or client name may
-- be filed as a counterpart.

CREATE TABLE meeting_agenda_items (
  id            TEXT PRIMARY KEY,
  -- Who this is for. A key like 'scooter' — a standing counterpart, never a client or an LP.
  counterpart   TEXT NOT NULL,
  title         TEXT NOT NULL,
  detail        TEXT,
  -- Where it came from, so an item the system raised is distinguishable from one she typed.
  -- owner | system | duty | analyst
  source        TEXT NOT NULL DEFAULT 'owner',
  -- open | raised | dropped. `raised` records that it was actually discussed, which is what makes
  -- an item that keeps coming back visible as a pattern rather than as a fresh idea each week.
  status        TEXT NOT NULL DEFAULT 'open',
  -- 1 blocks something; 2 matters; 3 is worth mentioning. Blocking items lead the packet, because
  -- an unread access grant is worth more meeting minutes than a status update.
  priority      INTEGER NOT NULL DEFAULT 2,
  raised_at     INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_agenda_open ON meeting_agenda_items(counterpart, status, priority);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('meeting_agenda_items', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'Things to raise with a standing counterpart at the next meeting. Operating machinery, not relationship content: no client, LP or buyer name may be filed here, and nothing links to a person record. External processing asks first because an item can quote a business detail.')
ON CONFLICT(entity) DO NOTHING;

-- ─── The three items already known ──────────────────────────────────────────
--
-- Seeded rather than left to be remembered, because each was found today by reading the two
-- spreadsheets and each would otherwise have to survive in her head until Wednesday.

INSERT OR IGNORE INTO meeting_agenda_items (id, counterpart, title, detail, source, priority, status, created_at, updated_at) VALUES
  ('mai_wp_gmail_grant', 'scooter',
   'Ask for the same Google grant on the West Peek sending address',
   'Domain-wide delegation, Client ID 109529914046573753934, scope https://www.googleapis.com/auth/gmail.readonly, on sequoia@westpeek.ventures. It is what lets anything read LP replies — and the outreach register has carried an open item since 19 August saying opt-out requests land in that mailbox and are structurally invisible. That is a live compliance defect on 248 sent emails, not a nice-to-have.',
   'system', 1, 'open', unixepoch() * 1000, unixepoch() * 1000),

  ('mai_wp_tracker_stale', 'scooter',
   'The AI Outreach tab he reads is five weeks behind',
   'His LP Tracker''s AI Outreach tab ends 5 August. The source outreach log runs to 22 August, and has written nothing since — 16 days. Two separate questions: whether the weekly copy is worth automating, and whether the outreach agent is still running at all.',
   'system', 1, 'open', unixepoch() * 1000, unixepoch() * 1000),

  ('mai_wp_pipeline_zero', 'scooter',
   'The tracker reports $0 pipeline while the commitments tab shows verbal yeses',
   'The header cells read Amount In Pipeline $0.00 and Amount Committed $0.00. The commitments tab lists roughly $5.95M against named investors, several marked verbal yes. The summary formulas are not reading the tab holding the money. Worth agreeing which number is the real one before either of you quotes it.',
   'system', 2, 'open', unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0189_boss_standing_agenda');
