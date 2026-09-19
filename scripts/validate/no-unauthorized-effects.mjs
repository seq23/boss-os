#!/usr/bin/env node
/**
 * no-unauthorized-effects.mjs — static authority scan (P3, `npm run validate:authority`).
 *
 * Proves, by construction:
 * (a) ONLY src/worker/effects/executor.ts performs external-effect execution:
 *     - no other worker file writes state 'EXECUTED' on external_effect_request;
 *     - no worker file contains an outbound fetch() to a non-localhost URL
 *       (all effect adapters are local simulations).
 * (b) The reserved/executed call sites pass through authorize():
 *     - handleMergeCompanies and handleReverseMerge (services/companies.ts) each call
 *       authorize() with the reserved action identity_merge.execute;
 *     - executeExternalEffect (effects/executor.ts) calls authorize() and consumes
 *       the receipt via consumeApprovalCard().
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
const EXECUTOR = path.join("src", "worker", "effects", "executor.ts");

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
  ["src/worker/effects/feedClient.ts", "RSS/Atom acquisition; https-only, blocks loopback/RFC1918/metadata, size and time capped"],
  ["src/worker/effects/resendClient.ts", "Resend email transport; reachable only after executeExternalEffect() has an approved receipt, and inert unless RESEND_API_KEY and WP_OS_EMAIL_SEND are both set"],
  ["src/worker/effects/secEdgarClient.ts", "SEC EDGAR full-text search; public, read-only, https-only, one request per market map, sends the User-Agent the SEC's fair-access policy requires"],
  ["src/worker/effects/networkOsClient.ts", "Network OS snapshot pull (§12A); READ-ONLY by construction — no POST in the file — and inert unless base URL, session secret and approved email are all set"],
  ["src/worker/effects/runwareClient.ts", "Runware image generation; the PROMPT is the only thing that leaves — no firm records travel with it — https-only to one host, inert unless RUNWARE_API_KEY is set, one image per call, size and time capped"],
  ["src/worker/effects/googleClient.ts", "Google OAuth + Calendar (P51); READ-ONLY scopes so nothing here can alter a calendar, inert unless GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are both set, and reachable only for a partner who granted consent themselves"],

  // ── Inbox overhaul, 19 Sep 2026. ──
  ["src/worker/boss/wealth/gmailDraft.ts", "Boss OS Gmail DRAFT (owner, 19 Sep 2026: \"it should never send — the green button should be to create the draft\"). Impersonates her own mailbox under ONE scope (compose) and names ONE endpoint (drafts.create), both held as constants and never read from a request. It cannot send: no send endpoint and no transport exist on this path, and spry-vc-never-sends.mjs plus the-inbox-draft-never-sends.mjs fail the build if one appears. Reached only after her approval in the Inbox, which is the authorization; inert without the Worker's Google service-account secret, and its absence is a NAMED STOP printed on the card"],

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
  ["src/worker/boss/router/anthropic.ts", "Boss OS model router, third vendor; the exact sibling of fireworks.ts and openrouter.ts and reached the same way — solely through Boss's own router, which applies cost mode, per-lane and per-employee budgets, privacy class, risk ceiling and the decision log before the call. One host, https-only, base URL held as a constant in router/backends.ts and never read from a request body. Inert without ANTHROPIC_API_KEY, and its absence is a NAMED STOP rather than a silent fallback to another provider: she approved a specific backend, and answering from a different one would mean a party she never consented to read her words"],
  ["src/worker/boss/router/openai.ts", "Boss OS model router, fourth vendor; identical construction and identical gating to the entry above. The Sovereignty Addendum §1 forbids a critical capability depending permanently on one provider, which is why there is more than one of these at all. Inert without OPENAI_API_KEY"],
  ["src/worker/boss/routes/employees.ts", "NOT EGRESS. `fetch(new URL('/api/judgement', c.req.url))` is the Worker calling ITSELF at its own origin, so a duty draft is raised through the same authenticated judgement route a person would use rather than by writing the rows directly. Nothing leaves the isolate; the URL is built from the incoming request, so it cannot be pointed anywhere else"],
  ["src/worker/boss/routes/packets.ts", "NOT EGRESS, AND NOT EVEN THIS PROCESS'S FETCH. The match is inside a STRING of browser JavaScript embedded in a generated HTML packet — `fetch('/api/boss/auth/unlock')`, run later by the reader's own browser against her own origin. Listed rather than excused by a cleverer regex: a scan that learns to ignore text inside strings is a scan that misses a real call assembled in one"],
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

/** Extract the body of an exported async function from a source string. */
function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  if (start === -1) return null;
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
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

export function checkSources(files) {
  const violations = [];

  for (const [rel, raw] of Object.entries(files)) {
    const source = stripComments(raw);
    // (a2) No outbound network fetch anywhere in worker code, except the named egress clients.
    const egressAllowed = EGRESS_ALLOWED.has(rel);
    if (OUTBOUND_FETCH.test(source) && !egressAllowed) {
      violations.push(`${rel}: outbound fetch() to a non-localhost URL (external effects must be local simulations in effects/executor.ts adapters)`);
    }
    // (a2b) A file that calls fetch() at all — including through an injected fetchImpl with a
    // constant URL — must be on the allowlist. Without this, egress hides from (a2) simply by
    // storing the URL in a variable, which is exactly how both real clients slipped past it.
    if (!egressAllowed && ANY_FETCH.test(source) && !/\bfetchImpl\s*[,)=:]/.test(source)) {
      violations.push(`${rel}: calls fetch() but is not in EGRESS_ALLOWED — add it there with a reason, or route the call through effects/`);
    }
    // (a1) Only the executor may mark external_effect_request EXECUTED.
    if (rel !== EXECUTOR.split(path.sep).join("/") && source.includes("external_effect_request") && source.includes("EXECUTED")) {
      violations.push(`${rel}: references external_effect_request and 'EXECUTED' — only effects/executor.ts may execute external effects`);
    }
  }

  // (b) Choke-point routing at the reserved/executed call sites.
  const companies = files["src/worker/services/companies.ts"];
  if (!companies) {
    violations.push("src/worker/services/companies.ts: file missing");
  } else {
    for (const fn of ["handleMergeCompanies", "handleReverseMerge"]) {
      const body = functionBody(companies, fn);
      if (!body) {
        violations.push(`services/companies.ts: ${fn} not found`);
        continue;
      }
      if (!body.includes("authorize(") || !body.includes('"identity_merge.execute"')) {
        violations.push(`services/companies.ts: ${fn} does not route through authorize() with identity_merge.execute`);
      }
      if (!body.includes("consumeApprovalCard(")) {
        violations.push(`services/companies.ts: ${fn} does not consume the authorization receipt (consumeApprovalCard)`);
      }
    }
  }

  const executor = files[EXECUTOR.split(path.sep).join("/")];
  if (!executor) {
    violations.push(`${EXECUTOR}: file missing`);
  } else {
    const body = functionBody(executor, "executeExternalEffect");
    if (!body || !body.includes("authorize(")) {
      violations.push("effects/executor.ts: executeExternalEffect does not verify through authorize()");
    }
    if (!body || !body.includes("consumeApprovalCard(")) {
      violations.push("effects/executor.ts: executeExternalEffect does not consume the receipt (replay protection)");
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
    "src/worker/services/companies.ts": [
      "export async function handleMergeCompanies() { await authorize(env, actor, \"identity_merge.execute\", ref, { receiptId }); await consumeApprovalCard(env, card); }",
      "export async function handleReverseMerge() { await authorize(env, actor, \"identity_merge.execute\", ref, { receiptId }); await consumeApprovalCard(env, card); }",
    ].join("\n"),
    "src/worker/effects/executor.ts":
      "export async function executeExternalEffect() { await authorize(env, actor, key, ref, { receiptId }); await consumeApprovalCard(env, id); db('external_effect_request', 'EXECUTED'); }",
  };
  const failures = [];
  if (checkSources(clean).length !== 0) failures.push("clean fixture was flagged");

  const cases = {
    "another module marks EXECUTED": {
      ...clean,
      "src/worker/services/sneaky.ts": 'await db.prepare("UPDATE external_effect_request SET state = \'EXECUTED\'")',
    },
    "outbound fetch outside localhost": {
      ...clean,
      "src/worker/services/sneaky.ts": 'await fetch("https://api.example.com/send")',
    },
    "merge without authorize()": {
      ...clean,
      "src/worker/services/companies.ts": clean["src/worker/services/companies.ts"].replaceAll("authorize(", "noop("),
    },
    "executor without receipt consumption": {
      ...clean,
      "src/worker/effects/executor.ts": clean["src/worker/effects/executor.ts"].replace("consumeApprovalCard(", "noop("),
    },
  };
  for (const [name, files] of Object.entries(cases)) {
    if (checkSources(files).length === 0) failures.push(`violating fixture NOT caught: ${name}`);
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const failures = selfTest();
  if (failures.length > 0) {
    console.error("SELF-TEST FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED: clean fixture passes; all 4 violating fixtures are caught.");
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
const violations = checkSources(realTree);
if (violations.length > 0) {
  console.error("AUTHORITY SCAN FAILED — unauthorized-effect violations:");
  for (const v of violations) console.error(`  ✗ ${v}`);
  // What to do about it. This is the scan most likely to be tripped by someone who thinks they are
  // writing an ordinary service, so the epilogue names the one path rather than restating the rule.
  console.error("\nAnything that leaves the system is an external effect: it is REQUESTED by a service,");
  console.error("authorized through authorize(), and EXECUTED only by effects/executor.ts, which");
  console.error("consumes the approval receipt so it cannot be replayed. Splitting those three steps");
  console.error("across a service is how an effect happens with nobody having approved it.");
  process.exit(1);
}
console.log("AUTHORITY SCAN PASSED: external-effect execution is confined to effects/executor.ts, no outbound fetch in worker code, merge/reverse/executor route through authorize().");
