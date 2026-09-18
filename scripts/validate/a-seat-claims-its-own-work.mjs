#!/usr/bin/env node
/**
 * EVERY SUBSCRIPTION SEAT CAN BE PREFLIGHTED, CAN BE CLAIMED FOR, AND SURVIVES A VAULT FULL OF KEYS.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * On 18 September 2026 there was no Executive Intelligence Report. The duty fired at 12:00:57 UTC,
 * the Worker parked the work, and nothing ever claimed it. `~/Library/Logs/boss-agent/agent.err`
 * held four consecutive copies of one line:
 *
 *   ANTHROPIC_API_KEY is set. This backend is designed to run on the owner's own session; remove
 *   the key or register a separate keyed backend deliberately.
 *
 * The refusal was right in principle and pointed at the wrong process. `com.seq.boss-agent` runs
 * the claimer under `npm run vault:run`, which injects every vault key into the PARENT; the key
 * entered the vault the night before, when `bk_anthropic` was commissioned. But the CLI is spawned
 * with `childEnv()`, an allowlist of nine harmless names, so no key of any spelling could ever have
 * reached it. The guard could not reach what it governed, and its only live effect was to exit 1
 * before a single run was claimed. A guard whose sole observable behaviour is a false stop.
 *
 * AND UNDERNEATH IT, A SECOND SEAT NOTHING COULD CLAIM FOR. `workOnce` defaults
 * `backendId = "bk_claude_code"` and the claimer never passed one, so `bk_codex` — enabled the same
 * night, priced, proven with a real generation, with `codexExecutor` registered in AGENT_EXECUTORS —
 * had no path by which its work could ever be picked up. Registered, documented and unreachable:
 * the defect this repository names most often, one layer below where it usually catches it.
 *
 * ─── What is checked, and why each one is behaviour rather than prose ───────
 *
 *   1. THE TWO SEAT LISTS MATCH. `AGENT_EXECUTORS` (who runs the envelope) and `SEAT_PREFLIGHT`
 *      (who answers "can I authenticate") must have identical key sets. Two components each keeping
 *      their own list with no link between them is how `bk_codex` got an executor and no preflight.
 *
 *   2. A VAULT-SHAPED PARENT ENVIRONMENT DOES NOT REFUSE ANY SEAT. Every seat's `describeAuth` is
 *      called with `childEnv(<every key in the vault>)` and must come back ok. This is the exact
 *      regression, pinned by running the real functions rather than by reading a comment.
 *
 *   3. THE REFUSAL IS STILL LIVE. Each seat's `describeAuth`, handed an environment that DOES carry
 *      its key, must still refuse. Fixing (2) by deleting the check would pass (2) and fail here.
 *
 *   4. `childEnv` LEAKS NOTHING. The allowlist is asserted directly: given every credential name
 *      this repository knows, the child environment contains none of them. (2) is only safe because
 *      of this, so the coupling is checked rather than assumed.
 *
 *   5. THE CLAIMER PREFLIGHTS ON THE CHILD ENVIRONMENT AND CLAIMS PER SEAT. `agent.mjs` must pass
 *      `childEnv(process.env)` into the preflight, must iterate `SEAT_PREFLIGHT`, and must pass a
 *      `backendId` into `workOnce`. A bare `describeAuth()` there is the original bug returning.
 *
 *   6. A DEAD SEAT IS SKIPPED, NOT FATAL. `agent.mjs` may only exit non-zero when NO seat is usable.
 *      One seat's missing credential must never stop the other from doing the day's work — that is
 *      what turns a chain member into a dependency, which is how `bk_local_runtime` became "NO
 *      LOCAL HOST, deferred indefinitely".
 *
 * RULE 0: examining zero seats is a FAILURE, not a pass. A loop over an empty set is how a
 * validator stays green for ever while the thing it guards rots.
 *
 *   node scripts/validate/a-seat-claims-its-own-work.mjs
 *   node scripts/validate/a-seat-claims-its-own-work.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const AGENT = "scripts/sync-agent/agent.mjs";

/**
 * Every credential name that has ever been in this owner's vault, plus the two that matter most.
 *
 * SPELLED OUT RATHER THAN READ FROM THE VAULT. Reading the live vault would make this validator
 * pass or fail depending on which machine ran it, and CI has no vault at all — a check that cannot
 * run in CI is a check that runs once. These are the names; `npm run vault:status` is the machine.
 */
export const VAULT_SHAPED_ENV = {
  ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
  OPENAI_API_KEY: "sk-not-a-real-key",
  OPENROUTER_API_KEY: "sk-or-not-a-real-key",
  GEMINI_API_KEY: "not-a-real-key",
  PERPLEXITY_API_KEY: "not-a-real-key",
  CLOUDFLARE_API_TOKEN: "not-a-real-token",
  RESEND_API_KEY: "not-a-real-key",
  BOSS_PASSCODE: "not-a-real-passcode",
  GSC_SERVICE_ACCOUNT_JSON: "{}",
  // The harmless ones the child is allowed to keep, so the allowlist is exercised in both
  // directions rather than only in the refusing one.
  PATH: "/usr/bin:/bin",
  HOME: "/Users/nobody",
};

/** The names in VAULT_SHAPED_ENV that are credentials and must never reach a child process. */
export const CREDENTIAL_NAMES = Object.keys(VAULT_SHAPED_ENV).filter((k) => k !== "PATH" && k !== "HOME");

/**
 * Does `agent.mjs` preflight on the child's environment and claim for each seat by name?
 *
 * READ AS SOURCE, NOT RUN. Running the claimer would unlock a live Worker and claim real work; the
 * three facts below are structural and a regex can hold them honestly. Each pattern is written so
 * that the ORIGINAL BUGGY LINE fails it: `describeAuth()` with no argument, and a `workOnce` call
 * with no `backendId`, are exactly what this refuses to find.
 */
export function claimerShape(src) {
  // Comments carry the words "describeAuth()" and "backendId" in prose; strip them so the check
  // reads code rather than the story told about the code.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  const preflightCall = /describeAuth\s*\(\s*childEnvironment\s*\)|describeAuth\s*\(\s*childEnv\s*\(/.test(code);
  return {
    // The preflight is handed the child's environment.
    buildsChildEnv: /childEnv\s*\(\s*process\.env\s*\)/.test(code),
    preflightsOnChildEnv: preflightCall,
    // and never the bare parent's.
    bareDescribeAuth: /describeAuth\s*\(\s*\)/.test(code),
    // Every seat is asked, not just the first one somebody wired.
    iteratesSeats: /SEAT_PREFLIGHT/.test(code),
    // and the claim names the backend it is claiming for.
    passesBackendId: /workOnce\s*\(\s*\{[^}]*\bbackendId\b/.test(code),
    // A single unusable seat must not be fatal; only an empty set of usable seats may exit.
    exitsOnlyWhenNoSeatUsable: /seats\.length\s*===\s*0[\s\S]{0,400}?process\.exit\(1\)/.test(code),
  };
}

async function scan() {
  const problems = [];
  const { AGENT_EXECUTORS, SEAT_PREFLIGHT, childEnv } = await import("../sync-agent/runner.mjs");

  const executorKeys = Object.keys(AGENT_EXECUTORS).sort();
  const preflightKeys = Object.keys(SEAT_PREFLIGHT).sort();

  // 1. The two lists are one list.
  if (JSON.stringify(executorKeys) !== JSON.stringify(preflightKeys)) {
    problems.push(
      `AGENT_EXECUTORS and SEAT_PREFLIGHT name different seats — executors [${executorKeys.join(", ")}] ` +
      `vs preflights [${preflightKeys.join(", ")}]. A seat in one list and not the other is either a ` +
      `seat that runs unchecked or a seat nothing can claim for.`,
    );
  }

  // 4. childEnv leaks nothing. Checked BEFORE 2, because 2 is only meaningful if this holds.
  const child = childEnv(VAULT_SHAPED_ENV);
  for (const name of CREDENTIAL_NAMES) {
    if (child[name] !== undefined) {
      problems.push(
        `childEnv() passed ${name} through to the child process. The allowlist has grown a credential, ` +
        `which means an agent_executed run could be billed to a key rather than to the owner's seat.`,
      );
    }
  }

  let seatsChecked = 0;
  for (const backendId of preflightKeys) {
    const describeAuth = await SEAT_PREFLIGHT[backendId]();
    seatsChecked += 1;

    // 2. A vault-shaped parent must not refuse the seat.
    const underVault = describeAuth(childEnv(VAULT_SHAPED_ENV));
    if (!underVault.ok) {
      problems.push(
        `${backendId} refuses to run when the claimer is launched under \`vault:run\`: "${underVault.detail}". ` +
        `This is the 18 Sep 2026 fault exactly — the vault injects keys into the PARENT, childEnv strips ` +
        `them before the CLI starts, and refusing on the parent stops the morning brief for nothing.`,
      );
    }

    // 3. The refusal is still live where it belongs.
    const leaked = { ...child };
    for (const name of CREDENTIAL_NAMES) leaked[name] = VAULT_SHAPED_ENV[name];
    const underLeak = describeAuth(leaked);
    if (underLeak.ok) {
      problems.push(
        `${backendId} accepts an environment that DOES carry a credential. The refusal has been deleted ` +
        `rather than aimed correctly: if childEnv's allowlist ever leaks a key, this seat would quietly ` +
        `bill it instead of the subscription the owner already pays for.`,
      );
    }
  }

  // 5 and 6. The claimer's shape.
  const shape = claimerShape(read(AGENT));
  if (!shape.buildsChildEnv || !shape.preflightsOnChildEnv) {
    problems.push(
      `${AGENT} does not preflight on childEnv(process.env). The preflight must judge the environment the ` +
      `child actually receives, not the one the vault handed the parent.`,
    );
  }
  if (shape.bareDescribeAuth) {
    problems.push(
      `${AGENT} still calls describeAuth() with no argument, which reads process.env — the original bug, ` +
      `verbatim. It is the line that cost the 18 Sep 2026 Executive Intelligence Report.`,
    );
  }
  if (!shape.iteratesSeats) {
    problems.push(
      `${AGENT} does not iterate SEAT_PREFLIGHT. One hard-coded seat is how bk_codex was enabled, priced ` +
      `and proven, and still had no path by which its work could be claimed.`,
    );
  }
  if (!shape.passesBackendId) {
    problems.push(
      `${AGENT} calls workOnce() without a backendId, so it claims only for the default seat ` +
      `(bk_claude_code) and work parked for any other seat waits for ever.`,
    );
  }
  if (!shape.exitsOnlyWhenNoSeatUsable) {
    problems.push(
      `${AGENT} does not gate its non-zero exit on an empty set of usable seats. One seat with a missing ` +
      `credential must be skipped and named, never allowed to stop the other seat's work — that is the ` +
      `difference between a chain member and a dependency.`,
    );
  }

  return { seatsChecked, problems };
}

// ─── Self-test: the source-shape reader, proved on text ─────────────────────

function selfTest() {
  let failed = 0;
  const good = `
    const childEnvironment = childEnv(process.env);
    for (const [backendId, load] of Object.entries(SEAT_PREFLIGHT)) {
      const describeAuth = await load();
      const auth = describeAuth(childEnvironment);
      if (auth.ok) seats.push(backendId);
    }
    if (seats.length === 0) { process.exit(1); }
    out = await workOnce({ origin, deviceId, cookie, backendId });
  `;
  const cases = [
    { name: "the fixed claimer passes every check", src: good,
      want: { buildsChildEnv: true, preflightsOnChildEnv: true, bareDescribeAuth: false, iteratesSeats: true, passesBackendId: true, exitsOnlyWhenNoSeatUsable: true } },
    { name: "the ORIGINAL buggy line is caught", src: `const auth = describeAuth();\nif (!auth.ok) process.exit(1);\nconst out = await workOnce({ origin, deviceId, cookie });`,
      want: { buildsChildEnv: false, preflightsOnChildEnv: false, bareDescribeAuth: true, iteratesSeats: false, passesBackendId: false, exitsOnlyWhenNoSeatUsable: false } },
    { name: "a comment that merely talks about describeAuth() is not code", src: `/* it used to call describeAuth() on process.env */\n${good}`,
      want: { buildsChildEnv: true, preflightsOnChildEnv: true, bareDescribeAuth: false, iteratesSeats: true, passesBackendId: true, exitsOnlyWhenNoSeatUsable: true } },
    { name: "a claimer that exits on the FIRST bad seat is caught", src: good.replace("if (seats.length === 0) { process.exit(1); }", "if (!auth.ok) { process.exit(1); }"),
      want: { buildsChildEnv: true, preflightsOnChildEnv: true, bareDescribeAuth: false, iteratesSeats: true, passesBackendId: true, exitsOnlyWhenNoSeatUsable: false } },
  ];
  for (const c of cases) {
    const got = claimerShape(c.src);
    for (const [k, v] of Object.entries(c.want)) {
      if (got[k] !== v) {
        console.error(`  ✗ ${c.name}: ${k} expected ${v}, got ${got[k]}`);
        failed += 1;
      }
    }
  }
  if (failed) {
    console.error(`\nSELF-TEST FAILED: ${failed} assertion(s)`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const { seatsChecked, problems } = await scan();

/*
 * RULE 0. No seats means AGENT_EXECUTORS/SEAT_PREFLIGHT stopped being shaped the way this reads
 * them — a broken scan, not a clean repo — and it is the state in which every assertion above
 * passes over an empty loop.
 */
if (seatsChecked === 0) {
  console.error(
    "SEAT SCAN EXAMINED NO SEATS. SEAT_PREFLIGHT in scripts/sync-agent/runner.mjs is empty or no longer\n" +
    "shaped the way this scan reads it, so every check below ran over nothing. That is a broken scan.",
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error("SEAT SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(
    "A seat that cannot be claimed for, or that refuses itself because the vault filled the parent's\n" +
    "environment, is a morning with no brief and nothing anywhere saying why.",
  );
  process.exit(1);
}

console.log(
  `SEAT SCAN PASSED: ${seatsChecked} agent_executed seat(s), each preflighted and each claimable by name; ` +
  `a vault-shaped environment refuses none of them, a leaked credential still refuses every one of them, ` +
  `and one dead seat cannot stop the others.`,
);
selfTest();
