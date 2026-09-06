-- Boss OS v20 — Phase 16: Spirit OS, astrology, contribution, ancestors.
-- Canon §43 (fourteen components), §42.1–42.3, §44, §5.2. Decision §1.5.
--
-- Two laws shape this schema more than anything else.
--
-- §1.5, anti-delusion: a manifestation is closed by what was done and what
-- happened, never by what was noticed. Signs are recorded and never count.
--
-- §5.2, reality priority: none of this outranks the operational state of the
-- system. The astro tables carry an advisory marker and a method string,
-- because a computed number with no stated method invites being believed.

-- ─── manifestations ────────────────────────────────────────────────────────────
CREATE TABLE manifestations (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  statement         TEXT NOT NULL,          -- what is wanted, in the present tense
  domain            TEXT,                   -- wealth|body|spirit|execution|relationships|craft|other
  first_action      TEXT NOT NULL,          -- §1.5: the concrete thing that happens next
  target_at         INTEGER,
  status            TEXT NOT NULL DEFAULT 'open', -- open|manifested|released|abandoned
  manifested_at     INTEGER,
  closed_reason     TEXT,
  notes             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_manifestations_status ON manifestations(status, created_at DESC);

-- ─── manifestation_evidence ────────────────────────────────────────────────────
-- `action` is something the Boss did. `result` is something that happened in the
-- world and can be checked. `sign` is a synchronicity, a dream, a feeling — kept
-- because it matters to the person, and never counted toward completion.
CREATE TABLE manifestation_evidence (
  id                TEXT PRIMARY KEY,
  manifestation_id  TEXT NOT NULL REFERENCES manifestations(id) ON DELETE CASCADE,
  ts                INTEGER NOT NULL,
  kind              TEXT NOT NULL,          -- action|result|sign
  description       TEXT NOT NULL,
  verifiable        INTEGER NOT NULL DEFAULT 0, -- can someone else check it?
  reference         TEXT,                   -- where it can be checked
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_evidence_manifestation ON manifestation_evidence(manifestation_id, ts DESC);

-- ─── rituals ───────────────────────────────────────────────────────────────────
CREATE TABLE rituals (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  intent        TEXT,
  cadence       TEXT NOT NULL DEFAULT 'weekly', -- daily|weekly|monthly|lunar|seasonal
  anchor        TEXT,                       -- new_moon|full_moon|month_start|none
  steps         TEXT NOT NULL,              -- json: [text]
  minutes       INTEGER,
  status        TEXT NOT NULL DEFAULT 'active', -- active|paused|retired
  last_done_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_rituals_status ON rituals(status, cadence);

-- A ritual with no history cannot show whether it is actually practised, and
-- "did I do this" is the only question the screen needs to answer.
CREATE TABLE ritual_runs (
  id            TEXT PRIMARY KEY,
  ritual_id     TEXT NOT NULL REFERENCES rituals(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  minutes       INTEGER,
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_ritual_runs ON ritual_runs(ritual_id, ts DESC);

-- ─── dream_entries ─────────────────────────────────────────────────────────────
CREATE TABLE dream_entries (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  title         TEXT,
  body          TEXT NOT NULL,
  symbols       TEXT,                       -- json: [text]
  mood          TEXT,
  memory_id     TEXT REFERENCES memory_items(id), -- if it was captured to memory
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_dreams_ts ON dream_entries(ts DESC);

-- ─── contributions ─────────────────────────────────────────────────────────────
-- Canon §44: at least one a month, four is the good month. No daily
-- requirement, and no guilt — the tone is part of the specification.
CREATE TABLE contributions (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  month         TEXT NOT NULL,              -- YYYY-MM in UTC
  kind          TEXT NOT NULL,              -- money|time|help|teaching|introduction|other
  recipient     TEXT,
  amount_micros INTEGER NOT NULL DEFAULT 0,
  minutes       INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  anonymous     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_contributions_month ON contributions(month, ts DESC);

-- ─── ancestor_entries ──────────────────────────────────────────────────────────
-- One gentle hour a month. Nothing here nags, and nothing here is scored.
CREATE TABLE ancestor_entries (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  month         TEXT NOT NULL,              -- YYYY-MM in UTC
  who           TEXT NOT NULL,              -- the person or line remembered
  relation      TEXT,
  kind          TEXT NOT NULL DEFAULT 'remembrance', -- remembrance|story|gratitude|ritual|research
  minutes       INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_ancestors_month ON ancestor_entries(month, ts DESC);

-- ─── astro_calendar ────────────────────────────────────────────────────────────
-- The almanac. Every row carries how it was produced; a row with no method is a
-- row nobody can check.
CREATE TABLE astro_calendar (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,              -- new_moon|full_moon|window|retrograde|shadow
  label         TEXT NOT NULL,
  starts_at     INTEGER NOT NULL,
  ends_at       INTEGER,
  detail        TEXT,                       -- json
  source        TEXT NOT NULL DEFAULT 'computed', -- computed|imported
  method        TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_astro_event ON astro_calendar(kind, starts_at);
CREATE INDEX idx_astro_when ON astro_calendar(starts_at);

-- ─── astro_days ────────────────────────────────────────────────────────────────
-- One materialised row per day, so the daily view is a read and not a
-- recomputation, and so what was shown on a past day stays inspectable.
CREATE TABLE astro_days (
  id                TEXT PRIMARY KEY,       -- YYYY-MM-DD in UTC
  date_ts           INTEGER NOT NULL UNIQUE,
  phase             TEXT NOT NULL,
  illumination_bps  INTEGER NOT NULL,       -- 0–10000
  age_days          REAL NOT NULL,
  waxing            INTEGER NOT NULL,
  moon_sign         TEXT NOT NULL,
  moon_degrees      REAL NOT NULL,
  cusp              INTEGER NOT NULL DEFAULT 0,
  next_sign         TEXT,
  windows           TEXT,                   -- json: active derived windows
  method            TEXT NOT NULL,
  computed_at       INTEGER NOT NULL
);
CREATE INDEX idx_astro_days_ts ON astro_days(date_ts DESC);
