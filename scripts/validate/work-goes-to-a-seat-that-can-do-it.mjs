#!/usr/bin/env node
/**
 * WORK GOES ONLY TO A SEAT THAT CAN DO IT, AND AN ASK IS NEVER A TASK.
 *
 * 4 Oct 2026 a KDP subtitle edit — work inside the owner's own Amazon account — was assigned to Zora,
 * who has no browser, no duty and no executor. Both endpoints that create `work_assignments` rows
 * checked only that the helper EXISTED. It went overdue, and on 7 Oct Simone emailed the owner:
 * "Can you check the status with Zora or complete the manual edit yourself?"
 *
 * What this checks:
 *   1. EVERY place in src/ that inserts a `work_assignments` row calls `checkAssignment(` before it,
 *      in the same handler. A new door that skips the check fails the build.
 *   2. The /kdp/mail route refuses an owner_ask that is a task (`ownerAskIsATask(`).
 *   3. The surface report refuses both too (`ASSIGNMENT_CANNOT_REACH`, `OWNER_ASK_IS_A_TASK`).
 *   4. Behaviour, from the one record (`executors.mjs`): the 4 Oct assignment is refused, the 7 Oct
 *      ask is refused, a cover repair for Zora still passes, and every executor names an
 *      `npm run` script that exists — a capability with no command is not a capability.
 *
 * RULE 0: zero insert sites found is a FAILURE — a scan that cannot find what it governs is broken.
 *
 *   node scripts/validate/work-goes-to-a-seat-that-can-do-it.mjs
 *   node scripts/validate/work-goes-to-a-seat-that-can-do-it.mjs --self-test
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAssignment, ownerAskIsATask, SEAT_EXECUTORS } from "../../src/shared/boss/duties/executors.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSERT_RE = /INSERT INTO work_assignments/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

/** Pure: problems in a set of { path, text } sources. */
export function problems({ sources, report, packageScripts }) {
  const p = [];
  let sites = 0;
  for (const { path, text } of sources) {
    for (const m of text.matchAll(INSERT_RE)) {
      sites += 1;
      // The handler that holds this insert: from the nearest route/function start before it.
      const before = text.slice(0, m.index);
      const start = Math.max(before.lastIndexOf('.post("'), before.lastIndexOf("export async function"), before.lastIndexOf("\nasync function"), 0);
      if (!/checkAssignment\(/.test(text.slice(start, m.index))) {
        p.push(`${path}: a work_assignments insert with no checkAssignment( before it in its handler — work could go to a seat that cannot do it (Zora, 4 Oct 2026).`);
      }
    }
    if (/kdp\.post\("\/mail"/.test(text) && !/ownerAskIsATask\(/.test(text)) {
      p.push(`${path}: /kdp/mail does not refuse an owner_ask that is a task (ownerAskIsATask).`);
    }
  }
  if (sites === 0) p.push("RULE 0: no `INSERT INTO work_assignments` found under src/ — the scan cannot see what it governs.");
  for (const code of ["ASSIGNMENT_CANNOT_REACH", "OWNER_ASK_IS_A_TASK", "IN_REVIEW_IS_PROGRESS"]) {
    if (!report.includes(code)) p.push(`kdp-surface-report.mjs does not refuse ${code}.`);
  }
  const kdpEdit = checkAssignment({ helper: "emp_knowledge", what: "Edit The Gift Letter (Down Payment) KDP Details tab: change subtitle, save, and publish", why: "moves Draft to Live" });
  if (kdpEdit.ok) p.push("checkAssignment let a KDP edit go to Zora — the 4 Oct 2026 assignment.");
  const cover = checkAssignment({ helper: "emp_knowledge", what: "Repair the cover and hand me the file", why: "Amazon rejects it" });
  if (!cover.ok) p.push("checkAssignment refused a cover repair for Zora — colleague work must still be delegable.");
  if (!ownerAskIsATask("Zora's assignment is overdue. Can you check the status with Zora or complete the manual edit yourself?")) {
    p.push("ownerAskIsATask passed the 7 Oct 2026 ask.");
  }
  if (ownerAskIsATask("Approve the subtitle. Recommended: A Template for Documenting Family Funds Toward a Home Purchase.")) {
    p.push("ownerAskIsATask refused a plain wording decision — that is exactly what an ask is for.");
  }
  for (const [seat, caps] of Object.entries(SEAT_EXECUTORS)) {
    for (const [cap, cmd] of Object.entries(caps)) {
      const scripts = [...String(cmd).matchAll(/npm run ([a-z:-]+)/g)].map((x) => x[1]);
      if (!scripts.length) p.push(`${seat}.${cap} names no npm run command.`);
      for (const s of scripts) if (!packageScripts[s]) p.push(`${seat}.${cap} names "npm run ${s}", which package.json does not have.`);
    }
  }
  return { problems: p, sites };
}

function load() {
  const sources = walk(join(ROOT, "src")).map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, "utf8") }));
  const report = readFileSync(join(ROOT, "scripts/ops/kdp-surface-report.mjs"), "utf8");
  const packageScripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
  return { sources, report, packageScripts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const real = load();
  if (process.argv.includes("--self-test")) {
    const route = real.sources.find((s) => s.path.endsWith("routes/kdp.ts"));
    const cases = [
      ["the real tree passes", problems(real).problems.length === 0],
      ["an insert with the check removed fails", problems({ ...real, sources: [{ path: "x.ts", text: route.text.replaceAll("checkAssignment(", "skipped(") }] }).problems.some((x) => /no checkAssignment/.test(x))],
      ["a /mail with no ask guard fails", problems({ ...real, sources: [{ path: "x.ts", text: route.text.replaceAll("ownerAskIsATask(", "nothing(") }] }).problems.some((x) => /ownerAskIsATask/.test(x))],
      ["zero insert sites is a failure", problems({ ...real, sources: [] }).problems.some((x) => x.startsWith("RULE 0"))],
      ["a report without the refusal fails", problems({ ...real, report: real.report.replaceAll("ASSIGNMENT_CANNOT_REACH", "X") }).problems.length > 0],
      ["an executor naming a missing script fails", problems({ ...real, packageScripts: {} }).problems.some((x) => /package.json does not have/.test(x))],
    ];
    const failed = cases.filter(([, ok]) => !ok);
    for (const [n] of failed) console.error(`  ✗ ${n}`);
    if (failed.length) { console.error(`work-goes-to-a-seat self-test: ${failed.length} case(s) wrong`); process.exit(1); }
    console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
  } else {
    const { problems: p, sites } = problems(real);
    if (p.length) { for (const x of p) console.error(`  ✗ ${x}`); console.error(`WORK-REACHES-AN-EXECUTOR SCAN FAILED: ${p.length} problem(s).`); process.exit(1); }
    console.log(`WORK-REACHES-AN-EXECUTOR SCAN PASSED: ${sites} assignment door(s) all check the seat can do it; asks that are tasks are refused at the endpoint and the report.`);
  }
}
