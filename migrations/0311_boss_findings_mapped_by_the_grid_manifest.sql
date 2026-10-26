-- A finding's repository may be mapped by the grid manifest, not only by REPO_IDENTITY.md.
--
-- 26 Oct 2026. Two lists said which repository serves a domain: each checkout's REPO_IDENTITY.md,
-- grepped by the weekly Ahrefs pass, and sites.json (the grid repos), read by the Search Readiness
-- queue. Most repositories never declared their domains in REPO_IDENTITY.md, so the Ahrefs pass
-- wrote `no_repo` for 13 domains sites.json already mapped (Today: "Porchandparty901 … no
-- repository claims that domain"), and the ingest refused a whole queue pass whose rows were mapped
-- from the manifest. src/shared/boss/siteAudit/domainRepos.mjs is now the one list; a row it maps is
-- recorded as mapped_by = 'grid_manifest'. SQLite cannot widen a CHECK in place, so the table is
-- rebuilt exactly as 0287 built it, with the one value added.

CREATE TABLE site_audit_findings_new (
  id            TEXT PRIMARY KEY,
  project       TEXT NOT NULL,
  domain        TEXT,
  repo          TEXT,
  mapped_by     TEXT CHECK (mapped_by IN ('repo_identity','grid_manifest','unmapped')),
  disposition   TEXT NOT NULL CHECK (disposition IN ('fixed_pr','surfaced','off_limits','no_repo','none','ahrefs_side','client_repo','in_flight','ahrefs_credits')),
  headline      TEXT NOT NULL,
  because       TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  pr_url        TEXT,
  health_score  INTEGER,
  errors        INTEGER,
  message_id    TEXT,
  reported_at   INTEGER,
  searched      TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acted','dismissed')),
  notes         TEXT,
  run_id        TEXT NOT NULL,
  found_at      INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  archived_at   INTEGER
);

INSERT INTO site_audit_findings_new
  (id, project, domain, repo, mapped_by, disposition, headline, because, suggested_action, pr_url,
   health_score, errors, message_id, reported_at, searched, status, notes, run_id, found_at,
   updated_at, archived_at)
SELECT id, project, domain, repo, mapped_by, disposition, headline, because, suggested_action, pr_url,
       health_score, errors, message_id, reported_at, searched, status, notes, run_id, found_at,
       updated_at, archived_at
  FROM site_audit_findings;

DROP INDEX IF EXISTS idx_site_audit_unique;
DROP INDEX IF EXISTS idx_site_audit_live;
DROP INDEX IF EXISTS idx_site_audit_run;
DROP TABLE site_audit_findings;
ALTER TABLE site_audit_findings_new RENAME TO site_audit_findings;
CREATE UNIQUE INDEX idx_site_audit_unique ON site_audit_findings(project, headline);
CREATE INDEX idx_site_audit_live ON site_audit_findings(archived_at, status, found_at DESC);
CREATE INDEX idx_site_audit_run ON site_audit_findings(run_id, found_at DESC);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0311_boss_findings_mapped_by_the_grid_manifest');
