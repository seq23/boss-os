-- The Meetings tab is a diary. It was a packet reader that lied in its summary line.
--
-- ─── Her words, with a screenshot ──────────────────────────────────────────
--
--   "this meetings tab needs work. it says Nothing in the diary when the meeting tab is closed then
--    u open to all this stuff. this stuff is unnecessary. this tab is suppose to show what meetings
--    i have upcoming. i should be able to input what meetings i have and it should check my
--    calendars for meetings and if there is a packet or deliverable for a meeting i should see that
--    in a link"
--
-- ─── Four defects, and the first one is the familiar one ───────────────────
--
-- 1. THE COLLAPSED LINE CONTRADICTED THE CONTENTS. "Nothing in the diary", opening onto a full
--    agenda. That is the same shape as the frozen alert this repository spent the morning fixing: a
--    summary computed from one thing while the section renders another. `summarise()` counted
--    `c.meetings` — the CRM table, always empty — while the body rendered the packet. Both were
--    correct about the thing each was looking at, and together they were a lie.
--
-- 2. IT DUMPED THE PACKET INLINE. "Your week", the grant steps, the whole document, expanded into a
--    section she opens to see what is on today. The content is right and it belongs on the agenda
--    page, which already exists at one permanent URL. She asked for A LINK.
--
-- 3. IT ANSWERED THE WRONG QUESTION. "this tab is suppose to show what meetings i have upcoming."
--    A row is: what it is, when, with whom, and a link if there is a packet. Nothing else.
--
-- 4. SHE COULD NOT PUT A MEETING IN IT. A diary you cannot write in is not a diary.
--
-- ─── Why a new table rather than `meetings` ────────────────────────────────
--
-- `meetings` is the relationship CRM: `person_id` is NOT NULL and references `people`, and it
-- carries briefs, captures and follow-ups. Every one of those is right for "a call with a
-- counterparty I track". None of it is right for "Wednesday, Scooter, 9am", and forcing one would
-- mean inventing a `people` row for everybody she ever meets — which collides head-on with her rule
-- that counterparty names stay out of this system.
--
-- SO THE TWO ARE MERGED ON READ RATHER THAN KEPT APART. `GET /diary` returns diary entries AND
-- CRM meetings in one ordered list. Two components each keeping their own list with no link between
-- them is the defect this repository names by name; the link is that there is one surface and one
-- query, and neither list is a place she has to remember to look.
--
-- ─── MANUAL ENTRY IS THE PRIMARY MECHANISM, AND THAT IS A FINDING ──────────
--
-- The first plan made calendar sync the spine and manual entry the fallback. Fetching her actual
-- feeds on 9 September settled it the other way:
--
--   personal      4,527 events back to 2009 — ZERO dated today or later
--   spry.vc         835 events              — ONE upcoming, an invoice notice
--   cryptoclearr      0 events              — the feed is empty
--
-- HER ARCHIVES ARE LARGE AND HER FUTURE IS EMPTY. Those calendars are a record of what happened,
-- not a diary of what is coming, and she confirmed it directly: "the meeting on wednesday is usually
-- on my sequoia@westpeek calendar and im telling u its a standing meeting so this is a manual
-- meeting addition."
--
-- A diary built primarily on those feeds would show an empty screen on the one day she has a
-- meeting — WHICH IS EXACTLY THE BUG SHE REPORTED THIS MORNING, rebuilt on better plumbing. So the
-- feeds are a supplement that catches whatever does get scheduled, merged into the same list, and
-- what she types is the spine.
--
-- ─── Which means recurrence has to work on a typed entry ───────────────────
--
-- "every Wednesday, Scooter, standing partner meeting" is entered once and appears every week. A
-- diary that made her retype her only recurring meeting fifty-two times would not be used twice.
-- Stored as a rule on ONE row and expanded on read, so there is nothing to backfill and no
-- generator that can fall behind.

CREATE TABLE diary_entries (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  -- Free text, hers, and deliberately not a foreign key. It also does the linking work: an entry
  -- whose counterpart matches a packet's counterpart shows that packet's link on its row.
  counterpart   TEXT,
  scheduled_at  INTEGER NOT NULL,
  duration_min  INTEGER,
  location      TEXT,
  -- manual    — she typed it.
  -- calendar  — read from a calendar she has connected.
  -- A `recurring` value is deliberately absent: the standing Wednesday is derived on read and never
  -- written, so nothing can leave a stale copy of it here.
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','calendar')),
  -- The calendar event's own id, so a re-sync UPDATES rather than duplicating. Without it, a job
  -- run twice in a morning produces a diary with everything in it twice, which is the fastest way
  -- to make her stop trusting the screen.
  calendar_uid  TEXT,
  note          TEXT,
  -- none   — a one-off.
  -- weekly — repeats on the weekday of `scheduled_at`, expanded on read across the horizon.
  --
  -- ONE ROW AND A RULE, NOT FIFTY-TWO ROWS. Materialising a year of a standing meeting means a
  -- generator that can fall behind, rows to backfill when she moves it, and a fixture that vanishes
  -- the week the generator breaks. Expanding on read cannot go stale.
  recurrence    TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','weekly')),
  -- When a repeat stops. NULL means it is still standing.
  recur_until   INTEGER,
  -- Cancelled is not deleted: a meeting that was in the diary and is not any more is a fact, and
  -- deleting the row makes "he moved it" and "it never existed" look the same.
  cancelled_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_diary_when ON diary_entries(scheduled_at);
-- NOT A PARTIAL INDEX, AND THAT IS LOAD-BEARING. `ON CONFLICT(calendar_uid) DO UPDATE` only matches
-- an index whose definition it can name exactly, so a `WHERE calendar_uid IS NOT NULL` clause makes
-- the upsert silently match nothing and the sync file zero rows. SQLite already allows any number of
-- NULLs in a unique index, so the plain form does the same job and the upsert works.
CREATE UNIQUE INDEX idx_diary_calendar_uid ON diary_entries(calendar_uid);

-- ─── The Wednesday meeting, typed in as she described it ────────────────────
--
-- Her words, and they decide both the mechanism and the row: "im telling u its a standing meeting so
-- this is a manual meeting addition." It lives on her westpeek.ventures calendar, which is the one
-- feed not connected — and even if it were, the other three prove her forward schedule is not in
-- Google.
--
-- The counterpart is capitalised for the screen and matched case-insensitively against the packet's
-- own `counterpart`, so "Scooter" here and "scooter" on the packet are the same person rather than
-- two that never link.
--
-- 1788994800000 is Wednesday 9 September 2026 at 15:00 UTC, which is 09:00 America/Chicago — the
-- hour the packet job already assumes. Weekly from there, no end date.
INSERT OR IGNORE INTO diary_entries
  (id, title, counterpart, scheduled_at, source, recurrence, note, created_at, updated_at)
VALUES
  ('dia_standing_scooter', 'West Peek partner meeting', 'Scooter', 1788994800000, 'manual', 'weekly',
   'The standing weekly with Scooter. Its packet is on the agenda page every Wednesday; the link is on this row when one has been filed.',
   unixepoch() * 1000, unixepoch() * 1000);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('diary_entries', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'What she has coming up: a title, a time, and who it is with in her own words. She types these or a calendar she has connected supplies them, so the names in it are hers to put there — unlike the relationships table, nothing here is derived from reading her mail. External processing asks first because a title is free text.')
ON CONFLICT(entity) DO NOTHING;

-- ─── How her calendars actually get in here ─────────────────────────────────
--
-- "it should check my calendars for meetings."
--
-- THE MECHANISM IS THE SECRET iCal ADDRESS, AND IT IS BETTER THAN THE OBVIOUS ONE. Every Google
-- calendar — consumer or Workspace — publishes a private ICS URL under Settings, Settings for my
-- calendars, the calendar, Integrate calendar, "Secret address in iCal format". A plain HTTPS GET
-- returns the whole feed.
--
-- WHY NOT DOMAIN-WIDE DELEGATION, WHICH WAS THE FIRST PLAN:
--
--   · DWD CANNOT READ A CONSUMER CALENDAR, the same wall the KDP mail hit. Two of her four accounts
--     are @gmail.com, so half the diary would have been permanently missing and the screen would
--     have had to say so for ever.
--   · IT WOULD HAVE NEEDED TWO MORE ADMIN GRANTS — a new scope on spry.vc and another from Scooter
--     on westpeek.ventures — and the LP mail has already been waiting on one of those since
--     19 August.
--   · AND THE DURABLE PROPERTY SHE HAS BEEN ASKING FOR ALL DAY: an iCal secret URL is not a token.
--     She changed her Google password this morning and it killed the OAuth connector instantly.
--     It does not touch these. There is nothing here for a password change to revoke.
--
-- There is also no Google Calendar connector on claude.ai — only Gmail and Drive — so the route
-- that reads the KDP mail does not exist for calendars even if she wanted it.
--
-- ─── The URLs are SECRETS and live in the vault ────────────────────────────
--
-- Anyone holding one can read that calendar in full, so each goes in the encrypted vault under its
-- own name, is never logged, never appears in an error message, and is never rendered on a screen.
-- The register below holds the NAME of the vault entry and the state of the feed — never the URL.
-- If one ever leaks she resets it from the same settings page and the old address dies immediately,
-- which is the recovery path and is written into the fix steps so she does not have to ask.
--
-- ─── Four accounts, and none of them blocks the others ─────────────────────
--
-- One calendar connected is better than none. Each feed clears its own row the first time it
-- returns events, the diary says WHICH are connected and which are not, and manual entry works
-- regardless. A partial calendar presented as complete is worse than manual entry, because she
-- would trust it and stop typing the ones it cannot see.
INSERT OR IGNORE INTO credential_probes
  (id, label, what_depends, state, fix_steps, max_age_hours, created_at, updated_at) VALUES
  ('cred_cal_seq_taylor', 'Calendar feed — your personal Google calendar',
   'Whether anything scheduled on your personal calendar appears in the diary. Connected on 9 September, and worth knowing what it actually holds: 4,527 events going back to 2009 and NOT ONE dated today or later. It is a record of what happened rather than a diary of what is coming, which is why what you type is the spine and this is the supplement.',
   'unknown',
   'In Google Calendar as seq.taylor@gmail.com: Settings, then Settings for my calendars, pick the calendar, Integrate calendar, and copy the "Secret address in iCal format". Then: npm run vault:set CAL_ICS_SEQ_TAYLOR and paste it. Treat it as a password — anyone with it can read the whole calendar. If it ever leaks, press Reset on that same page and the old address stops working immediately.',
   168, unixepoch() * 1000, unixepoch() * 1000),

  ('cred_cal_staylor_spry', 'Calendar feed — staylor at spry.vc',
   'Whether brokerage meetings appear in the diary. Connected on 9 September: 835 events, one of them upcoming — an invoice notice.',
   'unknown',
   'In Google Calendar signed in as the spry.vc account: Settings, Settings for my calendars, the calendar, Integrate calendar, copy the "Secret address in iCal format". Then: npm run vault:set CAL_ICS_STAYLOR_SPRY. It is a password in URL form; Reset on that page kills it if it ever leaks.',
   168, unixepoch() * 1000, unixepoch() * 1000),

  ('cred_cal_westpeek', 'Calendar feed — sequoia at westpeek.ventures',
   'Whether West Peek meetings appear in the diary. NOTE this needs nothing from Scooter — unlike the mail grant, an iCal address is yours to copy and does not touch domain administration at all.',
   'unknown',
   'In Google Calendar signed in as the westpeek.ventures account: Settings, Settings for my calendars, the calendar, Integrate calendar, copy the "Secret address in iCal format". Then: npm run vault:set CAL_ICS_WESTPEEK. Reset on that page kills it if it ever leaks.',
   168, unixepoch() * 1000, unixepoch() * 1000),

  ('cred_cal_cryptoclearr', 'Calendar feed — the cryptoclearr Google calendar',
   'Whether meetings on that account appear in the diary. Connected on 9 September and the feed is empty: zero events. Connected and empty is a different fact from not connected, and the screen says which.',
   'unknown',
   'In Google Calendar signed in as that account: Settings, Settings for my calendars, the calendar, Integrate calendar, copy the "Secret address in iCal format". Then: npm run vault:set CAL_ICS_CRYPTOCLEARR. Reset on that page kills it if it ever leaks.',
   168, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0213_boss_the_diary_is_a_diary');
