-- Today's brokerage move can finally use her REAL BOOK, and her real book still never enters D1.
--
-- ─── The two facts that were in tension ────────────────────────────────────
--
-- 1. `brokerageMove` in `src/worker/boss/today/pillars.ts` cannot see the interest ledger — 2,145
--    rows at `~/.boss-os/capital/ledger.json` carrying `principal`, `principal_email`, `side`,
--    `asset`, `size_usd`, `durability`, `intermediated_by` and `quote`. So the one brokerage
--    suggestion she gets on a weekday morning falls back to confirmed crossmatches and unsized book
--    lots, and can never say "this lot has no matched counterparty" — the sentence the ledger exists
--    to produce.
--
-- 2. THE LEDGER MAY NOT BE SYNCED. Stated in three places, and it is hers:
--
--      "Named counterparties, assets and sizes never reach the Boss OS database — not code-named,
--       not counted."
--
--    `scripts/ops/interest-match.mjs:53` and `src/worker/boss/today/subjects.ts` both say it. She is
--    a registered representative of a FINRA broker-dealer; client interest data staying off a cloud
--    database is her decision and it stands.
--
-- ─── The pattern this repository already had for exactly this ──────────────
--
-- `scripts/ops/buyer-hunt.mjs --from-boss` computes on her Mac, where the data is, and posts a
-- RESULT back. Nothing about the ledger crosses; the answer does. The same shape applies here, with
-- the crossing detail going to her inbox instead of to a task card:
--
--   · A LOCAL JOB computes the crossings from the ledger and EMAILS THE DETAIL to her from
--     monique@sequoiataylor.com — named counterparty, asset, size, next action — which is how
--     `capital:match` already delivers, over Resend, never from spry.vc.
--   · TODAY'S CONTRACT CARRIES A POINTER WITH NO NAMES: "Monique has 3 crossings from your book
--     this morning, sent 07:45 — they are in your inbox." A count, a clock and a kind.
--
-- ─── WHY THE TABLE HAS NO FREE TEXT COLUMN, WHICH IS THE WHOLE DESIGN ──────
--
-- A rule that says "do not write a name here" is a comment. The version of this table that had a
-- `summary TEXT` or a `delivered_to TEXT` would hold a counterparty within a month, because the
-- first person who wanted the pointer to be a little more useful would put one there and nothing
-- would object.
--
-- So THE COLUMNS CANNOT HOLD A NAME. Every one is an INTEGER, or a TEXT with a CHECK constraint
-- listing its only permitted values. There is no place to put "Fidelity", no place to put
-- "OpenAI", no place to put "$500M" and no place to put an email address. The boundary is enforced
-- by the shape of the row rather than by the discipline of the next contributor, and
-- `validate:pointer-has-no-names` fails the build if a free TEXT column is ever added.
--
-- The id is INTEGER AUTOINCREMENT for the same reason: a TEXT primary key is a free text column,
-- and one supplied by the caller is a free text column the caller controls.

CREATE TABLE brokerage_pointers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,

  -- WHAT KIND OF WORK IS IN THE MAIL, from a closed list. `cross` is two live sides of the same
  -- name that can trade with each other; `revival` is open interest that was never filled.
  -- A CHECK rather than a convention: an unlisted value is refused by SQLite itself.
  kind       TEXT NOT NULL CHECK (kind IN ('cross','revival')),

  -- HOW MANY. A count is the most a pointer may say about what is in the mail.
  -- `> 0` because a pointer to an empty mail is noise, and her rule is that empty-handed beats
  -- noise. The local job sends nothing and posts nothing on a day with nothing; the constraint
  -- makes "posted a zero" impossible rather than merely discouraged.
  crossings  INTEGER NOT NULL CHECK (crossings > 0),

  -- WHEN MONIQUE SENT THE MAIL. Epoch millis. This is what lets the contract say "sent 07:45",
  -- which is the fact that makes the pointer checkable: she can go and find the message.
  sent_at    INTEGER NOT NULL,

  -- When the pointer reached D1. Separate from `sent_at` so a post that arrived late says so.
  created_at INTEGER NOT NULL,

  -- When today's contract showed it, so one morning's mail is pointed at once.
  seen_at    INTEGER
);

CREATE INDEX idx_brokerage_pointer_fresh ON brokerage_pointers(seen_at, sent_at DESC);

-- CLOUD_SYNC is correct and is not a softening of the boundary: what is stored here is a count, a
-- clock and a word from a two-value list. LOCAL_ONLY on the processing axis because there is nothing here a model could
-- usefully be given, and a row that may never be interesting to a model is the cheapest kind to
-- classify — the airlock refuses it outright rather than weighing it.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('brokerage_pointers', 'wealth', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'A pointer to work Monique emailed her from the interest ledger on her Mac: how many crossings, of what kind, and the minute the mail was sent. Structurally incapable of holding a counterparty, an asset, a size or an address — every column is an integer or a CHECK-constrained enum. The ledger itself never enters this database.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0234_boss_a_pointer_with_no_names_in_it');
