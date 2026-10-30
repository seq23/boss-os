-- Public code contains no campaign contacts. These rows are private runtime research only.
CREATE TABLE pnp_outreach_prospects (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contact_first TEXT NOT NULL,
  contact_email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('lobby','party')),
  line TEXT NOT NULL,
  source_url TEXT NOT NULL,
  line_source_url TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'found' CHECK(state IN ('found','verified','sent1','sent2','replied','suppressed','taken_over','skipped')),
  nb_verdict TEXT,
  verified_at INTEGER,
  found_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  first_attempt_at INTEGER,
  first_sent_at INTEGER,
  first_message_id TEXT,
  followup_attempt_at INTEGER,
  followup_sent_at INTEGER,
  followup_message_id TEXT,
  note TEXT
);
CREATE INDEX idx_pnp_outreach_state ON pnp_outreach_prospects(state);

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_pnp_corporate_outreach', 'Office Christmas outreach', 'emp_research', 'ops',
   10, 20, 'America/Chicago', 'daily', NULL, unixepoch()*1000 + 86400000,
   'local_job', 'ops', 'Find local offices and send the approved Christmas decor note on weekdays',
   json_object('local_job', 'pnp-corporate-outreach.mjs',
     'research_seats', 'Codex subscription first, then Claude subscription; never a paid API.',
     'runs', 'Weekdays at 10:20 America/Chicago',
     'why_local', 'The sender token and the approved contract stay on the Mac.',
     'why_no_model', 'Only research uses the subscription seat router; email text is the approved contract verbatim.'),
   'Published contact addresses only, checked valid by NeverBounce; at most 12 first emails a weekday and one follow-up after five days. Stop for every reply or opt-out, at four paid corporate bookings, or after December 5, 2026. Count progress in the morning email.', 0);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('pnp_outreach_prospects', 'ops', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'Public-source corporate contact research and private sequence history. Existing prospect rows never enter a model prompt; outbound text is the approved local artifact.');
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0318_boss_pnp_corporate_outreach');
