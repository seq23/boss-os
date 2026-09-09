#!/usr/bin/env node
/**
 * A NUMBER ON HER SCREEN MUST COME FROM THE LIST IT COUNTS.
 *
 * ─── What she was actually shown, on production, on 9 September 2026 ───────
 *
 *   Today card: "Approval Inbox — 9 waiting".      Tab badge: 9.
 *   Inbox tab:  "0 waiting on you · Nothing needs you".
 *   GET /api/boss/approvals → { "ok": true, "data": [] }
 *
 * Three surfaces, three numbers, and the two she saw first were the two with nothing behind them.
 * She had already reported the same defect in the other product — "still says 12 unread even tho i
 * read it all" — which makes it a class, not an incident.
 *
 * ─── Why a scan rather than a test ─────────────────────────────────────────
 *
 * `tests/boss/countMatchesList.test.ts` proves the numbers agree TODAY, across every state a row
 * can be in. It cannot prove that the fifth caller somebody adds next month will use the shared
 * source, and the defect was never a wrong query — all four queries were individually correct. It
 * was four queries. So the test asserts the behaviour and this asserts the shape that keeps the
 * behaviour true.
 *
 * ─── The rule ──────────────────────────────────────────────────────────────
 *
 * Counting or listing PENDING APPROVALS happens in `src/worker/boss/approvals/pending.ts` and
 * nowhere else. Anything that genuinely asks a different question — "which pending approvals expire
 * within a day", "what was pending at the moment she agreed the day" — is a named exception with
 * the reason written down, because those are not the badge and must never be mistaken for it.
 *
 * RULE 0: finding no such query at all means the module moved or the predicate changed, which is a
 * broken scan rather than a clean repository. It exits non-zero.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const SELF_TEST = process.argv.includes("--self-test");

const walk = (dir, out = []) => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

/** The one place allowed to ask. */
const SOURCE = "src/worker/boss/approvals/pending.ts";

/**
 * Queries that mention pending approvals and are NOT the badge. Each names the different question
 * it asks, because "it's fine" is how the four callers accumulated in the first place.
 */
const NOT_THE_BADGE = new Map([
  [
    "src/worker/boss/routes/today.ts",
    {
      why:
        "Two HISTORICAL RECORDS and one row lookup. What was pending at the moment she agreed the day " +
        "(canon §17 step 6) and the midday sweep are snapshots of a past moment ON PURPOSE — a record " +
        "that updated itself would stop being a record — and the third selects the single oldest " +
        "docket to name it, which is not a count of anything.",
      /*
       * AND THE EXEMPTION IS CONDITIONAL. This file is allowed its snapshots only while it takes its
       * LIVE number from the shared source. Without this line the exemption would cover a future
       * regression that put the badge's own count back into this file — an exemption that grows to
       * cover the thing it was granted around is how a guard stops governing what it governs.
       */
      must: /pendingApprovals\(/,
    },
  ],
]);

/**
 * A count of pending approvals, however it is spelled — and NOT the several near-neighbours that
 * ask a genuinely different question.
 *
 * `expires_at` in the same statement means "which of the waiting things is about to run out", which
 * is a different number with a different meaning and no relationship to the badge. Excluding it by
 * SHAPE rather than by filename is what keeps this scan from turning into a list of exemptions that
 * nobody re-reads — a new caller asking the expiry question passes without anyone having to notice.
 */
const AFTER_FROM = 220;
function badgeQueries(src) {
  const found = [];
  let i = src.indexOf("FROM approvals");
  while (i !== -1) {
    const stmt = src.slice(i, i + AFTER_FROM);
    if (/status\s*=\s*'pending'/i.test(stmt) && !/expires_at/i.test(stmt)) found.push(stmt);
    i = src.indexOf("FROM approvals", i + 1);
  }
  return found;
}

function scan(files, read) {
  const offenders = [];
  const honoured = new Set();
  let examined = 0;
  let sourceFound = false;

  for (const f of files) {
    const src = read(f);
    /*
     * THE SHARED SOURCE IS RECOGNISED BY ITS EXPORT, NOT BY ITS SQL. It builds the predicate from a
     * named constant, so the literal string this scan hunts for does not appear in it — and a scan
     * that required the literal would declare the module missing the moment it was written well.
     */
    if (/export async function pendingApprovals/.test(src)) { sourceFound = true; continue; }
    if (badgeQueries(src).length === 0) continue;
    examined += 1;
    const exception = NOT_THE_BADGE.get(f);
    if (exception) {
      if (exception.must && !exception.must.test(src)) {
        offenders.push(`${f} (exempted for its snapshots, but it no longer reads the live count from the shared source)`);
      } else {
        honoured.add(f);
      }
      continue;
    }
    offenders.push(f);
  }
  return { offenders, examined, sourceFound, honoured };
}

if (SELF_TEST) {
  /*
   * THE NEGATIVE PROOF, RUN ON EVERY BUILD RATHER THAN ONCE BY HAND.
   *
   * A scan nobody has watched fail is a scan that might match nothing. Three fixtures: the shape it
   * exists to catch, the shape it must allow, and the empty repository that must not pass.
   */
  const fixtures = {
    "src/worker/boss/approvals/pending.ts": "export async function pendingApprovals(db) {}",
    "src/worker/boss/routes/newthing.ts": "SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'",
    "src/worker/boss/routes/today.ts": "SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' -- pendingApprovals(",
    "src/worker/boss/routes/harmless.ts": "SELECT * FROM tasks WHERE status = 'queued'",
  };
  const r = scan(Object.keys(fixtures), (f) => fixtures[f]);
  const fail = [];
  if (!r.offenders.includes("src/worker/boss/routes/newthing.ts")) fail.push("a new independent count was not caught");
  if (r.offenders.includes("src/worker/boss/routes/today.ts")) fail.push("a named exception was flagged");
  if (!r.sourceFound) fail.push("the shared source was not recognised");

  const empty = scan(["a.ts"], () => "nothing at all");
  if (empty.examined !== 0) fail.push("the empty fixture examined something");

  if (fail.length) {
    console.error("ONE-SOURCE SELF-TEST FAILED:");
    for (const f of fail) console.error("  ✗", f);
    process.exit(1);
  }
  console.log("one-source self-test: 4 fixtures, the scan catches a second count and allows the named exceptions.");
  process.exit(0);
}

const files = [...walk("src/worker"), ...walk("src/client")];
const { offenders, examined, sourceFound, honoured } = scan(files, (f) => readFileSync(join(ROOT, f), "utf8"));

/*
 * A NAMED EXCEPTION THAT MATCHES NOTHING IS A LIE THAT PASSES.
 *
 * The list is the record of which second questions are legitimate. If a file on it stops containing
 * the query it was excused for, the excuse is stale — and a stale excuse is how the next real
 * offender gets waved through under a filename somebody recognises.
 */
const stale = [...NOT_THE_BADGE.keys()].filter((f) => !honoured.has(f));
if (stale.length) {
  console.error("STALE EXEMPTION — named, but no longer matching anything:");
  for (const f of stale) console.error(`  ✗ ${f}`);
  console.error("  Remove it from NOT_THE_BADGE, or find out why its query changed.");
  process.exit(1);
}

if (examined === 0 || !sourceFound) {
  console.error("ONE-SOURCE SCAN EXAMINED NOTHING.");
  console.error(`  Nothing in the tree queries pending approvals, or ${SOURCE} no longer does.`);
  console.error("  The module has moved or the predicate changed. That is a broken scan, not a clean repo.");
  process.exit(2);
}

if (offenders.length) {
  console.error("A SECOND ANSWER TO 'WHAT IS WAITING ON HER':");
  for (const f of offenders) console.error(`  ✗ ${f} counts pending approvals with its own SQL.`);
  console.error(`\n  Use pendingApprovals() from ${SOURCE}, which returns the rows AND the total from one`);
  console.error("  query. If this genuinely asks a different question, add it to NOT_THE_BADGE with the reason.");
  process.exit(1);
}

console.log(`one source for the pending count: ${examined} file(s) ask, ${NOT_THE_BADGE.size} named exception(s), 0 rogue counts.`);
