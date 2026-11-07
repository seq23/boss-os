-- Owner ruling, 7 Nov 2026 (personal brain): Detox Denver (detoxdenver.org) and Dianne's Place are ONE
-- business and a friends' site, in Search Readiness with its repo. dianne-place-recovery-services left
-- `NO_AUTO_FIX` in src/shared/boss/siteAudit/repoPolicy.mjs; the duty's `never` text says the new
-- truth. Her patients' data still never feeds her own businesses' networks.
UPDATE standing_duties
   SET task_input = json_set(
         task_input,
         '$.never',
         'Client repos that are not grid repo sites are off limits to the fixer entirely (the sheila and mercedes repositories): their findings are recorded as client_repo rows and nothing is branched. hicks-consulting-canonical and horse-legal-guide-velocity are grid repo sites and are fixed like every other (owner, 25 Oct 2026); so is dianne-place-recovery-services (detoxdenver.org, a friends'' site since 7 Nov 2026, under the strict health gate; her patients'' data never feeds the owner''s own businesses). Parked repos in the personal brain''s Repo categories are never branched. It never works in the owner''s checkout, only in a fresh worktree off origin, and never duplicates a fix an open PR or branch already carries (in_flight). It never calls a bare merge, a workflow dispatch or a deploy: a green fix lands through ~/bin/land and nothing else. local-guides-citation-velocity is no longer off limits (owner, 16 Oct 2026). A protected page (the Spry Labs download page) is fixed only on its own, in a single-page change, never in a bulk or cosmetic fix.')
 WHERE id = 'duty_site_audit_repair';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0356_boss_dianne_is_a_friends_site');
