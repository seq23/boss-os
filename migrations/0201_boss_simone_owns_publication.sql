-- Simone takes possession of the publishing block, and the watcher stops reporting to a log file.
--
-- ─── What she asked for ─────────────────────────────────────────────────────
--
-- "idk which employee deals w/that but someone needs to be responsible for makin sure all my books
-- ive already authored get published and we are stuck b/c of a software issue on amazon side and i
-- have a cron launchd agent emailing back and forth with kdp id like an employee to take possession
-- of this and make sure this all gets published."
--
-- And, on what that person actually does: "simone needs to make sure amazon kdp replies keep coming
-- until a resolve happens. she should read all the emails and make determinations on the responses
-- and then when there is a resolve she should launch claude code browser tool to try again."
--
-- ─── Why Simone ─────────────────────────────────────────────────────────────
--
-- Chief of Staff, and one of three seats that had a charter and no work — the org-chart version of
-- this codebase's favourite defect. Her charter is already exactly this shape: "read what comes in
-- and decide what the Boss actually needs to see... draft the recommendation, never the decision."
-- A support case that has to be read, classified and chased without ever committing her to
-- anything is Chief of Staff work in the ordinary sense of the phrase. Camille researches, Monique
-- keeps relationships, Danielle ships, Imani practises; none of them is who you hand a stuck case.
--
-- ─── The part that decides the architecture ─────────────────────────────────
--
-- AGENTS CANNOT READ HER MAILBOX. The Claude Code runner strips every environment variable matching
-- KEY|TOKEN|SECRET|PASSCODE before the process starts. That is a deliberate property of the
-- sandbox. So "read the KDP support replies and make a determination" cannot be an agent duty — it
-- is a LOCAL job on her Mac, exactly like Monique's network refresh and Camille's Search Console
-- read. Simone is the named OWNER; `scripts/ops/kdp-watch.sh` under launchd is the only thing that
-- can actually do it.
--
-- Which exposed a real gap in `standing_duties`: every row in it assumes an agent executes the
-- task. Monique's refresh and Camille's property read are therefore NOT duties at all — they are
-- launchd jobs with a comment in `today.ts` claiming an owner, which is ownership written in the
-- one place nothing can read. `executor` is the missing column. A `local_job` duty carries the
-- owner, the cadence and the success criterion like any other, and the cron materialises NOTHING
-- for it: the job runs from launchd and reports back, and `next_due_at` advances when it does.
--
-- ─── Reconciling with the watcher that already exists ───────────────────────
--
-- `~/bin/kdp-watch.sh` and `~/bin/kdp-watch-prompt.md` have been running Mon/Wed/Fri at 09:23 since
-- 2 September and they work — the run on 7 September correctly found that the case had fanned into
-- four threads and that she had already answered the newest one herself. What they do NOT do is
-- tell this system anything: the determination lands in `~/Library/Logs/kdp-watch/latest.log` and
-- stops. Two components each keeping their own list with no link between them.
--
-- So the watcher is ABSORBED rather than duplicated. Its canonical copy moves into the repo, the
-- launchd installer owns its plist, and it gains one step at the end: post the determination to
-- Boss OS. A second tracker was the other option and it was never seriously on the table.
--
-- ─── What crosses the boundary, and what does not ───────────────────────────
--
-- The watcher reads SUBJECTS AND BODIES — it has to, because you cannot tell from From/To/Date
-- whether support resolved a case. That reading happens on her Mac, inside `claude -p`, through the
-- Gmail connector she is already signed into. NOTHING OF IT REACHES THIS DATABASE. What is posted
-- is a determination and a state: a sentinel, how many days since support wrote, how many nudges
-- have gone unanswered, and one sentence of the run's own words about what it decided. The
-- endpoint refuses any determination containing an `@`, on the same reasoning the relationships
-- sync uses — it caught a real leak on its first run — and the prompt is told never to quote.

-- ─── The column that makes an owned local job expressible ────────────────────
--
-- 'agent' is the default and every existing duty keeps it, so nothing changes shape.
ALTER TABLE standing_duties ADD COLUMN executor TEXT NOT NULL DEFAULT 'agent';

-- ─── The books ───────────────────────────────────────────────────────────────
--
-- WHY THE TITLES ARE NOT STORED. Her standing rule keeps names out of the OS, and there is a second
-- reason here: this table exists to answer "how many are still stuck", and a reference is enough to
-- answer it. `label` is hers to fill in if she ever wants one; nothing writes it automatically.
CREATE TABLE kdp_titles (
  id             TEXT PRIMARY KEY,
  -- KDP names a draft by an internal title id and a published book by its ASIN. Both are opaque
  -- references to Amazon's own records and neither says anything about the book.
  title_ref      TEXT NOT NULL,
  label          TEXT,
  -- blocked   — Publish refuses. The account-level flag.
  -- in_review  — submitted and awaiting Amazon.
  -- live       — actually published, which is the only state that ends this.
  -- withdrawn  — hers to set, for anything she decides not to publish.
  state          TEXT NOT NULL DEFAULT 'blocked' CHECK (state IN ('blocked','in_review','live','withdrawn')),
  note           TEXT,
  first_seen_at  INTEGER NOT NULL,
  state_changed_at INTEGER NOT NULL,
  went_live_at   INTEGER,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_kdp_title_ref ON kdp_titles(title_ref);
CREATE INDEX idx_kdp_title_state ON kdp_titles(state, state_changed_at DESC);

-- ─── Each time the watcher looked, and what it decided ───────────────────────
CREATE TABLE kdp_case_checks (
  id                 TEXT PRIMARY KEY,
  checked_at         INTEGER NOT NULL,
  -- The watcher's own sentinel, unchanged from the prompt that produces it. `stalled` is the one
  -- that matters most: three or more unanswered nudges means the case is not being worked and needs
  -- a different route entirely, which is a thing only a person can start.
  sentinel           TEXT NOT NULL CHECK (sentinel IN
                       ('no-reply','replied','needs-her','cleared','published','nudged','stalled')),
  -- One or two sentences in the run's own words. NEVER a quotation from the mail: the prompt says
  -- so and the endpoint enforces it by refusing anything with an '@' in it.
  determination      TEXT,
  -- What happens next, and who does it. The honest half of the owner's browser question: some of
  -- this can be automated and some of it cannot, and the screen says which rather than implying.
  next_action        TEXT,
  needs_owner        INTEGER NOT NULL DEFAULT 0,
  days_since_support INTEGER,
  nudges_unanswered  INTEGER,
  threads_seen       INTEGER,
  -- 'launchd' normally; 'manual' when she runs it herself. A determination with no provenance is
  -- one nobody can weigh.
  source             TEXT NOT NULL DEFAULT 'launchd',
  created_at         INTEGER NOT NULL
);
CREATE INDEX idx_kdp_checks ON kdp_case_checks(checked_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('kdp_titles', 'ops', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Opaque Amazon references and a publication state. No titles, no manuscript, nothing about a person: this table answers "how many of her books are still stuck" and holds nothing else that could answer anything.'),
  ('kdp_case_checks', 'ops', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'A determination about a support case, written by a job on her Mac. The mail it was derived from stays there — subjects and bodies are read inside the local run and never posted. External processing asks first because a determination is prose, and prose is where a quotation would hide if the rule against quoting were ever broken.')
ON CONFLICT(entity) DO NOTHING;

-- ─── The seven that are stuck, and the three that prove the account works ────
--
-- The three live ones are here deliberately. They published on 1-2 September from this same
-- account, which is the fact that disproves every "her account is not set up" theory support has
-- sent, and a table that held only the failures would lose it.
-- ONE STATEMENT PER TITLE, not a chain of UNION ALL. The first version was a ten-term
-- compound SELECT and D1's runtime refused it outright: "too many terms in compound SELECT".
-- Ten INSERTs are also simply easier to read than a subquery pretending to be a table.

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, updated_at)
  VALUES ('kdp_A12Z8RECXCYT3S', 'A12Z8RECXCYT3S', 'blocked', 'Draft. Publish refused since 2 September.', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, updated_at)
  VALUES ('kdp_A746KSQA6VXQ8', 'A746KSQA6VXQ8', 'blocked', 'Draft. Publish refused since 2 September.', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, updated_at)
  VALUES ('kdp_A2C99P6JESFOP0', 'A2C99P6JESFOP0', 'blocked', 'Draft. The verification title — known valid, and the one that produced the empty-payload refusal.', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, updated_at)
  VALUES ('kdp_A14601U7XU2FCM', 'A14601U7XU2FCM', 'blocked', 'Draft. Publish refused since 2 September.', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, updated_at)
  VALUES ('kdp_A3O8BGWQ63OSF0', 'A3O8BGWQ63OSF0', 'blocked', 'Draft. Publish refused since 2 September.', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, updated_at)
  VALUES ('kdp_A1EYXUFGFV7CN6', 'A1EYXUFGFV7CN6', 'blocked', 'Draft. Publish refused since 2 September.', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, updated_at)
  VALUES ('kdp_AZUTRW0LN8GDM', 'AZUTRW0LN8GDM', 'blocked', 'Draft. Publish refused since 2 September.', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, went_live_at, updated_at)
  VALUES ('kdp_B0HHFK6W76', 'B0HHFK6W76', 'live', 'Published 1-2 September from this same account.', unixepoch() * 1000, unixepoch() * 1000, 1756771200000, unixepoch() * 1000);

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, went_live_at, updated_at)
  VALUES ('kdp_B0HHHR33NQ', 'B0HHHR33NQ', 'live', 'Published 1-2 September from this same account.', unixepoch() * 1000, unixepoch() * 1000, 1756771200000, unixepoch() * 1000);

INSERT OR IGNORE INTO kdp_titles (id, title_ref, state, note, first_seen_at, state_changed_at, went_live_at, updated_at)
  VALUES ('kdp_B0HHHLKDD4', 'B0HHHLKDD4', 'live', 'Published 1-2 September from this same account.', unixepoch() * 1000, unixepoch() * 1000, 1756771200000, unixepoch() * 1000);

-- ─── Simone's duty ───────────────────────────────────────────────────────────
--
-- MON/WED/FRI 09:23, which is when the watcher already runs and is not arbitrary: KDP support
-- replies on weekdays, so a weekend check finds the same nothing twice. Expressed as a daily
-- cadence with `weekdays`, the middle ground 0196 added.
--
-- next_due_at is the next occurrence rather than 0. A local_job duty is never materialised by the
-- cron, so seeding 0 would not "fire immediately" — it would just read as permanently overdue on
-- the screen from the moment this deploys, which is a false alarm on day one.
--
-- HAIKU, NAMED. `claude -p` with no --model runs the default, which is the most expensive one
-- available: that is what made a single briefing cost $3.88, and this job runs thirteen times a
-- month. Reading four email threads and deciding whether a support reply resolves a case does not
-- need the expensive model. `validate:duty-delivery` asserts the shell script names the same model
-- this row does, so the two cannot drift apart.
--
-- ~$0.05 a run, ~13 runs a month, ≈ $0.65. Takes committed spend from ~$11 to ~$11.65 of the $25.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday, weekdays,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_kdp_publication', 'Kindle publication — chase to resolution', 'emp_chief', 'ops',
   9, 23, 'America/Chicago', 'daily', NULL, json_array(1, 3, 5),
   unixepoch() * 1000 + 86400000, 'local_job', 'ops', 'Kindle publication — chase to resolution',
   json_object(
     'local_job', 'kdp-watch.sh',
     'requested', json_object(
       'model', 'claude-haiku-4-5-20251001',
       'max_seconds', 600
     ),
     'case', '51496198',
     'why_local',
     'Reading KDP support mail needs her mailbox, and the Claude Code runner strips every credential from its environment on purpose. This runs from launchd on her Mac through the Gmail connector she is already signed into; the mail stays there and only a determination is posted back.',
     'prompt_file', 'scripts/ops/kdp-watch-prompt.md'
   ),
   'Every authored title reaches Live. Until then: KDP support is chased on a ladder rather than nagged or forgotten, every reply gets a determination within one run, and the moment the account-level block clears the system says so in words rather than leaving her to notice.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0201_boss_simone_owns_publication');
