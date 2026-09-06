-- Boss OS v20 — Phase 20: the SEO/GEO and Document Compiler runtimes.
-- Canon §37, §38, §78.15, §78.8.
--
-- Both runtimes execute as governed work: a task with a classification and a
-- permission envelope, a capability resolved from the Phase 18 registry, and an
-- evidence packet on every terminal outcome. Neither produces a claim it cannot
-- show the working for.
--
-- This build has no network access. Anything that would need one — fetching a
-- live URL, reading a search result page, querying an index — is reported as
-- deferred rather than estimated, the same treatment Phase 16 gives the
-- ephemeris.

-- ─── runtime_jobs ──────────────────────────────────────────────────────────────
CREATE TABLE runtime_jobs (
  id                  TEXT PRIMARY KEY,
  runtime             TEXT NOT NULL,          -- document_compiler|seo_geo
  kind                TEXT NOT NULL,          -- what sort of run
  title               TEXT NOT NULL,
  input               TEXT NOT NULL,          -- json: exactly what it was given
  capability_id       TEXT REFERENCES capabilities(id),
  task_id             TEXT REFERENCES tasks(id),
  evidence_packet_id  TEXT REFERENCES evidence_packets(id),
  status              TEXT NOT NULL DEFAULT 'running', -- running|complete|failed
  started_at          INTEGER NOT NULL,
  finished_at         INTEGER,
  error               TEXT,
  deferred            TEXT,                   -- json: what needed a network and was not done
  created_at          INTEGER NOT NULL
);
CREATE INDEX idx_runtime_jobs ON runtime_jobs(runtime, started_at DESC);

-- ─── document_artifacts ────────────────────────────────────────────────────────
-- The compiler's output: a real file in R2, hashed per section and as a whole.
CREATE TABLE document_artifacts (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES runtime_jobs(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  format        TEXT NOT NULL DEFAULT 'markdown',
  r2_key        TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  sections      TEXT NOT NULL,          -- json: [{key, title, bytes, sha256, source}]
  manifest      TEXT NOT NULL,          -- json: the whole manifest, including what was absent
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_job ON document_artifacts(job_id);

-- ─── seo_audits ────────────────────────────────────────────────────────────────
-- Canon §37/§38. Every check names what it read and what it found; nothing here
-- reports a ranking, because nothing here can see one.
CREATE TABLE seo_audits (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES runtime_jobs(id) ON DELETE CASCADE,
  target        TEXT NOT NULL,          -- what was audited: a document id, or supplied text
  target_kind   TEXT NOT NULL,          -- artifact|text
  checks        TEXT NOT NULL,          -- json: [{key, observed, pass, evidence}]
  findings      TEXT NOT NULL,          -- json: [{severity, text, fix}]
  score         INTEGER NOT NULL DEFAULT 0,
  max_score     INTEGER NOT NULL DEFAULT 0,
  deferred      TEXT NOT NULL,          -- json: checks that need a network
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_seo_job ON seo_audits(job_id);

-- ─── geo_probes ────────────────────────────────────────────────────────────────
-- Generative-engine readiness: for each question a reader might ask, is the
-- answer actually present in the text, and is it attributable?
CREATE TABLE geo_probes (
  id            TEXT PRIMARY KEY,
  audit_id      TEXT NOT NULL REFERENCES seo_audits(id) ON DELETE CASCADE,
  question      TEXT NOT NULL,
  answered      INTEGER NOT NULL DEFAULT 0,
  excerpt       TEXT,
  attributable  INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_probes_audit ON geo_probes(audit_id);

-- ─── The two runtimes as capability packages ───────────────────────────────────
-- Canon §78.15: a runtime is a capability like any other, and §78.8 says the
-- current default is reviewable rather than doctrine.
INSERT INTO capabilities
  (id, key, name, category, job_type, summary, how_it_works, inputs, outputs, dependencies,
   cost_model, latency_profile, risk_class, privacy_class, criticality, maturity,
   benchmark_score, benchmark_note, limits, failure_modes, evidence, status, version, created_at, updated_at)
VALUES
  ('cap_document_compiler', 'document_compiler', 'Document Compiler Mode', 'workflow', 'drafting',
   'Compiles a structured document from named sources into a hashed artifact with a manifest.',
   'Runs as a governed task, assembles sections from real rows and supplied text, writes the file to R2 and records a per-section manifest.',
   '["document kind","sections","sources"]', '["artifact in R2","manifest","evidence packet"]',
   '["R2 vault binding","capability registry"]',
   'Free; assembly only, no inference.', 'Milliseconds.',
   'low', 'private', 'standard', 'proven', NULL,
   'Deterministic: the same inputs produce the same hash.',
   '["Does not write prose for you — it assembles what exists","No network access, so nothing external is fetched"]',
   '["A section with no source is recorded as absent rather than filled"]',
   '["src/server/runtimes/compiler.ts","test/runtimes.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_seo_geo', 'seo_geo_runtime', 'SEO/GEO runtime', 'tool', 'research',
   'Audits supplied content for search and generative-engine readiness, and produces evidence rather than a claim.',
   'Static checks over the text plus answerability probes; anything needing a live fetch is reported as deferred.',
   '["text or artifact","questions"]', '["audit with per-check evidence","probes","evidence packet"]',
   '["capability registry"]',
   'Free; static analysis only.', 'Milliseconds.',
   'low', 'private', 'standard', 'proven', NULL,
   'Checks are deterministic and each names what it read.',
   '["No network: rankings, indexation and competitor data cannot be observed here","Reports readiness, never position"]',
   '["Treating a static score as a ranking prediction"]',
   '["src/server/runtimes/seo.ts","test/runtimes.test.ts"]', 'benched', 1, unixepoch() * 1000, unixepoch() * 1000);

-- Document Compiler Mode becomes the active default for drafting, and the
-- packet compiler it replaces goes to the bench rather than away. Canon §78.8:
-- this is the current default, reviewable, not permanent doctrine.
UPDATE active_defaults
   SET previous_capability_id = capability_id,
       capability_id = 'cap_document_compiler',
       reason = 'Canon §78.8: Document Compiler Mode is the current default for drafting. It is reviewable, not doctrine — the packet compiler is benched, not retired.',
       set_by = 'system',
       set_at = unixepoch() * 1000
 WHERE job_type = 'drafting';

UPDATE capabilities SET status = 'benched' WHERE key = 'prompt_compiler';

INSERT INTO bench_candidates (id, job_type, capability_id, status, note, benched_at) VALUES
  ('bch_prompt_drafting', 'drafting', 'cap_prompt_compiler', 'benched',
   'Replaced as the drafting default when Document Compiler Mode became current. Still the right tool for a rough request.',
   unixepoch() * 1000),
  ('bch_seo_research', 'research', 'cap_seo_geo', 'benched',
   'The SEO/GEO runtime is a research alternative, benched rather than made the default for all research.',
   unixepoch() * 1000);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0164_boss_runtimes');
