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
  "agent_queue.private_prompt": { role: BRAIN, why: "A seat prompt the privacy screen flags (LP, investor or deal terms, a private name, children's data, an unreadable lexicon) runs on Claude only, fail closed: a ChatGPT plan is a setting, not a no-training contract (private-data-routing; west-peek-os #326)." },
  "agent_queue.confidential_draft": { role: BRAIN, why: "LP and deal-terms drafts run on the Claude seat only (private-data-routing, 31 Oct 2026)." },

  // ── Company brains ────────────────────────────────────────────────────────────────────────────
  "brain.write": { role: BRAIN, why: "Company-brain writes (PUT /api/boss/brains/<slug>) are Claude's." },
});

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
 * "free_rung": work DECLARED public, or cleared for public models on its card (and not an LP/deal
 *   draft, not a Chrome job) walks the whole chain from rung 1.
 * "claude_seat": everything else (confidential, LP, deal, children's, private) never touches a free
 *   rung (private-data-routing: fail closed) and goes to the Claude seat; it waits only when no
 *   Claude seat can take it.
 */
export function afterCodexLimit({ sensitivity, modelAccess = null, confidential = false, chromeJob = false } = {}) {
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
