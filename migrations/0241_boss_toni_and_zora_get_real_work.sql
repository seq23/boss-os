-- Toni and Zora, who were amber because nothing on the roster was theirs.
--
-- ─── Her words, 13 September 2026 ───────────────────────────────────────────
--
-- "we dont need to retire them we might find work for them later"
-- "and u should find something for those 2 (toni and zora) to do"
--
-- RETIRING THEM IS OFF THE TABLE, so the question is what work already needs doing that belongs to
-- each of them by charter. Neither duty below is invented to fill a slot; both were already
-- happening or already required, and neither had an owner.
--
-- ─── TONI: the credential register ──────────────────────────────────────────
--
-- Her charter: "Guard the trading lane. Check every order against the authority envelope. You have
-- no execution authority and never will by default." The trading lane holds nothing — zero
-- positions, zero orders — so the LANE is empty, but the REMIT is risk, and there is unguarded risk
-- work in this system today.
--
-- `com.seq.boss-credentials.plist` has been running `npm run credentials:check` daily on her Mac,
-- and there is NO duty row for it. So nine credentials — the Gmail connector, the Google service
-- account, four calendar feeds, the West Peek delegation — are probed every day by a job that
-- nothing on the roster owns. If that job stopped, the register would go stale, every probe would
-- keep reading `live` from its last answer, and the screen would say the credentials were fine
-- because nothing was watching the watcher. That is precisely the failure the register was built
-- after: "the last time nothing was watching, the Gmail connector was dead for days."
--
-- It is also a launchd job with no duty link, which is the blind spot
-- `scripts/validate/a-launchd-run-reaches-its-duty.mjs` exists to close — it could not see this one
-- because there was no duty row to link. Wrapping it in `duty-run.sh` and giving it to Toni closes
-- both gaps with one row.
--
-- `last_run_at` IS SEEDED FROM EVIDENCE, NOT ASSUMED. `credential_probes.checked_at` records when
-- the prober last answered, and the newest value is the day this migration is written — so the job
-- demonstrably ran and saying otherwise would make her dot amber about something that is true.
-- Seeded from the row rather than from `unixepoch()`, so if the prober has in fact stopped, this
-- inherits the stale date and goes red exactly as it should.
--
-- ─── ZORA: the LP tracker, moved off Monique ────────────────────────────────
--
-- Her charter: "Turn conversation into candidate memory. Never promote anything yourself. Propose,
-- cite the source, and let the gate decide." She is the Archivist — the seat for keeping a record
-- true against its source.
--
-- Monique carried EIGHT duties against Danielle's four and Camille's two, and one of the eight is
-- not relationship work at all. `duty_scooter_sheet` — "Scooter's LP tracker, current before the
-- Wednesday sync" — reconciles a spreadsheet against the reply record. It talks to nobody. Every
-- other duty Monique holds involves reading or writing to an actual person; this one is
-- record-keeping against a source, which is the archivist's job by definition.
--
-- So it moves, Monique goes to seven, and Zora gets a duty that already exists, already has a
-- launchd job wrapped into `duty-run.sh`, and already delivers something she uses on Wednesdays.
-- Nothing new has to work for this to be real.
--
-- ITS CLOCK IS NOT TOUCHED. Re-owning work is not running it, and advancing `next_due_at` here
-- would hide a missed Tuesday behind a change of name. `last_run_at` stays NULL, which is true, so
-- Zora reads AMBER — "no evidence" — until the job actually reports. That is the honest state and
-- the dot is built to say it.
--
-- ─── WHAT NEITHER OF THESE DOES ─────────────────────────────────────────────
--
-- Nothing here points at spry.vc, sends from any address, touches a `west-peek-*` repo, or puts a
-- named counterparty, asset or size into this database. The credential check reads presence and
-- answers live/dead; the LP tracker reconciles a sheet that already exists.

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday, weekdays,
   next_due_at, last_run_at, task_kind, task_title, task_input, success_criteria, suspended,
   created_at, executor)
VALUES (
  'duty_credentials',
  'The logins this system runs on — checked, and said out loud when one dies',
  'emp_risk', 'ops', 7, 15, 'America/Chicago', 'daily', NULL, NULL,
  0, NULL,
  'research',
  'Credential register check',
  json_object(
    'local_job', 'credential-check.mjs',
    'why_local', 'Probing a Google credential means using it, and the Claude Code runner strips every credential from its environment on purpose. This runs from launchd on her Mac and posts back only live/dead and the time it was answered — never a value and never a fragment of one.',
    'delivers', 'credential_probes',
    'repo', 'boss-os',
    'operates_on', json_array()
  ),
  'Every probe in the register carries an answer and the time it was answered. A probe that could not be decided reports unknown rather than inheriting its last answer, and a dead credential names what stopped working and the steps to fix it.',
  0,
  unixepoch() * 1000,
  'local_job'
);

-- Seeded from evidence: the newest time the prober actually answered.
UPDATE standing_duties
   SET last_run_at = (SELECT MAX(checked_at) FROM credential_probes WHERE checked_at IS NOT NULL)
 WHERE id = 'duty_credentials' AND last_run_at IS NULL;

-- The first occurrence after that run, computed the same way the cron would.
UPDATE standing_duties
   SET next_due_at = COALESCE(last_run_at, unixepoch() * 1000) + 86400000
 WHERE id = 'duty_credentials';

UPDATE standing_duties
   SET employee_id = 'emp_knowledge'
 WHERE id = 'duty_scooter_sheet';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0241_boss_toni_and_zora_get_real_work');
