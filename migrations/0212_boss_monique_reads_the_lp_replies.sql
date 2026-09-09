-- Somebody reads the LP replies, the day there is any way to read them.
--
-- ─── What she asked for ────────────────────────────────────────────────────
--
--   "yes granting sequoia@westpeek.ventures will be good. an employee can keep track of all the opt
--    outs and replies and send me an inbox daily summary to deliver to the twin agent ---- that is
--    a great idea"
--
-- ─── Monique, and not a ninth employee ─────────────────────────────────────
--
-- Director of Relationships. She already owns the mailbox sweep and the network refresh, which are
-- the same shape of work — read what came in, decide what it means, name people by code name. Zora
-- and Toni are the seats still without standing duties and neither is who you hand a mailbox.
--
-- ─── DORMANT WITH A NAMED REASON, WHICH IS THE INTERESTING PART ────────────
--
-- The grant does not exist. Scooter has to add domain-wide delegation on westpeek.ventures and
-- nobody else can. So this duty is created SUSPENDED, and it is the credential prober — not a human
-- and not a cron — that wakes it: `cred_westpeek_delegation` going live is the condition, and
-- `today/duties.ts` reads the probe on every render.
--
-- A DUTY THAT ERRORED EVERY MORNING FOR THREE WEEKS WHILE HE GOT ROUND TO IT WOULD BE NOISE, and
-- noise on a daily surface is how a screen stops being read — the exact failure the escalation
-- ladder was designed around. Suspended-with-a-reason says the true thing: this is built, it is
-- waiting on one specific act by one specific person, and here is who.
--
-- ─── An opt-out is an action, not a list item ──────────────────────────────
--
-- The point of noticing an opt-out is that Twin STOPS EMAILING THAT PERSON. A summary that names
-- them and leaves her to relay it by hand is "flagged, not fixed" with extra steps. So the run
-- writes a suppression list Twin can consume directly, and the Inbox item points at it.
--
-- ─── The privacy tension, resolved rather than fudged ──────────────────────
--
-- Boss OS shows code names and the sync endpoint refuses any batch containing an `@`. Suppressing
-- someone in Twin needs their REAL address. Both are true and they do not conflict, because they
-- are about different files: the same split `contacts-sync.mjs` already uses. Real addresses go to
-- `~/.boss-os/lp/suppress.txt` ON HER MAC and never leave it; what reaches the Worker is counts,
-- categories and code names. The endpoint refuses an `@` exactly as every other one does — the
-- guard is not weakened by one character.
--
-- ─── Categorised, because twelve messages is not a summary ─────────────────
--
-- Replies to a fundraise are not homogeneous. "Two want the deck" is worth reading; "you have
-- twelve replies" is not. Six categories, counted, with one composed sentence each.

CREATE TABLE lp_reply_digests (
  id             TEXT PRIMARY KEY,
  day_id         TEXT NOT NULL,
  -- Counts by category. Nothing here identifies anybody.
  opt_outs       INTEGER NOT NULL DEFAULT 0,
  interested     INTEGER NOT NULL DEFAULT 0,
  wants_deck     INTEGER NOT NULL DEFAULT 0,
  questions      INTEGER NOT NULL DEFAULT 0,
  auto_replies   INTEGER NOT NULL DEFAULT 0,
  bounces        INTEGER NOT NULL DEFAULT 0,
  total_read     INTEGER NOT NULL DEFAULT 0,
  -- One or two sentences in the run's own words. Never a quotation, never an address — the endpoint
  -- refuses anything with an '@' in it, the same guard the KDP determination carries.
  summary        TEXT,
  -- Where the real addresses are, so Twin can act. A PATH, not the addresses.
  suppress_file  TEXT,
  created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_lp_digest_day ON lp_reply_digests(day_id);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('lp_reply_digests', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'Counts of what came back from LP outreach, by category, and one composed sentence. No name, no address, no quotation: the real identities live in a file on her Mac that Twin reads and nothing here can. External processing asks first because a summary is prose, and prose is where a name would hide if the rule were ever broken.')
ON CONFLICT(entity) DO NOTHING;

-- ─── A suspended duty has to be able to say WHY ─────────────────────────────
--
-- `suspended` is a bare flag: 0176 gave it "suspended is not deleted", which is right and silent
-- about the reason. A duty switched off with no reason on the row is indistinguishable from one
-- somebody turned off and forgot, and this one is off for a very specific reason belonging to a
-- named person. The column is nullable and every existing row keeps NULL, so nothing changes shape.
ALTER TABLE standing_duties ADD COLUMN suspended_reason TEXT;

-- ─── The duty, suspended until the grant exists ─────────────────────────────
--
-- HAIKU, NAMED. `claude -p` with no --model runs the most expensive one available — the defect that
-- made one briefing cost $3.88. Reading a day of replies and putting each in one of six buckets is
-- classification, not judgement, and does not need the expensive model. `validate:duty-delivery`
-- fails the build if this string and the shell script's disagree.
--
-- ~$0.03 a run, daily, ≈ $0.90 a month — and only once it is actually running.
--
-- 07:45, after the 07:10 agent tick and before the day starts. Daily rather than weekly because an
-- LP who asked for the deck on Tuesday and hears nothing until Sunday is an LP you have lost.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday, weekdays,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended, suspended_reason) VALUES
  ('duty_lp_replies', 'LP replies — read, categorise, and hand the opt-outs to Twin', 'emp_relationship', 'ops',
   7, 45, 'America/Chicago', 'daily', NULL, NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops', 'LP replies — read, categorise, and hand the opt-outs to Twin',
   json_object(
     'local_job', 'lp-replies.sh',
     'requested', json_object(
       'model', 'claude-haiku-4-5-20251001',
       'max_seconds', 600
     ),
     'why_local',
     'Reading the West Peek mailbox needs a credential the Claude Code runner strips on purpose. This runs from launchd on her Mac; the mail stays there and only counts and one sentence are posted back.',
     'prompt_file', 'scripts/ops/lp-replies-prompt.md'
   ),
   'Every reply to LP outreach is read and categorised within a day, an opt-out reaches Twin as a suppression Twin can act on rather than a line she has to relay, and a day with no replies produces no Inbox item at all.',
   1,
   'Dormant until Scooter grants domain-wide delegation on westpeek.ventures — nothing can read that mailbox until he does, and this employee would fail every morning for the same reason. The credential prober wakes it: `cred_westpeek_delegation` going live is the condition, and it is tested daily rather than remembered.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0212_boss_monique_reads_the_lp_replies');
