-- The same universe, kept in two lists that had never been crossed.
--
-- SHE IS RAISING A FUND FROM FAMILY OFFICES, ENDOWMENTS, FOUNDATIONS AND PENSIONS, and she is
-- brokering late-stage secondaries to family offices, endowments, foundations and pensions. Those
-- are the same institutions wearing different hats. One list lives in a Google Sheet on her Mac
-- (the LP tracker) and the other lives in `sourcing_candidates` in here, and nothing had ever asked
-- whether a name appears on both.
--
-- ─── Why this crosses a boundary the rest of the system keeps shut ───────────
--
-- West Peek and the brokerage are deliberately separate businesses and this repo goes to some
-- trouble to keep them apart. This crosses them ON PURPOSE, because she asked, and the crossing is
-- narrow: it moves a FIRM NAME and the fact of an overlap, in one direction, into a list she
-- reviews. It moves no person, no email, no LP commitment, and nothing about the fund.
--
-- The useful framing, and the one every row is written in: "an LP prospect who is also a plausible
-- buyer". Which hat is which is stated on the row rather than left for her to work out, because the
-- two hats need different sentences and sending the wrong one is the actual risk here.
--
-- ─── Precision over recall, and why near-misses are stored but NOT promoted ──
--
-- A false match costs more than a missed one, and asymmetrically. A missed overlap means she works
-- a firm cold, which is what she does today. A FALSE overlap means she opens a call believing she
-- has a warm relationship with a stranger — and there is no recovering the first thirty seconds of
-- that conversation. So the matcher is conservative by construction, and `confidence` separates
-- what it will vouch for from what it merely noticed:
--
--   'confirmed' — the distinctive core of the two names is identical and one full name is a token
--                 subset of the other. "StepStone" and "StepStone Group (VC Secondaries Fund VI)".
--   'near'      — the cores agree but the names diverge, or the cores are close but not equal.
--                 SHOWN SEPARATELY AND NEVER COUNTED AS A MATCH. This is the row that says "look at
--                 this yourself", not "you know them".
--
-- The failure this guards against is real and was demonstrated while building it: a naive substring
-- search for the candidate "W Capital Partners" matched an LP firm called "Lakeview Capital
-- Management", because "w capital" is a substring of "Lakeview Capital". Matching is on tokens.
--
-- ─── No LP individuals, ever ─────────────────────────────────────────────────
--
-- Her standing rule allows public institution names — `sourcing_candidates` and `link_prospects`
-- already carry them, because a fund's own website is public research and not a client relationship.
-- It does not allow LP PEOPLE. So this table stores the firm, the aggregate state of that firm in
-- her sequence (how many were contacted, which drip stage, whether it is suppressed), and nothing
-- that identifies anybody. Names and addresses stay in the local file the contributor writes.
--
-- The endpoint refuses any payload containing an '@' in a firm field, the same way the relationship
-- sync does. That guard is not theoretical there either: it caught a real leak on its first run.

-- ─── Why the name is not `firm_crossmatches` ─────────────────────────────────
--
-- The first draft called it that and `tests/boss/bridge.test.ts` refused it, correctly. In this
-- database the `firm_*` prefix means THE FIRM — West Peek Ventures the fund entity, whose tables
-- arrived with the chassis clone and whose count is ratcheted downwards by a test that fails the
-- moment a fifth one appears. Phase 21's premise is that Boss OS holds no firm data and the two
-- meet only at an audited bridge; a table about COUNTERPARTIES wearing that prefix would have
-- quietly widened a boundary while looking like a naming choice.

CREATE TABLE counterparty_crossmatches (
  id              TEXT PRIMARY KEY,
  -- The buyer candidate side. Both are stored: the id so she can act on the candidate, the name so
  -- the row still reads correctly if the candidate is later deleted.
  candidate_id    TEXT NOT NULL,
  candidate_name  TEXT NOT NULL,
  -- The LP side, as it is spelled in her tracker. A public institution, never a person.
  lp_firm         TEXT NOT NULL,
  -- The normalised core both sides reduced to. Kept because it is the evidence for the match, and a
  -- match whose reasoning is invisible is one she has to re-derive by hand before trusting it.
  matched_core    TEXT NOT NULL,
  -- 'confirmed' | 'near'. Never mixed in a count.
  confidence      TEXT NOT NULL,
  -- 'core_exact_subset' | 'core_exact' | 'core_near' — how the matcher got there.
  method          TEXT NOT NULL,
  -- Which list on the LP side: 'sequence' (actively being emailed) or 'suppressed' (on the
  -- do-not-contact tab). The distinction matters enormously and is invisible from a firm name:
  -- suppressed means suppressed AS AN LP, which says nothing about approaching them as a buyer.
  lp_list         TEXT NOT NULL,
  -- Aggregates only. Counts of people, never people.
  lp_contacts     INTEGER NOT NULL DEFAULT 0,
  lp_type         TEXT,
  lp_drip_stage   TEXT,
  lp_signal_tier  TEXT,
  lp_first_sent   TEXT,
  lp_last_sent    TEXT,
  lp_status_note  TEXT,
  -- ONE SENTENCE SAYING WHY THIS MATTERS. Required, not optional: a row that says two lists share a
  -- name and does not say what to do about it is a puzzle, and she has enough of those.
  why             TEXT NOT NULL,
  -- Her verdict. new | reviewed | acted | rejected. Nothing else moves a row out of 'new'.
  status          TEXT NOT NULL DEFAULT 'new',
  notes           TEXT,
  run_id          TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- One row per candidate/firm pair. The contributor is idempotent: re-running it refreshes the
-- evidence and leaves her status alone.
CREATE UNIQUE INDEX idx_crossmatch_pair ON counterparty_crossmatches(candidate_id, lp_firm);
CREATE INDEX idx_crossmatch_confidence ON counterparty_crossmatches(confidence, status, created_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('counterparty_crossmatches', 'wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'Public institution names appearing on both the LP tracker and the buyer candidate list, with aggregate counts of her outreach to each. Same class as sourcing_candidates: public funds and endowments, not clients. No LP individual, address or commitment crosses into this table, and the endpoint rejects any firm field containing an @. External processing asks first because the combination — this firm, and where she is with them — is commercially sensitive in a way neither list is alone.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0199_boss_counterparty_crossmatches');
