-- Kendra looks for tools, so she does not have to go looking.
--
-- HER ASK: "one of the employees should be looking for tools and things to suggest to me that i use
-- to help achieve my goals too. i shouldnt have to scroll to look for things to suggest to myself to
-- use. i want to keep costs down but i might have to pay for some things and it should always be a
-- suggestion." And the example that defines the whole problem: "ex software lightreel.ai i dont know
-- if its good or not."
--
-- ─── Why Kendra ─────────────────────────────────────────────────────────────
--
-- Systems Manager. The tool stack IS systems, and she had no work in a roster where Camille owned
-- every duty. Camille is the obvious answer and the wrong one — she is already carrying the
-- executive report and buyer sourcing, and a research employee doing all research is how one seat
-- becomes the whole company.
--
-- ─── The rule that makes this useful rather than an advertisement ───────────
--
-- "I don't know if it's good" cannot be answered by the vendor. A landing page will always say the
-- tool is excellent, so EVIDENCE MUST COME FROM SOMEWHERE OTHER THAN THE SELLER: a practitioner
-- writing about using it, a comparison someone ran, a thread where people complain about it. A
-- suggestion sourced from the product's own marketing is not a suggestion, it is a repost.
--
-- ─── Her own standing rule, encoded ─────────────────────────────────────────
--
-- "Check existing before proposing vendors." Before naming anything paid, the run has to say what
-- she would use it INSTEAD of — including the free option and including doing nothing. She has
-- repeatedly been offered paid services for problems she already had solved, and the cost of that is
-- not the subscription, it is the hour spent discovering the overlap.
--
-- ─── Nothing is ever adopted ────────────────────────────────────────────────
--
-- Every row lands as a suggestion with a price and a verdict, and stays there until she says
-- otherwise. There is no path in this system by which a tool becomes part of her stack without her.

CREATE TABLE tool_suggestions (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,
  -- Which of her goals it serves: brokerage | west_peek | ads | saas | digital_products | youtube |
  -- practice | ops. A tool with no goal attached is a tool she does not need.
  serves         TEXT NOT NULL DEFAULT 'ops',
  what_it_does   TEXT NOT NULL,
  -- The real number, or null when the vendor hides it. NEVER estimated: a guessed price is the one
  -- number that turns a suggestion into a bad decision.
  price_note     TEXT,
  free_tier      INTEGER NOT NULL DEFAULT 0,
  -- What she would use it INSTEAD of, including "nothing" and including something she already owns.
  instead_of     TEXT,
  -- The honest verdict, and where it came from. `evidence_url` may never be the vendor's own site.
  verdict        TEXT,
  evidence       TEXT,
  evidence_url   TEXT,
  -- new | trying | adopted | rejected. Hers to move, always.
  status         TEXT NOT NULL DEFAULT 'new',
  notes          TEXT,
  run_id         TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_tool_url ON tool_suggestions(url);
CREATE INDEX idx_tool_status ON tool_suggestions(status, created_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('tool_suggestions', 'ops', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Publicly available software, with a price and a sourced verdict. Nothing personal and nothing about a counterparty: these are products anyone can look up, held here so she does not have to go looking.')
ON CONFLICT(entity) DO NOTHING;

-- ─── Kendra's duty ───────────────────────────────────────────────────────────
--
-- Thursday, weekly. Deliberately not Monday: Monday already carries the property read and the
-- backlink sweep, and three lists landing on one morning is three lists she skims.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_tool_scout', 'Tools worth knowing about', 'emp_continuity', 'ops',
   8, 0, 'America/Chicago', 'weekly', 4,
   0, 'research', 'Tools worth knowing about',
   json_object(
     'backend_id', 'bk_claude_code',
     'delivers', 'tool_suggestions',
     'requested', json_object(
       'repo_path', '/Users/sequoiataylor/.boss-os/tools',
       'allowed_paths', json_array('/Users/sequoiataylor/.boss-os/tools'),
       'web_tools', json_array('WebSearch', 'WebFetch'),
       'max_seconds', 1800
     ),
     'prompt',
     'Find tools she should know about, so she never has to go looking for them.' || char(10) || char(10) ||
     'GOALS.json in your working directory lists what she is actually trying to do — sell digital products, generate and sell leads from local guides sites, get two SaaS apps distributed through partnerships, grow a YouTube channel, and rank properties that currently sit on page six of Google. Aim at those. A brilliant tool for a business she does not run is noise.' || char(10) || char(10) ||
     'ROTATE THE QUESTION each week rather than searching the same thing: what are people actually using to get customers for a digital product, to build citations and get surfaced by LLMs, to produce short-form video without a studio, to find and pitch backlink targets, to run cold outreach that lands. Pick one or two and go deep.' || char(10) || char(10) ||
     '── THE RULE THAT MATTERS MOST ──' || char(10) || char(10) ||
     'A VENDOR IS NEVER EVIDENCE ABOUT ITSELF. Every landing page says the product is excellent. Her exact words about one she had seen: "i dont know if its good or not." So `evidence_url` must NOT be the product''s own site — find a practitioner writing about using it, a comparison someone actually ran, a thread where people say what broke. If you cannot find independent evidence, say so in the verdict and mark it unproven rather than dropping it or dressing up the marketing copy.' || char(10) || char(10) ||
     '── COST ──' || char(10) || char(10) ||
     'Report the REAL price or say the vendor hides it. Never estimate one — a guessed price is the single number that turns a suggestion into a bad decision. Note the free tier honestly, including how crippled it is.' || char(10) || char(10) ||
     'Before proposing anything paid, say what she would use it INSTEAD of — including the free alternative, including something she may already have, and including doing nothing. She wants costs kept down and has repeatedly been sold things for problems she had already solved.' || char(10) || char(10) ||
     '── WHAT NOT TO DO ──' || char(10) || char(10) ||
     'Do not sign up for anything. Do not enter any details anywhere. Do not recommend adopting anything — every row is a suggestion she decides on. Three tools you actually investigated beat fifteen you listed from a roundup article, and a roundup article is usually affiliate marketing.' || char(10) || char(10) ||
     'WRITE delivers.json AFTER EVERY TOOL YOU FINISH — not at the end. You are on a hard timeout and whatever is in the file is what she gets.' || char(10) || char(10) ||
     'delivers.json:' || char(10) ||
     '  tools [{ name, url, serves, what_it_does, price_note, free_tier, instead_of, verdict, evidence, evidence_url }]' || char(10) ||
     '        serves is one of: brokerage, west_peek, ads, saas, digital_products, youtube, practice, ops.' || char(10) ||
     '        verdict is your honest read in one or two sentences, including when it is "probably not worth it".' || char(10) ||
     '  gaps  [{ wanted, why }] — questions you could not answer, including tools you looked at and could find no independent evidence for.'
   ),
   'Three or fewer tools, each aimed at a goal she actually has, each carrying a real price or an honest "hidden", each with a verdict backed by evidence from somewhere other than the vendor, and each saying what it would replace.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0194_boss_tool_suggestions');
