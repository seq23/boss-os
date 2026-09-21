-- A duty on her word — 21 September 2026.
--
-- ─── What she asked ─────────────────────────────────────────────────────────
--
--   "is there a lane for me to ask for a new duty to my Boss OS agents? i still dont know how to
--    create a job for them — if it's not user-friendly then make it so."
--
-- ─── What existed, and why it never ran ─────────────────────────────────────
--
-- `duties/author.ts` drafted a proper duty from her phrase and `POST /employees/duties/draft` filed
-- it in the Inbox as a `duty_created` judgement call. No screen called the route and the mailbox
-- classified a `recurring_duty` message without ever drafting one. Exists but nothing invokes it.
--
-- ─── The lane ───────────────────────────────────────────────────────────────
--
--   mail    `#<seat> new duty <her words>` to boss@sequoiataylor.com from her verified address
--           (or `#simone new duty <seat> …` for the Chief of Staff to route). The employee replies
--           with the full draft and "Reply `approved` to create it, `changes: …` to redraft."
--           `approved` on the thread decides the SAME judgement call the Inbox button would;
--           `changes: …` redrafts with her text as overrides; `your call` in the ORIGINAL request
--           creates it at once, recorded as pre-approved with the phrase.
--   screen  Team → Duties: every duty per employee, and "Add a duty" that previews the draft and
--           files it exactly as the mail door does.
--
-- ─── Why a sidecar table ────────────────────────────────────────────────────
--
-- The judgement call is the Inbox card; this row is the lane's own record — which door, which
-- mail, which phrase, what was drafted, every refusal verbatim, whether it was pre-approved and by
-- which words, which duty it became and when that duty first fires. Her reply is matched to it
-- through the request mail's Message-ID (her client keeps it in References) or the `[dd_…]` token
-- the reply carried. `repo_changes` (0265) takes the same shape for the same reason.
--
-- ─── The invariant, pinned by `validate:duty-birth` ────────────────────────
--
-- No `standing_duties` row is created at runtime except through `duties/create.ts`, which is
-- reached only from the approval loop (`duty_created`) or from a recorded pre-approval, and which
-- runs the owner ↔ executor ↔ script check before the write. A duty that cannot run is refused,
-- never created inert (Rule 0).

CREATE TABLE IF NOT EXISTS duty_drafts (
  id                  TEXT PRIMARY KEY,                 -- dd_…
  door                TEXT NOT NULL CHECK (door IN ('mail','screen')),
  mail_id             TEXT,                             -- the boss_inbound_mail row that asked, when mail did
  request_message_id  TEXT,                             -- her request's Message-ID; her reply's References names it
  employee_id         TEXT NOT NULL REFERENCES employees(id),
  routed_by           TEXT REFERENCES employees(id),    -- Simone, when `#simone new duty <seat>` routed it
  tag                 TEXT,
  phrase              TEXT NOT NULL,                    -- her words, in full
  intake_kind         TEXT NOT NULL DEFAULT 'recurring_duty',
  draft_json          TEXT NOT NULL,                    -- the draft exactly as she saw it
  refusals_json       TEXT NOT NULL DEFAULT '[]',       -- every refusal, verbatim
  -- drafted   → in her inbox (judgement_id) and in her mail; waiting on her word
  -- refused   → could not run; the NAMED STOP went back to her; nothing filed
  -- created   → the duty row exists (duty_id, first_run_at)
  -- redrafted → superseded by a later draft on her `changes: …`
  -- held      → her `no` / `stop`, or a send-back from the Inbox; nothing created
  state               TEXT NOT NULL CHECK (state IN ('drafted','refused','created','redrafted','held')),
  judgement_id        TEXT,
  approval_id         TEXT,
  pre_approved_phrase TEXT,                             -- "your call" etc., from the ORIGINAL request only
  approved_by         TEXT,
  approved_at         INTEGER,
  approval_mail_id    TEXT,                             -- the reply that approved, when mail did
  held_note           TEXT,
  supersedes          TEXT,                             -- the draft this one replaced
  duty_id             TEXT,
  first_run_at        INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_duty_drafts_state ON duty_drafts (state, employee_id, created_at);
CREATE INDEX IF NOT EXISTS idx_duty_drafts_mail ON duty_drafts (mail_id);
CREATE INDEX IF NOT EXISTS idx_duty_drafts_judgement ON duty_drafts (judgement_id);

-- Classified like the duties it drafts: her instruction to her own employee about her own work.
-- A phrase naming an LP or a deal term would be caught by the router's scan at run time, as it is
-- for every duty; the draft row itself holds the phrase, the derived fields and the outcome.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('duty_drafts', 'operations', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Her sentence describing a standing duty for one of her own employees, the draft derived from it, every refusal, and whether and how she approved it. The same class as standing_duties, which it becomes.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0267_boss_a_duty_on_her_word');
