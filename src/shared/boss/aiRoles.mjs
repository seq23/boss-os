/**
 * WHICH ENGINE DOES WHICH WORK — THE ONE MAP (owner, 3 Nov 2026: "after today we need to default
 * OpenAI and Claude just be the brains").
 *
 * From 4 Nov 2026 OpenAI Codex (the `codex` CLI on her ChatGPT plan; never the paid OpenAI API) does
 * the hands-on work of every Boss OS employee. Claude plans, decides, reviews and writes company
 * brains, and nothing else. Every runner that launches a model reads its role from HERE:
 *
 *   worker → `ai-run --role worker` (codex exec)      brain → `ai-run --role brain` (claude -p)
 *
 * A CODEX LIMIT NO LONGER WAITS (owner, 6 Nov 2026, replacing the 3 Nov rule): the work walks on to the
 * free tiers and the Claude seat (`afterCodexLimit` below). In the agent queue a Codex-limited job
 * waits on Codex's seat only when no Claude seat is ready to take it (`CODEX_LIMIT_WAITS` is that
 * last resort). Read by:
 *   scripts/ops/lib/ai-run.mjs        (runAs: the Mac runners' one launcher)
 *   scripts/ops/repo-change.mjs       (Danielle's repo changes, per phase)
 *   scripts/ops/ahrefs-audit-fix.sh   (duty_site_audit_repair and the Search Readiness passes)
 *   src/worker/boss/queue/consumer.ts (the agent queue's seat order) and scripts/sync-agent/agent.mjs
 *
 * Exceptions that stay on Claude are rows here with their reason, never an `if` in a runner.
 */

export const WORKER = "worker";
export const BRAIN = "brain";

/** ai-run's exit code for a Codex usage limit (EX_TEMPFAIL): the run waits for the reset. */
export const CODEX_LIMIT_EXIT = 75;

/** The last resort only: a Codex-limited job waits for the reset when no later rung (free, Claude seat) can run. */
export const CODEX_LIMIT_WAITS = true;

export const AI_ROLES = Object.freeze({
  // ── Danielle's repo-change lane (repo-change.sh → repo-change.mjs), one row per phase ─────────
  "repo_change.plan": { role: BRAIN, why: "Short planning and the plan email she approves: deciding what to build is a brain's job." },
  "repo_change.build": { role: WORKER, why: "Edits the worktree and runs the repo's validators: hands-on work." },
  "repo_change.land": { role: BRAIN, why: "Final-diff review before ~/bin/land; Codex's sandbox also cannot write the git metadata land needs." },

  // ── Danielle's weekly Ahrefs repairs (duty_site_audit_repair) and the Search Readiness passes ──
  "site_audit.mail_digest": { role: BRAIN, why: "Reads the week's Ahrefs mail through the claude.ai Gmail connector, which Codex cannot reach; read-only, it writes the digest the repair works from." },
  "site_audit.repair": { role: WORKER, why: "Crawls, edits her repos, runs validators and opens PRs: hands-on work." },

  // ── Mail readers on her Mac (claude.ai Gmail connector; Codex cannot reach it) ────────────────
  "kdp_surface": { role: BRAIN, why: "Reads Amazon's KDP mail through the claude.ai Gmail connector and classifies it for her: reading and summarising, no edits; Codex cannot reach the connector." },
  "mailbox_sweep": { role: BRAIN, why: "Reads her mailbox through the Gmail connector on the Claude seat, where the connector is available." },

  // ── The agent queue (com.seq.boss-agent*): duties parked for her Mac's seats ──────────────────
  "agent_queue.default": { role: WORKER, why: "An employee's duty run is hands-on work: Codex's seat goes first on every ladder that has it." },
  "agent_queue.chrome_job": { role: BRAIN, why: "Runs in her Chrome through Claude in Chrome; Codex has no browser (1 Nov 2026)." },

  // ── The weekly AI answers read (duty_ai_visibility → scripts/ops/ai-visibility.sh) ─────────────
  "ai_visibility.read": { role: BRAIN, jobClass: "short", why: "Reads OpenSEO's weekly AI answers through the openseo Claude plugin, which only a Claude session loads, locked to 9 read-only tools (ai-visibility-permissions.json); code recomputes every count it returns." },

  // ── Company brains ────────────────────────────────────────────────────────────────────────────
  // Owner, 13 Nov 2026: "recording can be a free model interpreting can be a more high quality model".
  // ── Noelle, the Growth Director (scripts/ops/noelle.sh: full Claude Code with her persona, 24 Nov 2026) ──
  "growth.noelle": { role: BRAIN, jobClass: "hard", why: "Noelle's run: full Claude Code as the Director of Growth in ~/Work/noelle, with builder tools, the rules file and skills, inside Claude Code's OS sandbox (scripts/ops/lib/noelle-sandbox.sh: her own paths, her hosts and a separate GitHub broker) with her guard's checks by name (scripts/ops/noelle-guard.mjs). Brains: only spry, porch-and-party, time-2-read, personal, team and risk (noelle.mjs readBrain), never brokerage or west-peek-ventures. On a Claude limit scheduled work stops and her call goes to the Boss OS answer ladder." },
  "chief.simone": { role: BRAIN, jobClass: "hard", why: "Runs the chief of staff session on the Mac with the owner’s message and the team roster." },
  "brain.record": { role: WORKER, jobClass: "short", why: "Saving her exact words or a measured number into a brain, read back after the save: short and checkable, so it starts on the free routes." },
  "brain.interpret": { role: BRAIN, jobClass: "hard", why: "Rewriting, merging, summarising or deciding what a ruling means: hard judgement." },
  "brain.write": { role: BRAIN, jobClass: "hard", why: "A company-brain write that does not say whether it records or interprets is treated as interpreting: the strongest route." },
});

/** Route tiers follow the required ability. Unclassified work uses the most capable seats. */
export const HARD = "hard";
export const CLEAR_BRIEF = "clear_brief";
export const SHORT = "short";
export const JOB_CLASSES = Object.freeze([HARD, CLEAR_BRIEF, SHORT]);

export const CLAUDE = "claude";
export const CODEX = "codex";
export const FREE = "free";
/** Weakest first. A route that keeps failing a kind hands it UP this list, never down. */
export const ROUTE_TIERS = Object.freeze([FREE, CODEX, CLAUDE]);

export const ROUTE_TABLE = Object.freeze({
  [HARD]: Object.freeze([CLAUDE, CODEX]),
  [CLEAR_BRIEF]: Object.freeze([CODEX, CLAUDE]),
  [SHORT]: Object.freeze([FREE, CODEX, CLAUDE]),
});
export const NAMED_STOP = "named_stop";

/**
 * The routes a job may walk, in order, and how the walk ends. `demoted` are tiers the run log says
 * failed this class twice in a row (seatOrder.ts `seatFailedTwice`): each is dropped only while a
 * STRONGER tier is still on the list, so the job moves up a rung and a list is never emptied.
 */
export function routeOrder({ jobClass, demoted = [] } = {}) {
  const cls = JOB_CLASSES.includes(jobClass) ? jobClass : HARD;
  let routes = [...ROUTE_TABLE[cls]];
  for (const tier of demoted) {
    const stronger = routes.some((r) => ROUTE_TIERS.indexOf(r) > ROUTE_TIERS.indexOf(tier));
    if (stronger) routes = routes.filter((r) => r !== tier);
  }
  return { jobClass: cls, routes, end: NAMED_STOP };
}

/** Intake kinds that are short and checkable. */
const SHORT_KINDS = new Set(["research", "drafting", "scheduled_check", "memory_promotion", "model_benchmark", "search_queries", "extract_from_fetched_text"]);
/** Intake kinds that arrive with a clear brief (a duty row, a workflow's own step). */
const CLEAR_BRIEF_KINDS = new Set(["recurring_duty", "triggered_workflow", "coaching", "relationship", "west_peek_bridge"]);
/**
 * DELIVERABLES THAT ARE HARD WHATEVER KIND THEY WERE FILED UNDER (owner, 13 Nov 2026: "figure out how
 * ot make sure my briefs get wrriten to the impeccable standard we have had"). Her daily briefing
 * (`delivers: "executive_reports"`) reaches her unchecked every morning, which is the definition of
 * HARD above; filed as a routine duty it walked the Codex-first row, and the briefs Codex wrote
 * (25 Oct to 1 Nov 2026) ran at half the depth of the standard. So it starts on Claude's seat, with
 * Codex's as the backup.
 */
// "quality_reads": the monthly read of her deliverables against their best examples (duties/drift.ts)
// is judgement on her private records: Claude's seat, Codex's as the backup, never a free route.
export const HARD_DELIVERS = Object.freeze(["executive_reports", "quality_reads"]);

/**
 * A job's class, from what the queue already knows about it. NOT A CLASSIFIER: no text is read. A
 * flag that marks hard work wins; then the intake kind; anything else (a one-off ask, a decision, a
 * repository change, trading, an unknown or missing kind) is HARD.
 *
 * `delivers`: what the task hands back; a deliverable on HARD_DELIVERS is hard whatever its kind.
 * `brainEdit`: "record" (her exact words or a measured number, read back after the save) is SHORT;
 * any other brain edit is interpreting, and HARD.
 */
export function jobClassOf({ intakeKind = null, repair = false, repoChange = false, chromeJob = false, brainEdit = null, delivers = null } = {}) {
  if (repair || repoChange || chromeJob) return HARD;
  if (typeof delivers === "string" && HARD_DELIVERS.includes(delivers)) return HARD;
  if (brainEdit != null && brainEdit !== false) return brainEdit === "record" ? SHORT : HARD;
  if (SHORT_KINDS.has(intakeKind)) return SHORT;
  if (CLEAR_BRIEF_KINDS.has(intakeKind)) return CLEAR_BRIEF;
  return HARD;
}

/** The class a Mac runner's job key carries; a key with none is HARD. */
export function jobClassFor(key) {
  return AI_ROLES[key]?.jobClass ?? HARD;
}

/** Only short, checkable work can move to a free rung. */
export function afterCodexLimit({ jobClass = HARD } = {}) {
  return jobClass === SHORT ? "free_rung" : "claude_seat";
}

/** The role for a job key. An unknown key is a programming error, so it throws rather than guesses. */
export function roleFor(key) {
  const row = AI_ROLES[key];
  if (!row) throw new Error(`NAMED STOP [NO_AI_ROLE] "${key}" is not in src/shared/boss/aiRoles.mjs; add it with its role and why.`);
  return row.role;
}
