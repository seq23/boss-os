-- 0263 — EVERY GRID PROPERTY HAS ITS READERS, AND A READER THAT CANNOT READ SAYS SO.
--
-- ─── Her words, 19 September 2026 ────────────────────────────────────────────
--
--   "Connect all the GSC and whatever else to measure the health and GitHub and all."
--
-- ─── What Boss OS measured before this, per property ─────────────────────────
--
-- GitHub: `grid-watch.mjs` read every grid repo daily and filed OBSERVATIONS — a red workflow, a
-- stale PR, a lane that stopped shipping — into `grid_observations` (0235). It filed exceptions,
-- never a reading: a green, shipping repo left no row, so "healthy" and "never looked" were the
-- same absence. Search Console: `property-performance.mjs` printed weekly movement to a terminal
-- and `line-returns.mjs` folded clicks into the return ledger; neither wrote a per-property health
-- figure anywhere a card could read. Uptime: nothing. Cloudflare deployments: nothing.
--
-- ─── One table, four readers, one row per reading ────────────────────────────
--
-- `property_health_readings` holds the LATEST fact each reader established about each property.
-- A reader that cannot read writes a row too — `state = 'blocked'` with the sentence that says why
-- (no credential, no grant, no domain recorded) — so the card never shows a blank where a reading
-- should be. Rule 0 lives in the reader: a run that reads zero properties fails loudly.
--
-- `numbers` is JSON because the four readers measure different things (a status code and a
-- latency; a workflow conclusion and a PR count; clicks and impressions; a deployment id and its
-- age) and four typed column sets for four readers is a schema that grows a column set per reader
-- for ever. The shape per reader is fixed in `src/worker/boss/health/readers.ts` and in
-- `grid-watch.mjs`, and the card renders by reader.
--
-- ─── Two Worker-run duties, and a new executor ───────────────────────────────
--
-- `executor = 'worker'` is new. `agent` duties become tasks a seat claims; `local_job` duties run
-- from launchd on her Mac and report back. Neither fits a GET to a public domain or a Search Console
-- read with a key the Worker already holds: an agent would claim it hours later and a Mac job would
-- add a launchd slot for work that needs no Mac. A `worker` duty is run by `materialiseDueDuties`
-- itself on the tick it comes due, and its outcome is written straight onto the duty row.
--
-- `worker_reader` in `task_input` names the reader; `delivers` names the table it writes, so
-- `validate:duty-delivery` can follow the chain: reader module exists → materialise invokes it →
-- it writes INTO the table → a route reads it → a screen renders it.

CREATE TABLE property_health_readings (
  id            TEXT PRIMARY KEY,
  -- The grid property, by its key in `src/shared/boss/grid.mjs`. The route refuses a key that file
  -- does not declare, so this is a reference to the grid and never a second copy of it.
  property_key  TEXT NOT NULL,
  -- One of the four readers in `src/shared/boss/propertyReaders.mjs`.
  reader        TEXT NOT NULL CHECK (reader IN ('uptime','github','gsc','cloudflare')),
  -- For readers with several targets per property (five guide domains; two repos), which one.
  target        TEXT NOT NULL,
  -- ok      — read, and the numbers say it is fine.
  -- warn    — read, and something is off (a red workflow, a 5xx, a week with zero impressions).
  -- blocked — could not read, and `error` names why. NEVER a quiet nothing.
  state         TEXT NOT NULL CHECK (state IN ('ok','warn','blocked')),
  -- One sentence for the card.
  summary       TEXT NOT NULL,
  numbers       TEXT NOT NULL DEFAULT '{}',
  -- Something she can open: the site, the Actions page, the Search Console property.
  evidence_url  TEXT,
  error         TEXT,
  read_at       INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_property_health_latest ON property_health_readings(property_key, reader, target, read_at DESC);
CREATE INDEX idx_property_health_read_at ON property_health_readings(read_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('property_health_readings', 'ops', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'What a read-only probe saw of her own public properties: a status code, a latency, a workflow conclusion, a click count, a deployment age. Her own sites and her own accounts; nothing personal, nothing about a counterparty.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_property_uptime',
   'Is every property up — a GET to each canonical domain, every morning',
   'emp_continuity', 'ops',
   6, 0, 'America/Chicago', 'daily', NULL,
   0,
   'worker', 'ops',
   'Is every property up — a GET to each canonical domain, every morning',
   json_object(
     'worker_reader', 'uptime',
     'delivers', 'property_health_readings',
     'why_worker',
     'A GET to a public domain needs no credential and no Mac. The Worker runs it on the tick the duty comes due and writes one row per domain; a property with no recorded domain gets a blocked row that says so.'
   ),
   'Every grid property has a row for this reader dated this run: an ok/warn row per recorded domain with its status code and latency, or a blocked row naming why no domain could be probed. A run that wrote zero rows is a FAILURE, never a quiet day.',
   0),
  ('duty_property_gsc',
   'What Search Console saw last week, per property',
   'emp_research', 'ops',
   7, 0, 'America/Chicago', 'weekly', 1,
   0,
   'worker', 'research',
   'What Search Console saw last week, per property',
   json_object(
     'worker_reader', 'gsc',
     'delivers', 'property_health_readings',
     'why_worker',
     'GSC_SERVICE_ACCOUNT_JSON is bound to the Worker (synced 19 Sep 2026) and every Search Console property is shared with the service account directly, so the Worker reads seven days of clicks and impressions per domain under webmasters.readonly. Weekly, because Search Console lags two to three days and a daily number is yesterday''s weather.'
   ),
   'Every grid property has a row for this reader dated this run: clicks and impressions for the last seven days per readable domain, or a blocked row naming the domain the service account is not a user on, or the missing key. Zero rows written is a FAILURE.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0263_boss_every_property_has_its_readers');
