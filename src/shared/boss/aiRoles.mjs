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
  "mailbox_sweep": { role: BRAIN, why: "Reads her whole mailbox, which carries confidential LP and deal text: Claude seat only (private-data-routing), and Codex cannot reach the connector." },

  // ── The agent queue (com.seq.boss-agent*): duties parked for her Mac's seats ──────────────────
  "agent_queue.default": { role: WORKER, why: "An employee's duty run is hands-on work: Codex's seat goes first on every ladder that has it." },
  "agent_queue.chrome_job": { role: BRAIN, why: "Runs in her Chrome through Claude in Chrome; Codex has no browser (1 Nov 2026)." },
  "agent_queue.private_prompt": { role: BRAIN, why: "A seat prompt the privacy screen flags (LP, investor or deal terms, a private name, children's data, an unreadable lexicon) never reaches a free or cloud route, fail closed. It walks the private row of ROUTE_TABLE below: Claude's seat first, Codex's as the backup for short and clear-brief work, Claude's seat only for hard work (owner, 13 Nov 2026)." },
  "agent_queue.confidential_draft": { role: BRAIN, why: "LP and deal-terms drafts run on the Claude seat only (private-data-routing, 31 Oct 2026)." },

  // ── Company brains ────────────────────────────────────────────────────────────────────────────
  // Owner, 13 Nov 2026: "recording can be a free model interpreting can be a more high quality model".
  "brain.record": { role: WORKER, jobClass: "short", why: "Saving her exact words or a measured number into a brain, read back after the save: short and checkable, so it starts on the free routes." },
  "brain.interpret": { role: BRAIN, jobClass: "hard", why: "Rewriting, merging, summarising or deciding what a ruling means: hard judgement." },
  "brain.write": { role: BRAIN, jobClass: "hard", why: "A company-brain write that does not say whether it records or interprets is treated as interpreting: the strongest route." },
});

/*
 * ─── JOB CLASS × ROUTE TIER: THE ONE TABLE (owner, 13 Nov 2026, "ok yes execute this") ─────────────
 *
 * Her words: "all private stuff can go through codex i need a backup to claude", "its more about model
 * ability too", and "there needs to be no standing rule about any … model". So nothing here names a
 * model. A job has a CLASS (how hard it is), a route has a TIER (free / Codex / Claude), and the order
 * per class is this data. Which concrete model answers inside a tier is the tier's own business: the
 * free tier ranks its candidates from the run log (router/experience.ts `freeMemory`), a seat runs
 * whatever its own invocation config says.
 *
 *   HARD        hard judgement and long builds: writes code that lands, decides, merges, reviews,
 *               repairs, touches money, interprets a brain, or reaches her or a customer unchecked.
 *   CLEAR_BRIEF well-specified work: housekeeping, docs, test lists, bulk edits with a clear brief.
 *   SHORT       short and checkable: sorting, summaries, first drafts, routine searches, read-only
 *               lists something else checks, recording her words or a number into a brain.
 *
 * PRIVATE (committed LP names, deal terms, private brain sections, anything the privacy screen marks):
 * the free tier is never on the list, and that is the privacy rule, not an ability rule; it is decided
 * by the route's recorded data use (router/policy.ts, stage 1) and nothing here can lift it. Private
 * HARD work has one route and WAITS for it by name; it is never moved to Codex.
 *
 * A job with no class is HARD: an unknown fails toward the stronger route.
 */
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
  public: Object.freeze({
    [HARD]: Object.freeze([CLAUDE, CODEX]),
    [CLEAR_BRIEF]: Object.freeze([CODEX, CLAUDE]),
    [SHORT]: Object.freeze([FREE, CODEX, CLAUDE]),
  }),
  private: Object.freeze({
    [HARD]: Object.freeze([CLAUDE]),
    [CLEAR_BRIEF]: Object.freeze([CLAUDE, CODEX]),
    [SHORT]: Object.freeze([CLAUDE, CODEX]),
  }),
});

/** How a walk ends when every route on it is out: private HARD work waits for its one route. */
export const WAIT_FOR_CLAUDE = "wait_for_claude";
export const NAMED_STOP = "named_stop";

/**
 * The routes a job may walk, in order, and how the walk ends. `demoted` are tiers the run log says
 * failed this class twice in a row (seatOrder.ts `seatFailedTwice`): each is dropped only while a
 * STRONGER tier is still on the list, so the job moves up a rung and a list is never emptied.
 */
export function routeOrder({ jobClass, privateWork = false, demoted = [] } = {}) {
  const cls = JOB_CLASSES.includes(jobClass) ? jobClass : HARD;
  let routes = [...ROUTE_TABLE[privateWork ? "private" : "public"][cls]];
  for (const tier of demoted) {
    const stronger = routes.some((r) => ROUTE_TIERS.indexOf(r) > ROUTE_TIERS.indexOf(tier));
    if (stronger) routes = routes.filter((r) => r !== tier);
  }
  return { jobClass: cls, routes, end: privateWork && cls === HARD ? WAIT_FOR_CLAUDE : NAMED_STOP };
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
export const HARD_DELIVERS = Object.freeze(["executive_reports"]);

/**
 * A job's class, from what the queue already knows about it. NOT A CLASSIFIER: no text is read. A
 * flag that marks hard work wins; then the intake kind; anything else (a one-off ask, a decision, a
 * repository change, trading, an unknown or missing kind) is HARD.
 *
 * `delivers`: what the task hands back; a deliverable on HARD_DELIVERS is hard whatever its kind.
 * `brainEdit`: "record" (her exact words or a measured number, read back after the save) is SHORT;
 * any other brain edit is interpreting, and HARD.
 */
export function jobClassOf({ intakeKind = null, repair = false, repoChange = false, confidentialDraft = false, chromeJob = false, brainEdit = null, delivers = null } = {}) {
  if (repair || repoChange || confidentialDraft || chromeJob) return HARD;
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

/**
 * AFTER A CODEX LIMIT: ALL FREE TIERS FIRST, THEN HER SUBSCRIPTION SEATS, NEVER A WAIT WHILE A LATER
 * RUNG CAN RUN (owner, 6 Nov 2026, replacing the 3 Nov "public work → free rung, never Claude; the rest
 * waits"): "it started with all free tiers and if they were all out then it uses an allowance on the
 * paid models i have subscriptions to". And (CLAUDE.md, her yes 6 Nov 2026): "A Codex usage limit
 * hands the work to Claude, then the free routes; it never waits for the reset."
 *
 * The chain, read by src/worker/boss/queue/consumer.ts (at dispatch) and routes/backends.ts (a limit
 * mid-run), with the free rungs in src/worker/boss/queue/freeRung.ts:
 *   1. Gemini free (research: with Google Search grounding)
 *   2. OpenRouter `:free` models (max price 0; any reported cost stops the call). Research hands them
 *      Brave Search results, the repo's $0 search source; with no Brave key rung 2 is skipped by name
 *      ("no free search source for OpenRouter"). OpenRouter's web plugin costs money: never used.
 *   3. Codex's seat, if it is not spent
 *   4. the Claude seat (bk_claude_code on her Mac), only when her Mac was seen recently and the seat
 *      is not marked spent
 *   5. NAMED STOP with the reset
 * Never a paid API.
 *
 * "free_rung": SHORT work (ROUTE_TABLE below) DECLARED public, or cleared for public models on its
 *   card (and not an LP/deal draft, not a Chrome job) walks the whole chain from rung 1.
 * "claude_seat": everything else (confidential, LP, deal, children's, private) never touches a free
 *   rung (private-data-routing: fail closed) and goes to the Claude seat; it waits only when no
 *   Claude seat can take it.
 */
export function afterCodexLimit({ sensitivity, modelAccess = null, confidential = false, chromeJob = false, jobClass = HARD } = {}) {
  // The free tier is on the list for SHORT work only (ROUTE_TABLE); a job with no class is HARD.
  if (jobClass !== SHORT) return "claude_seat";
  // Public = declared public, OR cleared for public models on its card (owner, 6 Nov 2026: the
  // deep research for Valerie was "public_model_approved" and sat waiting four days for Codex). The
  // router's privacy screen still reads every prompt and keeps private text off the free rung.
  const isPublic = sensitivity === "public" || modelAccess === "public_model_approved";
  return isPublic && !confidential && !chromeJob ? "free_rung" : "claude_seat";
}

/** The role for a job key. An unknown key is a programming error, so it throws rather than guesses. */
export function roleFor(key) {
  const row = AI_ROLES[key];
  if (!row) throw new Error(`NAMED STOP [NO_AI_ROLE] "${key}" is not in src/shared/boss/aiRoles.mjs; add it with its role and why.`);
  return row.role;
}
