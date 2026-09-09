-- The escalation stopped being able to change its mind, and so it started lying.
--
-- ─── Her words, on the morning of 9 September ───────────────────────────────
--
-- "the critical alerts for simone did not say anything about my oauth being disconnected and that
--  is a problem. it says something else"
--
-- She was right, and what it said was a week old. Verbatim, on Today, on 9 September:
--
--   "A server-side flag on the KDP account. Publish returns 'fix the highlighted errors' with
--    nothing highlighted and a hidden alert reading 'Account Information Incomplete'..."
--
-- Two things had happened since that sentence was written and NEITHER REACHED THE SCREEN:
--
--   · The claude.ai Gmail connector's token expired, so the watcher could not read her mail at
--     all. It reported `needs-her` — correctly — and the alert showed the week-old text.
--   · Support finally named a root cause, cover image processing. The alert showed the week-old
--     text.
--
-- ─── The cause was a fix, which is the interesting part ─────────────────────
--
-- 0203 repaired a real defect: the first determination the watcher posted OVERWROTE the
-- deliverable's `blocker`, so the escalation read "Simone is blocked on Every authored book
-- published — <whatever the last run happened to find>", and the one sentence she needs in order to
-- act was replaced by a log line. The fix was to stop `routes/kdp.ts` passing a blocker at all.
--
-- THAT IS AN OVERCORRECTION, AND IT IS WORSE THAN THE BUG IT REPLACED. A blocker nothing may write
-- is a blocker that can never change; the alert froze on the day it was seeded and has been
-- confidently wrong ever since. A wrong sentence in the loudest place on her screen costs more than
-- a missing one, because she acts on it.
--
-- ─── One field was never enough. There are two facts here ───────────────────
--
--   THE BLOCKER — the standing reason this commitment exists and has not completed. Seven authored
--   titles are not on sale, Publish refuses, and Amazon case #51496198 is the route. It changes
--   rarely and deliberately, and it is what she acts on.
--
--   THE CURRENT STATUS — what is stopping it RIGHT NOW and what the last run learned. It changes on
--   every run. It is the half that was missing, and its absence is what made the alert stale.
--
-- Collapsing the two loses the standing reason (0203's bug). Refusing to write either loses the
-- current one (0203's fix). So the row now carries both, the alert prints both, and every run
-- writes exactly one of them.
--
-- ─── The clock does not restart when the sentence changes ───────────────────
--
-- `blocked_since` is untouched by any of this and stays untouched on purpose. A block that has sat
-- for a week is a week old even when today's reason for it is new — otherwise the ladder measures
-- how recently someone rephrased the problem rather than how long the books have been stuck, and
-- the one number that must not be resettable becomes the easiest one to reset.
--
-- ─── "I could not run" and "I ran, and here is what I found" ────────────────
--
-- On 7 September both looked identical on the screen: silence. `run_outcome` is the distinction,
-- carried on the determination and repeated onto the deliverable, so a dead credential reads as a
-- dead credential rather than as a quiet week at Amazon. Silence is only evidence when something
-- was actually listening.
--
-- It is a plain column with no CHECK constraint because SQLite's ALTER TABLE ADD COLUMN is the only
-- way to add one without rebuilding the table, and rebuilding a table that holds her determination
-- history to gain a constraint the endpoint already enforces is a bad trade. `routes/kdp.ts` and
-- `routes/credentials.ts` are the only writers and both validate it.

ALTER TABLE owned_deliverables ADD COLUMN current_status TEXT;
ALTER TABLE owned_deliverables ADD COLUMN current_status_at INTEGER;
ALTER TABLE owned_deliverables ADD COLUMN current_status_kind TEXT;

ALTER TABLE kdp_case_checks ADD COLUMN run_outcome TEXT NOT NULL DEFAULT 'determined';

-- ─── The standing reason, rewritten as a standing reason ────────────────────
--
-- What was in `blocker` was a DIAGNOSIS — a specific theory about a specific hidden DOM alert — and
-- a diagnosis is exactly the kind of thing that goes out of date. Support has since named cover
-- image processing instead. So the blocker becomes the durable statement of what is owed and how it
-- is being pursued, and the perishable half moves to `current_status` where something rewrites it.
--
-- The disproven theory stays, because a fact she has already paid to establish is worth more than a
-- sentence of prose: it is what stops the 10-draft cap being re-tested a third time.
UPDATE owned_deliverables
   SET blocker = 'Seven authored titles are not on sale. KDP''s Publish refuses them, three titles published from this same account on 1-2 September, and Amazon case #51496198 is the route. The 10-unpublished-title cap was tested on 7 September and disproven — draining the queue freed slots and the refusal did not change.',
       current_status = 'Support has named the cause: cover image processing on the blocked titles. That is a different answer from the account-level flag theory the case ran on for a week, and it has not yet been acted on or verified. Recorded from the support correspondence on 9 September; the next watcher run replaces this line with what it finds.',
       current_status_at = unixepoch() * 1000,
       current_status_kind = 'determined',
       updated_at = unixepoch() * 1000
 WHERE id = 'del_kdp_publication';

-- ─── Nothing was watching the credentials this all runs on ──────────────────
--
-- The connector expired in silence. Nothing noticed, because nothing was looking: it was found
-- because a human ran the watcher by hand and read the output. It will expire again.
--
-- The failure has a specific shape worth naming. THE NOTIFICATION SHARED ITS FAILURE MODE WITH THE
-- WORK: `kdp-watch-prompt.md` told Simone to email the owner through the same claude.ai Gmail
-- connector she reads the mailbox with, so the one condition that most needed to reach her was the
-- exact condition that could not send. The Boss OS report is the channel that survived, and it
-- survived by luck rather than by design. It is the primary channel now, and email is a
-- nice-to-have that may fail silently.
--
-- ONE ROW PER CREDENTIAL, UPSERTED, NEVER APPENDED. This is a liveness register rather than a log:
-- the question is "is this working right now", and a table that grows makes that question a query.
-- `checked_at` going stale is itself the alarm — the same construction as an owned deliverable, for
-- the same reason. A prober that stops running must make the screen louder, not quieter.
CREATE TABLE credential_probes (
  id             TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  -- What breaks when this credential is dead, in her language. An alert that says a token expired
  -- and does not say what stopped working is one she cannot weigh.
  what_depends   TEXT NOT NULL,
  -- live    — proven working by an actual call, this run.
  -- dead    — proven not working. This is the state that shouts.
  -- unknown — the prober could not decide. NOT the same as live, and never rendered as fine.
  state          TEXT NOT NULL DEFAULT 'unknown' CHECK (state IN ('live','dead','unknown')),
  detail         TEXT,
  -- The exact steps, on the row, so the alert is self-explaining rather than a pointer to a doc.
  fix_steps      TEXT NOT NULL,
  checked_at     INTEGER,
  last_live_at   INTEGER,
  -- Older than this and the answer is stale, which is reported as its own condition. A probe that
  -- said 'live' three weeks ago is not evidence about today.
  max_age_hours  INTEGER NOT NULL DEFAULT 36,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_credential_probes_state ON credential_probes(state, checked_at);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('credential_probes', 'ops', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Whether a credential is working, and what to do when it is not. Holds no credential, no token, no address and no mail — a state word, a date and a fixed instruction. The whole point is that it is readable on her screen before something needs the credential and fails.')
ON CONFLICT(entity) DO NOTHING;

-- SEEDED 'unknown' WITH A NULL checked_at, WHICH IS DELIBERATELY LOUD ON DAY ONE. Until the prober
-- has actually run, nothing has verified any of these, and the honest render of that is "nothing has
-- checked this", not a reassuring green. Seeding them 'live' would be a claim no call supports.
INSERT OR IGNORE INTO credential_probes
  (id, label, what_depends, state, fix_steps, max_age_hours, created_at, updated_at) VALUES
  ('cred_gmail_connector', 'The claude.ai Gmail connector',
   'Simone''s KDP case watch and Monique''s Sunday mailbox sweep. Both read your mail inside claude -p on your Mac, and neither can do anything at all without it. It is also the only path to the KDP mailbox: the Google service account cannot reach a consumer inbox.',
   'unknown',
   'Open claude.ai, go to Settings, then Connectors, and reconnect Google Gmail. It expires on its own schedule and nothing on your Mac can renew it. Then run: npm run credentials:check',
   36, unixepoch() * 1000, unixepoch() * 1000),

  ('cred_google_service_account', 'The Google service account',
   'The weekly network refresh, the Search Console property read, the LP tracker sync and the brokerage sourcing contact list. Everything that reads the spry.vc Workspace.',
   'unknown',
   'Check GSC_SERVICE_ACCOUNT_JSON is in the vault (npm run vault:status), and that domain-wide delegation for its client ID is still granted in Google Admin: Security, then Access and data control, then API controls, then Domain-wide delegation. Then run: npm run credentials:check',
   36, unixepoch() * 1000, unixepoch() * 1000),

  ('cred_kdp_mail_via_workspace', 'A path to the KDP mail that does not need the connector',
   'Whether Simone can keep working when the claude.ai connector expires. Right now she cannot: the connector is the single point of failure on the publishing chase.',
   'unknown',
   'In Gmail as seq.taylor@gmail.com: Settings, See all settings, Forwarding and POP/IMAP, Add a forwarding address, enter staylor@spry.vc, and confirm the code Google sends there. Then Filters and Blocked Addresses, Create a new filter, From contains amazon.com, Create filter, tick Forward it to staylor@spry.vc. Takes about two minutes and forwards nothing but Amazon mail.',
   36, unixepoch() * 1000, unixepoch() * 1000);

-- ─── Toni takes the credentials, and stops being a seat with no work ────────
--
-- Chief Risk Officer, and one of the two remaining charters with nothing attached to them. "A
-- dependency this whole system runs on failed silently and nobody was watching" is risk work in the
-- ordinary sense of the phrase, and it is the third instance of the pattern 0201 started: a seat
-- that had a charter and no duty gets a real commitment rather than a nicer description.
--
-- ITS TERMINAL CONDITION IS SOMETHING SHE MUST DO, AND THAT IS THE POINT. Everything about the
-- failover that could be built without her has been: the prober runs, the service account is proven
-- healthy, and the Workspace mailbox is searched for KDP mail on every run so the moment forwarding
-- starts working the deliverable closes itself by counting. What is left is two minutes in Gmail
-- that only the account holder can do, so it becomes a NAMED item that explains itself on the
-- screen she already opens — not a paragraph in a report.
--
-- WHY FORWARDING AND NOT THE OTHER TWO ROUTES. Domain-wide delegation cannot impersonate a consumer
-- @gmail.com account — that was established by testing on 9 September, not assumed — and the KDP
-- correspondence lives in one. So there are three honest options and this is the one chosen:
--
--   · Change the KDP account's contact address to the Workspace domain. REJECTED: the account is
--     mid-investigation on an account-level publishing block, and changing its contact address
--     during that is the worst possible moment to touch it. It would also strand the existing case
--     history in the old mailbox.
--   · An IMAP app password in the vault. REJECTED: it requires turning on app passwords, and it
--     stores a credential granting FULL mailbox access to solve a problem about Amazon mail. Wider
--     than the need, and Google has been steadily restricting the mechanism.
--   · Forward Amazon mail to the Workspace mailbox. CHOSEN: about two minutes of her time, uses a
--     service account that already exists and is already proven healthy, grants access to Amazon
--     mail and nothing else, touches the KDP account not at all, and she can undo it in one click.
-- THE COLUMN ORDER PUTS EVERY QUOTED VALUE FIRST, AND THAT IS LOAD-BEARING RATHER THAN TIDY.
-- `scripts/validate/owned-deliverables.mjs` maps a row's columns onto its STRING LITERALS
-- positionally, so a NULL or an arithmetic expression in the middle of the list shifts every
-- following column by one and the scan silently checks the wrong field. A validator reading the
-- escalation path as the duty id is worse than no validator. `duty_id` is genuinely NULL here —
-- nothing automated moves this, which is a real and honest state the table allows — so it sits
-- after the strings with the numbers.
INSERT OR IGNORE INTO owned_deliverables
  (id, name, employee_id, lane, terminal_condition, terminal_check, state,
   escalation_path, blocker, current_status, current_status_kind,
   duty_id, current_status_at, blocked_since, last_activity_at, stall_after_days,
   created_at, updated_at)
VALUES
  ('del_kdp_mail_failover', 'A second path to the KDP mail', 'emp_risk', 'ops',
   'The Google service account can read Amazon mail in the spry.vc Workspace mailbox. Proven by the credential prober actually finding a message there, not by anyone saying the filter was created.',
   'kdp_mail_reachable_without_connector', 'blocked',
   'Named on Today under Critical Alerts every time she opens it, with the exact steps on the alert itself, and it does not stop until the prober finds Amazon mail in the Workspace mailbox or she kills it with a reason.',
   'The claude.ai Gmail connector is the only path to the KDP mailbox, so when it expires the publishing chase goes blind and cannot even say that it has. It expired without warning before 7 September and was found by hand. Domain-wide delegation cannot reach a consumer inbox, so the service account cannot substitute for it as things stand.',
   'Two minutes in Gmail, and only the account holder can do it. Settings, See all settings, Forwarding and POP/IMAP, Add a forwarding address, staylor@spry.vc, confirm the code Google sends there. Then Filters and Blocked Addresses, Create a new filter, From contains amazon.com, Create filter, and tick Forward it to staylor@spry.vc.',
   'determined',
   NULL, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000, 14,
   unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0207_boss_the_alert_says_what_is_true_now');
