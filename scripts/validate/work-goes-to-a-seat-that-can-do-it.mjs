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
 *   5. EVERY KIND OF TASK HAS SOMETHING THAT CLAIMS IT (7 Oct 2026, the 48 grid tasks). Every
 *      `INSERT INTO tasks` site is in TASK_CREATORS; every kind it creates is in TASK_EXECUTORS; every
 *      token the queue drain refuses (`json_extract(t.input, '$.x')` in bossMount.ts) is in
 *      TASK_EXECUTORS; and every executor's claim marker is really in its file, with its `npm run`
 *      command in package.json. A task kind created with no claiming executor fails the build.
 *
 * RULE 0: zero insert sites found is a FAILURE — a scan that cannot find what it governs is broken.
 *
 *   node scripts/validate/work-goes-to-a-seat-that-can-do-it.mjs
 *   node scripts/validate/work-goes-to-a-seat-that-can-do-it.mjs --self-test
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAssignment, ownerAskIsATask, SEAT_EXECUTORS, TASK_EXECUTORS, TASK_CREATORS } from "../../src/shared/boss/duties/executors.mjs";
import { existsSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSERT_RE = /INSERT INTO work_assignments/g;
const TASK_INSERT_RE = /INSERT INTO tasks\b/;
const DRAIN_TOKEN_RE = /json_extract\(t\.input, '\$\.(\w+)'\)/g;

/**
 * Pure: problems with who claims each kind of task. `readFile(rel)` returns a repo file's text or null.
 */
export function taskProblems({ sources, taskExecutors, taskCreators, packageScripts, readFile }) {
  const p = [];
  let sites = 0;
  const insertFiles = new Set();
  for (const { path, text } of sources) {
    if (!TASK_INSERT_RE.test(text)) continue;
    sites += 1;
    insertFiles.add(path);
    const kinds = taskCreators[path];
    if (!kinds) { p.push(`${path}: inserts a tasks row and is not in TASK_CREATORS — nothing is named to claim what it creates (the 48 grid tasks, 7 Oct 2026).`); continue; }
    for (const k of kinds) if (!taskExecutors[k]) p.push(`${path}: creates "${k}" tasks and TASK_EXECUTORS names no executor for "${k}" — work nothing can execute.`);
  }
  if (sites === 0) p.push("RULE 0: no `INSERT INTO tasks` found under src/ — the task scan cannot see what it governs.");
  for (const path of Object.keys(taskCreators)) {
    if (!insertFiles.has(path)) p.push(`TASK_CREATORS lists ${path}, which inserts no tasks row — two lists that drifted.`);
  }
  const drain = sources.find((s) => s.path.endsWith("worker/bossMount.ts"));
  const tokens = drain ? [...drain.text.matchAll(DRAIN_TOKEN_RE)].map((m) => m[1]) : [];
  if (!tokens.length) p.push("RULE 0: no `json_extract(t.input, '$.x')` exclusion found in bossMount.ts's drain — the scan cannot see which tasks the drain refuses.");
  for (const t of tokens) {
    if (!taskExecutors[t]) p.push(`bossMount.ts's drain refuses tasks carrying input.${t}, and TASK_EXECUTORS names nothing else that claims them — refused by the drain and claimed by nobody (grid_fix, 16 Sep–7 Oct 2026).`);
  }
  for (const [kind, ex] of Object.entries(taskExecutors)) {
    const text = readFile(ex.file);
    if (text === null) p.push(`TASK_EXECUTORS.${kind} names ${ex.file}, which does not exist.`);
    else if (!text.includes(ex.marker)) p.push(`TASK_EXECUTORS.${kind}: ${ex.file} no longer contains its claim ("${ex.marker}") — the executor it names does not claim this work.`);
    if (ex.command) {
      const s = /npm run ([a-z:-]+)/.exec(ex.command)?.[1];
      if (!s || !packageScripts[s]) p.push(`TASK_EXECUTORS.${kind} names "${ex.command}", which package.json does not have.`);
    }
  }
  return { problems: p, sites, tokens };
}

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
  const readFile = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);
  return { sources, report, packageScripts, readFile, taskExecutors: TASK_EXECUTORS, taskCreators: TASK_CREATORS };
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
      ["the real tree's tasks all have a claiming executor", taskProblems(real).problems.length === 0],
      ["grid_fix with no executor fails (the 48 tasks of 7 Oct)", (() => { const { grid_fix, ...rest } = real.taskExecutors; const r = taskProblems({ ...real, taskExecutors: rest }).problems; return r.some((x) => /creates "grid_fix" tasks/.test(x)) && r.some((x) => /input\.grid_fix/.test(x)); })()],
      ["a new tasks insert site nobody registered fails", taskProblems({ ...real, sources: [...real.sources, { path: "src/worker/boss/routes/newDoor.ts", text: "INSERT INTO tasks (id) VALUES (?)" }] }).problems.some((x) => /newDoor\.ts: inserts a tasks row and is not in TASK_CREATORS/.test(x))],
      ["a drain exclusion with no executor fails", taskProblems({ ...real, sources: real.sources.map((s) => s.path.endsWith("worker/bossMount.ts") ? { ...s, text: s.text + "\nAND COALESCE(json_extract(t.input, '$.orphan_kind'), '') = ''" } : s) }).problems.some((x) => /input\.orphan_kind/.test(x))],
      ["an executor whose file lost its claim fails", taskProblems({ ...real, readFile: (rel) => rel === "scripts/ops/grid-watch.mjs" ? real.readFile(rel).replaceAll("GRID_INBOX", "X") : real.readFile(rel) }).problems.some((x) => /TASK_EXECUTORS\.grid_fix: .* no longer contains/.test(x))],
      ["an executor command missing from package.json fails", taskProblems({ ...real, packageScripts: {} }).problems.some((x) => /TASK_EXECUTORS\.grid_fix names "npm run grid:post"/.test(x))],
      ["zero tasks insert sites is a failure", taskProblems({ ...real, sources: [] }).problems.some((x) => x.startsWith("RULE 0: no `INSERT INTO tasks`"))],
      ["a registry entry for a file that inserts nothing fails", taskProblems({ ...real, taskCreators: { ...real.taskCreators, "src/worker/ghost.ts": ["drain"] } }).problems.some((x) => /ghost\.ts, which inserts no tasks row/.test(x))],
    ];
    const failed = cases.filter(([, ok]) => !ok);
    for (const [n] of failed) console.error(`  ✗ ${n}`);
    if (failed.length) { console.error(`work-goes-to-a-seat self-test: ${failed.length} case(s) wrong`); process.exit(1); }
    console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
  } else {
    const { problems: p0, sites } = problems(real);
    const t = taskProblems(real);
    const p = [...p0, ...t.problems];
    if (p.length) { for (const x of p) console.error(`  ✗ ${x}`); console.error(`WORK-REACHES-AN-EXECUTOR SCAN FAILED: ${p.length} problem(s).`); process.exit(1); }
    console.log(`WORK-REACHES-AN-EXECUTOR SCAN PASSED: ${sites} assignment door(s) all check the seat can do it; asks that are tasks are refused at the endpoint and the report; ${t.sites} task insert site(s) and ${t.tokens.length} drain-refused token(s) (${t.tokens.join(", ")}) all have a claiming executor.`);
  }
}
