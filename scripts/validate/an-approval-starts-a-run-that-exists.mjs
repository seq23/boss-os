#!/usr/bin/env node
/**
 * AN APPROVAL THAT PROMISES A RUN MUST NAME A RUN THAT EXISTS AND IS SCHEDULED.
 *
 * ─── The two days this cost, exactly ────────────────────────────────────────
 *
 * 9 September, 14:00 — seven replacement covers raised in her Inbox.
 * 9 September, 14:30 — she approved them. `apr_m237hjk726ky3ekn`, decided_by `boss`.
 * 11 September       — the seven titles were still blocked, and she said so in capitals.
 *
 * The approval was not ignored. It was CONSUMED: `approvals/resume.ts` fired its `kdp_cover_upload`
 * handler, `executed_at` was stamped, `execution_status` read `executed`, and the entire effect was
 * a sentence written onto the deliverable —
 *
 *     "Covers approved by you on 2026-09-09. Simone uploads them, publishes ONE title first ..."
 *
 * — describing a run that nothing performs. No launchd job invoked `kdp:covers`, `kdp:publish` or
 * anything that could click; the two KDP jobs are `claude -p` processes that read Amazon and
 * report, and a scheduled `claude -p` has no browser tools at all.
 *
 * SO THE DEFECT IS NOT "AN APPROVAL WITH NO CONSUMER". It is worse and more specific: A CONSUMER
 * THAT RECORDS AN INTENTION, STAMPS A RECEIPT, AND HANDS OFF TO A SCHEDULED RUN THAT WAS NEVER
 * SCHEDULED. "Runs but inert" wearing a receipt — and a receipt is what made it invisible, because
 * every screen and every query said the decision had been executed.
 *
 * ─── What this checks ───────────────────────────────────────────────────────
 *
 * For every handler in `RESUME_HANDLERS` whose effect is to promise future work:
 *
 *   1. IT NAMES THE RUN. A handler that says "Simone uploads them on her next run" without naming
 *      which job that is has made a promise nobody can check. The name is a `local_job` script.
 *   2. THE NAMED SCRIPT EXISTS in `scripts/ops/`.
 *   3. SOMETHING INSTALLS IT. `install-agent-launchd.sh` must name it — a script nothing schedules
 *      is the exact state that produced this defect.
 *   4. A STANDING DUTY OWNS IT, so the promised work has an employee's name on it and a clock.
 *
 * A handler that performs its work INLINE — writes the row, sends the mail, closes the item — is
 * not making a promise and is not asked to name a job. The test is whether the handler defers.
 *
 * RULE 0: zero handlers examined is a FAILURE. `RESUME_HANDLERS` not being readable by this scan
 * means the scan broke, not that every approval is honest.
 *
 *   node scripts/validate/an-approval-starts-a-run-that-exists.mjs
 *   node scripts/validate/an-approval-starts-a-run-that-exists.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const RESUME = "src/worker/boss/approvals/resume.ts";
const INSTALLER = "scripts/ops/install-agent-launchd.sh";

/**
 * Each handler in `RESUME_HANDLERS`, with its body.
 *
 * Split on the handler key rather than parsed, for the same reason the duty scanner is: a real TS
 * parser would be more correct and would also be a dependency in a file whose whole job is to be
 * obviously right.
 */
export function handlersIn(source) {
  const start = source.indexOf("RESUME_HANDLERS");
  if (start === -1) return [];
  const body = source.slice(start);
  const marks = [...body.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*async\s*\(/gim)];
  const out = [];
  for (let i = 0; i < marks.length; i += 1) {
    const from = marks[i].index;
    const to = i + 1 < marks.length ? marks[i + 1].index : body.length;
    out.push({ name: marks[i][1], body: body.slice(from, to) });
  }
  return out;
}

/**
 * Does this handler DEFER — promise that something will happen later — rather than do the work?
 *
 * The tell is future tense about another actor in the text the owner will read. "Simone uploads
 * them on her next run", "it will be sent", "this starts on the next tick". A handler that writes
 * its row and returns has done its job and promises nothing.
 *
 * DELIBERATELY BROAD, AND THE COST OF A FALSE POSITIVE IS ONE COMMENT. A handler wrongly flagged is
 * fixed by naming the job it relies on, which is worth writing down anyway. A handler wrongly
 * cleared is two more days of a decision sitting in a database doing nothing.
 */
export function promisesFutureWork(body) {
  const text = body.replace(/\s+/g, " ");
  /*
   * The verb forms are listed rather than stemmed. "send" + "ed" is "sended", and the first draft's
   * suffix pattern missed "will be sent" for exactly that reason — an irregular verb in the one
   * sentence shape this is most likely to meet.
   */
  const FUTURE = [
    /\bon (her|his|its|the) next run\b/i,
    /\bnext run\b/i,
    /\bwill (be )?(upload|uploaded|publish|published|send|sent|run|start|started|pick|picked|collect|collected|do|done)\b/i,
    /\bstarts? on the next\b/i,
    /\bwhen (the|her) (watcher|job|run)\b/i,
    /*
     * `picks? (it|this) up` WAS HERE AND IS DELIBERATELY GONE. It matched
     * `completion_acknowledged`, whose sentence "whoever picks it up is guessing" is about a PERSON
     * reading a reopened deliverable — and that handler does its work inline, with a real UPDATE,
     * promising nothing. A false alarm from a validator is worse than no validator: it sends
     * someone chasing a problem that does not exist and teaches them to ignore the next one. Every
     * pattern left is an unambiguous reference to a SCHEDULED RUN.
     */
  ];
  return FUTURE.some((re) => re.test(text));
}

/**
 * Every local job a handler names.
 *
 * ALL OF THEM, NOT THE FIRST. The first draft returned only the first match and immediately misread
 * a handler whose leading comment mentioned a different script — it reported that
 * `buyer_outreach_email` promised `kdp-resume.mjs`, which is a sentence about nothing. A handler
 * satisfies this check if ANY script it names is real, installed and owned; naming one good job and
 * mentioning another in passing is not a defect.
 */
export function namedJobs(body) {
  return [...new Set([...body.matchAll(/([A-Za-z0-9_-]+\.(?:sh|mjs))/g)].map((m) => m[1]))];
}

function scan() {
  const problems = [];
  for (const f of [RESUME, INSTALLER]) {
    if (!existsSync(join(ROOT, f))) {
      problems.push(`${f} does not exist, so this scan cannot see whether an approval starts anything.`);
      return { handlers: [], deferring: [], problems };
    }
  }

  const handlers = handlersIn(read(RESUME));
  const installer = read(INSTALLER);
  const opsDir = readdirSync(join(ROOT, "scripts/ops"));

  const files = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const dutyJobs = new Set();
  for (const f of files) {
    for (const m of read(`migrations/${f}`).matchAll(/'local_job'\s*,\s*'([A-Za-z0-9_.-]+\.(?:sh|mjs))'/g)) {
      dutyJobs.add(m[1]);
    }
  }

  const deferring = handlers.filter((h) => promisesFutureWork(h.body));

  for (const h of deferring) {
    const jobs = namedJobs(h.body);
    if (jobs.length === 0) {
      problems.push(
        `RESUME_HANDLERS.${h.name} tells her that work will happen later and NAMES NO JOB that does it.\n` +
        `      That is the kdp_cover_upload defect exactly: an intention recorded, a receipt stamped, and\n` +
        `      a hand-off to a run nobody can point at. Name the local_job script in the handler.`,
      );
      continue;
    }
    // A handler is satisfied by ONE job that is real, installed and owned. The three conditions are
    // checked together, because a script that exists but is scheduled by nothing is the exact state
    // that left seven books blocked for two days after she approved their covers.
    const kept = jobs.filter((j) => opsDir.includes(j) && installer.includes(j) && dutyJobs.has(j));
    if (kept.length === 0) {
      const why = jobs.map((j) => {
        if (!opsDir.includes(j)) return `"${j}" does not exist in scripts/ops`;
        if (!installer.includes(j)) return `"${j}" is installed by nothing — no launchd job runs it`;
        return `"${j}" is owned by no standing duty, so nobody is accountable for it`;
      });
      problems.push(
        `RESUME_HANDLERS.${h.name} promises work later and none of the jobs it names can carry it:\n` +
        `      ${why.join(";\n      ")}.`,
      );
    }
  }

  return { handlers, deferring, problems };
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  let failed = 0;
  const cases = [
    {
      name: "the real defect is detected",
      body: `kdp_cover_upload: async (env) => { return { detail: "Approved. Simone uploads the covers on her next run." }; }`,
      defers: true, job: null,
    },
    {
      name: "a handler naming its job is accepted",
      body: `x: async (env) => { /* kdp-publish.sh does this */ return { detail: "Simone uploads them on her next run." }; }`,
      defers: true, job: "kdp-publish.sh",
    },
    {
      name: "a handler that does its own work promises nothing",
      body: `y: async (env) => { await env.DB.prepare("UPDATE x SET y = 1").run(); return { detail: "Recorded." }; }`,
      defers: false, job: null,
    },
    {
      name: "'will be sent' is a promise",
      body: `z: async (env) => { return { detail: "The note will be sent tonight." }; }`,
      defers: true, job: null,
    },
  ];
  for (const c of cases) {
    const d = promisesFutureWork(c.body);
    if (d !== c.defers) {
      console.error(`  ✗ ${c.name}: expected defers=${c.defers}, got ${d}`);
      failed += 1;
      continue;
    }
    if (d && (namedJobs(c.body)[0] ?? null) !== c.job) {
      console.error(`  ✗ ${c.name}: expected job ${JSON.stringify(c.job)}, got ${JSON.stringify(namedJobs(c.body)[0] ?? null)}`);
      failed += 1;
    }
  }

  // The splitter must give each handler its own body, or one handler's named job would vouch for
  // its neighbour's silence — the same bleed the duty-delivery self-test guards against.
  const hs = handlersIn(`export const RESUME_HANDLERS = {\n  a: async (env) => { return 1; },\n  b: async (env) => { return 2; },\n};`);
  if (hs.length !== 2 || hs[0].body.includes("return 2")) {
    console.error("  ✗ handler bodies bleed into each other");
    failed += 1;
  }

  if (failed) {
    console.error(`\nSELF-TEST FAILED: ${failed} case(s)`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${cases.length + 1}/${cases.length + 1} cases.`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const { handlers, deferring, problems } = scan();

if (handlers.length === 0) {
  console.error(
    "APPROVAL-PROMISE SCAN EXAMINED NO HANDLERS. RESUME_HANDLERS is no longer shaped the way this scan\n" +
    "reads it. That is a broken scan, not a repository where every approval starts something.",
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error("APPROVAL-PROMISE SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(
    "She makes a decision, the system stamps it executed, and nothing happens. That is the worst\n" +
    "failure this product has, because the receipt is what stops anyone looking.",
  );
  process.exit(1);
}

console.log(
  `APPROVAL-PROMISE SCAN PASSED: ${handlers.length} resume handlers — ${deferring.length} promise future ` +
  `work, and every one names a script that exists, is installed by launchd, and is owned by a standing duty.`,
);
selfTest();
