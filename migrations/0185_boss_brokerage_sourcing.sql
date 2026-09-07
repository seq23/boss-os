-- The brokerage gets a sourcing motion, because it has never had one.
--
-- HER ACCOUNT OF THE PROBLEM: "no organization or system at all for brokerage — just taking calls as
-- I can and working on what comes to me." No deals closed, not enough top of funnel, deals stalling
-- or falling through. And plainly: "this area of my life is going poorly and it should help me."
--
-- That is not a discipline problem. A business running purely on inbound has a funnel fed by
-- nothing, and a referral business decays silently — nobody ever says they stopped thinking of you,
-- the calls just stop, and it feels like the market. West Peek already has the motion the brokerage
-- lacks: an external agent surfacing LPs every day. This is the same shape, pointed at buyers.
--
-- ─── What the agent does, in her words ──────────────────────────────────────
--
--   1. Search the internet for potential buyers of private tech secondaries — $5M+ minimum,
--      $20M+ preferred.
--   2. Look through her brokerage email for contacts she has not spoken to in a while.
--   3. Find connections she is missing — clients who might want to buy something she has discussed
--      recently.
--
-- ONLY THE FIRST OF THOSE RUNS TODAY, and that is a real boundary rather than a shortcut. Steps 2
-- and 3 need her brokerage inbox, which she has offered but not yet connected, and which is the
-- most confidential material she owns. The duty is written so those steps activate when the access
-- exists; until then it does the web half and says in its own output that the email half did not
-- run. A duty that silently did two thirds of its job would be the worst of both.
--
-- ─── Why the candidates get their own table ─────────────────────────────────
--
-- These are unvetted firms found on the open web. They must never mix with `people` and
-- `relationships`, which hold her actual network and drive the daily touch. A prospect that has
-- quietly become a "relationship" is a system lying about who she knows.
--
-- ON COMPANY NAMES: her standing rule keeps client and counterparty names out of the OS, and this
-- does not breach it. These are public institutions found in public sources, not her clients —
-- `origin` records that so the two can never be confused, and nothing here implies she has spoken
-- to any of them. The moment one becomes a real counterparty it moves to `people` under a code name
-- and this row is closed.

CREATE TABLE sourcing_candidates (
  id             TEXT PRIMARY KEY,
  -- Public institution name. See the note above on why this does not breach the naming rule.
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'buyer',   -- buyer|seller|intermediary
  -- What she is actually looking for: private tech secondaries, $5M+, $20M+ preferred.
  ticket_floor_usd  INTEGER,
  thesis         TEXT,                            -- why they plausibly buy what she sells
  -- Every claim carries where it came from and when it was read. A sourcing list without sources is
  -- a list of guesses, and the whole failure mode here is a plausible name nobody can check.
  source_url     TEXT,
  source_name    TEXT,
  read_at        INTEGER,
  -- public_research | email_gap | email_match — so a web guess is never mistaken for someone she
  -- actually knows, and an email-derived suggestion is never mistaken for a stranger.
  origin         TEXT NOT NULL DEFAULT 'public_research',
  -- new | reviewed | contacted | rejected | promoted
  -- SHE DECIDES. Nothing here becomes a relationship without her saying so; `promoted` records that
  -- it moved to `people` under a code name.
  status         TEXT NOT NULL DEFAULT 'new',
  notes          TEXT,
  run_id         TEXT,                            -- the backend_run that produced it
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_sourcing_name ON sourcing_candidates(name, kind);
CREATE INDEX idx_sourcing_status ON sourcing_candidates(status, created_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('sourcing_candidates', 'wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'Public institutions found in public sources, with the source and read time on every row. Not her client list and not her network: nothing here implies she has spoken to any of them, and a row that becomes a real counterparty moves to people under a code name. External processing asks first because the research that produces it reads the open web.')
ON CONFLICT(entity) DO NOTHING;

-- ─── The duty ────────────────────────────────────────────────────────────────
--
-- 06:45 Central, fifteen minutes after the Executive Intelligence Report, so the two never contend
-- for the single work slot on her Mac and the sourcing list is there when she opens the day.
--
-- next_due_at 0 so the first cron tick after deploy materialises it rather than waiting for
-- tomorrow. Same workspace as the report, same delivery contract shape, same web tools.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence,
   next_due_at, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_brokerage_sourcing', 'Brokerage Sourcing Sweep', 'emp_research', 'ops',
   6, 45, 'America/Chicago', 'daily',
   0, 'research', 'Brokerage Sourcing Sweep',
   json_object(
     'backend_id', 'bk_claude_code',
     'delivers', 'sourcing_candidates',
     'requested', json_object(
       'repo_path', '/Users/sequoiataylor/.boss-os/sourcing',
       'allowed_paths', json_array('/Users/sequoiataylor/.boss-os/sourcing'),
       'web_tools', json_array('WebSearch', 'WebFetch'),
       'max_seconds', 900
     ),
     'prompt',
     'Find buyers for private, late-stage technology secondaries.' || char(10) || char(10) ||
     'The mandate: institutions that buy private tech secondaries at $5M+ per position, and $20M+ is strongly preferred. Family offices, secondaries funds, crossover funds, sovereign and pension allocators with a direct-secondaries programme. Skip anyone whose stated minimum is below $5M.' || char(10) || char(10) ||
     'Use WebSearch and WebFetch and OPEN the pages you cite. For each candidate you must be able to point at a source that actually says they buy secondaries — a fund page, a mandate, a filing, a named transaction, an interview. A plausible-sounding firm with no source is worse than nothing here, because it costs her a phone call to find out.' || char(10) || char(10) ||
     'Write delivers.json in the current working directory:' || char(10) ||
     '  candidates  [{ name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at }]' || char(10) ||
     '              thesis is one sentence on why they plausibly buy what she sells. read_at is an ISO timestamp of when YOU opened the source.' || char(10) ||
     '  gaps        [{ wanted, why }] — anything you could not verify. Never drop a candidate silently; say why it did not make the list.' || char(10) ||
     '  notes       Anything she should know about how the search went.' || char(10) || char(10) ||
     'Ten well-sourced names beat fifty guesses. If you can only verify three, deliver three and say so in gaps.' || char(10) || char(10) ||
     'EMAIL STEPS — DO NOT ATTEMPT THESE. She has asked for two more things from this agent: finding contacts in her brokerage inbox she has not spoken to in a while, and spotting clients who might want to buy something she has discussed recently. Both need her brokerage email, which is not connected to this run. Do not go looking for it, do not read any mailbox, and do not guess at contacts. Record in gaps that the email half did not run and why.'
   ),
   'A list of buyers of private tech secondaries at $5M+ per position, every one carrying a source that was actually opened and the time it was read, with anything unverified named as a gap rather than dropped.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0185_boss_brokerage_sourcing');
