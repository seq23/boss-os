#!/usr/bin/env node
/**
 * BOSS OS'S INBOX IS BOSS OS'S. IT NEVER REACHES INTO WEST PEEK.
 *
 * ─── Her words, 10 September 2026 ───────────────────────────────────────────
 *
 *   "why are u sharing anything with west peek's os? why? this is a separate repo and domain."
 *
 * and, on how to build it instead:
 *
 *   "u can copy the code thats fine."
 *
 * So a COPY is correct and an IMPORT is not, and the difference is the whole of this guard. A copy
 * that diverges is two businesses evolving separately, which is what they are. A shared module is
 * one routing table deciding the fate of two companies' mail — and the day somebody adds a tag to
 * West Peek's table to fix a West Peek bug, her personal mail changes destination and nothing says
 * so.
 *
 * ─── This is her third correction of the same blend ────────────────────────
 *
 * Spry versus West Peek, then West Peek versus Boss OS, then this. A rule she has had to state
 * three times is a rule that belongs in the build, not in a comment somebody will read once.
 *
 * ─── WHAT IS ASSERTED ──────────────────────────────────────────────────────
 *
 *   1. No Boss OS intake file imports from a West Peek intake module. Structural, not textual: an
 *      `import` or a `require`, which is the thing that actually creates runtime coupling.
 *   2. No Boss OS intake file names a West Peek mailbox, domain or tag. A hardcoded
 *      `os@joinwestpeek.com` needs no import to send her mail to the wrong business.
 *   3. Nothing outside Boss OS's own intake resolves an employee tag. `#firstname` is Boss OS's
 *      convention and a West Peek file matching on it would be routing her employees.
 *   4. The `email()` handler DISPATCHES ON THE RECIPIENT. This is the one that matters most in
 *      practice: the handler used to pass every message to West Peek's router unconditionally, so
 *      pointing boss@ at this Worker would have filed her mail into a fund's deal funnel. A guard
 *      that only checked imports would have called that file clean.
 *
 * RULE 0: FINDING NOTHING TO EXAMINE IS A FAILURE. If the Boss intake files stop matching this
 * scan's idea of where they live, the guard is standing over an empty room while the real code is
 * unwatched — which is this portfolio's named defect "a guard that cannot reach what it governs".
 *
 *   node scripts/validate/boss-intake-is-boss-only.mjs
 *   node scripts/validate/boss-intake-is-boss-only.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Boss OS's intake, and everything that is allowed to route her mail. */
const BOSS_INTAKE = [
  "src/shared/boss/intake/mail.mjs",
  "src/shared/boss/intake/liveBook.mjs",
  "src/worker/boss/intake/inboundMail.ts",
  "src/worker/boss/capital/book.ts",
  "src/worker/boss/capital/bookNag.ts",
];

/** West Peek's intake. Foreign code in this repo; readable, copyable, never importable from Boss OS. */
const WEST_PEEK_INTAKE = [
  "shared/intake/emailTriggers",
  "effects/inboundEmail",
  "services/dealIntake",
  "effects/networkOsClient",
  "services/portfolioReporting",
];

/** West Peek's addresses and its tag convention. */
const WEST_PEEK_IDENTITY = [
  /joinwestpeek\.com/i,
  /westpeek\.ventures/i,
  /#wp[a-z]+/i,
  /*
   * `INTAKE_MAILBOX` IS WEST PEEK'S CONSTANT. `BOSS_INTAKE_MAILBOX` IS HERS, AND THE FIRST DRAFT OF
   * THIS PATTERN COULD NOT TELL THEM APART — a plain `\b` does not fire on the boundary between `_`
   * and `I`, so every correct use of Boss OS's own mailbox constant was reported as a violation.
   * A guard whose first live run fails on the compliant code is a guard that gets suppressed rather
   * than fixed, which is how a boundary quietly stops being enforced.
   */
  /(?<![A-Za-z0-9_])INTAKE_MAILBOX\b/,
];

const importedModules = (source) => [
  ...source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g),
  ...source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g),
  ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
  ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
].map((m) => m[1]);

/** Comments describe the boundary constantly and must. Only real code may violate it. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Rules 1 and 2, over the Boss OS intake files. */
export function intakeViolations(files) {
  const bad = [];
  for (const [name, raw] of Object.entries(files)) {
    const code = stripComments(raw);
    for (const spec of importedModules(code)) {
      if (WEST_PEEK_INTAKE.some((wp) => spec.includes(wp))) {
        bad.push(`${name} imports "${spec}" — West Peek's intake. Copy what you need; never import it.`);
      }
    }
    for (const pattern of WEST_PEEK_IDENTITY) {
      const hit = pattern.exec(code);
      if (hit) bad.push(`${name} names West Peek in live code: "${hit[0]}". Boss OS mail is boss@sequoiataylor.com only.`);
    }
  }
  return bad;
}

/** Rule 3: only Boss OS's own intake may resolve a `#firstname`. */
export function tagLeakViolations(files) {
  const bad = [];
  for (const [name, raw] of Object.entries(files)) {
    if (BOSS_INTAKE.includes(name)) continue;
    const code = stripComments(raw);
    if (/\bseatTag\s*\(|\brouteToSeat\s*\(/.test(code) && !name.startsWith("src/worker/boss/") && !name.startsWith("tests/")) {
      bad.push(`${name} resolves a Boss OS employee tag. #firstname belongs to Boss OS's intake.`);
    }
  }
  return bad;
}

/**
 * Rule 4: the email handler dispatches on the recipient before either router sees the message.
 *
 * THE ONE A TEXTUAL IMPORT SCAN WOULD HAVE MISSED. `src/worker/index.ts` legitimately imports both
 * handlers — it is the seam where the two meet — so it can never be judged by its imports. What has
 * to be true is that Boss OS's handler is chosen by the ADDRESS, and that West Peek's is gated
 * rather than being the unconditional default it used to be.
 */
export function dispatchViolations(indexSource) {
  const bad = [];
  if (indexSource === null) return ["src/worker/index.ts could not be read, so the email dispatch is unverified"];
  const code = stripComments(indexSource);
  const handler = /async\s+email\s*\([\s\S]*?\n\s{2}\},/.exec(code)?.[0];
  if (!handler) return ["no email() handler was found in src/worker/index.ts — this guard is watching nothing"];

  if (!/isBossMailbox\s*\(/.test(handler)) {
    bad.push("email() does not test the recipient with isBossMailbox() — every message would take one branch regardless of who it was for");
  }
  if (!/handleBossInboundMail\s*\(/.test(handler)) {
    bad.push("email() never calls handleBossInboundMail() — Boss OS's own mailbox is unreachable");
  }
  const wp = handler.indexOf("handleInboundEmail(");
  if (wp !== -1) {
    // West Peek's handler must sit behind an explicit recipient test, not be the fall-through.
    const before = handler.slice(0, wp);
    if (!/INTAKE_MAILBOX/.test(before)) {
      bad.push("handleInboundEmail() is reachable without an explicit West Peek recipient test — her mail would be routed by West Peek's tag table");
    }
    if (before.indexOf("isBossMailbox") === -1) {
      bad.push("West Peek's handler is reached before the Boss OS recipient test");
    }
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  const cases = [
    ["an import of West Peek's trigger table",
     { "src/worker/boss/intake/inboundMail.ts": 'import { EMAIL_TRIGGERS } from "../../../shared/intake/emailTriggers";' }, true],
    ["a require of West Peek's handler",
     { "src/worker/boss/intake/inboundMail.ts": 'const h = require("../../effects/inboundEmail");' }, true],
    ["a dynamic import of West Peek's deal intake",
     { "src/worker/boss/intake/inboundMail.ts": 'const m = await import("../../services/dealIntake");' }, true],
    ["a hardcoded West Peek mailbox with no import at all",
     { "src/shared/boss/intake/mail.ts": 'export const FALLBACK = "os@joinwestpeek.com";' }, true],
    ["a West Peek tag in Boss OS's router",
     { "src/shared/boss/intake/mail.ts": 'if (text.includes("#wpdealflow")) return dealflow;' }, true],
    ["prose about the boundary, which is required and must stay legal",
     { "src/shared/boss/intake/mail.ts": '/* Not os@joinwestpeek.com — that is West Peek, and #wpdealflow is its tag. */\nexport const M = "boss@sequoiataylor.com";' }, false],
    ["Boss OS importing its own modules",
     { "src/worker/boss/intake/inboundMail.ts": 'import { routeToSeat } from "../../../shared/boss/intake/mail";' }, false],
  ];
  let failed = 0;
  for (const [name, files, shouldCatch] of cases) {
    const caught = intakeViolations(files).length > 0;
    if (caught !== shouldCatch) { console.error(`  ✗ ${name} — expected ${shouldCatch ? "caught" : "clean"}`); failed += 1; }
    else console.log(`  ✓ ${name}`);
  }

  const dispatchCases = [
    ["the old unconditional handler, which is the real bug",
     "  async email(message, env, ctx) {\n    await handleInboundEmail(message, env);\n  },", true],
    ["Boss OS reached only after West Peek has already taken it",
     "  async email(message, env, ctx) {\n    await handleInboundEmail(message, env);\n    if (isBossMailbox(message.to)) await handleBossInboundMail(message, env);\n  },", true],
    ["dispatch on the recipient, Boss OS first",
     "  async email(message, env, ctx) {\n    if (isBossMailbox(message.to)) { await handleBossInboundMail(message, env); return; }\n    if (message.to === INTAKE_MAILBOX) { await handleInboundEmail(message, env); return; }\n  },", false],
  ];
  for (const [name, src, shouldCatch] of dispatchCases) {
    const caught = dispatchViolations(src).length > 0;
    if (caught !== shouldCatch) { console.error(`  ✗ dispatch: ${name} — expected ${shouldCatch ? "caught" : "clean"}`); failed += 1; }
    else console.log(`  ✓ dispatch: ${name}`);
  }

  const leak = tagLeakViolations({ "src/worker/effects/inboundEmail.ts": "const seat = routeToSeat(raw, roster);" });
  if (leak.length === 0) { console.error("  ✗ a West Peek file resolving a Boss OS tag was not caught"); failed += 1; }
  else console.log("  ✓ a West Peek file resolving a Boss OS tag");

  if (failed) { console.error(`BOSS INTAKE SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("BOSS INTAKE SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const files = {};
for (const rel of BOSS_INTAKE) {
  const full = join(ROOT, rel);
  if (existsSync(full)) files[rel] = readFileSync(full, "utf8");
}

/*
 * RULE 0. A scan that examined nothing is not a pass — it is a guard pointed at files that have
 * moved, reporting clean about code it can no longer see.
 */
if (Object.keys(files).length === 0) {
  console.error("BOSS INTAKE SCAN FAILED — 0 of the Boss OS intake files were found.");
  console.error(`  Expected: ${BOSS_INTAKE.join(", ")}`);
  console.error("  They have moved or been renamed. Point this guard at them deliberately.");
  process.exit(2);
}
if (Object.keys(files).length < BOSS_INTAKE.length) {
  console.error("BOSS INTAKE SCAN FAILED — some intake files are missing, so the boundary is only partly checked:");
  for (const rel of BOSS_INTAKE) if (!files[rel]) console.error(`  ✗ ${rel} not found`);
  process.exit(2);
}

const indexPath = join(ROOT, "src/worker/index.ts");
const indexSource = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;

const problems = [
  ...intakeViolations(files),
  ...dispatchViolations(indexSource),
  ...tagLeakViolations({ "src/worker/effects/inboundEmail.ts": existsSync(join(ROOT, "src/worker/effects/inboundEmail.ts")) ? readFileSync(join(ROOT, "src/worker/effects/inboundEmail.ts"), "utf8") : "" }),
];

if (problems.length) {
  console.error(`BOSS INTAKE SCAN FAILED — ${problems.length} violation(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\n  \"why are u sharing anything with west peek's os? why? this is a separate repo and domain.\"");
  console.error("  Copy what you need from West Peek's intake. Never import it, and never let one");
  console.error("  routing table decide two businesses' mail.");
  process.exit(1);
}

console.log(
  `BOSS INTAKE SCAN PASSED: ${Object.keys(files).length} Boss OS intake file(s) examined, none importing or `
  + "naming West Peek; email() dispatches on the recipient and West Peek's handler is gated behind its own mailbox.",
);
