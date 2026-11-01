/**
 * A JOB IN HER OWN CHROME IS A CHROME JOB, NOT A RESEARCH PAGE (1 Nov 2026).
 *
 * She wrote: "One-time Chrome job for tomorrow, Monday 2 Nov, after 9am Central — give it to whoever on
 * the team already works in my Chrome (Camille does the Facebook listings there) … in Pinterest, on the
 * A Player Mode account, connect the RSS feed for the faith board". Simone's triage matched "listings",
 * gave it to Camille, and the mail door then prefixed "research: " because Camille's only queue
 * executor was the research page — so a browser action became a WebSearch/WebFetch page that cannot
 * touch Chrome, ran at once, and on the "OpenAI first" switch went to Codex, which has no Chrome at all.
 *
 * Camille already works in her Chrome: the Marketplace listings run as `claude -p --chrome
 * --allowedTools "mcp__claude-in-chrome__*"` on her Mac (~/bin/pnp-listings.sh, launchd
 * com.seq.boss-fb-renew). A Chrome job is the same executor reached through the queue: her Claude Code
 * seat (bk_claude_code, Claude's seat ONLY — never Codex, never a cloud rung), with the envelope key
 * `browser: "chrome"` that the runner (scripts/sync-agent/runner.mjs) admits only for that seat and
 * the adapter (backends/claudeCode.mjs) turns into `--chrome` plus the Claude in Chrome tools.
 *
 * Only her explicit words make a Chrome job: "Chrome job", "Claude in Chrome", or Chrome / her
 * browser named as where the work happens ("in my Chrome", "works in my Chrome"). The executor record
 * is `SEAT_EXECUTORS.emp_research.owner_chrome` in src/shared/boss/duties/executors.mjs.
 *
 * Plain ESM with a hand-written `.d.mts`, so the Worker, the tests and the validators run the SAME code.
 */
import { NEVER_SPEND_RULE } from "../duties/executors.mjs";

export const CHROME_JOB_SEAT = "emp_research";
export const CHROME_JOB_BACKEND = "bk_claude_code";
export const CHROME_JOB_DIR = "/Users/sequoiataylor/.boss-os/chrome-jobs";
export const CHROME_JOB_REQUESTED = Object.freeze({
  repo_path: CHROME_JOB_DIR,
  allowed_paths: Object.freeze([CHROME_JOB_DIR]),
  browser: "chrome",
  max_seconds: 1500,
});

export const CHROME_JOB_RE =
  /\b(?:chrome (?:job|task|action)|claude in chrome|(?:in|inside|using|through|works in|working in) (?:my|her) (?:own )?(?:google )?(?:chrome|browser))\b/i;

/** Does this text ask for work done in her own Chrome? Pure. */
export function chromeJobIn(text) {
  return CHROME_JOB_RE.test(String(text ?? ""));
}

/** The instruction the seat run is handed: her words whole, the browser rules, and how to end. */
export function composeChromePrompt({ ask }) {
  return [
    "You are Camille on Sequoia Taylor's Boss OS team. This is a job in HER OWN Chrome, through the Claude in Chrome tools (the same Chrome where you run the Porch & Party Marketplace listings).",
    "",
    `HER WORDS: ${String(ask ?? "").trim()}`,
    "",
    "Do exactly what she asked, in her Chrome, and nothing else. Change no other setting. Never type a password; if a sign-in is needed, stop and say so.",
    NEVER_SPEND_RULE,
    "If her words say to try again another day when it fails, and it failed, add one line: Deferred to YYYY-MM-DD: Chrome job — <her task in one sentence>, and say whether this was the first or second try.",
    "End your reply with exactly one line: RESULT: <what is now true, in plain words> — or STOP: <why it could not be done>.",
  ].join("\n");
}
