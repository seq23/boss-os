#!/usr/bin/env node
/**
 * no-direct-provider-calls.mjs — static AI-boundary scan (P4, `npm run validate:ai-boundary`).
 *
 * Proves, by construction, that Boss OS's model router (src/worker/boss/router/, the files named in
 * BOSS_ROUTER) is the ONLY path to a model provider: no other source file under src/ may contain
 *   (a) provider SDK imports (openai, @anthropic-ai/sdk, @google/generative-ai, …),
 *   (b) model API hostnames (api.openai.com, api.anthropic.com,
 *       generativelanguage.googleapis.com, api.perplexity.ai, openrouter.ai), or
 *   (c) bearer-token model calls (fetch + Bearer authorization in the same file).
 * And no entry in BOSS_ROUTER may name a file that is gone.
 *
 * Until 22 Nov 2026 the copied West Peek fund code had its own governor (src/worker/ai/runAi.ts and
 * its providers/), and the Boss OS router was listed here as a debt to resolve "once the fund domain
 * is gone". It went with the chassis, so the router is the one governor and the debt is paid. What
 * is left in src/worker/ai/ is the Whisper adapter, which uses the env.AI binding and needs no entry.
 *
 * Scope note: the scan covers src/** (worker/client/shared — executable code).
 * migrations/ and scripts/seed/ legitimately carry provider hostnames as
 * CONFIG DATA (seeded provider_registry rows, D9: providers are configuration);
 * they can perform no calls.
 *
 * The scan FAILS LOUDLY (exit 1, named violations). `--self-test` feeds synthetic
 * violating sources through the same check function and asserts they are caught.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC_DIR = path.join(ROOT, "src");

const SDK_IMPORT = /(?:from|require\()\s*["'][^"']*(openai|anthropic|generative-ai|perplexity|openrouter)[^"']*["']/i;
const MODEL_HOSTNAMES = /(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.perplexity\.ai|openrouter\.ai)/;
const BEARER = /bearer/i;

function listSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|jsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(SRC_DIR);
  return out;
}

/**
 * Run all checks over a map of { relativePath: source }. Returns violation strings.
 * Pure — the same function scans the real tree and the self-test fixtures.
 */
/**
 * Boss OS's model router: the one governor for every model call (cost modes, per-lane and
 * per-employee hard budget stops, privacy class, risk ceiling, bounded fallback, a decision log that
 * records refusals, every call in `usage_ledger`). Named individually, not pattern-matched, so
 * nothing drifts in behind them; a new vendor file is added here with its reason.
 */
const BOSS_ROUTER = new Set([
  "src/worker/boss/router/fireworks.ts",
  // ── Stage 4 · continuity. Two more files, and the same written reason. ──
  //
  // THE EXEMPTION DOES NOT GROW IN KIND, ONLY IN COUNT, and the count is the point. The Sovereignty
  // Addendum §1 forbids a critical capability depending permanently on ONE external provider
  // without a tested continuity path; Boss OS's drafting and coding lanes depended entirely on
  // Fireworks. A second vendor is the fix, so the file that speaks to it is the same debt as the
  // first file, not a new one — governed by the same router, the same cost modes, the same hard
  // budget stops, the same privacy class and risk ceiling, the same decision log, and now also by
  // the spend lever and the execution-backend guard, which refuse before either adapter is reached.
  //
  // Named individually, exactly as the first one is, so nothing drifts in behind them.
  "src/worker/boss/router/openrouter.ts",
  // The registry that says which of the three adapters to call, at which host. It performs no call
  // and holds no credential: it is here only because it carries the vendor hostnames as CONSTANTS,
  // which is the whole reason a request body cannot move this system's egress. The scan is right to
  // see a hostname; a config table would have hidden it, which is worse.
  "src/worker/boss/router/backends.ts",
  // ── 0211 · the two frontier providers, for coaching alone. ──
  //
  // SAME DEBT, SAME COUNT-NOT-KIND RULE. Both go through Boss OS's router, which applies the
  // privacy class, the risk ceiling, the cost mode, the spend lever, the execution-backend guard
  // and the hard budget stops before either file is reached, and both write to `usage_ledger` and
  // `routing_decisions` like every other adapter here. Neither is a second door to a model.
  //
  // WHY THEY EXIST AT ALL, since everything else in this system was pushed DOWN to the cheapest
  // model that could do the job: coaching is the one route carrying her interior life, and her
  // instruction is explicit — "it is imperative that i use the best models with the best thinking
  // brains and the most integrity". A verified turn on 9 September was answered by Llama 3.1 8B.
  //
  // AND WHY DIRECT RATHER THAN THROUGH THE OPENROUTER ADAPTER ALREADY EXEMPTED HERE: OpenRouter is
  // a proxy, and coaching is the one route whose design is about minimising who sees her words. For
  // utility work the proxy is the better trade and stays the default.
  //
  // Named individually, exactly as the others are, so nothing drifts in behind them.
  "src/worker/boss/router/anthropic.ts",
  "src/worker/boss/router/openai.ts",
  // Google Gemini direct uses the fixed GEMINI_HOST.
  "src/worker/boss/router/gemini.ts",
  "src/worker/boss/router/workersAi.ts", // REST transport for the dedicated Workers Free account.
]);

// Google Workspace data transport uses OAuth bearer headers. Its pathname and origin are
// fixed in the account broker. SDK imports and model host checks still apply to that file.
const WORKSPACE_BEARER = "src/worker/boss/agents/simoneAccounts.ts";

export function checkSources(files, checkStale = false) {
  const violations = [];

  for (const [rel, source] of Object.entries(files)) {
    if (BOSS_ROUTER.has(rel)) continue; // the router is the allowed path; its reason is written above
    if (SDK_IMPORT.test(source)) {
      violations.push(`${rel}: provider SDK import outside Boss OS's model router`);
    }
    if (MODEL_HOSTNAMES.test(source)) {
      violations.push(`${rel}: model API hostname outside Boss OS's model router`);
    }
    if (rel !== WORKSPACE_BEARER && /\bfetch\s*\(/.test(source) && BEARER.test(source)) {
      violations.push(`${rel}: fetch + Bearer authorization outside Boss OS's model router (bearer-token model call)`);
    }
  }

  if (checkStale) {
    for (const rel of BOSS_ROUTER) {
      if (!(rel in files)) violations.push(`${rel}: listed in BOSS_ROUTER but no longer exists — remove the entry`);
    }
  }

  return violations;
}

function scanRealTree() {
  const files = {};
  for (const full of listSourceFiles()) {
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    files[rel] = readFileSync(full, "utf8");
  }
  return files;
}

function selfTest() {
  const clean = {
    [WORKSPACE_BEARER]: 'await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: "Bearer " + key } });',
    "src/worker/boss/router/openai.ts":
      'await fetch("https://api.openai.com/v1/responses", { headers: { authorization: `Bearer ${key}` } });',
    "src/worker/boss/lanes/writer.ts": 'import { route } from "../router/route";\nawait route(env, input);',
  };
  const failures = [];
  if (checkSources(clean).length !== 0) failures.push("clean fixture was flagged (the router must be the allowed path)");

  const cases = {
    "provider SDK import in a Boss OS lane": { ...clean, "src/worker/boss/lanes/sneaky.ts": 'import OpenAI from "openai";\nconst c = new OpenAI();' },
    "scoped provider SDK import": { ...clean, "src/worker/boss/sneaky.ts": 'import { Anthropic } from "@anthropic-ai/sdk";' },
    "model hostname literal outside the router": { ...clean, "src/worker/ai/sneaky.ts": 'const url = "https://api.openai.com/v1/chat/completions";' },
    "model host in the Google Workspace broker": { ...clean, [WORKSPACE_BEARER]: 'await fetch("https://api.openai.com/v1/responses")' },
    "bearer-token model call in the client": { ...clean, "src/client/sneaky.tsx": 'await fetch(url, { headers: { authorization: "Bearer " + key } });' },
    "a router file in a look-alike folder": { ...clean, "src/worker/boss/routerx/openai.ts": 'await fetch("https://api.openai.com/v1")' },
  };
  for (const [name, files] of Object.entries(cases)) {
    if (checkSources(files).length === 0) failures.push(`violating fixture NOT caught: ${name}`);
  }
  if (!checkSources(clean, true).some((v) => v.includes("no longer exists"))) failures.push("violating fixture NOT caught: a stale BOSS_ROUTER entry");
  return { failures, caseCount: Object.keys(cases).length + 1 };
}

if (process.argv.includes("--self-test")) {
  const { failures, caseCount } = selfTest();
  if (failures.length > 0) {
    console.error("SELF-TEST FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `SELF-TEST PASSED: clean fixture passes (the router is the only path); all ${caseCount} violating fixtures are caught.`,
  );
  process.exit(0);
}

const realTree = scanRealTree();
const scannedCount = Object.keys(realTree).length;
// A scan that finds nothing to check is not a pass — it is a scan that stopped reaching its own
// target. If SRC_DIR is ever renamed, moved, or the walk silently returns nothing, this used to
// print "PASSED" having examined zero files. Reproduced 2026-09: pointing the scan at an empty
// directory still printed "AI BOUNDARY SCAN PASSED". A guard on the count, not just the content.
if (scannedCount === 0) {
  console.error(`AI BOUNDARY SCAN FAILED — examined 0 source files under ${path.relative(ROOT, SRC_DIR)}.`);
  console.error("A scan that checks nothing is not a passing scan. Confirm SRC_DIR resolves to the real");
  console.error("source tree before trusting this result.");
  process.exit(1);
}
const violations = checkSources(realTree, true);
if (violations.length > 0) {
  console.error("AI BOUNDARY SCAN FAILED — direct-provider-call violations:");
  for (const v of violations) console.error(`  ✗ ${v}`);
  // What to do about it. A scan that names the breach and not the fix costs more than it saves:
  // the reader who trips this is usually the one who least knows where the boundary is.
  console.error("\nEvery model call goes through Boss OS's model router (src/worker/boss/router/), which");
  console.error("applies the cost mode, the hard budget stops, the privacy class and the spend record.");
  console.error("A genuinely new vendor gets a file there, named in BOSS_ROUTER with its reason.");
  process.exit(1);
}
console.log("AI BOUNDARY SCAN PASSED: no provider SDK imports, model API hostnames, or bearer-token model calls outside Boss OS's model router, and every router entry still exists.");
