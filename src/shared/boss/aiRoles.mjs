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
 * A CODEX LIMIT WAITS. `ai-run` exits 75 with `NAMED STOP [CODEX_LIMIT] resets <time>`; the run ends
 * as a named note (not red, not a failed duty) and the next scheduled run retries it. A worker job is
 * NEVER handed to Claude because Codex is out (`CODEX_LIMIT_WAITS`). Read by:
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

/** A Codex limit is waited out, never handed to Claude. */
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
  "agent_queue.confidential_draft": { role: BRAIN, why: "LP and deal-terms drafts run on the Claude seat only (private-data-routing, 31 Oct 2026)." },

  // ── Company brains ────────────────────────────────────────────────────────────────────────────
  "brain.write": { role: BRAIN, why: "Company-brain writes (PUT /api/boss/brains/<slug>) are Claude's." },
});

/** The role for a job key. An unknown key is a programming error, so it throws rather than guesses. */
export function roleFor(key) {
  const row = AI_ROLES[key];
  if (!row) throw new Error(`NAMED STOP [NO_AI_ROLE] "${key}" is not in src/shared/boss/aiRoles.mjs; add it with its role and why.`);
  return row.role;
}
