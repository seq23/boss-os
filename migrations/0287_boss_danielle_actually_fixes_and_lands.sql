-- 0287 — DANIELLE ACTUALLY FIXES, AND LANDS WHAT SHE FIXES (16 Oct 2026).
--
-- Owner, 16 Oct 2026: "fix danielle's job so she can actually fix things". The passes of 15 and
-- 16 Oct read every Ahrefs mail and fixed nothing (projects=24 fixed=0 surfaced=10; projects=10
-- fixed=0 surfaced=9 off_limits=1). What changes in data:
--
--   1. site_audit_findings.disposition gains four named outcomes that are NOT unfixed site defects:
--      ahrefs_side (AHREFS_SIDE_CRAWL_FAILURE — reachable from outside, robots allows Ahrefs),
--      client_repo (CLIENT_REPO — report only, never raised), in_flight (IN_FLIGHT — an open PR or
--      branch already touches it) and ahrefs_credits (AHREFS_CRAWL_CREDITS — the workspace ran out
--      of monthly crawl credits; every October crawl failure was this). A CHECK cannot be altered
--      in SQLite, so the table is rebuilt with every row and index carried over.
--   2. The duty's model moves from Sonnet to Opus: her rule since 6 Oct is Opus for every agent.
--   3. The duty's `never` and success criteria tell the new truth: client repos are never touched,
--      local-guides-citation-velocity is no longer off limits, and a green fix is LANDED through
--      ~/bin/land instead of being left for her to merge.

CREATE TABLE site_audit_findings_new (
  id            TEXT PRIMARY KEY,
  project       TEXT NOT NULL,
  domain        TEXT,
  repo          TEXT,
  mapped_by     TEXT CHECK (mapped_by IN ('repo_identity','unmapped')),
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

UPDATE standing_duties
   SET name = 'The Ahrefs audits, crawled, fixed at source and landed',
       task_title = 'The Ahrefs audits, crawled, fixed at source and landed',
       task_input = json_set(task_input,
         '$.model', 'claude-opus-5',
         '$.never',
         'Client repos are off limits to the fixer entirely (hicks-consulting-canonical, dianne-place-recovery-services, the sheila and mercedes repositories): their findings are recorded as client_repo rows and nothing is branched. It never works in the owner''s checkout, only in a fresh worktree off origin, and never duplicates a fix an open PR or branch already carries (in_flight). It never calls a bare merge, a workflow dispatch or a deploy: a green fix lands through ~/bin/land and nothing else. local-guides-citation-velocity is no longer off limits (owner, 16 Oct 2026).'),
       success_criteria = 'Every flagged site is crawled by Danielle herself (site-crawl.py) so findings carry real URLs rather than the mail''s counts. Every project is mapped to a repository by that repo''s own REPO_IDENTITY.md, never by resemblance. A fix is made at source in a fresh worktree, proven by that repository''s own validators, opened as a PR, watched to green and landed through ~/bin/land. Client repos are reported and never touched. A crawl failure is probed from outside and recorded as AHREFS_SIDE_CRAWL_FAILURE or AHREFS_CRAWL_CREDITS when the site is fine. A pass that surfaces fixable defects with fixed=0, or leaves a PR unlanded, exits red with each reason named.'
 WHERE id = 'duty_site_audit_repair';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0287_boss_danielle_actually_fixes_and_lands');
