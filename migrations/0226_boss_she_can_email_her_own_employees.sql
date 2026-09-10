-- She can email boss@sequoiataylor.com and an employee picks it up.
--
-- Owner, 10 September 2026: she wants to mail one address and reach any of them by name — #monique,
-- #simone, #zora. And separately: she will email Monique her live sell-side inventory, which becomes
-- the book Monique works from.
--
-- ─── THE TAG ROUTES. THE SENDER AUTHORISES. ─────────────────────────────────
--
-- A hashtag is a public word: anyone who learns it can type it. So it may say WHO a message is for
-- and it may never say that the message is allowed. Authorisation is the verified sender — her own
-- addresses, checked against the DMARC result Cloudflare Email Routing puts on the message before
-- delivery. That is why `boss_inbound_mail` records `from_addr`, `dmarc_pass` and `authorised` as
-- three separate columns rather than one boolean: a refusal has to be readable afterwards, and
-- "who claimed to send it" and "did that check out" are different facts.
--
-- EVERY MESSAGE LANDS A ROW, including the refused ones and the ones nobody could place. An inbox
-- that loses mail without saying so is worse than one that does not exist, and a refusal with no
-- trace is indistinguishable from a handler that crashed.
--
-- ─── NOTHING HERE IS WEST PEEK'S ────────────────────────────────────────────
--
-- `os@joinwestpeek.com` is a different business, on a different domain, served by a different
-- Worker (`west-peek-os` — confirmed against the live Cloudflare zone on 10 Sep 2026). These tables
-- are Boss OS's own and are written only by `src/worker/boss/intake/inboundMail.ts`, which imports
-- nothing from `src/worker/effects/inboundEmail.ts`. `validate:boss-intake-is-boss-only` asserts it.

CREATE TABLE boss_inbound_mail (
  id            TEXT PRIMARY KEY,
  received_at   INTEGER NOT NULL,
  to_addr       TEXT NOT NULL,
  -- Who it CLAIMS to be from. A header, and therefore a claim.
  from_addr     TEXT NOT NULL,
  -- Whether Cloudflare's DMARC evaluation actually bound that claim to the sending domain.
  dmarc_pass    INTEGER NOT NULL DEFAULT 0,
  -- Whether it was hers AND proven. The two together are the authorisation; the tag never is.
  authorised    INTEGER NOT NULL DEFAULT 0,
  subject       TEXT,
  -- The tag she typed, when she typed one this system recognised.
  tag           TEXT,
  employee_id   TEXT REFERENCES employees(id),
  -- ROUTED | DEFAULTED | AMBIGUOUS | REFUSED_SENDER | TOO_LARGE
  outcome       TEXT NOT NULL,
  -- One sentence, the same one that went back to her in the reply.
  why           TEXT NOT NULL,
  task_id       TEXT REFERENCES tasks(id),
  -- The whole message in R2, so an arrival is recoverable rather than merely reported.
  object_key    TEXT,
  bytes         INTEGER NOT NULL DEFAULT 0,
  replied_at    INTEGER
);
CREATE INDEX idx_boss_inbound_mail ON boss_inbound_mail(received_at DESC);

-- ─── Her live book ──────────────────────────────────────────────────────────
--
-- VERSIONED, because a later email supersedes an earlier one and the history has to survive. A book
-- that was overwritten in place cannot answer "what did I actually have out when I made that call",
-- and it cannot tell the 7-day nag whether anything is genuinely new.
--
-- SUPERSEDED, NOT DELETED. `superseded_at` is set on the old row when a new one lands, so "the
-- current book" is one query and yesterday's is still there to read.

CREATE TABLE capital_book (
  id            TEXT PRIMARY KEY,
  version       INTEGER NOT NULL,
  received_at   INTEGER NOT NULL,
  -- The message it came out of. Every position traces back to something she actually sent.
  mail_id       TEXT REFERENCES boss_inbound_mail(id),
  -- Content identity. An identical resend does not become a new version, and does not reset the nag.
  fingerprint   TEXT NOT NULL,
  -- Lines that looked like inventory and could not be read, as json. Shown to her, never swallowed.
  unparsed      TEXT,
  superseded_at INTEGER
);
CREATE UNIQUE INDEX idx_capital_book_version ON capital_book(version);
CREATE INDEX idx_capital_book_live ON capital_book(superseded_at, received_at DESC);

CREATE TABLE capital_book_line (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES capital_book(id) ON DELETE CASCADE,
  asset         TEXT NOT NULL,
  side          TEXT NOT NULL DEFAULT 'sell',
  -- The headline size. For a range this is the CEILING: the number that sizes a buyer.
  size_usd      INTEGER,
  -- She will not break below this. What disqualifies a buyer who is too small.
  size_min_usd  INTEGER,
  size_max_usd  INTEGER,
  size_shares   INTEGER,
  -- Her own words, verbatim, so a reply can quote her back to herself.
  size_text     TEXT,
  source_line   TEXT NOT NULL
);
CREATE INDEX idx_capital_book_line ON capital_book_line(book_id);

-- ─── Classification ─────────────────────────────────────────────────────────
--
-- THE BOOK IS SOVEREIGN, AND THIS IS A DECISION, NOT A DEFAULT.
--
-- `scripts/ops/interest-match.mjs` states the standing rule for this subsystem: "Named
-- counterparties, assets and sizes never reach the Boss OS database." Her own book is the one thing
-- that rule cannot cover, because she asked for it to arrive here by email — and the reason the rule
-- exists does not apply to it. The rule protects OTHER PEOPLE'S identities: who wants what, at what
-- size, learned from her mailbox. Her book is her own inventory, she is the counterparty, and no
-- third party is named in it.
--
-- So it is stored, and it is stored LOCAL_ONLY / LOCAL_ONLY: it never leaves through Sovereign Sync
-- and no external model may be shown it. `data-classification.mjs` also names these tables sovereign
-- so a later migration cannot move them to CLOUD_SYNC without that being a visible act in a
-- validator rather than a line in a SQL diff.

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('boss_inbound_mail', 'intake', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'Arrival record for mail to boss@sequoiataylor.com: who sent it, whether that was proven, which employee took it. Operating machinery, and the audit trail for every refusal.'),
  ('capital_book', 'capital', 'LOCAL_ONLY', 'LOCAL_ONLY',
   'Her live sell-side inventory, versioned. Her own book, not a third party''s identity - and still sovereign: what she has out, at what size, is the most commercially sensitive thing in this system.'),
  ('capital_book_line', 'capital', 'LOCAL_ONLY', 'LOCAL_ONLY',
   'The individual lots of her live book: issuer, size, floor. Never leaves, and never goes to an external model.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0226_boss_she_can_email_her_own_employees');
