#!/usr/bin/env node
/**
 * no-unauthorized-effects.mjs — static authority scan (P3, `npm run validate:authority`).
 *
 * Proves, by construction, that worker code reaches the network only from the files named in
 * EGRESS_ALLOWED, each with its reason:
 *   - no worker file outside the list calls fetch() to a non-localhost URL;
 *   - no worker file outside the list calls fetch() at all (an injected URL hides from the first);
 *   - no entry on the list names a file that is gone (a stale allowance is an unread rule).
 *
 * Until 22 Nov 2026 it also pinned the West Peek fund's effect executor and company-merge choke
 * points (effects/executor.ts, services/companies.ts). Both retired with the chassis; Boss OS has
 * no external_effect_request path, so those checks would watch nothing.
 *
 * The scan FAILS LOUDLY (exit 1, named violations) on any breach. `--self-test`
 * feeds synthetic violating sources through the same check functions and asserts
 * they are caught — proving detection by design, without breaking real code.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKER_DIR = path.join(ROOT, "src", "worker");

const OUTBOUND_FETCH = /fetch\s*\(\s*["'`]https?:\/\/(?!localhost\b|127\.0\.0\.1\b)/;

/**
 * Files permitted to reach the network, each with the reason it is allowed.
 *
 * WHY THIS LIST EXISTS: the regex above only catches fetch() called with a LITERAL url. Both real
 * egress clients take an injected `fetchImpl` and pass a constant, so neither was ever caught —
 * they were passing by accident, not by decision. Naming them makes the allowance a choice someone
 * made, and gives a reviewer one place to see everything that can leave the building.
 *
 * Adding a file here should be a conscious act. Egress from anywhere else stays a violation.
 */
const EGRESS_ALLOWED = new Map([
  ["src/worker/boss/agents/simoneAccounts.ts", "Owner-session Google OAuth token, identity and revoke endpoints. Leased Simone tools use fixed Google Workspace origins, read methods and an account gate. Tokens stay in the encrypted vault and Authorization headers."],
  ["src/worker/boss/research/grounded.ts", "Reads where a Google grounding link lands (GET vertexaisearch.cloud.google.com/grounding-api-redirect/… with redirect: manual, the Location header only, 6 s cap); one fixed host, nothing sent but the GET, so a research page cites the real page (6 Nov 2026)"],

  // ── Inbox overhaul, 19 Sep 2026. ──
  // boss fix L (23 Oct 2026, ruling 10)
  ["src/worker/boss/commands/google.ts", "Simone does it by email (owner, 25 Oct 2026). Google Calendar on her Workspace calendars only (WORKSPACE_MAILBOXES, checked before any token): the clash check, the event with a Meet link that IS the invite she asked for, a bounced guest swapped on the same event, a delete. Gmail messages/send ONLY from sendOne, which run.ts calls only for a row in state approved, set only by her Send tap or her \"send\" reply on the exact words shown; spry-vc-never-sends.mjs (COMMAND_SENDER) fails the build if any of that changes. Inert without the Worker's Google service-account secret"],
  ["src/worker/boss/routes/lpTap.ts", "Her one-tap \"Send as is\" on a held LP reply (owner, 23 Oct 2026: \"Send as is / Edit, then send / Skip\"; she OK'd read and write on sequoia@westpeek.ventures). Her POST on the 144-bit token stored on that one row IS the authorization; a GET never acts. Sends ONLY an existing draft (drafts/send, never messages/send) from a westpeek.ventures mailbox checked before the compose token is minted; spry-vc-never-sends.mjs (LP_TAP_MODULE) and lp-rules.mjs fail the build if any of that changes. Inert without the Worker's Google service-account secret, and says \"Not sent yet\" when it is absent"],
  ["src/worker/boss/wealth/gmailDraft.ts", "Boss OS Gmail DRAFT (owner, 19 Sep 2026: \"it should never send — the green button should be to create the draft\"). Impersonates her own mailbox under ONE scope (compose) and names ONE endpoint (drafts.create), both held as constants and never read from a request. It cannot send: no send endpoint and no transport exist on this path, and spry-vc-never-sends.mjs plus the-inbox-draft-never-sends.mjs fail the build if one appears. Reached only after her approval in the Inbox, which is the authorization; inert without the Worker's Google service-account secret, and its absence is a NAMED STOP printed on the card"],

  // ── Her jobs, 19 Sep 2026. ──
  ["src/worker/boss/research/firmScan.ts", "\"Find firms that did X and draft the ask\" (owner, 19 Sep 2026). READ-ONLY public web: a keyless public news RSS feed (GET) and the article pages it links (GET), https, 12 s timeout, text capped at 9,000 chars per page, at most 8 pages per scan. Nothing about her, her book or a counterparty leaves in the request — the query is the model's three search phrases for the instruction's subject. Every finding is verified against the fetched page before a letter exists; the letters go through the Inbox and the Gmail-draft path, never a transport"],
  // ── Her jobs, 19 Sep 2026 — Job 3. ──
  ["src/worker/boss/health/readers.ts", "Boss OS grid health readers (owner, 19 Sep 2026: \"connect all the GSC and whatever else to measure the health and GitHub and all\"). Two READ-ONLY readers: a GET to each canonical domain in src/shared/boss/grid.mjs (public sites, her own, ten-second timeout, body discarded), and a Search Console read under webmasters.readonly AS the service account — no `sub`, no impersonation, two constant hosts (oauth2.googleapis.com, searchconsole.googleapis.com). No POST that writes anything anywhere: the one POST is Search Console's query verb for a read. Runs only from a standing duty with executor 'worker'; inert without GSC_SERVICE_ACCOUNT_JSON, and that absence is a NAMED blocked row on every property card rather than silence"],

  // ── Ported Boss OS. Both entries are DEBT, and both say what pays for them. ──
  ["src/worker/boss/router/fireworks.ts", "Boss OS model router (ported); the ONLY adapter in the Boss subtree that calls a vendor, reached solely through Boss's own router, which applies its cost mode, per-lane and per-employee budget hard stops, privacy class, risk ceiling and decision log before the call. Inert unless FIREWORKS_API_KEY is set. Duplicates runAi rather than escaping it — see PORTED_BOSS_ROUTER in no-direct-provider-calls.mjs for the two ways that ends"],
  ["src/worker/boss/router/openrouter.ts", "Boss OS continuity backend (Stage 4); the SECOND model vendor, which is the whole point — the Sovereignty Addendum §1 forbids a critical capability depending permanently on one provider, and coding and drafting depended entirely on one. One host, https-only, held as a CONSTANT in router/backends.ts and never read from a request body, so no row a caller can write moves this egress. Reached solely through the Boss router, which applies data sensitivity, capability, availability and the spend lever's budget before the call, in that order. Inert unless OPENROUTER_API_KEY is set AND the bk_openrouter backend has been commissioned. Its sibling Workers AI needs no entry here at all: it is the env.AI binding, so it calls no fetch and has no host"],
  /*
   * ── The two remaining model vendors, and two files that are not egress at all. ──
   *
   * All four were failing this scan on 9 September 2026 with nothing behind the failure but an
   * un-updated list — a validator red for four days teaches everyone to ignore it, which costs more
   * than the rule it enforces.
   */
  ["src/worker/effects/groundingLinkClient.ts", "Google grounding links → real page URLs for meeting-prep sources (6 Nov 2026). READ-ONLY: one HEAD per link, redirects not followed, no body read, only links on Google's own grounding-redirect host (a constant in the file), https-only, 5 s timeout. Nothing of ours leaves but the link Google itself returned"],
  ["src/worker/boss/cron/dispatch.ts", "Boss OS's own clock (21 Nov 2026, Kendra's alarm mail:morning-email: GitHub's schedule event fired this account's workflows once every 6-9 hours). ONE POST to ONE fixed URL (DISPATCH_URL, a constant: repos/seq23/boss-os/dispatches), https-only, 10 s timeout. What leaves is the job's event type and its slot key; it starts a boss-os workflow that already runs on GitHub and does nothing else. Each slot is claimed in D1 first, so it fires once. Inert without GITHUB_SEQ23_PAT, and that absence is NAMED STOP [CLOUD_CLOCK_NO_TOKEN] with a Kendra alarm"],
  ["src/worker/effects/braveSearchClient.ts", "Brave Search, the second meeting-guest research route (owner, 5 Nov 2026). READ-ONLY: one GET per search to one host (BRAVE_SEARCH_HOST, a constant in the file, never read from a request), https-only, 10 s timeout, at most 5 results. The only thing that leaves is the search phrase (guest name, firm, company domain); a committed LP is stopped before any search. Capped at 20 searches a day, claimed in D1 before the call (FREE_ROUTES.svc_brave_search). Every snippet is fenced as untrusted before a model reads it. Inert without BRAVE_SEARCH_API_KEY"],
  ["src/worker/boss/router/gemini.ts", "Boss OS router's direct Gemini adapter. Fixed Google host, abort signal and refused redirects. The worker reading entry uses its own vault key from a project without billing and sends neither tools nor grounding options."],
  ["src/worker/boss/router/workersAi.ts", "Boss OS router's Workers AI adapter. The general router uses its binding. Worker reading uses the same adapter with a fixed HTTPS Cloudflare REST endpoint and dedicated Workers Free account credentials. The transport refuses redirects, aborts at the router deadline and returns Cloudflare's daily-limit code to the caller."],
  ["src/worker/boss/router/anthropic.ts", "Boss OS model router, third vendor; the exact sibling of fireworks.ts and openrouter.ts and reached the same way — solely through Boss's own router, which applies cost mode, per-lane and per-employee budgets, privacy class, risk ceiling and the decision log before the call. One host, https-only, base URL held as a constant in router/backends.ts and never read from a request body. Inert without ANTHROPIC_API_KEY, and its absence is a NAMED STOP rather than a silent fallback to another provider: she approved a specific backend, and answering from a different one would mean a party she never consented to read her words"],
  ["src/worker/boss/router/openai.ts", "Boss OS model router, fourth vendor; identical construction and identical gating to the entry above. The Sovereignty Addendum §1 forbids a critical capability depending permanently on one provider, which is why there is more than one of these at all. Inert without OPENAI_API_KEY"],
  ["src/worker/boss/routes/employees.ts", "NOT EGRESS. `fetch(new URL('/api/judgement', c.req.url))` is the Worker calling ITSELF at its own origin, so a duty draft is raised through the same authenticated judgement route a person would use rather than by writing the rows directly. Nothing leaves the isolate; the URL is built from the incoming request, so it cannot be pointed anywhere else"],
  ["src/worker/boss/trading/quant.ts", "Boss OS kill-switch probe (ported); sends ONE command — kill_switch or ping — to an operator-registered engine control URL, with a hard AbortSignal timeout and no firm or personal record in the body. No engine is registered in this build, so control_url is null and the file returns not_configured without reaching the network: the quant validation status reports the kill switch as UNPROVEN rather than claiming it works"],
]);

/**
 * Any CALL to bare fetch — literal URL or not. Used to police the allowlist above.
 *
 * Excludes two things that are not egress and would otherwise be false positives:
 *   `env.ASSETS.fetch(...)`  — a binding method call, hence the `.` in the lookbehind;
 *   `async fetch(request…)`  — the Worker's own entrypoint DECLARATION, hence `async`/`function`.
 */
const ANY_FETCH = /(?<![A-Za-z0-9_$.])(?<!async\s)(?<!function\s)fetch\s*\(/;

function listWorkerFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(WORKER_DIR);
  return out;
}

/**
 * Run all checks over a map of { relativePath: source }. Returns violation strings.
 * Pure — the same function scans the real tree and the self-test fixtures.
 */
/**
 * Strip COMMENTS before scanning. String literals are deliberately left in place.
 *
 * Added after this scanner flagged a file whose only mention of fetch() was a comment saying the
 * file does not call fetch(). A scan that reads prose produces false positives and, worse, teaches
 * people that the way past it is to reword a comment.
 *
 * Strings stay because they ARE code here: the EXECUTED check below looks for a SQL literal, and
 * stripping quotes broke it — caught immediately by the self-test, which is the whole reason this
 * scanner has one.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 "); // line comments, leaving http:// intact
}

export function checkSources(files, checkStale = false) {
  const violations = [];

  for (const [rel, raw] of Object.entries(files)) {
    const source = stripComments(raw);
    // (a2) No outbound network fetch anywhere in worker code, except the named egress clients.
    const egressAllowed = EGRESS_ALLOWED.has(rel);
    if (OUTBOUND_FETCH.test(source) && !egressAllowed) {
      violations.push(`${rel}: outbound fetch() to a non-localhost URL from a file not in EGRESS_ALLOWED`);
    }
    // (a2b) A file that calls fetch() at all — including through an injected fetchImpl with a
    // constant URL — must be on the allowlist. Without this, egress hides from (a2) simply by
    // storing the URL in a variable, which is exactly how both real clients slipped past it.
    if (!egressAllowed && ANY_FETCH.test(source) && !/\bfetchImpl\s*[,)=:]/.test(source)) {
      violations.push(`${rel}: calls fetch() but is not in EGRESS_ALLOWED — add it there with a reason`);
    }
  }

  // A stale allowance: an entry for a file that is gone. Ignored for fixtures that name no real file.
  if (checkStale) {
    for (const rel of EGRESS_ALLOWED.keys()) {
      if (!(rel in files)) violations.push(`${rel}: listed in EGRESS_ALLOWED but no longer exists — remove the entry`);
    }
  }

  return violations;
}

function scanRealTree() {
  const files = {};
  for (const full of listWorkerFiles()) {
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    files[rel] = readFileSync(full, "utf8");
  }
  return files;
}

function selfTest() {
  const clean = {
    "src/worker/boss/ok.ts": "export const x = 1;",
    "src/worker/boss/research/grounded.ts": 'await fetch("https://vertexaisearch.cloud.google.com/x", { redirect: "manual" });',
  };
  const failures = [];
  if (checkSources(clean).length !== 0) failures.push("clean fixture was flagged");

  const cases = {
    "outbound fetch outside localhost": { ...clean, "src/worker/boss/sneaky.ts": 'await fetch("https://api.example.com/send")' },
    "fetch through a variable URL": { ...clean, "src/worker/boss/sneaky.ts": "const u = target; await fetch(u);" },
  };
  for (const [name, files] of Object.entries(cases)) {
    if (checkSources(files).length === 0) failures.push(`violating fixture NOT caught: ${name}`);
  }
  // A stale allowance is caught when the real-tree check runs.
  if (!checkSources(clean, true).some((v) => v.includes("no longer exists"))) failures.push("violating fixture NOT caught: a stale EGRESS_ALLOWED entry");
  return failures;
}

if (process.argv.includes("--self-test")) {
  const failures = selfTest();
  if (failures.length > 0) {
    console.error("SELF-TEST FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED: clean fixture passes; all 3 violating fixtures are caught.");
  process.exit(0);
}

const realTree = scanRealTree();
const scannedCount = Object.keys(realTree).length;
// A scan that finds nothing to check is not a pass. The named-file checks above already fail
// closed when specific files are missing, but this guard makes that explicit and covers a walk
// that returns nothing for any reason — not just the files this scan happens to name.
if (scannedCount === 0) {
  console.error(`AUTHORITY SCAN FAILED — examined 0 source files under ${path.relative(ROOT, WORKER_DIR)}.`);
  console.error("A scan that checks nothing is not a passing scan. Confirm WORKER_DIR resolves to the real");
  console.error("worker tree before trusting this result.");
  process.exit(1);
}
const violations = checkSources(realTree, true);
if (violations.length > 0) {
  console.error("AUTHORITY SCAN FAILED — unauthorized-effect violations:");
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error("\nEvery file that reaches the network is named in EGRESS_ALLOWED with the reason it may.");
  console.error("Add a new one there with its reason, or remove the entry for a file that is gone.");
  process.exit(1);
}
console.log("AUTHORITY SCAN PASSED: every worker file that reaches the network is named in EGRESS_ALLOWED, and every entry there still exists.");
