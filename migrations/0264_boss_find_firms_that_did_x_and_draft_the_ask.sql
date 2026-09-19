-- 0264 — "Find me a list of firms that did X, and draft an email to ask them Y."
--
-- ─── Her words, 19 September 2026 ────────────────────────────────────────────
--
--   "I would want one of my Boss OS AI agents to find me a list of firms that have reported IPO
--    participation in the release, and draft an email for me to ask if I can send investors to
--    them."
--
-- ─── What that instruction did before this migration (traced, not guessed) ──
--
-- Typed into Team → New task (or mailed to an employee), it reached `admitTask`, was classified
-- `research`, owned by whichever employee came first in the lane (Simone — `KIND_TO_DEPARTMENT`
-- names departments the roster does not use, so the department match never fires), and drained
-- onto a cloud rung with no web access. A model that cannot open a page answered with a paragraph
-- promising to look, the task went `awaiting_approval`, and approving it started nothing: no list,
-- no evidence, no letters, no draft in her Gmail. The politest face of "ran and did nothing".
--
-- ─── What exists now ─────────────────────────────────────────────────────────
--
-- A `firm_scans` row per instruction, owned by Camille, run on the Worker's own queue:
--   1. the instruction is parsed into FIND (what the firms did) and ASK (what she wants of them);
--   2. news search feeds are read for the FIND (public RSS, no key), each article fetched;
--   3. a model on the ladder extracts the firms and THE SENTENCE that says they did X — and a
--      finding is kept only if that sentence is literally in the page it cites (`verified = 1`);
--   4. each verified firm becomes a `sourcing_candidates` row (origin `firm_scan`) and gets a
--      letter through the SAME door the buyer letters use: composed in her voice with the ASK,
--      checked against the rules in code, raised in her Inbox as a judgement card, the green button
--      makes the Gmail draft, a send-back with a note is rewritten (0261). Nothing sends.
--
-- Every step writes its count here, so the task can say "6 sources read · 4 firms found ·
-- 4 letters in your Inbox" from rows rather than from a model's own account of itself.
CREATE TABLE firm_scans (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  instruction     TEXT NOT NULL,
  -- The parse: what the firms did, and what she wants to ask them.
  find_text       TEXT NOT NULL,
  ask_text        TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('queued','searching','extracting','drafting','done','failed')),
  queries         TEXT,              -- JSON list of the search queries used
  sources_found   INTEGER NOT NULL DEFAULT 0,
  sources_read    INTEGER NOT NULL DEFAULT 0,
  findings_count  INTEGER NOT NULL DEFAULT 0,
  verified_count  INTEGER NOT NULL DEFAULT 0,
  drafts_count    INTEGER NOT NULL DEFAULT 0,
  written_by      TEXT,
  cost_micros     INTEGER NOT NULL DEFAULT 0,
  failure         TEXT,
  requested_at    INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_firm_scans_state ON firm_scans(state, requested_at);

-- One row per firm the model named. `verified` is the grounding: the quote appears verbatim in
-- the fetched page. An unverified finding is kept for the record and gets NO letter.
CREATE TABLE firm_scan_findings (
  id            TEXT PRIMARY KEY,
  scan_id       TEXT NOT NULL REFERENCES firm_scans(id) ON DELETE CASCADE,
  firm          TEXT NOT NULL,
  role          TEXT,                -- what the source says they did, in a few words
  quote         TEXT NOT NULL,
  evidence_url  TEXT NOT NULL,
  source_title  TEXT,
  verified      INTEGER NOT NULL DEFAULT 0,
  candidate_id  TEXT,
  draft_state   TEXT,                -- 'awaiting' | 'refused' | null (unverified)
  draft_detail  TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_firm_scan_findings_scan ON firm_scan_findings(scan_id, verified);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('firm_scans', 'research', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Her instruction and the counts of a public-web scan. Public news, public firms; nothing here is a counterparty''s confidence.'),
  ('firm_scan_findings', 'research', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'A firm named in a public article, the sentence that names it, and the URL. Public by construction: a finding is only kept if the sentence is on the public page it cites.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0264_boss_find_firms_that_did_x_and_draft_the_ask');
