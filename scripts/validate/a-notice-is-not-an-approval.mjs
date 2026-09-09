#!/usr/bin/env node
/**
 * NOTHING ASKS FOR A VERDICT IT CANNOT USE.
 *
 * ─── Confirmed on production, 9 September 2026 ─────────────────────────────
 *
 *   SELECT kind, status, COUNT(*) FROM approvals GROUP BY kind, status
 *     backend_run    | approved | 5
 *     judgement_call | approved | 2
 *     notice         | approved | 8
 *
 * Eight of the fifteen decisions in that table were not decisions. An employee told her something —
 * "Monique emailed you the LP outcomes" — and the Inbox rendered it with Approve / Reject / Later.
 * There was nothing to approve, so she pressed Approve eight times to make a sentence go away, and
 * the system recorded eight approvals she never gave.
 *
 * THE DAMAGE IS NOT TO THE NOTICES. It is to the real approvals beside them. A screen that asks for
 * a verdict on things that have no verdict teaches its reader that the green button is a dismiss
 * button — and the next card is a letter going to a firm, or a cover going to Amazon.
 *
 * ─── The four links, and any one breaking rebuilds the defect ──────────────
 *
 *   1. THE COUNT EXCLUDES NOTICES AT THE SOURCE. `approvals/pending.ts` must subtract them in SQL,
 *      not on the page — past the hundred-row cap the split on the page says nothing about the
 *      split in the table.
 *   2. THE CARD BRANCHES ON IT. `Docket.tsx` must render a notice differently, and that branch must
 *      not contain Reject or Later, which mean nothing about a sentence.
 *   3. THE SCREEN KEEPS THEM APART. The Inbox must fetch and render notices in their own section,
 *      because styling them differently inside the same list leaves them in the same count.
 *   4. SOMETHING ACTUALLY RAISES ONE. A guard governing a kind nothing produces is a guard that
 *      cannot reach what it governs — this repository's named defect class.
 *
 * RULE 0: zero notice-raising callers, or zero files examined, is a FAILURE.
 *
 *   node scripts/validate/a-notice-is-not-an-approval.mjs
 *   node scripts/validate/a-notice-is-not-an-approval.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PENDING = "src/worker/boss/approvals/pending.ts";
const DOCKET = "src/client/boss/components/Docket.tsx";
const INBOX = "src/client/boss/pages/Inbox.tsx";

/**
 * The count must be filtered in SQL, in the one function every surface reads.
 *
 * ANCHORED ON `SELECT COUNT(*)` SPECIFICALLY, and that precision is not fussiness. The first version
 * matched any `COUNT(*)` within 200 characters of the exclusion — which the by-risk breakdown and
 * the page's own `COUNT(*) OVER ()` both satisfy. It passed a file whose HEADLINE TOTAL had been
 * un-filtered, which is the one number this whole guard exists for. A validator that reports on a
 * neighbouring statement is worse than none.
 */
export function countIncludesNotices(src) {
  return !/SELECT COUNT\(\*\)[^`]{0,200}?NOT \(\$\{IS_NOTICE\}\)/.test(src);
}

/**
 * The notice branch of the card, and what must not be in it.
 *
 * Sliced from the branch test to the `) : (` that opens the decision arm, so the scan asks about
 * the notice arm alone rather than about a file that mentions Reject somewhere.
 */
export function noticeArm(src) {
  const at = src.indexOf('approval.kind === "notice"');
  if (at === -1) return null;
  const end = src.indexOf(") : (", at);
  return src.slice(at, end === -1 ? src.length : end);
}

export function verdictButtonsIn(arm) {
  return [">Reject", "Reject<", "btn-reject", "Later<", "Approve<"].filter((b) => arm.includes(b));
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const fail = [];
  const say = (name, ok) => { if (!ok) fail.push(name); };

  say("a filtered count passes",
    !countIncludesNotices("const c = await db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE ${where} AND NOT (${IS_NOTICE})`)"));
  say("an unfiltered count is caught",
    countIncludesNotices("const c = await db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE ${where}`)"));
  // The trap that let a broken file through: a NEIGHBOURING statement carrying the exclusion.
  say("a filtered by-risk query does not excuse an unfiltered total",
    countIncludesNotices(
      "db.prepare(`SELECT risk, COUNT(*) AS n FROM approvals WHERE ${where} AND NOT (${IS_NOTICE}) GROUP BY risk`);\n"
      + "db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE ${where}`);",
    ));

  const clean = noticeArm('{approval.kind === "notice" ? (\n<button>Got it</button>\n) : (\n<button className="btn-reject">Reject</button>\n)}');
  say("the decision arm is not scanned", verdictButtonsIn(clean).length === 0);

  const dirty = noticeArm('{approval.kind === "notice" ? (\n<button className="btn-reject">Reject</button>\n) : (\n<span/>\n)}');
  say("a verdict button inside the notice arm is caught", verdictButtonsIn(dirty).length > 0);

  say("a card with no notice branch at all is caught", noticeArm("<button>Approve</button>") === null);

  if (fail.length) {
    console.error("SELF-TEST FAILED:");
    for (const f of fail) console.error("  ✗", f);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED: 6/6 cases — an unfiltered count, a verdict button on a notice, and a missing branch are all caught.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const problems = [];
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);

const pending = read(PENDING);
if (!pending) problems.push(`${PENDING} is missing — the one place the count is computed does not exist.`);
else if (countIncludesNotices(pending)) {
  problems.push(
    `${PENDING} counts notices as things waiting on her. Filter them in SQL, not on the page: past ` +
      "the hundred-row cap the split on the page says nothing about the split in the table.",
  );
}

const docket = read(DOCKET);
if (!docket) problems.push(`${DOCKET} is missing.`);
else {
  const arm = noticeArm(docket);
  if (arm === null) {
    problems.push(`${DOCKET} does not branch on \`kind === "notice"\`, so a sentence gets Approve / Reject / Later.`);
  } else {
    for (const b of verdictButtonsIn(arm)) {
      problems.push(`${DOCKET} still offers "${b.replace(/[<>]/g, "")}" on a notice. There is nothing to reject about being told something.`);
    }
  }
}

const inbox = read(INBOX);
if (!inbox) problems.push(`${INBOX} is missing.`);
else if (!/api\.notices\(/.test(inbox) || !/nothing here needs an answer/i.test(inbox)) {
  problems.push(
    `${INBOX} does not give notices their own section. Styling them differently inside the pending ` +
      "list leaves them in the same list and the same count, which is the whole defect.",
  );
}

/*
 * RULE 0. A guard over a kind nothing raises is a guard that cannot reach what it governs — and this
 * repository has shipped exactly that before.
 */
const opsDir = join(ROOT, "scripts/ops");
const raisers = readdirSync(opsDir)
  .filter((f) => f.endsWith(".mjs"))
  .filter((f) => /kind:\s*"notice"/.test(readFileSync(join(opsDir, f), "utf8")));
if (raisers.length === 0) {
  problems.push("nothing under scripts/ops raises a notice, so this guard governs a kind that does not occur.");
}

if (problems.length) {
  console.error("NOTICE-VERSUS-APPROVAL SCAN FAILED:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nA screen that asks for a verdict on things with no verdict teaches her the green button is a\n" +
      "dismiss button. The next card is a letter going to a firm.",
  );
  process.exit(1);
}

console.log(
  `NOTICE-VERSUS-APPROVAL SCAN PASSED: the count excludes notices in SQL, the card gives them one ` +
    `honest button, the Inbox gives them their own section, and ${raisers.length} script(s) raise them.`,
);
