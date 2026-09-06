-- Boss OS v20 — Phase 13: Relationship Capital OS.
-- Canon §40 (relationship capital and meeting intelligence), §10, §51
-- (Person, Organization, Relationship, Meeting, Follow-Up).
--
-- Scores are integers 0–100. Timestamps stay epoch milliseconds. Money, where
-- it appears at all in this phase, stays integer USD micros.

-- ─── organizations ─────────────────────────────────────────────────────────────
-- A person is usually reachable through an institution, and the institution
-- outlives the individual relationship.
CREATE TABLE organizations (
  id            TEXT PRIMARY KEY,
  lane          TEXT NOT NULL REFERENCES lanes(id),
  name          TEXT NOT NULL,
  kind          TEXT,                       -- fund|firm|company|nonprofit|family_office|agency|other
  domain        TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'active', -- active|dormant|archived
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_org_name ON organizations(name);

-- ─── people ────────────────────────────────────────────────────────────────────
CREATE TABLE people (
  id              TEXT PRIMARY KEY,
  lane            TEXT NOT NULL REFERENCES lanes(id),
  full_name       TEXT NOT NULL,
  role            TEXT,
  organization_id TEXT REFERENCES organizations(id),
  email           TEXT,
  phone           TEXT,
  location        TEXT,
  bio             TEXT,                     -- who they are, in the Boss's words
  -- Canon §10: relationship data is sensitive by default. The router reads this
  -- before anything about a person can reach a cloud model.
  privacy_class   TEXT NOT NULL DEFAULT 'private', -- public|internal|private|restricted
  status          TEXT NOT NULL DEFAULT 'active',  -- active|dormant|archived
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_people_org ON people(organization_id);
CREATE INDEX idx_people_name ON people(full_name);

-- ─── relationships ─────────────────────────────────────────────────────────────
-- One relationship per person: the standing state of the tie, not an event.
-- Canon §40's five scoring dimensions live here. Three are judgements the Boss
-- makes and the system stores; two are derived and re-derived, with the trace
-- of how they were derived kept in `score_detail` so a wrong score is fixable
-- rather than mysterious.
CREATE TABLE relationships (
  id                    TEXT PRIMARY KEY,
  person_id             TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  lane                  TEXT NOT NULL REFERENCES lanes(id),
  kind                  TEXT NOT NULL DEFAULT 'professional', -- investor|lp|advisor|client|partner|mentor|peer|family|friend|professional|other
  -- §40 dimension 1 — how much this tie matters to the mission (Boss judgement)
  strategic_importance  INTEGER NOT NULL DEFAULT 50,
  -- §40 dimension 2 — how much trust actually exists (Boss judgement, moved by captures)
  trust_level           INTEGER NOT NULL DEFAULT 50,
  -- §40 dimension 3 — derived from last contact against the agreed cadence
  recency_score         INTEGER NOT NULL DEFAULT 0,
  -- §40 dimension 4 — what is realistically available here (Boss judgement)
  opportunity_value     INTEGER NOT NULL DEFAULT 0,
  -- §40 dimension 5 — the composite the screen sorts on
  relationship_health   INTEGER NOT NULL DEFAULT 0,
  cadence_days          INTEGER NOT NULL DEFAULT 30,
  last_contact_at       INTEGER,
  next_touch_due_at     INTEGER,
  scored_at             INTEGER,
  score_detail          TEXT,               -- json: inputs, weights, penalties, result
  notes                 TEXT,
  status                TEXT NOT NULL DEFAULT 'active', -- active|dormant|closed
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_relationship_person ON relationships(person_id);
CREATE INDEX idx_relationship_health ON relationships(status, relationship_health DESC);
CREATE INDEX idx_relationship_due ON relationships(status, next_touch_due_at);

-- ─── meetings ──────────────────────────────────────────────────────────────────
-- The unit §40 builds meeting intelligence around: a brief before, a capture
-- after. `status` is the only place that says which of those have happened.
CREATE TABLE meetings (
  id              TEXT PRIMARY KEY,
  lane            TEXT NOT NULL REFERENCES lanes(id),
  person_id       TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relationship_id TEXT REFERENCES relationships(id),
  organization_id TEXT REFERENCES organizations(id),
  title           TEXT NOT NULL,
  purpose         TEXT,                     -- what the Boss wants out of it
  the_ask         TEXT,                     -- the one clear ask, if there is one
  scheduled_at    INTEGER NOT NULL,
  duration_min    INTEGER,
  location        TEXT,
  status          TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|briefed|captured|cancelled
  held_at         INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_meetings_when ON meetings(scheduled_at);
CREATE INDEX idx_meetings_person ON meetings(person_id, scheduled_at DESC);

-- ─── meeting_briefs ────────────────────────────────────────────────────────────
-- The before-meeting brief. `template_id` is the existing `tpl_meeting_dossier`
-- template, which until this phase had nowhere to write.
CREATE TABLE meeting_briefs (
  id                  TEXT PRIMARY KEY,
  meeting_id          TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  template_id         TEXT REFERENCES task_templates(id),
  generated_at        INTEGER NOT NULL,
  dossier             TEXT NOT NULL,        -- json: who they are, what they want, what we want, landmines
  relationship_history TEXT NOT NULL,       -- json: prior meetings, captures, follow-ups, score trace
  suggested_questions TEXT NOT NULL,        -- json: [{question, why, source_type, source_id}]
  the_ask             TEXT,                 -- json: {available, text|reason}
  prompt              TEXT,                 -- the rendered template prompt
  created_at          INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_brief_meeting ON meeting_briefs(meeting_id);

-- ─── meeting_captures ──────────────────────────────────────────────────────────
-- The after-meeting capture. Every capture leaves at least one follow-up and at
-- least one memory promotion candidate behind; the counts are stored so the
-- claim is checkable without re-deriving it.
CREATE TABLE meeting_captures (
  id                      TEXT PRIMARY KEY,
  meeting_id              TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  template_id             TEXT REFERENCES task_templates(id),
  captured_at             INTEGER NOT NULL,
  notes                   TEXT NOT NULL,
  commitments_made        TEXT NOT NULL,    -- json: [{text, due_at}] — owed by the Boss
  commitments_received    TEXT NOT NULL,    -- json: [{text, due_at}] — owed to the Boss
  sentiment               TEXT,             -- warm|neutral|cool
  trust_delta             INTEGER NOT NULL DEFAULT 0,
  follow_up_count         INTEGER NOT NULL DEFAULT 0,
  memory_candidate_count  INTEGER NOT NULL DEFAULT 0,
  created_at              INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_capture_meeting ON meeting_captures(meeting_id);

-- ─── follow_ups ────────────────────────────────────────────────────────────────
-- A commitment with a date on it. When it comes due it is surfaced onto the day
-- as an open loop; `loop_id` is what stops it being surfaced twice.
CREATE TABLE follow_ups (
  id              TEXT PRIMARY KEY,
  lane            TEXT NOT NULL REFERENCES lanes(id),
  person_id       TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relationship_id TEXT REFERENCES relationships(id),
  meeting_id      TEXT REFERENCES meetings(id),
  capture_id      TEXT REFERENCES meeting_captures(id),
  owner           TEXT NOT NULL DEFAULT 'boss', -- boss|them
  title           TEXT NOT NULL,
  detail          TEXT,                     -- json
  due_at          INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open', -- open|done|dropped
  loop_id         TEXT REFERENCES open_loops(id),
  surfaced_at     INTEGER,
  completed_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_follow_ups_due ON follow_ups(status, due_at);
CREATE INDEX idx_follow_ups_person ON follow_ups(person_id, status, due_at);
CREATE INDEX idx_follow_ups_loop ON follow_ups(loop_id);
