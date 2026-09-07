-- Backlink prospecting, given to Monique, because the data says it is the lever.
--
-- HER QUESTION: "maybe someone can be responsible for trying to find me some backlinks?"
--
-- THE MEASUREMENT SAYS SHE IS RIGHT, which is worth recording because it makes this a decision
-- rather than a hunch. Across 23 Search Console properties in 28 days: 7,642 impressions and 24
-- clicks — a 0.31% click-through rate. That reads like a titles-and-snippets problem until you look
-- at position: the top queries on her strongest properties average between 56 and 78. That is pages
-- six to eight. Nobody clicks page six, and a better title at position 70 changes nothing.
--
-- So indexing works and ranking does not. At that distance the lever is authority, which is what a
-- backlink is, and it is also why the authority-backlink-network repo exists.
--
-- ─── Why Monique ────────────────────────────────────────────────────────────
--
-- Link acquisition is outreach: finding a person who runs a page, and giving them a reason to link.
-- That is the Director of Relationships' job description rather than a research task, and she had
-- no work in a system where Camille owned every duty.
--
-- ─── Why an agent CAN do this one ───────────────────────────────────────────
--
-- Unlike the network refresh, the Search Console read or the sheet sync, this needs no credential of
-- hers — it is open-web research. Agents research the world; local jobs read her accounts. This one
-- falls cleanly on the agent side.
--
-- ─── What makes a prospect real ─────────────────────────────────────────────
--
-- A URL that exists, that accepts links of this kind, and a named way to ask. "Guest post on
-- industry blogs" is not a prospect; a specific resource page with a maintainer and a submission
-- route is. The delivery path drops anything without a source URL, exactly as the buyer sourcing
-- does, because the failure mode here is a list of plausible-sounding sites that each cost her an
-- hour to discover are dead.

CREATE TABLE link_prospects (
  id             TEXT PRIMARY KEY,
  -- The property this link would point at. Her own domain: not a client, not a counterparty.
  property       TEXT NOT NULL,
  -- The page that could carry the link.
  url            TEXT NOT NULL,
  site_name      TEXT,
  -- resource_page | directory | unlinked_mention | guest_post | profile | other
  kind           TEXT NOT NULL DEFAULT 'resource_page',
  -- Why this page plausibly links to something like hers, in one sentence.
  rationale      TEXT,
  -- How a person actually asks: a contact page, a submission form, a named editor, a repo PR.
  approach       TEXT,
  -- Rough authority signal if one was found, and null rather than guessed when it was not.
  authority_note TEXT,
  -- new | reviewed | contacted | won | rejected
  -- SHE DECIDES. Nothing is contacted by this system; the whole table is a list to work.
  status         TEXT NOT NULL DEFAULT 'new',
  notes          TEXT,
  run_id         TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_link_prospect_url ON link_prospects(property, url);
CREATE INDEX idx_link_prospect_status ON link_prospects(status, created_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('link_prospects', 'wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'Public web pages that might link to her own properties, each with the URL it was found at. No client, counterparty or personal data: these are her sites and other people''s public pages. External processing asks first because the research that produces it reads the open web.')
ON CONFLICT(entity) DO NOTHING;

-- ─── Monique's duty ──────────────────────────────────────────────────────────
--
-- Weekly on Monday, not daily. Link prospecting produces a list she has to work by hand, and a new
-- list every morning on top of an unworked one is how the whole thing gets ignored. next_due_at 0
-- so the first cron tick materialises it.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_link_prospects', 'Backlink prospecting', 'emp_relationship', 'ops',
   7, 30, 'America/Chicago', 'weekly', 1,
   0, 'research', 'Backlink prospecting',
   json_object(
     'backend_id', 'bk_claude_code',
     'delivers', 'link_prospects',
     'requested', json_object(
       'repo_path', '/Users/sequoiataylor/.boss-os/links',
       'allowed_paths', json_array('/Users/sequoiataylor/.boss-os/links'),
       'web_tools', json_array('WebSearch', 'WebFetch'),
       'max_seconds', 1800
     ),
     'prompt',
     'Find real, reachable places that could link to these sites.' || char(10) || char(10) ||
     'THE PROBLEM, so you aim at the right thing: these properties are indexed and served by Google, and their top queries sit at average positions between 56 and 78 — pages six to eight. 7,642 impressions produced 24 clicks last month. A better title at position 70 changes nothing; what moves a page from position 70 is authority. That is what you are hunting.' || char(10) || char(10) ||
     'PROPERTIES.json in your working directory lists her sites and what each is about, newest performance first. Work the top three only. A long list worked shallowly is worse than three worked properly.' || char(10) || char(10) ||
     'What counts as a prospect:' || char(10) ||
     '  · A resource or links page that already lists sites like hers, and is still maintained.' || char(10) ||
     '  · A directory that accepts submissions in her category and is not obviously a link farm.' || char(10) ||
     '  · An UNLINKED MENTION — a page that names her site or its content without linking. These are the best ones: the relationship already exists and the ask is small.' || char(10) ||
     '  · A page whose author plausibly wants what she has, with a real way to reach them.' || char(10) || char(10) ||
     'What does not count, and must not be delivered: anything you did not open, any paid-link scheme, any private blog network, comment or forum spam, and any generic advice like "guest post on industry blogs". A prospect is a URL, a reason, and a named way to ask.' || char(10) || char(10) ||
     'OPEN EVERY PAGE YOU LIST. The failure mode here is twenty plausible-sounding sites that each cost her an hour to discover are dead, parked, or have not been updated since 2019. Ten real ones beat fifty guesses, and three real ones is a good week.' || char(10) || char(10) ||
     'WRITE delivers.json AFTER EVERY PROSPECT YOU VERIFY — not at the end. Rewrite the whole file each time. You are on a hard timeout and will be killed without warning; whatever is in the file is what she gets.' || char(10) || char(10) ||
     'delivers.json:' || char(10) ||
     '  prospects [{ property, url, site_name, kind, rationale, approach, authority_note }]' || char(10) ||
     '            kind is resource_page | directory | unlinked_mention | guest_post | profile | other.' || char(10) ||
     '            approach says how a person actually asks: a contact page, a submission form, a named editor, a repo PR.' || char(10) ||
     '            authority_note is null unless you actually saw a signal — never estimate a domain authority.' || char(10) ||
     '  gaps      [{ wanted, why }] — properties you could not find anything for, and why. That is real information: it may mean the niche has no link surface.' || char(10) ||
     '  notes     Anything she should know about how the search went.' || char(10) || char(10) ||
     'You do not contact anyone. This is a list for her to work.'
   ),
   'Between three and ten prospects, every one a URL that was actually opened, carrying a reason it would plausibly link and a named way to ask — with properties that yielded nothing reported as gaps rather than padded.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0193_boss_link_prospects');
