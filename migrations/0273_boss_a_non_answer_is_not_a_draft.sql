-- A NON-ANSWER IS NOT A DRAFT, AND AN OPS TASK THAT ENDED HAS A WAY TO SAY SO.
--
-- ─── The defect ─────────────────────────────────────────────────────────────
--
-- 22 September 2026, `tsk_m351xejbtekke2cb`: she asked the Chief of Staff to "dig through the code
-- and figure out what the entire loop is" for `how-we-know`. It ran as one ~13-second cloud
-- completion with no repository, no filesystem and no tools, replied "I do not have direct access
-- to...", and was filed `awaiting_approval` — indistinguishable from a real draft waiting for her
-- word. `src/shared/boss/execution/cannotDo.mjs` is the rule that recognises that reply; this table
-- is the half of the fix that reaches her when she is not looking at the screen.
--
-- ─── Why a table and not a send ─────────────────────────────────────────────
--
-- Boss OS is a Cloudflare Worker. Its ONLY outbound mail capability is `message.reply()` on an
-- inbound Email Routing event — a reply to a message she sent, in that request, and nothing else.
-- A queue consumer finishing a task twenty minutes later has no inbound message to reply to, which
-- is exactly why NOTHING in this codebase has ever sent a completion email for a generic ops task.
-- `#danielle` repo changes and the KDP watch both get one because both run on her Mac, where
-- `scripts/ops/notify.mjs` and its Resend key live.
--
-- So the Worker writes down WHAT should be said and WHO says it, and the Mac agent — already
-- running six times a day as `com.seq.boss-agent` — drains this through the same
-- `notify.mjs` roster every other employee email goes through. One sender module, one roster, one
-- verified domain. The alternative, a second Resend path inside the Worker, would be a second copy
-- of the roster in the component that must never hold one.
--
-- ─── Rule 0 ─────────────────────────────────────────────────────────────────
--
-- `sent_at` and `error` are BOTH nullable and both are written: a drain that could not send says so
-- on the row, so a notice that never reached her is a query rather than a silence. `attempts`
-- climbs on every try, which is what makes "tried nine times and never got through" visible instead
-- of looking like "nothing to send".

CREATE TABLE IF NOT EXISTS boss_task_notices (
  id           TEXT PRIMARY KEY,
  -- The run this is about. Not a foreign key on purpose: a notice about a task must outlive any
  -- future pruning of the task itself, since the whole point is that she was told.
  task_id      TEXT NOT NULL,
  lane         TEXT NOT NULL,
  -- Which employee signs it. `notify.mjs` turns this into simone@sequoiataylor.com and REFUSES a
  -- name that is not on the roster rather than inventing an address, so this column is a name and
  -- never an address — the roster stays in one file.
  from_name    TEXT NOT NULL,
  -- What kind of thing happened. `could_not_do` is the only kind today; the column exists so the
  -- second kind does not arrive as a new table.
  kind         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  -- Set by the Mac drain, from Resend's own acceptance. Never set optimistically.
  sent_at      INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  -- The last refusal, in full enough to diagnose. A notice that failed silently would be this
  -- migration's own defect, one level up.
  error        TEXT
);

-- The drain's query: unsent, oldest first.
CREATE INDEX IF NOT EXISTS idx_boss_task_notices_unsent
  ON boss_task_notices (sent_at, created_at);
-- "Was she told about this task?" answered without a scan.
CREATE INDEX IF NOT EXISTS idx_boss_task_notices_task
  ON boss_task_notices (task_id);

-- ─── Classified, because an unclassified table is refused at runtime ────────
--
-- `CLOUD_SYNC`: it lives in the same D1 as `tasks`, it is written by a Worker, and her Mac reads it
-- over HTTPS. There is nowhere else for it to be.
--
-- `LOCAL_ONLY` FOR AI PROCESSING, which is the deliberate half. The body carries her own words —
-- the title of whatever she asked for — and the whole purpose of this row is to be READ BY A HUMAN
-- and sent to her. No model ever needs it as input, so the honest classification is the one that
-- refuses it as model input, exactly as `boss_inbound_mail` is classified for the same reason.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('boss_task_notices', 'queue', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'A message to HER about one of her own tasks, carrying her own words back. It exists to be emailed and read by a person; nothing takes it as model input, so it is classified to refuse that rather than to permit it unused.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0273_boss_a_non_answer_is_not_a_draft');
