#!/usr/bin/env node
/**
 * A LAUNCHD JOB THAT DOES A DUTY'S WORK MUST REACH THAT DUTY'S ROW IN D1.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 *   "I DONT CARE IF ITS LAUNCHD OR D1 — THOSE SHOULD BE LINKED ANYWAY."
 *
 * Monique's duties ran correctly from launchd on her Mac — `capital.log` shows the buyer work
 * firing and emailing her — while `standing_duties.last_run_at` read NULL, because the D1 cron is
 * not what executes them. A session read the null and told her the duties had never run. She caught
 * it. Two schedulers, two records, no link.
 *
 * CONFIRMED against production on 11 September 2026: ten duties carried `executor = 'local_job'`
 * and only THREE had ever recorded a run — exactly the three whose launchd job happened to post to
 * an endpoint that hardcoded their duty id. The other seven read as never having run:
 *
 *   duty_inbound_supply  duty_interest_nudge  duty_lp_positive  duty_mailbox_sweep
 *   duty_people_worth_a_call  duty_scooter_sheet  duty_site_audit_repair
 *
 * ─── Why a mapping needs proving in BOTH directions ─────────────────────────
 *
 * The link is made through `duty-run.sh <local_job>`, and the token is the SAME string the duty row
 * already carries in `task_input.$.local_job` — so there is no second list to drift. But "no second
 * list" is a claim, and a claim a validator does not check is a comment. So:
 *
 *   1. EVERY `duty-run.sh <token>` in the installer resolves to a duty that exists. A token nobody
 *      declared means the endpoint refuses the report at 09:23 and the run vanishes silently.
 *   2. EVERY duty with `executor = 'local_job'` is named by EXACTLY ONE invocation. Zero means a
 *      duty running blind — the original defect. Two means one run vouching for two pieces of work,
 *      which is worse, because it looks like success.
 *   3. No token resolves to more than one duty, for the same reason.
 *
 * ─── And the rule that makes the record honest ──────────────────────────────
 *
 *   4. NOTHING STAMPS `last_run_at` ON SCHEDULE. The endpoint may write it only on a successful
 *      completion. A duty that did not run must still look like a duty that did not run, and the
 *      tempting shortcut — stamp it when the scheduler fires — would have hidden the exact
 *      confusion this whole thing exists to end.
 *   5. A FAILED RUN IS NOT RECORDED AS A SUCCESS. The failure branch must not touch `last_run_at`
 *      or `next_due_at`, and must write `last_outcome`.
 *
 * RULE 0: examining zero duties, or zero invocations, is a FAILURE. A loop over an empty set is how
 * a validator stays green for ever while the thing it guards rots.
 *
 *   node scripts/validate/a-launchd-run-reaches-its-duty.mjs
 *   node scripts/validate/a-launchd-run-reaches-its-duty.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
/*
 * PARSED HERE RATHER THAN IMPORTED, AND THAT IS NOT DUPLICATION FOR ITS OWN SAKE.
 * `duties-deliver-somewhere.mjs` runs its whole scan at module scope, so importing its parser would
 * run that validator as a side effect of this one — two failures reported under one name, and a
 * green here meaning "both passed" without saying so. Eleven lines of regex is the cheaper half.
 */

/** Every duty an INSERT into `standing_duties` defines, with the text of its own tuple. */
export function dutiesIn(sql) {
  const out = [];
  for (const ins of [...sql.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+standing_duties\b/gi)]) {
    const block = sql.slice(ins.index);
    const ids = [...block.matchAll(/\(\s*'(duty_[a-z0-9_]+)'/gi)];
    for (let i = 0; i < ids.length; i += 1) {
      out.push({ id: ids[i][1], text: block.slice(ids[i].index, i + 1 < ids.length ? ids[i + 1].index : block.length) });
    }
  }
  return out;
}

/**
 * The ops script a locally-executed duty names.
 *
 * THE VALUE MUST LOOK LIKE A SCRIPT. `executor` is itself the literal `'local_job'`, so a naive
 * match reads the NEXT COLUMN and returns the task kind — a trap the sibling validator fell into
 * and documented.
 */
export function localJobScript(text) {
  const m = /'local_job'\s*,\s*'([A-Za-z0-9_.-]+\.(?:sh|mjs))'/.exec(text)
    ?? /"local_job"\s*:\s*"([A-Za-z0-9_.-]+\.(?:sh|mjs))"/.exec(text);
  return m ? m[1] : null;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const INSTALLER = "scripts/ops/install-agent-launchd.sh";
const WRAPPER = "scripts/ops/duty-run.sh";
const REPORTER = "scripts/ops/duty-ran.mjs";
const ENDPOINT = "src/worker/boss/routes/duties.ts";

/**
 * Every `duty-run.sh <token>` the installer writes into a plist.
 *
 * The token is read from the invocation rather than from a list this file keeps, because a list
 * this file kept would be the third copy of the thing whose second copy is the defect.
 */
export function wrappedJobs(installer) {
  return [...installer.matchAll(/duty-run\.sh\s+([A-Za-z0-9_.-]+\.(?:sh|mjs))\b/g)].map((m) => m[1]);
}

/**
 * Every duty a later migration RETIRES.
 *
 * A duty that has ended — the KDP case chase, once the books were Live — is deleted by a migration,
 * and a deleted duty needs no launchd job. Without this the validator would demand an installer
 * block for work that no longer exists, which is how a retired job stays on the schedule: on
 * 14 September 2026 `com.seq.kdp-watch` fired for a duty production no longer had, and emailed her
 * about a case that had closed two days earlier.
 */
export function retiredIn(sql) {
  const out = [];
  for (const m of sql.matchAll(/DELETE\s+FROM\s+standing_duties\s+WHERE\s+id\s*(?:=\s*'(duty_[a-z0-9_]+)'|IN\s*\(([^)]*)\))/gi)) {
    if (m[1]) out.push(m[1]);
    if (m[2]) for (const id of m[2].matchAll(/'(duty_[a-z0-9_]+)'/g)) out.push(id[1]);
  }
  return out;
}

/** Is a duty's declaration an `executor = 'local_job'` one? */
export function isLocalJob(text) {
  return /'local_job'\s*,\s*'[A-Za-z0-9_.-]+\.(?:sh|mjs)'/.test(text) || /'local_job'/.test(text);
}

function scan() {
  const problems = [];

  const files = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();

  /*
   * ── PER FILE, AND DEDUPED BY DUTY ID ─────────────────────────────────────
   *
   * `dutiesIn` slices from one duty id to the next inside the text it is given, so handing it every
   * migration concatenated makes each INSERT re-find every duty id that appears AFTER it anywhere
   * in the history. The first draft did exactly that and reported "kdp-publish.sh is named by 16
   * duties", all sixteen of them the same duty. A duplicate count is not a real ambiguity, and a
   * validator crying wolf is worse than no validator.
   *
   * A Set, because the question is "how many DISTINCT duties claim this script" — which is the
   * thing that would actually make one run vouch for two pieces of work.
   */
  const retired = new Set(files.flatMap((f) => retiredIn(read(`migrations/${f}`))));
  const declared = new Map();
  for (const f of files) {
    for (const duty of dutiesIn(read(`migrations/${f}`))) {
      if (retired.has(duty.id)) continue;
      const script = localJobScript(duty.text);
      if (!script) continue;
      if (!declared.has(script)) declared.set(script, new Set());
      declared.get(script).add(duty.id);
    }
  }

  for (const f of [INSTALLER, WRAPPER, REPORTER, ENDPOINT]) {
    if (!existsSync(join(ROOT, f))) problems.push(`${f} does not exist, so the launchd-to-D1 link has no ${f.endsWith(".ts") ? "server" : "client"} half.`);
  }
  if (problems.length) return { declared, wrapped: [], problems };

  const installer = read(INSTALLER);
  const wrapped = wrappedJobs(installer);

  // 1. Every wrapped token resolves to a duty that exists.
  for (const token of wrapped) {
    const duties = declared.has(token) ? [...declared.get(token)] : null;
    if (!duties) {
      problems.push(
        `install-agent-launchd.sh wraps "${token}" through duty-run.sh and NO standing duty names it in ` +
        `task_input.$.local_job. The report is refused at 09:23 and the run disappears — which is the ` +
        `original defect wearing a wrapper.`,
      );
    } else if (duties.length > 1) {
      problems.push(
        `"${token}" is named by ${duties.length} duties (${duties.join(", ")}). One run would vouch for ` +
        `two pieces of work, which is worse than vouching for none because it looks like success.`,
      );
    }
  }

  // 2. Every local_job duty is named by exactly one invocation.
  for (const [script, dutySet] of declared) {
    const duties = [...dutySet];
    const count = wrapped.filter((w) => w === script).length;
    if (count === 0) {
      problems.push(
        `${duties.join(", ")} names "${script}" as its local job and NOTHING in install-agent-launchd.sh ` +
        `routes it through duty-run.sh. It will run on her Mac and its duty row will read as never ` +
        `having run — the exact null that was misread as "these duties never fired".`,
      );
    } else if (count > 1) {
      problems.push(
        `"${script}" is wrapped ${count} times in install-agent-launchd.sh. Two jobs reporting the same ` +
        `duty means one of them is silently vouching for the other's work.`,
      );
    }
  }

  // 3. The endpoint resolves by the duty's own declaration, not by a caller-supplied duty id.
  const endpoint = read(ENDPOINT);
  if (!/json_extract\(task_input,\s*'\$\.local_job'\)/.test(endpoint)) {
    problems.push(
      `${ENDPOINT} does not resolve the duty from task_input.$.local_job. If it resolves from anything ` +
      `else, a second list exists and it will drift.`,
    );
  }
  if (/duty_id\s*[:=]\s*(?:b|body)[?.]/.test(endpoint)) {
    problems.push(
      `${ENDPOINT} appears to take a duty id from the caller. A caller that names its own duty can name ` +
      `the wrong one and nothing would ever know.`,
    );
  }

  // 4 and 5. The honesty rules about what may be written, and when.
  /*
   * ── THE TWO BRANCHES, BOUNDED AT BOTH ENDS ───────────────────────────────
   *
   * The first draft took "everything after `} else {`" as the failure branch, which swept up the
   * GET /runs handler below it — a handler that quite properly SELECTS last_run_at and next_due_at
   * to render them. It reported that the failure branch wrote both. An unbounded slice is how a
   * validator invents a defect, and inventing one teaches people to ignore the next real finding.
   *
   * `await logEvent` is the first statement after the if/else, so it is the end marker.
   */
  const branchStart = endpoint.indexOf('if (outcome === "ok")');
  const branchEnd = endpoint.indexOf("await logEvent", branchStart);
  if (branchStart === -1 || branchEnd === -1) {
    problems.push(`${ENDPOINT} no longer has an if (outcome === "ok") / else pair this scan can read. That is a broken scan, not a clean file.`);
    return { declared, wrapped, problems };
  }
  /*
   * AND COMMENTS ARE STRIPPED, for the reason the sibling validator had to learn the same day: the
   * failure branch's own comment says "`last_run_at` IS NOT TOUCHED, AND `next_due_at` IS NOT
   * ADVANCED" — the sentence explaining that it does the right thing was read as evidence that it
   * did the wrong one. A validator confused by an explanation of itself teaches people to delete
   * the explanation, and the explanation is the most valuable thing in the file.
   */
  const codeOnly = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const both = codeOnly(endpoint.slice(branchStart, branchEnd));
  const elseAt = both.indexOf("} else {");
  const okBranch = both.slice(0, elseAt);
  const failBranch = both.slice(elseAt);
  if (!/last_run_at\s*=\s*\?/.test(okBranch)) {
    problems.push(`${ENDPOINT} does not write last_run_at on a successful run, so a run that happened still reads as one that did not.`);
  }
  if (/last_run_at/.test(failBranch)) {
    problems.push(
      `${ENDPOINT} writes last_run_at on the FAILURE branch. A failed run must not look like a run: the duty ` +
      `last ran when it last worked.`,
    );
  }
  if (/next_due_at/.test(failBranch)) {
    problems.push(
      `${ENDPOINT} advances next_due_at on the FAILURE branch. A duty whose work did not happen is still due.`,
    );
  }
  if (!/last_outcome\s*=\s*'failed'/.test(failBranch)) {
    problems.push(
      `${ENDPOINT} does not record last_outcome = 'failed'. A failure that writes nothing leaves the previous ` +
      `success standing and unqualified, which is how a job fails quietly for a week.`,
    );
  }

  // The wrapper must report AFTER the job, with the job's own exit code, and must not swallow it.
  const wrapper = read(WRAPPER);
  if (!/exit \$RC/.test(wrapper)) {
    problems.push(`${WRAPPER} does not exit with the job's own code, so launchd would see the reporter's status instead of the work's.`);
  }
  if (!/OUTCOME="failed"/.test(wrapper)) {
    problems.push(`${WRAPPER} has no failure path, so a job that fails would be reported as one that worked.`);
  }

  return { declared, wrapped, problems };
}

// ─── Self-test: the parser, proved on text rather than on the repo ───────────

function selfTest() {
  let failed = 0;
  const cases = [
    { name: "a wrapped shell job is found", src: `<string>bash $REPO/scripts/ops/duty-run.sh kdp-watch.sh -- bash x</string>`, want: ["kdp-watch.sh"] },
    { name: "a retired duty is read out of its DELETE", src: `DELETE FROM standing_duties WHERE id = 'duty_kdp_publication';\nDELETE FROM standing_duties WHERE id IN ('duty_a', 'duty_b');`, want: ["duty_kdp_publication", "duty_a", "duty_b"], fn: retiredIn },
    { name: "a wrapped node job is found", src: `duty-run.sh lp-positive.mjs -- npm run x`, want: ["lp-positive.mjs"] },
    { name: "two invocations are both found", src: `duty-run.sh a.sh -- x\nduty-run.sh b.mjs -- y`, want: ["a.sh", "b.mjs"] },
    { name: "the wrapper's own definition is not an invocation", src: `bash scripts/ops/duty-run.sh <local_job> -- <command...>`, want: [] },
    { name: "an unwrapped command yields nothing", src: `<string>cd $REPO && npm run --silent properties</string>`, want: [] },
  ];
  for (const c of cases) {
    const got = (c.fn ?? wrappedJobs)(c.src);
    if (JSON.stringify(got) !== JSON.stringify(c.want)) {
      console.error(`  ✗ ${c.name}: expected ${JSON.stringify(c.want)}, got ${JSON.stringify(got)}`);
      failed += 1;
    }
  }
  if (failed) {
    console.error(`\nSELF-TEST FAILED: ${failed} case(s)`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const { declared, wrapped, problems } = scan();

/*
 * RULE 0, BOTH ENDS. No duties means the way duties are written changed and this scan did not keep
 * up. No invocations means the installer stopped wrapping them — which is precisely the state this
 * validator exists to catch, and exiting 0 on it would be the validator failing silently about a
 * silent failure.
 */
if (declared.size === 0) {
  console.error(
    "LAUNCHD-DUTY LINK SCAN EXAMINED NO LOCAL-JOB DUTIES. `standing_duties` inserts are no longer shaped\n" +
    "the way this scan reads them. That is a broken scan, not a clean repo.",
  );
  process.exit(2);
}
if (wrapped.length === 0) {
  console.error(
    "LAUNCHD-DUTY LINK SCAN FOUND NO WRAPPED JOBS. install-agent-launchd.sh routes nothing through\n" +
    "duty-run.sh, so every local job on her Mac runs against a duty row that will never learn it ran.\n" +
    "That is the original defect, and it is what this validator is for.",
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error("LAUNCHD-DUTY LINK SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(
    "A duty that runs on her Mac and a duty row in D1 that says it never ran are the same confusion\n" +
    "that produced a wrong report to her face. Link them, in both directions, or say which is not work.",
  );
  process.exit(1);
}

console.log(
  `LAUNCHD-DUTY LINK SCAN PASSED: ${declared.size} local-job duties, ${wrapped.length} wrapped launchd ` +
  `invocations, each resolving to exactly one duty and each duty named exactly once — and a failed run ` +
  `cannot write last_run_at.`,
);
selfTest();
