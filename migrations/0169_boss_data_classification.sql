-- Batch 1 of Boss OS v20.1 — the classification model the airlock is built on.
--
-- THE GOVERNING REQUIREMENT, from the Sovereign Sync plan §3: data designated LOCAL_ONLY must
-- never reach Claude, OpenAI, OpenRouter, Fireworks, Workers AI or any other external inference
-- provider, and must never enter cloud D1, R2, queues, exports, snapshots or the Firm OS bridge.
-- "This must be enforced technically, not merely by prompt wording or an approval card."
--
-- TWO INDEPENDENT AXES, because they are different questions (§3.1, §3.2). Where a record may
-- LIVE is not the same as what may THINK about it: a meeting capture may legitimately sync to a
-- device the owner controls while still never being sent to a hosted model.
--
-- WHY A REGISTRY AND NOT TWO COLUMNS ON 112 TABLES. Columns would mean touching every table in
-- the system to say something most of them say identically, and would leave the answer scattered
-- across 112 places when the airlock needs it in one. The registry is the single place that can
-- answer "may this leave?" for any entity, which is what makes the guard writable at all.
--
-- UNKNOWN IS NOT A GAP, IT IS A REFUSAL. An entity with no row here classifies as LOCAL_ONLY on
-- both axes and is refused, per §11 "Unknown classification". A validator fails the build when a
-- Boss table has no policy row, so a new table cannot arrive unclassified and be quietly trusted.
--
-- CLASSIFIED BEFORE ANY LOCAL-ONLY DATA EXISTED IN THE CLOUD. Production D1 was created empty on
-- 5 Sep 2026 and holds one day record. Residency is being declared while the answer is still free.

CREATE TABLE data_policy (
  entity        TEXT PRIMARY KEY,
  subsystem     TEXT NOT NULL,
  residency     TEXT NOT NULL CHECK (residency IN ('CLOUD_SYNC','LOCAL_ONLY')),
  ai_processing TEXT NOT NULL CHECK (ai_processing IN ('EXTERNAL_OK','EXTERNAL_WITH_APPROVAL','LOCAL_ONLY')),
  reason        TEXT NOT NULL,
  set_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  set_by        TEXT NOT NULL DEFAULT 'migration'
);

-- A single record may be tightened below its entity default; it may never be loosened above it.
-- The narrowing rule is enforced in the guard, which is the only writer.
CREATE TABLE record_policy (
  entity        TEXT NOT NULL,
  record_id     TEXT NOT NULL,
  residency     TEXT CHECK (residency IN ('CLOUD_SYNC','LOCAL_ONLY')),
  ai_processing TEXT CHECK (ai_processing IN ('EXTERNAL_OK','EXTERNAL_WITH_APPROVAL','LOCAL_ONLY')),
  reason        TEXT NOT NULL,
  set_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  set_by        TEXT NOT NULL,
  PRIMARY KEY (entity, record_id)
);

-- §2.4: a change to an accepted classification leaves an audit record. Silent reclassification is
-- how revoked access comes back.
CREATE TABLE policy_change_log (
  id            TEXT PRIMARY KEY,
  entity        TEXT NOT NULL,
  record_id     TEXT,
  from_residency TEXT,
  to_residency   TEXT,
  from_ai        TEXT,
  to_ai          TEXT,
  reason         TEXT NOT NULL,
  changed_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  changed_by     TEXT NOT NULL
);

CREATE INDEX idx_record_policy_entity ON record_policy (entity);
CREATE INDEX idx_policy_change_entity ON policy_change_log (entity, changed_at);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('data_policy', 'classification', 'CLOUD_SYNC', 'EXTERNAL_OK', 'The registry itself. It MUST reach both domains: a private device that cannot read the policy cannot enforce it, and an airlock only one side knows about is not an airlock. It holds entity names and reasons, never records.'),
  ('record_policy', 'classification', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Per-record tightenings. Syncs for the same reason as the registry, and carries an entity, an id and a reason - never the record it points at.'),
  ('policy_change_log', 'classification', 'CLOUD_SYNC', 'EXTERNAL_OK', 'The audit of reclassification (§2.4). It must survive on both sides, because a change nobody can see on the device is how revoked access comes back.'),
  ('active_defaults', 'capability_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('after_action_reviews', 'capability_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('agent_need_assessments', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('agent_proposals', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('ancestor_entries', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Spirit OS: the owners inner life, written for one reader.'),
  ('approval_events', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('approvals', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('astro_calendar', 'spirit', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('astro_days', 'spirit', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('audit_log', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('bench_candidates', 'capability_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('boss_task_queue', 'task_queue', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('brand_profiles', 'governance', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('bridge_handoffs', 'firm_bridge', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('budgets', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('calibrations', 'investor_wealth', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Decision and Prediction vaults: reasoning and calibration about live judgement.'),
  ('capabilities', 'capability_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('capability_patches', 'capability_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('capital_allocations', 'investor_wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('compliance_flags', 'governance', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('contributions', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Spirit OS: the owners inner life, written for one reader.'),
  ('cron_runs', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('day_flow_blocks', 'executive_os', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('days', 'executive_os', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('dead_letters', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('deals', 'investor_wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('decision_rights', 'governance', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('decisions', 'investor_wealth', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Decision and Prediction vaults: reasoning and calibration about live judgement.'),
  ('deployment_stages', 'quant_fund', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('discovery_inbox', 'capability_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('document_artifacts', 'runtimes', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('dream_entries', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Spirit OS: the owners inner life, written for one reader.'),
  ('emotional_states', 'governance', 'LOCAL_ONLY', 'LOCAL_ONLY', 'The emotional-state gates own record. It exists to protect the owner, not to be read elsewhere.'),
  ('employee_reviews', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('employees', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('entities', 'investor_wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('evidence_packets', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('failure_playbooks', 'governance', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('follow_ups', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('gate_entries', 'executive_os', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('geo_probes', 'runtimes', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('ip_assets', 'governance', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('kill_switch_probes', 'quant_fund', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('knowledge_exports', 'knowledge_os', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('knowledge_items', 'knowledge_os', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('knowledge_retirements', 'knowledge_os', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('knowledge_surfaces', 'knowledge_os', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('lanes', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('learning_entries', 'governance', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Personal learning journal.'),
  ('lps', 'investor_wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('maintenance_items', 'governance', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('manifestation_evidence', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Spirit OS: the owners inner life, written for one reader.'),
  ('manifestations', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Spirit OS: the owners inner life, written for one reader.'),
  ('manual_versions', 'knowledge_os', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('mastery_lenses', 'prompt_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('meeting_briefs', 'relationships', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Relationship notes and meeting captures: what was said about people, in confidence.'),
  ('meeting_captures', 'relationships', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Relationship notes and meeting captures: what was said about people, in confidence.'),
  ('meetings', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('memory_items', 'init', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Promoted memory. Tier is a per-record judgement, so the default protects and the exception is explicit.'),
  ('model_benchmarks', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('models', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('open_loops', 'executive_os', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('opportunities', 'investor_wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('organizations', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('people', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('permission_envelopes', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('portfolio_vehicles', 'investor_wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('pov_cards', 'prompt_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('predictions', 'investor_wealth', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Decision and Prediction vaults: reasoning and calibration about live judgement.'),
  ('promotion_events', 'init', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Promoted memory. Tier is a per-record judgement, so the default protects and the exception is explicit.'),
  ('promotion_rules', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('promotion_scorecards', 'quant_fund', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('prompt_library', 'prompt_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('prompt_packets', 'prompt_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('prompt_scores', 'prompt_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('prompt_traces', 'prompt_intelligence', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('providers', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('red_team_reviews', 'investor_wealth', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Decision and Prediction vaults: reasoning and calibration about live judgement.'),
  ('relationships', 'relationships', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Relationship notes and meeting captures: what was said about people, in confidence.'),
  ('ritual_runs', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Spirit OS: the owners inner life, written for one reader.'),
  ('rituals', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Spirit OS: the owners inner life, written for one reader.'),
  ('routes', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('routing_decisions', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('runtime_jobs', 'runtimes', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('scale_rungs', 'quant_fund', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('seo_audits', 'runtimes', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('settings', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('sovereignty_drills', 'continuity', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('sovereignty_packages', 'continuity', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('strategy_desks', 'quant_fund', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('system_events', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('task_events', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('task_templates', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('tasks', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('theses', 'investor_wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('trading_accounts', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_authority', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_engines', 'quant_fund', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_fills', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_incidents', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_nevers', 'quant_fund', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_orders', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_positions', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_sequence', 'quant_fund', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_signals', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('trading_strategies', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('usage_ledger', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('vault_entries', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('vault_restores', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('vault_snapshots', 'init', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.'),
  ('wealth_tracks', 'investor_wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Operational, but names real people or real money: an external model sees it only with an approval on the record.'),
  ('workload_profiles', 'phase1_5', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery. Holds no personal content of its own.');

-- The chassis answers "what schema is applied" from this table.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0169_boss_data_classification');
