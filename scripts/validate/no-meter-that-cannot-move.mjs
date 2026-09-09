#!/usr/bin/env node
/**
 * A NUMBER THAT CANNOT CHANGE MUST NOT BE DRAWN AS THOUGH IT MIGHT.
 *
 * ─── The thing this exists because of ──────────────────────────────────────
 *
 * The Inbox's top strip read "Today · $0.00 of $2.00" over a progress bar, every day, for as long as
 * it had existed. The figure was not small. It was STRUCTURALLY ALWAYS ZERO: nearly every duty runs
 * through Claude Code on the owner's own subscription, which records `cost_micros: 0` by design —
 * `claudeCode.mjs` says so in its own header — so no amount of work could ever move the bar.
 *
 * A bar that cannot fill is worse than no bar. It occupied the most prominent strip on the page and
 * implied an oversight that did not exist, AND IT WAS USED AS A REASON: 0196 shortened the daily
 * briefing's timeout to fit a ceiling that no run has ever moved, and that is what killed a complete
 * report at exit 124. That is the "a guard that cannot reach what it governs" defect with a visible
 * daily cost attached.
 *
 * ─── What the rule is ──────────────────────────────────────────────────────
 *
 * 1. NO PROGRESS BAR FED BY `spent_micros`. That column is the metered spend, and the metered
 *    backends are a rounding error next to the subscription ones, so its ratio is not a measure of
 *    anything a reader would take it for.
 * 2. A MONEY FIGURE MUST SAY WHOSE MONEY. Any `usd(...)` rendered on a screen has to sit in a file
 *    that also says `metered` or `estimate`, visibly, so a zero reads as "nothing metered ran"
 *    rather than "nothing ran".
 *
 * Neither rule bans the underlying data. Settings still shows the full cost breakdown, where it is
 * read as a ledger rather than as a control.
 *
 * RULE 0: it exits non-zero if it examines no screens at all, because a scan that found no client
 * pages is a broken scan and not a clean repository.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const SELF_TEST = process.argv.includes("--self-test");

const walk = (dir, out = []) => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
};

/**
 * A meter whose width comes from metered spend. The ratio it draws is `spent_micros / limit_micros`
 * and the numerator is structurally zero on this system.
 */
const DEAD_BAR = /className="meter"[\s\S]{0,400}?spent_micros|spent_micros[\s\S]{0,400}?className="meter"/;

/**
 * A dollar figure OF MODEL SPEND on a screen — not every dollar in the product.
 *
 * Capital renders deal sizes and Trading renders positions; those are her actual money and are
 * exactly as real as they look. The figure this rule is about is the one drawn from the spend
 * ledger, which on this system is almost entirely unmetered and therefore almost entirely zero.
 */
const MONEY = /\busd\([^)]*(spent_micros|cost_micros|limit_micros|budget)/;

/** Enough to make the scope of the figure visible to a reader. */
const QUALIFIED = /metered|estimate/i;

function scan(files, read) {
  const findings = [];
  let examined = 0;
  for (const f of files) {
    const src = read(f);
    examined += 1;
    if (DEAD_BAR.test(src)) {
      findings.push(`${f} draws a progress bar from spent_micros, which cannot move on this system.`);
    }
    if (MONEY.test(src) && !QUALIFIED.test(src)) {
      findings.push(`${f} renders a money figure with nothing on screen saying which spending it covers.`);
    }
  }
  return { findings, examined };
}

if (SELF_TEST) {
  const fixtures = {
    "a.tsx": `<div className="meter"><span style={{ width: ${"`${pct}%`"} }} /></div> spent_micros`,
    "b.tsx": `usd(row.cost_micros)`,
    "c.tsx": `usd(row.cost_micros) // metered backends only`,
    "e.tsx": `usd(deal.size_micros)`,
    "d.tsx": `<div className="stat-n">{work.failed}</div>`,
  };
  const r = scan(Object.keys(fixtures), (f) => fixtures[f]);
  const fail = [];
  if (!r.findings.some((x) => x.startsWith("a.tsx"))) fail.push("the dead progress bar was not caught");
  if (!r.findings.some((x) => x.startsWith("b.tsx"))) fail.push("an unqualified money figure was not caught");
  if (r.findings.some((x) => x.startsWith("c.tsx"))) fail.push("a qualified money figure was flagged");
  if (r.findings.some((x) => x.startsWith("d.tsx"))) fail.push("an ordinary count was flagged");
  if (r.findings.some((x) => x.startsWith("e.tsx"))) fail.push("her actual money was flagged as model spend");
  const empty = scan([], () => "");
  if (empty.examined !== 0) fail.push("the empty fixture examined something");

  if (fail.length) {
    console.error("METER SELF-TEST FAILED:");
    for (const x of fail) console.error("  ✗", x);
    process.exit(1);
  }
  console.log("meter self-test: 5 fixtures, the scan catches a bar that cannot move and an unlabelled money figure.");
  process.exit(0);
}

const files = walk("src/client/boss/pages").concat(walk("src/client/boss/components"));
const { findings, examined } = scan(files, (f) => readFileSync(join(ROOT, f), "utf8"));

if (examined === 0) {
  console.error("METER SCAN EXAMINED NOTHING: no client screens were found.");
  console.error("The pages have moved. That is a broken scan, not a clean repo.");
  process.exit(2);
}

if (findings.length) {
  console.error("A FIGURE THAT CANNOT MEAN WHAT IT LOOKS LIKE:");
  for (const x of findings) console.error("  ✗", x);
  console.error("\n  Show something that moves — runs, failures, deliverables, tokens — or say on screen");
  console.error("  which spending the figure covers. See scripts/validate/no-meter-that-cannot-move.mjs.");
  process.exit(1);
}

console.log(`no dead meters: ${examined} screen(s) examined, 0 figures that cannot move.`);
