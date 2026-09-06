-- Boss OS v20 — Phase 18: Capability Intelligence.
-- Canon §78.1–78.20. Roadmap CI-1→CI-10, §79.6 for the discovery triggers.
--
-- The Capability Package carries twenty-two content fields, as canon §78.4
-- specifies a twenty-two-field schema. Canon's exact field names are not
-- reproduced in any authority document available to this build, so the
-- twenty-two below are derived from what the phase actually has to decide with
-- — what job it does, what it costs, what it risks, how mature it is, what it
-- cannot do, and where the claims come from. `id`, `created_at` and
-- `updated_at` are bookkeeping and are not among the twenty-two.
--
-- The rule the schema exists to keep: exactly one capability is active per job
-- type, alternatives sit on the bench, and nothing on the bench executes.

-- ─── capabilities ──────────────────────────────────────────────────────────────
CREATE TABLE capabilities (
  id                TEXT PRIMARY KEY,
  -- 1–22, the Capability Package proper
  key               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,          -- model|tool|service|workflow|human
  job_type          TEXT NOT NULL,          -- the job it does, from the canonical list
  summary           TEXT NOT NULL,
  how_it_works      TEXT NOT NULL,
  inputs            TEXT NOT NULL,          -- json
  outputs           TEXT NOT NULL,          -- json
  dependencies      TEXT NOT NULL,          -- json: what must exist for it to work
  cost_model        TEXT NOT NULL,
  latency_profile   TEXT NOT NULL,
  risk_class        TEXT NOT NULL DEFAULT 'low',      -- low|medium|high
  privacy_class     TEXT NOT NULL DEFAULT 'private',  -- public|internal|private|restricted
  criticality       TEXT NOT NULL DEFAULT 'standard', -- core|standard|experimental
  maturity          TEXT NOT NULL DEFAULT 'candidate',-- candidate|proven|deprecated
  benchmark_score   INTEGER,                -- 0–100, null until benchmarked
  benchmark_note    TEXT,
  limits            TEXT NOT NULL,          -- json: what it cannot do
  failure_modes     TEXT NOT NULL,          -- json: how it fails
  evidence          TEXT NOT NULL,          -- json: where these claims come from
  status            TEXT NOT NULL DEFAULT 'benched',  -- active|benched|retired
  version           INTEGER NOT NULL DEFAULT 1,
  -- bookkeeping
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_capabilities_job ON capabilities(job_type, status);

-- ─── active_defaults ───────────────────────────────────────────────────────────
-- One row per job type, and the primary key is what enforces it. A job type
-- cannot quietly have two things running it.
CREATE TABLE active_defaults (
  job_type                TEXT PRIMARY KEY,
  capability_id           TEXT NOT NULL REFERENCES capabilities(id),
  previous_capability_id  TEXT REFERENCES capabilities(id),
  reason                  TEXT NOT NULL,
  set_by                  TEXT NOT NULL DEFAULT 'boss',
  approval_id             TEXT REFERENCES approvals(id),
  set_at                  INTEGER NOT NULL
);

-- ─── bench_candidates ──────────────────────────────────────────────────────────
-- Alternatives, benched. Nothing here executes; that is the difference between
-- a bench and a rotation.
CREATE TABLE bench_candidates (
  id              TEXT PRIMARY KEY,
  job_type        TEXT NOT NULL,
  capability_id   TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'benched', -- benched|promoted|rejected
  benchmark_score INTEGER,
  note            TEXT,
  benched_at      INTEGER NOT NULL,
  decided_at      INTEGER
);
CREATE UNIQUE INDEX idx_bench_unique ON bench_candidates(job_type, capability_id);

-- ─── discovery_inbox ───────────────────────────────────────────────────────────
-- Search is trigger-based, per roadmap §79.6. A discovery with no trigger is
-- tool-chasing, and the API refuses it.
CREATE TABLE discovery_inbox (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  trigger_key   TEXT NOT NULL,              -- one of the nine
  job_type      TEXT,
  source        TEXT,
  link          TEXT,
  note          TEXT NOT NULL,
  evidence      TEXT,                       -- json: what fired the trigger
  status        TEXT NOT NULL DEFAULT 'new',-- new|reviewed|dismissed|actioned
  reviewed_at   INTEGER,
  review_note   TEXT
);
CREATE INDEX idx_discovery_status ON discovery_inbox(status, ts DESC);

-- ─── after_action_reviews ──────────────────────────────────────────────────────
-- Run against real task traces, never against impressions.
CREATE TABLE after_action_reviews (
  id                  TEXT PRIMARY KEY,
  ts                  INTEGER NOT NULL,
  job_type            TEXT NOT NULL,
  capability_id       TEXT REFERENCES capabilities(id),
  window_start        INTEGER NOT NULL,
  window_end          INTEGER NOT NULL,
  tasks_examined      INTEGER NOT NULL DEFAULT 0,
  failures            INTEGER NOT NULL DEFAULT 0,
  findings            TEXT NOT NULL,        -- json
  evidence            TEXT NOT NULL,        -- json: the task ids it read
  outcome             TEXT NOT NULL,        -- no_action|patch_proposed|discovery_raised
  patch_id            TEXT,
  discovery_id        TEXT REFERENCES discovery_inbox(id)
);
CREATE INDEX idx_aar_job ON after_action_reviews(job_type, ts DESC);

-- ─── capability_patches ────────────────────────────────────────────────────────
-- A change to a Capability Package. Core capabilities cannot be patched without
-- an approved review; everything else is applied and recorded.
CREATE TABLE capability_patches (
  id              TEXT PRIMARY KEY,
  capability_id   TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  ts              INTEGER NOT NULL,
  proposed_by     TEXT NOT NULL DEFAULT 'boss',
  changes         TEXT NOT NULL,            -- json: {field: new_value}
  reason          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'proposed', -- proposed|applied|rejected
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approval_id     TEXT REFERENCES approvals(id),
  applied_at      INTEGER,
  review_note     TEXT,
  review_id       TEXT REFERENCES after_action_reviews(id)
);
CREATE INDEX idx_patches_capability ON capability_patches(capability_id, ts DESC);

-- ─── The packages this build actually has ──────────────────────────────────────
-- Each of these describes a mechanism that exists in this repository. A
-- capability package for something the build does not have would be the exact
-- failure §78 exists to prevent: a registry that reads as coverage and is not.
INSERT INTO capabilities
  (id, key, name, category, job_type, summary, how_it_works, inputs, outputs, dependencies,
   cost_model, latency_profile, risk_class, privacy_class, criticality, maturity,
   benchmark_score, benchmark_note, limits, failure_modes, evidence, status, version, created_at, updated_at)
VALUES
  ('cap_task_queue', 'task_queue', 'Queued task execution', 'workflow', 'one_off',
   'Work is admitted by intake, given an envelope, and executed in the queue consumer.',
   'Intake classifies and writes a permission envelope; the consumer runs the task and files an evidence packet.',
   '["title","input","lane"]', '["task output","evidence packet"]', '["queue binding","permission envelope"]',
   'Model spend only, charged to the lane budget.', 'Seconds to minutes, asynchronous.',
   'medium', 'private', 'core', 'proven', NULL, 'Exercised end to end by the queue tests.',
   '["Never runs inside an HTTP handler","No outward capability without an approved payload"]',
   '["Message exhausts retries and lands in the dead-letter queue"]',
   '["src/server/queue/consumer.ts","test/intake.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_cron_scheduler', 'cron_scheduler', 'Nightly cron', 'workflow', 'recurring_duty',
   'The 03:00 UTC run: budgets, the day, follow-ups, the almanac, expiry, promotions, the snapshot.',
   'Each step is independent and recorded per step in cron_runs.',
   '["schedule"]', '["cron_runs row with per-step results"]', '["cron trigger"]',
   'Negligible.', 'Once a night.',
   'low', 'private', 'core', 'proven', NULL, 'Every step asserted in the hardening tests.',
   '["No sub-daily cadence in this build"]', '["A step fails and the run is recorded partial"]',
   '["src/server/index.ts","test/hardening.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_router_model', 'router_model', 'Routed model call', 'model', 'research',
   'The model router picks a backend under the envelope, the cost mode and the privacy class.',
   'Candidates are screened on tier, risk, benchmark status and privacy, then costed against the envelope before anything is called.',
   '["prompt","envelope","sensitivity"]', '["completion","routing_decisions row","usage_ledger row"]',
   '["provider key","models registry"]',
   'Per-token, recorded in usage_ledger.', 'Seconds.',
   'medium', 'cloud', 'core', 'proven', NULL, 'Routing and refusal paths covered by the router tests.',
   '["Restricted content cannot reach a cloud model without an approved routing card"]',
   '["No eligible model under the cost mode","Budget exhausted mid-run"]',
   '["src/server/router/index.ts","test/router.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_prompt_compiler', 'prompt_compiler', 'Prompt packet compiler', 'tool', 'drafting',
   'Compiles a rough request into a lens-stacked packet with a counter-lens and an output contract.',
   'Assembles from the Mastery Lens Bench; calls no model itself.',
   '["request","task kind","sensitivity"]', '["compiled packet","structural score"]', '["mastery_lenses"]',
   'Free; no inference.', 'Milliseconds.',
   'low', 'private', 'standard', 'proven', NULL, 'Deterministic; the same request compiles identically.',
   '["Does not write the answer, only the instruction"]', '["A request too vague to score above the floor"]',
   '["src/server/prompt/compile.ts","test/prompt.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_approval_inbox', 'approval_inbox', 'Approval inbox', 'workflow', 'approval_request',
   'Anything sensitive or irreversible waits here, and approving executes the origin action.',
   'Decision and execution are recorded separately; rejection and expiry terminate the origin symmetrically.',
   '["approval card","payload"]', '["execution result","approval_events"]', '["approvals table"]',
   'None.', 'As fast as the Boss decides.',
   'high', 'private', 'core', 'proven', NULL, 'Execution, rejection and expiry all covered.',
   '["Cannot execute anything the payload does not describe"]', '["An expired approval cancels its origin"]',
   '["src/server/approvals/execute.ts","test/approvals.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_promotion_gate', 'promotion_gate', 'Memory promotion gate', 'workflow', 'memory_promotion',
   'The one path from capture to durable memory, through an approval.',
   'The sweep proposes; approving applies the tier change; retirement removes an item from every surface.',
   '["memory item","target tier"]', '["promotion_events row","tier change"]', '["approvals"]',
   'None.', 'Immediate on decision.',
   'medium', 'private', 'core', 'proven', NULL, 'Covered by the memory and knowledge tests.',
   '["Nothing is created above capture","A retired memory cannot be promoted"]',
   '["A duplicate proposal is skipped rather than stacked"]',
   '["src/server/routes/memory.ts","test/memory.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_meeting_intelligence', 'meeting_intelligence', 'Meeting intelligence', 'workflow', 'relationship',
   'A brief before the room and a capture after it, with follow-ups that surface when due.',
   'Reads the relationship scores and history; the capture writes follow-ups and a memory promotion candidate.',
   '["meeting","notes","commitments"]', '["brief","capture","follow-ups"]', '["people","relationships"]',
   'None; no model is called.', 'Immediate.',
   'medium', 'private', 'standard', 'proven', NULL, 'Full sequence covered end to end.',
   '["Does not draft the message, only the dossier"]', '["A meeting with no relationship record scores nothing"]',
   '["src/server/relationships/brief.ts","test/relationships.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_decision_journal', 'decision_journal', 'Decision journal and prediction vault', 'workflow', 'decision_support',
   'A decision is challenged before commitment and carries a falsifiable prediction.',
   'Red team precommit, then commitment, then resolution feeding a real calibration score.',
   '["decision","options","prediction"]', '["committed decision","calibration"]', '["approvals for capital moves"]',
   'None.', 'Immediate.',
   'high', 'private', 'core', 'proven', NULL, 'Acceptance walked end to end in the investor tests.',
   '["Does not make the decision","Cannot commit without a challenge"]',
   '["An unresolved prediction quietly stops being scored — surfaced as due_for_resolution"]',
   '["src/server/routes/investor.ts","test/investor.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_paper_broker', 'paper_broker', 'Paper broker', 'service', 'trading',
   'Simulated execution with real fill, position, average-cost and realised-P&L mathematics.',
   'Orders pass the authority envelope at execution time, not only at draft time.',
   '["order","reference price"]', '["fill","position","realised P&L"]', '["trading authority envelope"]',
   'None.', 'Immediate.',
   'high', 'private', 'core', 'proven', NULL, 'The whole paper lifecycle is covered.',
   '["No live broker adapter exists; enabling live execution returns 501","No market data feed"]',
   '["Kill switch cancels open orders and files an incident"]',
   '["src/server/trading/broker.ts","test/trading.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_benchmark_bench', 'benchmark_bench', 'Model benchmark bench', 'tool', 'model_benchmark',
   'Records benchmark results against models, and gates routing on benchmark status.',
   'A model that has not been benchmarked cannot be chosen for work that requires one.',
   '["model","benchmark result"]', '["model_benchmarks row"]', '["models registry"]',
   'Whatever the benchmark run costs.', 'Minutes.',
   'low', 'private', 'standard', 'proven', NULL, 'No model in this build is marked benchmarked, on purpose.',
   '["Does not run the benchmark for you"]', '["An unbenchmarked model is simply not eligible"]',
   '["src/server/routes/models.ts","test/router.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_agent_gate', 'agent_gate', 'Agent creation gate', 'workflow', 'new_agent_proposal',
   'A new employee requires a completed need assessment and survives No Agent Sprawl.',
   'A proposal whose assessment resolves to an existing employee, template or duty is blocked.',
   '["need assessment","proposal"]', '["provisional employee","refusal with reason"]', '["approvals"]',
   'None.', 'Immediate.',
   'medium', 'private', 'core', 'proven', NULL, 'Sprawl refusal covered in the intake tests.',
   '["Cannot create an employee without an assessment"]', '["A duplicate role is refused rather than merged later"]',
   '["src/server/routes/intake.ts","test/intake.test.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_boss_judgement', 'boss_judgement', 'The Boss decides it', 'human', 'coaching',
   'Work the system will not pretend to do: the coaching faculty is Phase 12 and is not in this build.',
   'Intake assigns it to the Boss rather than routing it, and says why.',
   '["the question"]', '["a human answer"]', '[]',
   'The Boss''s time.', 'Human.',
   'low', 'private', 'standard', 'proven', NULL, 'Recorded absence, not a stub.',
   '["No coaching faculty exists in this build; nothing here generates advice"]',
   '["Answering anyway would be the failure"]',
   '["PHASES.md — Phase 11, absent inputs recorded as absent"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_repo_review', 'repo_review', 'Repository work under review', 'human', 'repository',
   'Repository changes are made and reviewed with the test suite as the gate.',
   'Typecheck, tests and build are the acceptance signal; nothing merges on assertion.',
   '["change"]', '["passing validation"]', '["npm run validate"]',
   'None.', 'Minutes.',
   'high', 'private', 'core', 'proven', NULL, 'The validation command is the benchmark.',
   '["No autonomous repo agent exists in this build"]', '["A change that typechecks and still breaks behaviour"]',
   '["package.json","PHASES.md"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_scheduled_check', 'scheduled_check', 'Scheduled check', 'workflow', 'scheduled_check',
   'A check that runs on the nightly cadence and records what it found.',
   'Runs as a cron step; a failing step is recorded rather than cancelling the rest.',
   '["check definition"]', '["cron_runs step result"]', '["cron trigger"]',
   'Negligible.', 'Nightly.',
   'low', 'private', 'standard', 'proven', NULL, 'Per-step records asserted in the hardening tests.',
   '["No sub-daily schedule"]', '["A silent check that never reports"]',
   '["src/server/index.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('cap_triggered_workflow', 'triggered_workflow', 'Triggered workflow', 'workflow', 'triggered_workflow',
   'Work raised by something that happened rather than by the Boss asking.',
   'A trigger writes a task through the same intake path, so it is classified and enveloped like any other.',
   '["trigger event"]', '["task"]', '["intake"]',
   'As the task costs.', 'Seconds.',
   'medium', 'private', 'standard', 'proven', NULL, 'Follow-up surfacing is the working example.',
   '["No general event bus; triggers are explicit code paths"]', '["A trigger that fires repeatedly on the same cause"]',
   '["src/server/relationships/follow_ups.ts"]', 'active', 1, unixepoch() * 1000, unixepoch() * 1000),

  -- Benched, not running. This is what an alternative looks like when it is not
  -- silently mixed into the runtime.
  ('cap_local_model', 'local_model', 'Local model inference', 'model', 'research',
   'Inference on a local runtime, keeping restricted content off the network entirely.',
   'Would be selected by the existing router as a private-class backend.',
   '["prompt","envelope"]', '["completion"]', '["local runtime","hardware profile"]',
   'Hardware and electricity.', 'Seconds to minutes.',
   'low', 'local', 'experimental', 'candidate', NULL,
   'Not benchmarked: no local runtime exists in this build.',
   '["No local runtime is installed; this is a candidate, not a capability"]',
   '["Silently falling back to cloud would defeat the reason for it"]',
   '["src/server/router/policy.ts — privacy class handling"]', 'benched', 1, unixepoch() * 1000, unixepoch() * 1000);

-- ─── The active defaults ───────────────────────────────────────────────────────
INSERT INTO active_defaults (job_type, capability_id, reason, set_by, set_at) VALUES
  ('one_off',             'cap_task_queue',           'Queued execution is the only path that carries an envelope.', 'system', unixepoch() * 1000),
  ('recurring_duty',      'cap_cron_scheduler',       'The nightly cron is the cadence this build has.', 'system', unixepoch() * 1000),
  ('scheduled_check',     'cap_scheduled_check',      'Checks run as recorded cron steps.', 'system', unixepoch() * 1000),
  ('triggered_workflow',  'cap_triggered_workflow',   'Triggers enter through intake like anything else.', 'system', unixepoch() * 1000),
  ('approval_request',    'cap_approval_inbox',       'One inbox, one gate.', 'system', unixepoch() * 1000),
  ('research',            'cap_router_model',         'Routed inference under the envelope and the cost mode.', 'system', unixepoch() * 1000),
  ('drafting',            'cap_prompt_compiler',      'Drafting starts with a compiled packet, then routes.', 'system', unixepoch() * 1000),
  ('coaching',            'cap_boss_judgement',       'The coaching faculty is Phase 12 and is not in this build.', 'system', unixepoch() * 1000),
  ('memory_promotion',    'cap_promotion_gate',       'Canon has one promotion gate.', 'system', unixepoch() * 1000),
  ('relationship',        'cap_meeting_intelligence', 'Brief before, capture after.', 'system', unixepoch() * 1000),
  ('decision_support',    'cap_decision_journal',     'Challenged before commitment, scored after.', 'system', unixepoch() * 1000),
  ('repository',          'cap_repo_review',          'The validation command is the gate.', 'system', unixepoch() * 1000),
  ('model_benchmark',     'cap_benchmark_bench',      'Routing is gated on benchmark status.', 'system', unixepoch() * 1000),
  ('trading',             'cap_paper_broker',         'Paper only; no live adapter exists.', 'system', unixepoch() * 1000),
  ('new_agent_proposal',  'cap_agent_gate',           'No agent without an assessment.', 'system', unixepoch() * 1000);

INSERT INTO bench_candidates (id, job_type, capability_id, status, note, benched_at) VALUES
  ('bch_local_research', 'research', 'cap_local_model', 'benched',
   'Kept on the bench precisely because it is not installed. Benching it is how the option stays visible without becoming runtime.',
   unixepoch() * 1000);

