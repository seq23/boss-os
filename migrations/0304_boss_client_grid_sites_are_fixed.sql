-- Owner ruling, 25 Oct 2026 (the Search Readiness checklist, enforced): horselegalguide.com and
-- hicksconsulting.org get the same auto-fix lane as every other grid repo site. hicks-consulting-
-- canonical left `NO_AUTO_FIX` in src/shared/boss/siteAudit/repoPolicy.mjs; the duty's `never` text
-- says the new truth, and its success criteria add the Search Readiness fix queue the weekly audit
-- writes (~/.boss-os/search-readiness/fix-queue.json, read by the prompt's section 1b).
UPDATE standing_duties
   SET task_input = json_set(
         task_input,
         '$.never',
         'Client repos that are not grid repo sites are off limits to the fixer entirely (dianne-place-recovery-services, the sheila and mercedes repositories): their findings are recorded as client_repo rows and nothing is branched. hicks-consulting-canonical and horse-legal-guide-velocity are grid repo sites and are fixed like every other (owner, 25 Oct 2026). It never works in the owner''s checkout, only in a fresh worktree off origin, and never duplicates a fix an open PR or branch already carries (in_flight). It never calls a bare merge, a workflow dispatch or a deploy: a green fix lands through ~/bin/land and nothing else. local-guides-citation-velocity is no longer off limits (owner, 16 Oct 2026). A protected page (the Spry Labs download page) is fixed only on its own, in a single-page change, never in a bulk or cosmetic fix.'),
       success_criteria = success_criteria || ' Every brief in the Search Readiness fix queue (written each Monday by npm run sites:audit) is confirmed on the live site and fixed, or recorded with the reason it could not be.'
 WHERE id = 'duty_site_audit_repair';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0304_boss_client_grid_sites_are_fixed');
