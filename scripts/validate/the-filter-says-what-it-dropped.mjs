#!/usr/bin/env node
/**
 * A FILTER THAT CANNOT SAY WHAT IT DISCARDED IS NOT A FILTER, IT IS A LOSS.
 *
 * ─── The defect class this is the guard for ─────────────────────────────────
 *
 * `interest-ledger.mjs` reads 104,241 messages and keeps a few thousand. Every message it throws
 * away is a deal she will never learn she missed, and a discard is invisible by nature: the run
 * finishes quickly, reports a clean number, and looks exactly the same whether it dropped junk or
 * dropped the market.
 *
 * IF IT EVER DISCARDS 99.9%, THAT IS A BUG WEARING THE COSTUME OF EFFICIENCY. The only thing that
 * makes it visible is that every single message ends in a NAMED bucket and the buckets are printed.
 * This asserts that property on the code, on every build, because it is the kind of property that
 * gets quietly removed by someone tidying up a loop.
 *
 * ─── The five things, and why each one is separate ──────────────────────────
 *
 *   1. EVERY MESSAGE IS ACCOUNTED FOR. The run compares dropped + kept against the census and stops
 *      if they disagree. Without that, a `continue` added later silently eats messages for ever.
 *   2. DROPS ARE NAMED AND COUNTED, not summed into one number. "78% discarded" tells her nothing;
 *      "58 bulk_list_unsubscribe, 40 shape_no_size" tells her which stage to distrust.
 *   3. A TOTAL DISCARD IS A HARD STOP. Keeping nothing out of a non-empty mailbox is the loudest
 *      possible symptom and must not exit 0.
 *   4. AN EMPTY CENSUS IS A HARD STOP. A mailbox of 104,241 messages does not become empty; a
 *      revoked delegation looks identical to a quiet week unless someone says so.
 *   5. THERE IS NO COMPANY-NAME LIST IN THE FILTER. This is the one that matters most and is the
 *      easiest to undo: adding `SpaceX|ByteDance|Stripe` to the regex would raise precision on
 *      Monday and start losing next quarter's name silently for ever. The filter anchors on money
 *      and side vocabulary precisely so it catches names nobody typed into a config.
 *
 * RULE 0: if the filter file is missing or holds no filter, this fails. A scan of nothing is not a
 * clean scan — and a validator that passes on an absent subject is the defect it exists to catch.
 *
 *   node scripts/validate/the-filter-says-what-it-dropped.mjs
 *   node scripts/validate/the-filter-says-what-it-dropped.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILTER = "scripts/ops/interest-ledger.mjs";
const EXTRACTOR = "scripts/ops/interest-extract.mjs";

/**
 * COMPANY NAMES THAT MUST NOT APPEAR IN THE FILTER.
 *
 * These are the names anybody would reach for first, which is exactly why they are the tripwire. A
 * filter that names them has stopped being a filter for "the shape of a trade" and become a filter
 * for "the companies we thought of in September 2026".
 */
const NAME_TRIPWIRE = /\b(spacex|bytedance|stripe|anthropic|openai|databricks|neuralink|anduril|canva|figma|revolut|klarna)\b/i;

/** Pure over { path: source } so the self-test drives the same code the real scan does. */
export function checkFilter(src) {
  const bad = [];
  const must = [
    [/dropped \+ neverRead \+ kept\.length !== census/,
     "it must reconcile dropped + never-read + kept against the census and stop when they disagree"],
    [/NAMED STOP \[MAILBOX_NOT_FULLY_READ\]/,
     "a message that was never read is not a message that was filtered — losing a meaningful share of the mailbox to rate limits must be a hard stop, not a drop reason"],
    [/r\.status === 403/,
     "403 must be retried: Gmail signals a per-user rate limit as 403, and treating it as a refusal once lost 59,451 messages behind a confident summary"],
    [/r\.status === 401/,
     "401 must re-mint the credential: the JWT expires after an hour, this run takes longer, and a dead token once lost 10,483 messages that a slow retry then recovered zero of"],
    [/TOKEN_MAX_AGE_MS/,
     "the token must be re-minted before it can expire, not captured once at the start of a run that outlives it"],
    [/NAMED STOP \[UNACCOUNTED\]/,
     "a message in no bucket must be a named stop, not a rounding difference"],
    [/drops\[[a-zA-Z_]+\] = \(drops\[[a-zA-Z_]+\] \?\? 0\) \+ 1/,
     "every drop must be counted under its own named reason"],
    [/WHAT THE FILTER DISCARDED/,
     "the run must print what it discarded, by reason, rather than only what it kept"],
    [/NAMED STOP \[FILTER_DISCARDED_EVERYTHING\]/,
     "keeping nothing from a non-empty mailbox must exit non-zero — a 100% discard is a bug, not efficiency"],
    [/NAMED STOP \[EMPTY_CENSUS\]/,
     "a census of zero must be a named stop; a revoked delegation reads identically to a quiet week"],
    [/return "bulk_/, "stage 1 must return NAMED structural reasons"],
    [/return "shape_/, "stage 2 must return NAMED shape reasons"],
    [/list-unsubscribe/i,
     "stage 1 must key on List-Unsubscribe — a header is a fact about the message; wording is a guess"],
    [/shares\?/,
     "SIZE must accept a share count as well as a dollar figure: \"40k shares of X available\" is inbound supply with no dollars in it"],
  ];
  for (const [re, why] of must) if (!re.test(src)) bad.push(`${FILTER}: MISSING — ${why}`);

  /*
   * The name tripwire, applied to CODE ONLY. The file's own header explains at length why there is
   * no name list, and naming the companies is how it explains it — a validator that fired on its own
   * rationale is one that gets switched off.
   */
  const code = src.split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  if (NAME_TRIPWIRE.test(code)) {
    const hit = NAME_TRIPWIRE.exec(code)[0];
    bad.push(`${FILTER}: a company name ("${hit}") has entered the filter's executable code. `
      + "A fixed list is guaranteed to miss next quarter's name, and that miss is SILENT. "
      + "Anchor on money plus side vocabulary; let the ledger become the name source afterwards.");
  }
  return bad;
}

/** The two halves must stay two halves: the reader must not gain a model, the model must not gain Gmail. */
export function checkSeparation(filterSrc, extractSrc) {
  const bad = [];
  if (/api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|openrouter\.ai|spawn\(\s*["']claude/.test(filterSrc)) {
    bad.push(`${FILTER}: the mailbox reader now reaches a model. It reads and filters; the model pass is a separate process with no Gmail credential.`);
  }
  if (/gmail\.googleapis\.com|auth\/gmail/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: the extractor now calls Gmail directly. It must only read the candidate files the scan wrote.`);
  }
  if (!/--model/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: no longer names a model, so it inherits the most expensive one available.`);
  }
  if (!/NAMED STOP \[EXTRACTION_NEVER_RAN\]/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: a run where every batch failed must be a named stop. "The market is empty" and "the model was unreachable" are opposite facts.`);
  }
  /*
   * ─── THE ACCEPTANCE TEST, AND WHY IT IS PRECISION RATHER THAN RECALL ─────
   *
   * This first asserted a RECALL test — five deals she knows she did, recovered out of her own mail,
   * the same check that caught a 10-of-12 failure in the LP scan. It was built on an assumption
   * nobody checked, and she corrected it: "i havent done any deals in a while thats the whole point
   * of having this agent help me drum up business." There is no book of closed trades to reconcile
   * against, so recall is not a test that exists here.
   *
   * PRECISION IS, and it matters more anyway: a wrong row becomes a phone call to somebody about
   * stock they never wanted, and one bad call outweighs ten missed matches.
   *
   * WHAT MAKES IT A TEST RATHER THAN A MATTER OF TRUST IS THE QUOTE. She reads twenty-five rows
   * against the twenty-five real sentences that produced them and says which are wrong. So a row
   * without its sentence is refused, and a ledger where nothing carries a sentence is a named stop
   * rather than a screen reporting nothing to review.
   */
  if (!/no quote from the message/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: a row is admitted without the sentence that produced it. `
      + "An unquoted row cannot be checked, and precision judged on real sentences is the only "
      + "acceptance test this ledger has — she has no book of closed deals to reconcile against.");
  }
  if (!/NAMED STOP \[NOTHING_CHECKABLE\]/.test(extractSrc) || !/reviewSet/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: the review surface is gone. Without it the ledger's correctness is `
      + "asserted by the thing that produced it, which is no evidence at all.");
  }
  if (!/wrong\.json|WRONG_FILE/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: there is no way to mark a row wrong. A review she cannot answer is a report.`);
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  const real = readFileSync(join(ROOT, FILTER), "utf8");
  let failed = 0;
  const expect = (name, cond) => { if (cond) console.log(`  ✓ ${name}`); else { console.error(`  ✗ self-test: ${name}`); failed += 1; } };

  expect("the real filter passes", checkFilter(real).length === 0);
  /*
   * BOTH SPELLINGS ARE REMOVED, because the check accepts either. Removing only one left the file
   * passing and the self-test claiming a catch that had not happened — a self-test that proves the
   * validator works when it does not is worse than none at all.
   */
  expect("a filter that stops reconciling is caught",
    checkFilter(real.replace(/dropped \+ neverRead \+ kept\.length !== census/g, "false")).length > 0);
  expect("a filter that folds unread messages back into its drop counts is caught",
    checkFilter(real.replace(/NAMED STOP \[MAILBOX_NOT_FULLY_READ\]/g, "note")).length > 0);
  expect("a filter that stops retrying Gmail's 403 rate limit is caught",
    checkFilter(real.replace(/r\.status === 403 \|\| /g, "")).length > 0);
  expect("a filter that stops re-minting an expired credential is caught",
    checkFilter(real.replace(/r\.status === 401/g, "false")).length > 0);
  expect("a filter that captures its token once is caught",
    checkFilter(real.replace(/TOKEN_MAX_AGE_MS/g, "X")).length > 0);
  expect("a filter that stops naming its drops is caught",
    checkFilter(real.replace(/WHAT THE FILTER DISCARDED/g, "done")).length > 0);
  expect("a filter that would pass on a 100% discard is caught",
    checkFilter(real.replace(/NAMED STOP \[FILTER_DISCARDED_EVERYTHING\]/g, "note")).length > 0);
  expect("a company name entering the filter's code is caught",
    checkFilter(`${real}\nconst NAMES = /spacex|bytedance/i;`).length > 0);
  expect("the same names in a comment are not a violation",
    checkFilter(`${real}\n// SpaceX and ByteDance are deliberately absent from the code below.`).length === 0);
  expect("a reader that acquires a model call is caught",
    checkSeparation(`${real}\nspawn("claude", []);`, readFileSync(join(ROOT, EXTRACTOR), "utf8")).length > 0);
  const extract = readFileSync(join(ROOT, EXTRACTOR), "utf8");
  expect("an extractor that acquires a Gmail call is caught",
    checkSeparation(real, 'fetch("https://gmail.googleapis.com/x"); "--model"; "NAMED STOP [EXTRACTION_NEVER_RAN]"').length > 0);
  expect("the real extractor passes", checkSeparation(real, extract).length === 0);
  expect("an extractor that admits a row with no quote is caught",
    checkSeparation(real, extract.replace(/no quote from the message/g, "ok")).length > 0);
  expect("an extractor that loses the review surface is caught",
    checkSeparation(real, extract.replace(/NAMED STOP \[NOTHING_CHECKABLE\]/g, "note")).length > 0);
  expect("an extractor with no way to mark a row wrong is caught",
    checkSeparation(real, extract.replace(/wrong\.json/g, "x").replace(/WRONG_FILE/g, "X")).length > 0);

  if (failed) { console.error(`FILTER ACCOUNTING SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("FILTER ACCOUNTING SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

for (const f of [FILTER, EXTRACTOR]) {
  if (!existsSync(join(ROOT, f))) {
    console.error(`FILTER ACCOUNTING SCAN FAILED — ${f} does not exist.`);
    console.error("  The interest ledger has been renamed or removed. A scan with no subject is not a");
    console.error("  clean scan; it is a guard standing over nothing.");
    process.exit(2);
  }
}
const filterSrc = readFileSync(join(ROOT, FILTER), "utf8");
const extractSrc = readFileSync(join(ROOT, EXTRACTOR), "utf8");

const bad = [...checkFilter(filterSrc), ...checkSeparation(filterSrc, extractSrc)];

/*
 * AND THE LIVE RUN, WHEN THERE IS ONE. The checks above are about the code; this is about what the
 * code actually did on her mailbox. It is skipped in CI, where no scan has run — but where a scan
 * HAS run, its arithmetic must balance and its discard rate must not be absurd.
 */
const SCAN = join(process.env.BOSS_OS_CAPITAL_DIR ?? join(os.homedir(), ".boss-os", "capital"), "scan.json");
let live = "no local scan to check (this machine has not run one)";
if (existsSync(SCAN)) {
  try {
    const s = JSON.parse(readFileSync(SCAN, "utf8"));
    const summed = Object.values(s.drops ?? {}).reduce((a, b) => a + b, 0);
    const nr = Object.values(s.unread ?? {}).reduce((a, b) => a + b, 0);
    if (summed + nr + s.kept !== s.census) {
      bad.push(`${SCAN}: the last real run does not balance — ${summed} dropped + ${nr} unread + ${s.kept} kept ≠ ${s.census} census.`);
    }
    if (s.kept === 0) bad.push(`${SCAN}: the last real run kept nothing out of ${s.census} message(s).`);
    if ((s.never_read ?? 0) / s.census > 0.01) {
      bad.push(`${SCAN}: the last real run never read ${s.never_read} of ${s.census} message(s). That is not a scan of the mailbox.`);
    }
    if (s.discard_pct >= 99.9) {
      bad.push(`${SCAN}: the last real run discarded ${s.discard_pct}%. That is a broken stage, not an efficient filter.`);
    }
    live = `last real run: ${s.census} scanned, ${s.kept} kept, ${s.discard_pct}% discarded across `
      + `${Object.keys(s.drops ?? {}).length} named reason(s) — and it balances`;
  } catch (err) {
    bad.push(`${SCAN}: unreadable (${err?.message ?? err}).`);
  }
}

if (bad.length) {
  console.error(`FILTER ACCOUNTING SCAN FAILED — ${bad.length} violation(s):`);
  for (const v of bad) console.error(`  ✗ ${v}`);
  console.error("\n  Filter loose, classify tight. A regex tuned for precision silently drops real");
  console.error("  deals; the only thing that makes that visible is an itemised discard.");
  process.exit(1);
}

console.log(`FILTER ACCOUNTING SCAN PASSED: every message ends in a named bucket, a total discard is a`
  + ` named stop, no company name has entered the filter, and the reader and the model pass are still`
  + ` two processes. ${live}.`);
