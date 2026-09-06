-- Boss OS v20 — Phase 17: Prompt Intelligence and the Mastery Lens Bench.
-- Canon §76.1–76.21. Roadmap PI-1→PI-10.
--
-- The lens record carries nineteen content fields, as canon §76.10 specifies a
-- nineteen-field schema. Canon's exact field names are not reproduced in any
-- authority document available to this build, so the nineteen below are derived
-- from the requirements that *are* stated — the No Pedestal Law, counter-lenses,
-- tier eligibility, categories, failure modes — rather than guessed at. `id`,
-- `created_at` and `updated_at` are bookkeeping and are not among the nineteen.
--
-- §76.8, the No Pedestal Law, is enforced rather than described: a lens is a
-- method with an origin discipline, never a person. There is no field to put a
-- name in, and the API refuses one.

-- ─── mastery_lenses ────────────────────────────────────────────────────────────
CREATE TABLE mastery_lenses (
  id                TEXT PRIMARY KEY,
  -- 1–19, the schema proper
  key               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,
  summary           TEXT NOT NULL,
  method            TEXT NOT NULL,          -- json: ordered steps
  questions         TEXT NOT NULL,          -- json: what it asks of the work
  moves             TEXT NOT NULL,          -- json: what it changes in a prompt
  failure_modes     TEXT NOT NULL,          -- json: how this lens goes wrong
  counter_lens_key  TEXT,                   -- the lens that argues with it
  best_for          TEXT NOT NULL,          -- json: task kinds
  avoid_for         TEXT NOT NULL,          -- json: task kinds
  tier_minimum      INTEGER NOT NULL DEFAULT 3, -- eligible from this enhancement level
  risk_posture      TEXT NOT NULL DEFAULT 'balanced', -- conservative|balanced|aggressive
  evidence_required INTEGER NOT NULL DEFAULT 0,
  output_shape      TEXT NOT NULL,          -- what a finished answer must contain
  origin            TEXT NOT NULL,          -- the discipline, never a person
  status            TEXT NOT NULL DEFAULT 'active', -- draft|active|retired
  review_note       TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  -- bookkeeping
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_lenses_category ON mastery_lenses(category, status);

-- ─── pov_cards ─────────────────────────────────────────────────────────────────
-- A point of view is a stake, not a celebrity. Each card is somebody who has
-- something to lose by the answer being wrong.
CREATE TABLE pov_cards (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  stance        TEXT NOT NULL,
  wants         TEXT NOT NULL,              -- json
  fears         TEXT NOT NULL,              -- json
  questions     TEXT NOT NULL,              -- json
  tier_minimum  INTEGER NOT NULL DEFAULT 2,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL
);

-- ─── prompt_packets ────────────────────────────────────────────────────────────
-- A compiled packet: the rough request, what fired, what was stacked on it, and
-- the prompt that came out.
CREATE TABLE prompt_packets (
  id                TEXT PRIMARY KEY,
  request           TEXT NOT NULL,
  task_kind         TEXT,
  sensitivity       TEXT NOT NULL DEFAULT 'private',
  tier              INTEGER NOT NULL,       -- 1 = full treatment, 3 = light
  tier_reason       TEXT NOT NULL,
  triggers          TEXT NOT NULL,          -- json: which §76.3 triggers fired
  lens_stack        TEXT NOT NULL,          -- json: lens keys, in order
  counter_lens_key  TEXT,
  pov_card_keys     TEXT NOT NULL,          -- json
  adapter           TEXT NOT NULL,          -- backend the packet was compiled for
  sections          TEXT NOT NULL,          -- json: the structured packet
  compiled_prompt   TEXT NOT NULL,
  task_id           TEXT REFERENCES tasks(id),
  status            TEXT NOT NULL DEFAULT 'compiled', -- compiled|used|discarded
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_packets_created ON prompt_packets(created_at DESC);

-- ─── prompt_scores ─────────────────────────────────────────────────────────────
-- Scored on structure, deterministically, so two packets can be compared and a
-- score can be argued with.
CREATE TABLE prompt_scores (
  id            TEXT PRIMARY KEY,
  packet_id     TEXT NOT NULL REFERENCES prompt_packets(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  dimensions    TEXT NOT NULL,              -- json: [{key, points, max, why}]
  total         INTEGER NOT NULL,
  max_total     INTEGER NOT NULL,
  notes         TEXT,
  scored_by     TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX idx_scores_packet ON prompt_scores(packet_id, ts DESC);

-- ─── prompt_library ────────────────────────────────────────────────────────────
-- §76.17: nothing enters the library without review. `status` starts at
-- proposed and only an approved review moves it.
CREATE TABLE prompt_library (
  id            TEXT PRIMARY KEY,
  packet_id     TEXT REFERENCES prompt_packets(id),
  title         TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  task_kind     TEXT,
  tier          INTEGER NOT NULL,
  lens_stack    TEXT NOT NULL,              -- json
  status        TEXT NOT NULL DEFAULT 'proposed', -- proposed|approved|rejected|retired
  approval_id   TEXT REFERENCES approvals(id),
  review_note   TEXT,
  reviewed_at   INTEGER,
  uses          INTEGER NOT NULL DEFAULT 0,
  last_used_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_library_status ON prompt_library(status, created_at DESC);

-- ─── prompt_traces ─────────────────────────────────────────────────────────────
-- The trace points at the existing ledgers rather than duplicating them: one
-- row joins a packet to the routing decision and the usage row it produced.
CREATE TABLE prompt_traces (
  id                    TEXT PRIMARY KEY,
  packet_id             TEXT NOT NULL REFERENCES prompt_packets(id) ON DELETE CASCADE,
  task_id               TEXT REFERENCES tasks(id),
  routing_decision_id   TEXT REFERENCES routing_decisions(id),
  usage_ledger_id       TEXT REFERENCES usage_ledger(id),
  library_id            TEXT REFERENCES prompt_library(id),
  ts                    INTEGER NOT NULL,
  note                  TEXT
);
CREATE INDEX idx_traces_packet ON prompt_traces(packet_id, ts DESC);

-- ─── The initial bench ─────────────────────────────────────────────────────────
-- Eighteen lenses, inside canon's 15–20, each named for its method. Canon
-- §76.11's category list is not reproduced in any authority document available
-- to this build, so the categories below name the discipline each method comes
-- from.
INSERT INTO mastery_lenses
  (id, key, name, category, summary, method, questions, moves, failure_modes, counter_lens_key,
   best_for, avoid_for, tier_minimum, risk_posture, evidence_required, output_shape, origin, status, review_note, version, created_at, updated_at)
VALUES
  ('lns_first_principles', 'first_principles', 'First Principles Decomposition', 'analysis',
   'Strip the request to the constraints that are actually true, then rebuild from them.',
   '["List every assumption the request carries","Mark each as physical, contractual, or habitual","Delete the habitual ones","Rebuild the answer from what remains"]',
   '["What is actually forbidden here, rather than merely unusual?","Which constraint is real and which is inherited?"]',
   '["Adds an explicit assumptions section","Requires the answer to name which constraints bind"]',
   '["Reinvents solved problems","Discards conventions that encoded real experience"]',
   'base_rates',
   '["strategy","engineering","product","research"]', '["routine drafting","formatting"]',
   2, 'balanced', 0,
   'An assumptions list, then an answer that follows from it.',
   'Engineering and analytic philosophy method.', 'active', 'Bench default for design work.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_inversion', 'inversion', 'Inversion', 'risk',
   'Ask how this fails, and work backwards from the failure.',
   '["State the outcome to avoid","List the paths that lead there","Rank them by likelihood times damage","Design against the top two"]',
   '["What would guarantee this goes wrong?","Which of those is already true?"]',
   '["Adds a failure-path section","Requires at least one mitigation per named path"]',
   '["Turns every answer into a risk register","Freezes reversible decisions"]',
   'minimum_viable_answer',
   '["decision_support","risk","trading","investment"]', '["creative drafting"]',
   2, 'conservative', 0,
   'Failure paths with mitigations, then the recommendation.',
   'Safety engineering and pre-mortem practice.', 'active', 'Pairs with reversibility on one-way doors.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_base_rates', 'base_rates', 'Reference Class', 'analysis',
   'Compare the case to the class it belongs to before believing anything specific about it.',
   '["Name the reference class","State its base rate","State why this case would differ","Adjust from the base rate, not from zero"]',
   '["How often does this work for cases like this?","What makes this one different, specifically?"]',
   '["Requires a stated base rate","Forces the specific-case argument to be explicit"]',
   '["Buries a genuinely novel case in an average","Uses a class that does not fit"]',
   'first_principles',
   '["forecasting","investment","planning","research"]', '["novel systems with no class"]',
   2, 'conservative', 1,
   'Base rate, adjustment, and the reason for the adjustment.',
   'Forecasting and actuarial practice.', 'active', 'Required on anything with a probability in it.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_falsification', 'falsification', 'Falsification', 'research',
   'State in advance what would prove the answer wrong.',
   '["Write the claim as a testable statement","Name the observation that would refute it","Say when that observation could be made"]',
   '["What would change your mind?","When will we know?"]',
   '["Adds a refutation clause to every claim","Requires a date or an event"]',
   '["Refuses to answer without a clean test","Treats unfalsifiable but useful judgement as worthless"]',
   'evidence_chain',
   '["research","strategy","investment","forecasting"]', '["style","formatting"]',
   2, 'balanced', 1,
   'Claim, refuting observation, and when it can be checked.',
   'Scientific method.', 'active', 'Pairs with the Prediction Vault.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_constraint_mapping', 'constraint_mapping', 'Binding Constraint', 'systems',
   'Find the one constraint that actually limits the outcome and address it.',
   '["List the constraints","Estimate slack in each","Name the binding one","Check that the plan moves that one"]',
   '["Which constraint is actually binding?","Does this plan touch it at all?"]',
   '["Requires the plan to name the constraint it relieves"]',
   '["Misidentifies the constraint and optimises the wrong thing"]',
   'second_order',
   '["operations","engineering","planning"]', '["writing"]',
   2, 'balanced', 0,
   'The binding constraint, and how the answer relieves it.',
   'Operations research and the theory of constraints.', 'active', 'Cheapest lens for planning work.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_second_order', 'second_order', 'Second-Order Effects', 'systems',
   'Trace what happens after the obvious consequence.',
   '["State the first-order effect","Ask what that causes","Ask who reacts, and how","Stop at the third order or the first unknown"]',
   '["And then what?","Who changes their behaviour because of this?"]',
   '["Adds a consequences chain","Requires reactions from other parties to be named"]',
   '["Speculates past the evidence","Paralyses simple decisions"]',
   'minimum_viable_answer',
   '["strategy","policy","product","decision_support"]', '["mechanical tasks"]',
   1, 'balanced', 0,
   'A consequence chain with the point where it becomes speculation marked.',
   'Systems thinking.', 'active', 'Tier-1 default for strategy.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_cost_of_being_wrong', 'cost_of_being_wrong', 'Cost of Being Wrong', 'risk',
   'Size the downside before arguing about the upside.',
   '["State the loss if this is wrong","State who bears it","Compare it to the gain if right","Decide whether the asymmetry justifies the move"]',
   '["What does being wrong cost, in what currency?","Is the downside survivable?"]',
   '["Requires an explicit downside figure or bound"]',
   '["Refuses positive-expectancy bets with survivable losses"]',
   'reversibility',
   '["investment","trading","legal","health"]', '["low-stakes drafting"]',
   1, 'conservative', 0,
   'Downside, upside, and the asymmetry stated plainly.',
   'Decision analysis and risk management.', 'active', 'Mandatory on financial work.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_audience_stake', 'audience_stake', 'Audience Stake', 'communication',
   'Write for what the reader risks, not for what the writer knows.',
   '["Name the reader","Name what they lose if this is wrong","Lead with what they need to decide","Cut what only flatters the writer"]',
   '["What does the reader have at stake?","What will they do with this?"]',
   '["Reorders the answer around the reader''s decision"]',
   '["Over-simplifies for an expert audience"]',
   'plain_language',
   '["outbound_email","investor_materials","marketing","documentation"]', '["internal scratch work"]',
   2, 'balanced', 0,
   'The decision the reader faces, then what they need to make it.',
   'Technical writing and negotiation practice.', 'active', 'Automatic on outbound work.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_plain_language', 'plain_language', 'Plain Language', 'writing',
   'Say it in the fewest words that keep it true.',
   '["Delete hedges","Replace jargon with the thing it names","Shorten sentences that carry two ideas","Re-read for what was lost"]',
   '["Would a competent outsider understand this?","What did the hedging hide?"]',
   '["Requires jargon to be defined or removed","Bans throat-clearing openings"]',
   '["Flattens necessary precision","Loses domain terms that are exact"]',
   'evidence_chain',
   '["outbound_email","documentation","marketing"]', '["legal drafting","specifications"]',
   3, 'balanced', 0,
   'The same claim, shorter, with nothing true removed.',
   'Editorial practice.', 'active', 'Cheapest useful lens; eligible at every tier.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_evidence_chain', 'evidence_chain', 'Evidence Chain', 'research',
   'Every claim carries where it came from.',
   '["Mark each claim as observed, cited, or inferred","Attach the source to the cited ones","Mark the inferred ones as inference","Delete claims that are none of the three"]',
   '["Where did this come from?","Is that a source or a memory?"]',
   '["Requires inline provenance","Forbids unsourced confident claims"]',
   '["Slows fast work","Cites for the sake of citing"]',
   'minimum_viable_answer',
   '["research","legal","investor_materials","repo_work"]', '["brainstorming"]',
   2, 'conservative', 1,
   'Claims with provenance, and inferences labelled as inferences.',
   'Research and audit practice.', 'active', 'Required whenever the output leaves the building.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_output_contract', 'output_contract', 'Output Contract', 'product',
   'Define what a finished answer contains before writing one.',
   '["List the sections a complete answer has","State the format","State what completion looks like","Check the draft against the list"]',
   '["What does done look like?","Which section is missing?"]',
   '["Adds an explicit output contract to the packet"]',
   '["Produces box-ticking answers that meet the shape and miss the point"]',
   'minimum_viable_answer',
   '["repo_work","documentation","research","reporting"]', '["open-ended thinking"]',
   3, 'balanced', 0,
   'A named set of sections, each filled or explicitly marked absent.',
   'Specification and contract-first engineering.', 'active', 'Eligible at every tier; nearly free.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_minimum_viable_answer', 'minimum_viable_answer', 'Minimum Viable Answer', 'product',
   'Give the smallest answer that is actually useful, then offer depth.',
   '["Answer the question in three sentences","Mark what was left out","Offer the depth as an option"]',
   '["What is the answer, before the reasoning?","What can be cut without losing the decision?"]',
   '["Forces a lead answer before the analysis"]',
   '["Under-serves genuinely complex questions"]',
   'output_contract',
   '["operations","support","drafting"]', '["legal","investment analysis"]',
   3, 'aggressive', 0,
   'A short answer first, depth after it.',
   'Editorial and support practice.', 'active', 'The counterweight to every heavy lens.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_adversarial_review', 'adversarial_review', 'Adversarial Review', 'decision',
   'Argue the strongest opposing case before committing to this one.',
   '["Write the best case against","Find the strongest evidence for it","Answer it or concede it","State what survived"]',
   '["What would a competent opponent say?","Which of their points is right?"]',
   '["Adds an opposing-case section that must be answered"]',
   '["Manufactures false balance","Delays decisions that are already clear"]',
   'audience_stake',
   '["investment","strategy","legal","decision_support"]', '["routine tasks"]',
   1, 'conservative', 1,
   'The opposing case, the answer to it, and what remains standing.',
   'Legal advocacy and red-team practice.', 'active', 'Tier-1 default; pairs with the Phase 14 red team.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_reversibility', 'reversibility', 'Reversibility', 'decision',
   'Separate the doors that swing both ways from the ones that do not.',
   '["Classify the decision as reversible or not","Price the cost of reversal","Match the process to the class"]',
   '["Can this be undone, and at what cost?","Are we deliberating a two-way door?"]',
   '["Requires the decision class to be stated"]',
   '["Treats expensive reversals as free"]',
   'cost_of_being_wrong',
   '["decision_support","investment","engineering"]', '["writing"]',
   2, 'balanced', 0,
   'The decision class, the reversal cost, and the matching process.',
   'Decision analysis.', 'active', 'Pairs with cost of being wrong.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_unit_economics', 'unit_economics', 'Unit Economics', 'finance',
   'Reduce the argument to money per unit of the thing.',
   '["Define the unit","State revenue and cost per unit","State the fixed cost it must carry","Show the break-even"]',
   '["What does one of these earn and cost?","How many before this works?"]',
   '["Requires per-unit figures rather than totals"]',
   '["Ignores strategic value that does not appear per unit"]',
   'audience_stake',
   '["investment","pricing","product","trading"]', '["creative work"]',
   2, 'conservative', 1,
   'Per-unit economics and a break-even.',
   'Managerial accounting.', 'active', 'Automatic on pricing and deal work.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_failure_replay', 'failure_replay', 'Failure Replay', 'systems',
   'Recall how this exact thing failed before, from the record rather than from memory.',
   '["Search the failed-experiment record","Name the closest prior failure","State what is different this time","Carry forward the mitigation"]',
   '["Have we done this before?","What broke last time?"]',
   '["Requires a prior-failure section, even if it says none is on file"]',
   '["Over-fits to one bad experience"]',
   'first_principles',
   '["engineering","operations","repo_work","product"]', '["genuinely novel work"]',
   2, 'conservative', 1,
   'The closest prior failure and what is different now.',
   'Incident review practice.', 'active', 'Reads the Phase 15 failed-experiments surface.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_scope_fence', 'scope_fence', 'Scope Fence', 'engineering',
   'State what is deliberately out of scope, so silence is not mistaken for coverage.',
   '["List what is in scope","List what is out and why","Name what would move something across the line"]',
   '["What is this not doing?","What will someone assume was covered?"]',
   '["Adds an explicit out-of-scope section"]',
   '["Fences so tightly the work stops being useful"]',
   'second_order',
   '["repo_work","engineering","documentation","legal"]', '["exploratory work"]',
   3, 'balanced', 0,
   'In scope, out of scope, and the boundary condition.',
   'Specification practice.', 'active', 'Nearly free; eligible at every tier.', 1, unixepoch() * 1000, unixepoch() * 1000),

  ('lns_legal_exposure', 'legal_exposure', 'Legal Exposure', 'ethics',
   'Flag the claims that create obligations or liability, before they are made.',
   '["Mark claims that promise an outcome","Mark claims about other parties","Mark anything that reads as advice","Soften, source, or cut each one"]',
   '["Does this promise something we cannot guarantee?","Would this be read as professional advice?"]',
   '["Requires liability-bearing claims to be marked and handled"]',
   '["Hedges everything into uselessness"]',
   'plain_language',
   '["legal","marketing","outbound_email","investor_materials"]', '["internal notes"]',
   1, 'conservative', 1,
   'Marked claims, each softened, sourced or cut.',
   'Compliance review practice.', 'active', 'Automatic on legal-adjacent and outbound work.', 1, unixepoch() * 1000, unixepoch() * 1000);

-- ─── Points of view ────────────────────────────────────────────────────────────
INSERT INTO pov_cards (id, key, name, stance, wants, fears, questions, tier_minimum, status, created_at) VALUES
  ('pov_buyer', 'buyer', 'The person paying', 'Holds the money and the alternative options.',
   '["A reason to choose this","A price that makes sense"]', '["Being sold to","Hidden cost"]',
   '["What does this cost me, all in?","What happens if I do nothing?"]', 2, 'active', unixepoch() * 1000),
  ('pov_skeptic', 'skeptic', 'The informed skeptic', 'Believes the claim is probably overstated.',
   '["Evidence","Numbers with sources"]', '["Being fooled","Sounding credulous"]',
   '["What is the weakest link here?","Which number is doing all the work?"]', 1, 'active', unixepoch() * 1000),
  ('pov_operator', 'operator', 'The person who has to run it', 'Will live with the consequences daily.',
   '["Something maintainable","Clear failure handling"]', '["Being on call for someone else''s shortcut"]',
   '["Who fixes this at 3am?","What breaks first?"]', 2, 'active', unixepoch() * 1000),
  ('pov_regulator', 'regulator', 'The rule-bound reviewer', 'Cares only whether it is defensible.',
   '["Documented reasoning","Traceable decisions"]', '["Undisclosed conflicts","Missing records"]',
   '["Where is this written down?","Who approved it?"]', 1, 'active', unixepoch() * 1000),
  ('pov_successor', 'successor', 'The person who inherits this in a year', 'Was not in the room.',
   '["Context","The reason, not just the rule"]', '["Undocumented decisions"]',
   '["Why was it done this way?","What was tried and rejected?"]', 2, 'active', unixepoch() * 1000),
  ('pov_future_self', 'future_self', 'The Boss in six months', 'Will be judged by how this aged.',
   '["A decision that still looks sound","Recorded reasoning"]', '["Regret with no record of why"]',
   '["Will this look obvious or foolish later?","What did I know when I decided?"]', 1, 'active', unixepoch() * 1000);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0161_boss_prompt_intelligence');
