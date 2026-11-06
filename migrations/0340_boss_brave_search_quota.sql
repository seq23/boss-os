-- BRAVE SEARCH, THE SECOND RESEARCH ROUTE (owner, 5 Nov 2026): meeting-guest research tries Gemini's
-- Google-grounded search first, then Brave Search, then the guest's own pages. Brave is capped at 20
-- searches a day (FREE_ROUTES.svc_brave_search in src/worker/boss/backends/guard.ts, the one
-- statement of the cap). Each search is claimed here BEFORE the call, one row per service per day
-- (the day in Central time), so a 21st search that day is skipped and the research moves on.
-- Additive: a new table, nothing changed or dropped.
CREATE TABLE IF NOT EXISTS free_search_quota_days (
  service    TEXT NOT NULL,
  day        TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (service, day)
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('free_search_quota_days', 'router', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery: how many Brave searches were used each day. Counts only; no names, no queries.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0340_boss_brave_search_quota');
