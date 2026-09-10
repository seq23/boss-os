-- DANIELLE READS THE AHREFS AUDITS AND FIXES WHAT THEY FOUND, AT SOURCE, EVERY WEEK.
--
-- Owner, 10 September 2026: "i need an employee in Boss OS to search my seq.taylor@gmail.com for
-- any ahref audit reports and auto fix those too."
--
-- ─── This is not a new capability. It is a thing that already worked, made standing ──
--
-- Earlier the same day an agent did it by hand, once, because somebody asked. It found Site Audit
-- mail from `sa@ahrefs.com`, mapped the Ahrefs project names onto repositories by the domains their
-- own REPO_IDENTITY.md declares, and fixed the causes rather than the symptoms:
--
--   · Virtualagency-os → WPP-llm (virtualagency-os.com). Thirteen pages carried a RELATIVE
--     src="assets/…logo.jpeg" which, served at /answers/<page>, resolves to /answers/assets/… and
--     404s. And /admin/ linked seven /data/**.json files deliberately excluded from the deploy.
--   · Spryexecutiveos + Billionairehighperformancecoach → sprylabs-hpc-site. `templates/` was
--     missing from the assembler's deny-list, so twelve raw Mustache sources shipped as live pages
--     carrying href="{{canonical}}". That island of hard-linked template pages WAS the entire error
--     budget for both projects.
--
-- Both landed as PRs (#23 and #74) and were merged by her. The gap this migration closes is that
-- none of it happens again unless somebody asks again — and Ahrefs recrawls every week regardless.
--
-- ─── DANIELLE, RESOLVED BY ROLE AND NOT BY PREFERENCE ───────────────────────
--
-- `emp_repo` — Danielle, Technical Program Manager, Engineering, charter "Repo work, artifacts,
-- validation". Migration 0192 already put "shipping health onto Danielle" in as many words, and
-- `today/pillars.ts` already says "That is why Danielle — Technical Program Manager, Engineering —
-- owns it" about the Execution pillar. A crawl finding is site health in a repository she owns.
--
-- IT IS EXPLICITLY NOT MONIQUE AND NOT SIMONE. Monique is Relationships — capital, counterparties,
-- the book. Simone is Chief of Staff and takes what nobody else can place; routing repo work to her
-- would be using the default as a decision. And Danielle, as of this migration, owns NO duty at
-- all. 0192's own words for that state: "records of staff rather than staff".
--
-- ─── WEEKLY, THURSDAY 06:00 CENTRAL, AND THE HOUR IS DERIVED ────────────────
--
-- Not chosen because "weekly sounds right". Every Site Audit mail in `seq.taylor@gmail.com` was
-- read and timed:
--
--   Thu 2026-08-27  02:20 – 02:31 UTC
--   Thu 2026-09-03  01:07 – 03:58 UTC
--   Thu 2026-09-10  01:07 – 02:42 UTC
--
-- Ahrefs recrawls the whole account on a seven-day rhythm and delivers overnight into Thursday UTC,
-- which is Wednesday evening in her zone. The last report of the batch has never landed later than
-- 03:58 UTC. 06:00 America/Chicago is 11:00 UTC — seven hours after the latest observed arrival,
-- and the start of her Thursday, so a PR she has to merge is there when she opens the machine.
--
-- RUNNING BEFORE THE BATCH LANDS WOULD BE WORSE THAN NOT RUNNING. It would grade last week's crawl
-- and open PRs for findings that were already fixed — which is how an automated fixer teaches its
-- owner to stop reading its output.
--
-- ─── IT IS VISIBLE WHEN IT FINDS NOTHING ────────────────────────────────────
--
-- Her standing bar, about a sibling job: "if she comes up empty handed its fine. better than giving
-- me trash." Accepted — but a weekly job that silently finds nothing is indistinguishable from a
-- weekly job that silently failed to run, and this repository has shipped that exact shape (a duty
-- that fired eleven Sundays and dropped its payload every time, with nothing red anywhere). So an
-- empty week WRITES A ROW: disposition 'none', carrying the queries it ran, the date range it
-- covered and the message count it saw. Found-nothing and never-ran are opposite facts.
--
-- ─── AND A MISSED WEEK ESCALATES ────────────────────────────────────────────
--
-- Same shape as Monique's live-book nag. `executionContract` in today/pillars.ts reads the most
-- recent run and, past eight days, puts it on Today as Danielle's item. Employees cannot drop owned
-- work; a gap has to be a visible state rather than an absence.
--
-- ─── LOCAL JOB, AND THERE IS NO CLOUD VERSION OF THIS ───────────────────────
--
-- Three separate reasons, any one of which is sufficient:
--   · It reads the CONTENTS of `seq.taylor@gmail.com`. The Claude Code runner strips every
--     credential matching KEY|TOKEN|SECRET|PASSCODE, so a cloud agent cannot reach her mail.
--   · It needs working copies of her repositories, `git` and `gh`. A Worker has none of those.
--   · The fix has to be made at SOURCE and validated by each repository's own validators before a
--     PR is opened, which means actually running them.
--
-- IT OPENS PULL REQUESTS AND MERGES NOTHING. Never a merge, never a deploy, never a release
-- dispatch. She merges. That is enforced in the script and asserted by `validate:audit-fixer`.

CREATE TABLE site_audit_findings (
  id            TEXT PRIMARY KEY,

  -- The Ahrefs project, exactly as the subject line spells it: "Virtualagency-os", "Spryexecutiveos".
  -- Kept verbatim so a row can be traced back to a specific email without a translation table.
  project       TEXT NOT NULL,
  -- The public domain, which is the JOIN KEY onto a repository and the only honest one.
  domain        TEXT,

  -- The repository the project maps to, or NULL when nothing claimed the domain.
  --
  -- MAPPED BY EVIDENCE, NEVER BY RESEMBLANCE. `mapped_by` records HOW: 'repo_identity' means a
  -- REPO_IDENTITY.md in that repo names this domain, which is how the mapping was established the
  -- first time this work was done by hand. A guess would put a PR in the wrong repository, and a
  -- name that merely looks similar is how that happens.
  repo          TEXT,
  mapped_by     TEXT CHECK (mapped_by IN ('repo_identity','unmapped')),

  -- fixed_pr  — a branch, a source-level fix, that repo's own validators, and a PR. Never a merge.
  -- surfaced  — real and understood, and a person has to decide. Nothing was changed.
  -- off_limits— it maps to a repo the fixer may not touch. See shared/boss/siteAudit/repoPolicy.mjs.
  -- no_repo   — no repository in ~/GitHub claims this domain.
  -- none      — THE RUN FOUND NOTHING. Recorded, so an empty week is a fact rather than a silence.
  disposition   TEXT NOT NULL CHECK (disposition IN ('fixed_pr','surfaced','off_limits','no_repo','none')),

  -- What the audit said, in its own words: "Page has links to broken page: 2,703 URLs".
  headline      TEXT NOT NULL,
  -- The CAUSE, in the repository, in a sentence. Not the symptom count.
  because       TEXT NOT NULL,
  -- What was done, or what a person now has to do. A finding with no next move is an observation.
  suggested_action TEXT NOT NULL,

  -- The PR, unmerged, when there is one. NULL for every other disposition by construction.
  pr_url        TEXT,

  -- Ahrefs' own numbers, so improvement is measurable rather than asserted.
  health_score  INTEGER,
  errors        INTEGER,

  -- The message this came out of, and when it arrived. Ids and timestamps, never bodies.
  message_id    TEXT,
  reported_at   INTEGER,

  -- THE SEARCH EVIDENCE, and it is NOT NULL on purpose.
  --
  -- Owner's standing correction, five false alarms deep: a bare "nothing found" is not acceptable
  -- and has been wrong in this project before. So every row carries the mailbox, the queries, the
  -- date range and the message count that produced it — including, and especially, the 'none' row.
  searched      TEXT NOT NULL DEFAULT '{}',

  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acted','dismissed')),
  notes         TEXT,

  run_id        TEXT NOT NULL,
  found_at      INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  archived_at   INTEGER
);

-- One live row per project and finding. A weekly job that re-derives the same unfixed 404 must
-- UPDATE it rather than stack a fourth copy on her screen — the rule the mailbox sweep learned.
CREATE UNIQUE INDEX idx_site_audit_unique ON site_audit_findings(project, headline);
CREATE INDEX idx_site_audit_live ON site_audit_findings(archived_at, status, found_at DESC);
CREATE INDEX idx_site_audit_run ON site_audit_findings(run_id, found_at DESC);

-- CLOUD_SYNC because there is nothing private in it: public domains, public repository names, and
-- counts Ahrefs already emailed her. LOCAL_ONLY for AI processing for the same reason the mailbox
-- findings are — the reasoning ran on her Mac over her mail, and the conclusion must not be handed
-- back to an external model as context.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('site_audit_findings', 'engineering', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'Public domains, public repository names and the error counts Ahrefs mailed her. No message bodies and no addresses — the ingest endpoint refuses a batch containing an "@", the same guard that caught a real leak on the contacts sync. LOCAL_ONLY for AI processing because the reading and the repair happened on her Mac.')
ON CONFLICT(entity) DO NOTHING;

-- ─── The duty ───────────────────────────────────────────────────────────────
--
-- weekday 4 is Thursday (0 = Sunday, per `duties/cadence.ts` and `duty_practice_week`).
-- next_due_at is seeded in the same statement as the cadence, per 0197 — a duty whose cadence and
-- seed disagree is left due on the wrong day and nothing says so.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_site_audit_repair',
   'The week''s Ahrefs audits, fixed at source and opened as pull requests',
   'emp_repo', 'ops',
   6, 0, 'America/Chicago', 'weekly', 4,
   unixepoch() * 1000 + 86400000,
   'local_job', 'ops',
   'The week''s Ahrefs audits, fixed at source and opened as pull requests',
   json_object(
     'delivers', 'site_audit_findings',
     'local_job', 'ahrefs-audit-fix.sh',
     -- The step that spends is the one named. Reading an audit mail and deciding which source file
     -- causes a 404 is judgement over a repository, not classification of a sentence — the same
     -- call the mailbox sweep made, for the same reason. An unnamed model runs the most expensive
     -- one available, which is what made a single briefing cost $3.88.
     'model', 'claude-sonnet-4-5-20250929',
     'why_local',
     'It reads the contents of seq.taylor@gmail.com, which the Claude Code runner cannot do because it strips every credential on purpose; and it needs working copies of her repositories, git, gh and each repo''s own validators, none of which exist inside a Worker.',
     'never',
     'Merges nothing, deploys nothing, and dispatches no release workflow. It opens a pull request per repository and she merges. local-guides-citation-velocity is off limits to the fixer entirely and its findings are surfaced instead.'
   ),
   'Every finding names the Ahrefs project, the domain, and the repository the domain was matched to by that repo''s own REPO_IDENTITY.md — never by resemblance. A fix is made at source and never in built output, is proven by that repository''s own validators, and is opened as an unmerged PR. local-guides-citation-velocity is surfaced and never touched. A week with no findings WRITES a row carrying the mailbox, the queries, the date range and the message count, because "found nothing" and "never ran" are opposite facts.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0227_boss_danielle_fixes_what_the_audit_found');
