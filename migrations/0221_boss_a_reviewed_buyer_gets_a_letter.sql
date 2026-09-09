-- Reviewing something has to leave a next move behind it, and a row has to be able to say why it
-- is on her screen.
--
-- ─── Her words, 9 September 2026 ───────────────────────────────────────────
--
--   "the people tab has all these code names i dont know who these people are and it doesnt help
--    its not useful. the capital tab has all these prospective buyers and i reviewed them ....now
--    what? it doesn't suggest an email already crafted to send to them? and has it looked thru my
--    email for buyers who i actually did a deal with? or that actually discussed buying something
--    with me?"
--
-- Three complaints, and all three are the same defect wearing different hats: THE SCREEN ENDS. It
-- shows a correct thing and then stops, so the reader is left holding a list and no next move.
--
-- ─── 1. A reviewed candidate produces a letter ─────────────────────────────
--
-- `sourcing_candidates` has had a `reviewed` status since 0185 and reviewing one has never done
-- anything at all: the row changed a word and the screen redrew. That is the defect class this
-- repository produces most often — work that runs and is inert — landing on the one screen where
-- the whole point is to start a conversation.
--
-- So a verdict of `reviewed` now composes an outreach letter from what is actually known about that
-- buyer, and puts it in her Inbox as a judgement call with Approve / Try Again. Same mechanism as
-- the covers (0208), deliberately: a second approval path would be the two-lists defect.
--
-- IT IS DRAFTED AND NEVER SENT. Boss OS has no send path to a third party, this does not create
-- one, and the resume handler for an approved draft does not acquire one either — approving marks
-- the letter ready and puts it in front of her to send from her own mailbox. `sent_at` is stamped
-- by HER saying she sent it, never by any job here.
--
-- ─── 2. A person on the People tab can say why they are there ──────────────
--
-- `contacts-sync.mjs` has always POSTed `exchanges`, `days_since` and `days_since_she_wrote` for
-- every correspondent, and `POST /relationships/sync` has always thrown all three away. The screen
-- then had nothing to say about anybody, which is half of why it reads as a directory: the numbers
-- that would answer "why is this person here" were computed on her Mac, sent over the wire, and
-- dropped on the floor.
--
-- Two columns, and the endpoint stops discarding them. Neither identifies anybody: a count of
-- exchanges and the last time SHE wrote are facts about her own behaviour.
--
-- ─── 3. The buyer list can carry people she has actually dealt with ────────
--
-- 0185 wrote `origin` with exactly three values in mind — public_research | email_gap | email_match
-- — and said in its own comment that the email half would activate when the access existed. It
-- exists: `gmail-metadata.mjs` has been reading the brokerage mailbox through a named service
-- account since it was written. What was missing is somewhere to put the answer, and the one
-- distinction she asked for by name — someone she DID A DEAL with, versus someone who DISCUSSED
-- buying — had no column to live in.
--
-- `history_kind` is that column, and it is deliberately not folded into `origin`: origin says where
-- a row came from, history_kind says what her history with them is, and a screen that has to derive
-- the second from the first would derive it differently in two places.

-- ─── The letter ──────────────────────────────────────────────────────────────
--
-- WHY ITS OWN TABLE RATHER THAN A COLUMN ON THE CANDIDATE. A candidate can be written to more than
-- once — she sends it back, a second draft is made — and the attempts are the record of what was
-- tried. Overwriting one column would destroy exactly the history that makes the second attempt
-- better than the first.
--
-- NO ADDRESS, EVER. `to_hint` is how to reach them in her own words ("the contact address on their
-- secondaries page"), never an address: the composer works from `sourcing_candidates`, which holds
-- public institutions and no contact details, and the endpoint refuses an '@' the same way the
-- relationship sync does.
CREATE TABLE buyer_outreach_drafts (
  id             TEXT PRIMARY KEY,
  candidate_id   TEXT NOT NULL REFERENCES sourcing_candidates(id) ON DELETE CASCADE,
  -- The judgement call carrying this draft into her Inbox. NOT NULL: a draft that never reaches her
  -- is a file, and this table exists precisely because a file is what she already had.
  judgement_id   TEXT NOT NULL,
  attempt        INTEGER NOT NULL DEFAULT 1,

  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  -- Where to send it, in words rather than as an address. See the note above.
  to_hint        TEXT NOT NULL,
  -- WHAT THE LETTER WAS BUILT FROM, as json, so an approval can be audited against the facts that
  -- were true when it was drafted rather than the facts that are true when someone asks later.
  built_from     TEXT NOT NULL,

  -- awaiting  — in her Inbox, undecided.
  -- approved  — she said yes. The letter is ready for her to send; nothing here sent it.
  -- sent      — SHE says she sent it. Only her own action writes this.
  -- try_again — she sent it back with a reason; a later attempt supersedes it.
  state          TEXT NOT NULL DEFAULT 'awaiting'
                 CHECK (state IN ('awaiting','approved','sent','try_again','superseded')),
  her_note       TEXT,
  approved_at    INTEGER,
  sent_at        INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_outreach_state ON buyer_outreach_drafts(state, created_at DESC);
CREATE INDEX idx_outreach_candidate ON buyer_outreach_drafts(candidate_id, attempt DESC);

-- ─── What her history with a candidate actually is ───────────────────────────
--
-- `dealt`     — mail with them carries the shape of a completed transaction.
-- `discussed` — mail with them carries the shape of a purchase conversation that did not complete.
-- NULL        — no mail history at all, which is every row the web sweep has ever produced.
--
-- The distinction is hers and it is the whole of her third question. It is stored rather than
-- derived because the evidence for it lives in a mailbox this database cannot read.
ALTER TABLE sourcing_candidates ADD COLUMN history_kind TEXT;
-- Dates and counts, never a quotation and never a subject line. Same rule as a mailbox finding.
ALTER TABLE sourcing_candidates ADD COLUMN history_note TEXT;
ALTER TABLE sourcing_candidates ADD COLUMN history_exchanges INTEGER;
ALTER TABLE sourcing_candidates ADD COLUMN history_last_at INTEGER;

-- ─── Why a person is on the People tab ───────────────────────────────────────
--
-- Both computed on her Mac and posted since the day contacts-sync was written; both discarded on
-- arrival until now.
ALTER TABLE relationships ADD COLUMN exchanges INTEGER;
-- The last time SHE wrote, as distinct from the last time anything happened. "They wrote in June
-- and you never answered" is a different fact from "you spoke in June", and it is the one that
-- names an action.
ALTER TABLE relationships ADD COLUMN her_last_write_at INTEGER;

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('buyer_outreach_drafts', 'wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'A letter drafted to a public institution from public research already in sourcing_candidates, and her verdict on it. It holds no address and no counterparty content; the endpoint refuses a payload containing an at-sign. External processing asks first because a later draft may be composed by a model rather than from the row.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0221_boss_a_reviewed_buyer_gets_a_letter');
