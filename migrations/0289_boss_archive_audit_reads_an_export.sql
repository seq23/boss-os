-- 22 October 2026, after the first live run of duty_archive_audit.
--
-- A headless `claude -p` on her Mac has NO Artifact tool (CONFIRMED: the init event lists none and
-- ToolSearch cannot load one), so the Haiku run 0288 named for reading the gallery and the Open Loops
-- page could only have guessed. archive-audit.mjs now reads an export a Claude session that holds the
-- tool leaves at ~/.boss-os/archive/gallery.json and names a stop when it is missing or stale. No
-- model is called, so the duty row stops naming one (a row that names a model the script never
-- reaches is the drift `validate:duty-delivery` exists to catch).
UPDATE standing_duties
   SET task_input = json_set(json_remove(task_input, '$.requested'),
                             '$.why_no_model', 'Dates, commits and a file export are compared in code. The gallery and Open Loops page are read from an export a Claude session leaves on the Mac, because headless runs have no Artifact tool.',
                             '$.why_local', 'The document copies, ~/HANDOFF.md and the gallery export are on her Mac, and the Worker cannot read any of them.')
 WHERE id = 'duty_archive_audit';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0289_boss_archive_audit_reads_an_export');
