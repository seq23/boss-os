-- 26 October 2026 — nothing that waits goes unowned (owner-approved, "build it all").
--
-- waiting_on: Zora's ONE register of everything Boss OS is waiting on. Each item: what, the
-- employee who owns it, the date it is due, the automatic action on that date, and where it
-- surfaces. Zora's daily duty (scripts/ops/waiting-on.mjs, duty_waiting_on) opens the action as a
-- task for the owner on the date, and turns any item with no owner, or a passed date with no
-- action, into a repair for Danielle (fix first; never a Decide for her). Her own to-dos are rows
-- with owner 'sequoia' and kind 'her_todo': Simone's "Yours this week" reads them.
CREATE TABLE IF NOT EXISTS waiting_on (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('measurement','her_todo','build','other')),
  what          TEXT NOT NULL,
  owner         TEXT,
  due_on        TEXT,
  action        TEXT,
  surfaces_in   TEXT,
  state         TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','actioned','done','repair','removed')),
  task_id       TEXT,
  told_at       INTEGER,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waiting_on_due ON waiting_on(state, due_on);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('waiting_on', 'operations', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'What Boss OS is waiting on, who owns it and when: work items, no names or addresses.'),
  ('preseed_watch', 'capital', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'Monique''s weekly pre-seed lists: companies that crossed her desk (with who sent them) and public rounds. Built on her Mac without a model.')
ON CONFLICT(entity) DO NOTHING;

-- Monique's Pre-seed watch: one row per week, the two lists and the comparison as JSON.
CREATE TABLE IF NOT EXISTS preseed_watch (
  week        TEXT PRIMARY KEY,
  crossed     TEXT NOT NULL DEFAULT '[]',
  funded      TEXT NOT NULL DEFAULT '[]',
  compare     TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

-- ── The seed: every waiting item named on 26 Oct 2026 ──────────────────────
INSERT OR IGNORE INTO waiting_on (id, kind, what, owner, due_on, action, surfaces_in, created_at, updated_at) VALUES
  ('wo_wpp_thin', 'measurement', 'WPP-llm: re-read the 192-page thin-content ledger', 'emp_repo', '2026-11-02',
   'Re-read the thin ledger in WPP-llm; compare with the 192 pages recorded; any page still thin gets its fix started in that repo.', 'Simone''s morning email: one line, hit or missed', unixepoch()*1000, unixepoch()*1000),
  ('wo_memphis_vendors', 'measurement', 'Memphis vendor library: pages indexed (was 93 of 105; 9 of 12 never crawled)', 'emp_repo', '2026-11-08',
   'Read Search Console for the vendor library; target all 105 indexed and the 12 crawled. Missed: submit the uncrawled pages through IndexNow and link them from the hub.', 'Simone''s morning email: one line, hit or missed', unixepoch()*1000, unixepoch()*1000),
  ('wo_pnp_hubs', 'measurement', 'Porch & Party hubs: at least 6 of 12 indexed', 'emp_repo', '2026-11-15',
   'Read Search Console. Under 3 indexed: add links from the Memphis vendor library and the Google Business Profile.', 'Simone''s morning email: one line, hit or missed', unixepoch()*1000, unixepoch()*1000),
  ('wo_local_guides', 'measurement', 'Local guides: at least 5 more pages indexed on 3 of the 5 hosts', 'emp_repo', '2026-11-15',
   'Read Search Console per host. Missed: write the city and state brief for the hosts that did not move.', 'Simone''s morning email: one line, hit or missed', unixepoch()*1000, unixepoch()*1000),
  ('wo_approvalprep', 'measurement', 'ApprovalPrep: at least 48 of 72 pages indexed', 'emp_repo', '2026-11-15',
   'Read Search Console. Under 60%: add links to the unindexed pages from the Pinterest feed.', 'Simone''s morning email: one line, hit or missed', unixepoch()*1000, unixepoch()*1000),
  ('wo_neuro_leads', 'measurement', 'neuroevalguides.com: real leads since the 16 Oct launch (0 so far)', 'emp_repo', '2026-11-15',
   'Count real form leads since 16 Oct. Still 0: start the city and state page fix.', 'Simone''s morning email: one line, hit or missed', unixepoch()*1000, unixepoch()*1000),
  ('wo_wedding_cpg', 'measurement', 'weddingbudgetspreadsheet.com /wedding-cost-per-guest: impressions back', 'emp_repo', '2026-11-16',
   'Read Search Console impressions for the page over the last 7 days against its September level. Missed: start the page''s repair.', 'Simone''s morning email: one line, hit or missed', unixepoch()*1000, unixepoch()*1000),
  ('wo_wpp_dupes', 'measurement', 'WPP-llm: under 150 duplicates and at least 70% indexed', 'emp_repo', '2026-11-22',
   'Read the duplicate count and Search Console coverage. Missed: start the duplicate consolidation fix.', 'Simone''s morning email: one line, hit or missed', unixepoch()*1000, unixepoch()*1000),
  ('wo_lp_replies', 'other', 'LP and deal replies from the West Peek mailbox: a draft and an approval card in Decide; no answer in 7 days, one gentle nudge for her yes', 'emp_relationship', NULL,
   'Daily in Monique''s 06:15 LP run (lp-daily.mjs).', 'Simone''s morning email: Decide', unixepoch()*1000, unixepoch()*1000),
  ('wo_unsubscribe', 'build', 'Friday unsubscribe suggestions: senders in her personal Gmail she never opens, each with a one-tap approve', 'emp_repo', '2026-11-06',
   'Build the Friday section (her personal mailbox is read through her own Mac seat; unsubscribing happens only on her tap) and land it.', 'Simone''s Friday morning email', unixepoch()*1000, unixepoch()*1000),
  ('wo_pnp_social', 'her_todo', 'Porch & Party: set up Instagram, TikTok and Buffer', 'sequoia', NULL,
   NULL, 'Simone''s morning email: Yours this week', unixepoch()*1000, unixepoch()*1000);

-- ── The duties ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_waiting_on', 'Nothing that waits goes unowned', 'emp_knowledge', 'ops',
   7, 0, 'America/Chicago', 'daily', NULL, unixepoch()*1000 + 86400000, 'local_job', 'ops',
   'Check the waiting-on register: act on today''s dates, repair anything unowned or overdue',
   json_object('local_job', 'waiting-on.mjs',
     'why_no_model', 'Every item is a row; the check is dates and owners.',
     'why_local', 'It opens tasks through the Boss OS passcode, which lives in the vault on her Mac.'),
   'Every item due today has its action opened for its owner; an item with no owner or a passed date with no action is a repair for Danielle the same day.', 0),
  ('duty_mac_cleanup', 'Keep the Mac''s disk from filling up', 'emp_continuity', 'ops',
   9, 0, 'America/Chicago', 'weekly', 0, unixepoch()*1000 + 86400000, 'local_job', 'ops',
   'Weekly clean-up: old worktrees, caches, published renders, old browsers',
   json_object('local_job', 'mac-cleanup.mjs',
     'why_no_model', 'Selection by age, git state and the publish record; no judgement.',
     'why_local', 'It is her Mac''s own disk.'),
   'Old clean worktrees removed, unpushed ones listed, caches cleared, the log written; under 20 GB free she gets one line.', 0),
  ('duty_preseed_watch', 'Pre-seed watch', 'emp_relationship', 'ops',
   7, 30, 'America/Chicago', 'weekly', 1, unixepoch()*1000 + 86400000, 'local_job', 'ops',
   'Pre-seed watch: what crossed your desk, what was funded in the market, and the gaps',
   json_object('local_job', 'preseed-watch.mjs',
     'why_no_model', 'Mail is read by search and fixed rules; rounds come from public news headlines, marked as reported.',
     'why_local', 'Her mailboxes are read through the delegation on her Mac.'),
   'Two lists side by side on the Deals page and one line in the Monday email; nothing invented, every figure from a source.', 0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0313_boss_nothing_that_waits_goes_unowned');
