#!/usr/bin/env node
/**
 * THE EXAMINATION LOOKS AT EVERY GRID PROPERTY, CHANGES NOTHING, AND THE SLOT CAN ONLY SHOW WHAT IT
 * ACTUALLY FOUND.
 *
 * ─── Her instruction ────────────────────────────────────────────────────────
 *
 *   "the agent needs to examine what is going on with those businesses and give me stuff to do
 *    for those"
 *
 * ─── The three ways this feature fails, and none of them is by breaking ────
 *
 * 1. IT EXAMINES NOTHING AND THE SCREEN LOOKS THE SAME. "Nothing needs you today" and "nothing
 *    looked" are opposite facts that render identically, and the second one is invisible for weeks.
 *    So the run records `properties_expected` beside `properties_examined`, the endpoint refuses an
 *    examination that expected zero, and the job exits non-zero when it reached none.
 *
 * 2. IT KEEPS ITS OWN LIST. `spry-heartbeat.mjs` already did exactly this — eight repos assembled
 *    from `gh repo list`, two of them never named by her and four of hers missing, both client repos
 *    among them. The examination must iterate `src/shared/boss/grid.mjs` and never a literal list.
 *
 * 3. IT STARTS FIXING THINGS. Examining is READ-ONLY. Her standing rule is ONE AGENT PER REPO,
 *    learned when three agents in one repository turned forty minutes of work into four hours of
 *    rebasing. A job that reached into a dozen repositories and edited them would break that rule a
 *    dozen times in a single run, and one of those repositories would eventually be a west-peek one.
 *
 * And the fourth, which is the feature rather than a failure of it:
 *
 * 4. THE SLOT SHOWS ONLY WHAT NEEDS HER. Anything a script or an employee can do is DISPATCHED.
 *    "A slot that lists five red builds is a dashboard she will scroll past."
 *
 * RULE 0: if the grid this would examine is empty, or the examination script or the endpoint is
 * missing, this HARD-FAILS rather than passing over an empty set.
 *
 *   node scripts/validate/the-examination-covers-the-grid.mjs
 *   node scripts/validate/the-examination-covers-the-grid.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const WATCH = "scripts/ops/grid-watch.mjs";
const ROUTE = "src/worker/boss/routes/grid.ts";
const PILLARS = "src/worker/boss/today/pillars.ts";
const HEARTBEAT = "scripts/ops/spry-heartbeat.mjs";
const GRID_FILE = "src/shared/boss/grid.mjs";

/**
 * Verbs that change a repository.
 *
 * `gh api` with no `--method` is a GET and is allowed. Everything here either writes through the API
 * or writes through git, and either way it is a change to a repository this job may not make.
 */
/*
 * BOTH FORMS, BECAUSE THE SHELL FORM IS NOT THE ONE THIS FILE ACTUALLY USES. `gh` is invoked here
 * through `execFile` with an ARGV ARRAY — `["api", path]` — so a pattern written for
 * `gh pr create --fill` matches a command line nobody in this repository writes, while
 * `["pr", "create"]` sails past. The first draft had exactly that hole and the self-test found it:
 * three read-only fixtures were mutated into writes and the scan approved all three.
 *
 * So each verb is matched with an optional quote-and-comma between the words, which covers
 * `gh pr create`, `["pr", "create"]` and `['pr','create']` alike.
 */
/*
 * A SEPARATOR OF AT MOST EIGHT NON-ALPHANUMERIC CHARACTERS between the words. That covers the shell
 * form `gh pr create` and every argv-array spelling: `execFile("gh", ["pr", "create"])`,
 * `['pr','create']`, and the same with different quoting. Deliberately crude, because the precise
 * version was wrong twice in a row against the very fixtures written to break it.
 */
const SEP = "[^A-Za-z0-9]{1,8}";
const WRITE_VERBS = [
  new RegExp(`--method${SEP}(POST|PUT|PATCH|DELETE)`, "i"),
  new RegExp(`\\bgh${SEP}pr${SEP}(create|merge|edit|close|comment|review)`),
  new RegExp(`\\bgh${SEP}issue${SEP}(create|edit|close|comment)`),
  new RegExp(`\\bgh${SEP}workflow${SEP}run`),
  new RegExp(`\\bgh${SEP}release${SEP}create`),
  new RegExp(`\\bgit${SEP}(push|commit|merge|branch)`),
];

export function check({ watch, route, pillars, heartbeat, gridRepoCount }) {
  const problems = [];
  const code = (src) => (src ?? "").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  // ── RULE 0 ────────────────────────────────────────────────────────────────
  if (!watch) {
    problems.push(`${WATCH} does not exist, so nothing goes and looks at the grid and the side-hustle slot is back to echoing flags nobody sets.`);
  }
  if (!route || !/examination/.test(route)) {
    problems.push(`${ROUTE} has no examination endpoint, so a run on her Mac would have nowhere to file what it saw.`);
  }
  if (!gridRepoCount) {
    problems.push(
      `The grid names no repositories, so the examination would iterate an empty list and report a clean ` +
      `sweep of nothing. A loop over an empty set that says "all good" is the defect class her own rules ` +
      `name first.`,
    );
  }
  if (problems.length) return problems;

  const w = code(watch);

  // ── 2. It iterates the grid, and keeps no list of its own ─────────────────
  if (!/from ["'].*shared\/boss\/grid\.mjs["']/.test(watch)) {
    problems.push(
      `${WATCH} does not import the grid from ${GRID_FILE}. A second list is the defect this repository ` +
      `names most often, and it has already happened once here: spry-heartbeat.mjs kept eight repos of ` +
      `its own, two she never named and four of hers missing.`,
    );
  }
  if (!/for \(const property of GRID\)/.test(w) && !/GRID\.(?:flatMap|map|forEach)/.test(w)) {
    problems.push(`${WATCH} does not iterate GRID. Whatever it is examining, it is not provably the grid.`);
  }
  if (/const\s+PROPERTIES\s*=\s*\[/.test(w) || /const\s+REPOS\s*=\s*\[/.test(w)) {
    problems.push(`${WATCH} declares its own list of properties. The grid is the list.`);
  }

  // ── 1. Coverage is recorded, both numbers ─────────────────────────────────
  for (const field of ["properties_expected", "properties_examined"]) {
    if (!new RegExp(field).test(w)) {
      problems.push(
        `${WATCH} does not report \`${field}\`. Without both numbers, a run that reached nothing and a run ` +
        `that found nothing are the same empty screen — and they are opposite facts.`,
      );
    }
  }
  if (!/EMPTY_GRID|EXAMINED_NOTHING/.test(w)) {
    problems.push(
      `${WATCH} has no named stop for examining nothing. Rule 0 belongs at the exit code: a run that ` +
      `could read no repository must turn its duty row red, not report a quiet day.`,
    );
  }

  // ── 3. Read-only ──────────────────────────────────────────────────────────
  for (const verb of WRITE_VERBS) {
    if (verb.test(w)) {
      problems.push(
        `${WATCH} contains ${verb.source}, which changes a repository. The examination observes; fixes are ` +
        `dispatched as work through Boss OS. Her standing rule is one agent per repo, and a job reaching ` +
        `into a dozen of them at once breaks it a dozen times in one run.`,
      );
    }
  }

  // ── West Peek is refused BY NAME, in the run's own output ─────────────────
  if (!/if \(isExcluded\(/.test(w)) {
    problems.push(
      `${WATCH} never calls \`isExcluded\`. On 29 Aug 2026 an agent working portfolio-wide branched and ` +
      `merged into west-peek-network-os. The exclusions have to be applied, not merely written down.`,
    );
  }
  if (!/refused|excluded/i.test(w)) {
    problems.push(`${WATCH} does not say what it refused to examine. An exclusion nobody can see is one nobody can correct.`);
  }

  // ── 4. The split, enforced at the endpoint ────────────────────────────────
  const r = code(route);
  if (!/disposition/.test(r)) {
    problems.push(`${ROUTE} does not carry a \`disposition\`, so nothing separates work to dispatch from work only she can do.`);
  }
  if (!/needs_her_why/.test(r) || !/throw badRequest/.test(r)) {
    problems.push(
      `${ROUTE} does not refuse a \`needs_her\` observation that cannot say what only she can do. Without ` +
      `that refusal the bar is whatever the job felt like today.`,
    );
  }
  if (!/tier !== "primary"/.test(r)) {
    problems.push(
      `${ROUTE} does not refuse a \`needs_her\` observation from a non-primary property. The generator is ` +
      `"fix only if broken" and the authority network is "a cost centre, not a line — never a day's work". ` +
      `Both are examined; neither asks for her.`,
    );
  }
  if (!/propertyFor\(/.test(r)) {
    problems.push(
      `${ROUTE} does not resolve \`property_key\` against the grid, so \`grid_observations\` would become a ` +
      `second list of property names that nothing keeps in step.`,
    );
  }
  if (!/grid_fix/.test(r)) {
    problems.push(
      `${ROUTE} does not mark a dispatched task with \`grid_fix\`. That token is what keeps the model drain ` +
      `off it — fixing one of these means working inside one of her repositories, one agent at a time.`,
    );
  }

  // ── The slot can only show what the examination found ─────────────────────
  const p = code(pillars);
  if (!/FROM grid_observations/.test(p)) {
    problems.push(
      `${PILLARS} does not read \`grid_observations\`, so the side-hustle slot cannot surface anything the ` +
      `examination found and is back to waiting for a flag she sets by hand.`,
    );
  }
  if (!/disposition = 'needs_her'/.test(p)) {
    problems.push(`${PILLARS} does not restrict the slot to \`needs_her\` observations, so a red build could reach her contract.`);
  }

  // ── And the old second list is gone ───────────────────────────────────────
  if (heartbeat && !/shared\/boss\/grid\.mjs/.test(heartbeat)) {
    problems.push(
      `${HEARTBEAT} still keeps its own property list instead of reading the grid. That list already had two ` +
      `repos she never named and was missing four she did, including both client properties.`,
    );
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

const GOOD_WATCH = `
import { GRID, EXCLUDED, GRID_OWNER, isExcluded, whyExcluded } from "../../src/shared/boss/grid.mjs";
async function gh(path) { execFile("gh", ["api", path], cb); }
async function main() {
  const scope = [];
  const refused = [];
  for (const property of GRID) {
    for (const repo of property.repos) {
      if (isExcluded(repo)) { refused.push({ repo, why: whyExcluded(repo) }); continue; }
      scope.push({ property, repo });
    }
  }
  if (scope.length === 0) { console.error("NAMED STOP [EMPTY_GRID]"); process.exit(4); }
  const payload = { properties_expected: scope.length, properties_examined: reached };
  if (reached === 0) { console.error("NAMED STOP [EXAMINED_NOTHING]"); process.exit(8); }
}
`;

const GOOD_ROUTE = `
import { GRID, propertyFor } from "../../../shared/boss/grid.mjs";
grid.post("/examination", async (c) => {
  const property = propertyFor(raw.property_key);
  const why = String(raw.needs_her_why ?? "").trim();
  if (disposition === "needs_her") {
    if (!why) throw badRequest("no why");
    if (property.tier !== "primary") throw badRequest("not primary");
  }
  await c.env.DB.prepare("INSERT INTO tasks ...").bind(JSON.stringify({ grid_fix: {} })).run();
});
`;

const GOOD_PILLARS = `
async function examinedTouch(env, pin) {
  const row = await env.DB.prepare("SELECT o.id FROM grid_observations o WHERE o.disposition = 'needs_her' LIMIT 1").first();
}
`;

const GOOD_HEARTBEAT = `import { GRID } from "../../src/shared/boss/grid.mjs";`;

function selfTest() {
  const G = {
    watch: GOOD_WATCH, route: GOOD_ROUTE, pillars: GOOD_PILLARS,
    heartbeat: GOOD_HEARTBEAT, gridRepoCount: 10,
  };
  const cases = [
    { name: "the shipped shape passes", input: G, expect: 0 },
    { name: "RULE 0 — the examination script gone", input: { ...G, watch: "" }, expect: 1 },
    { name: "RULE 0 — the endpoint gone", input: { ...G, route: "export const grid = new Hono();" }, expect: 1 },
    { name: "RULE 0 — the grid names no repositories", input: { ...G, gridRepoCount: 0 }, expect: 1 },
    {
      name: "THE SECOND LIST: the examination keeping its own property list",
      input: { ...G, watch: GOOD_WATCH.replace(/import \{ GRID[^\n]*\n/, 'const PROPERTIES = ["a", "b"];\n') },
      expect: 1,
    },
    {
      name: "coverage no longer recorded, so examining nothing looks like finding nothing",
      input: { ...G, watch: GOOD_WATCH.replace("properties_expected: scope.length, properties_examined: reached", "ok: true") },
      expect: 1,
    },
    {
      name: "the named stop for examining nothing removed",
      input: { ...G, watch: GOOD_WATCH.replace("EMPTY_GRID", "hmm").replace("EXAMINED_NOTHING", "hmm") },
      expect: 1,
    },
    {
      name: "READ-ONLY BROKEN: the examination opening a pull request",
      input: { ...G, watch: `${GOOD_WATCH}\nexecFile("gh", ["pr", "create", "--fill"]);` },
      expect: 1,
    },
    {
      name: "READ-ONLY BROKEN: the examination pushing",
      input: { ...G, watch: `${GOOD_WATCH}\nexec("git push origin HEAD");` },
      expect: 1,
    },
    {
      name: "READ-ONLY BROKEN: a POST through the GitHub API",
      input: { ...G, watch: GOOD_WATCH.replace('["api", path]', '["api", "--method", "POST", path]') },
      expect: 1,
    },
    {
      name: "THE INCIDENT: the exclusions written down but never applied",
      input: { ...G, watch: GOOD_WATCH.replace(/if \(isExcluded\(repo\)\)[^\n]*\n/, "") },
      expect: 1,
    },
    {
      name: "a needs_her observation accepted with no reason only she can act",
      input: { ...G, route: GOOD_ROUTE.replace('    if (!why) throw badRequest("no why");\n', "").replace("needs_her_why", "headline") },
      expect: 1,
    },
    {
      name: "a secondary property allowed to ask for her",
      input: { ...G, route: GOOD_ROUTE.replace('    if (property.tier !== "primary") throw badRequest("not primary");\n', "") },
      expect: 1,
    },
    {
      name: "property_key stored without being resolved against the grid",
      input: { ...G, route: GOOD_ROUTE.replace(/propertyFor\(/g, "String(") },
      expect: 1,
    },
    {
      name: "a dispatched task left drainable by a model",
      input: { ...G, route: GOOD_ROUTE.replace("grid_fix", "fix") },
      expect: 1,
    },
    {
      name: "THE DASHBOARD DEFECT: the slot reading every observation, not only needs_her",
      input: { ...G, pillars: GOOD_PILLARS.replace("o.disposition = 'needs_her' ", "") },
      expect: 1,
    },
    {
      name: "the slot no longer reading the examination at all",
      input: { ...G, pillars: "async function examinedTouch() { return null; }" },
      expect: 1,
    },
    {
      name: "the heartbeat keeping the old second list",
      input: { ...G, heartbeat: 'const PROPERTIES = [{ repo: "seq23/approvalprep" }];' },
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const okCase = c.expect === 0 ? found === 0 : found >= 1;
    if (!okCase) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
      if (c.expect === 0) for (const p of check(c.input)) console.error(`          • ${p}`);
    }
  }
  if (failed) {
    console.error(`\nthe-examination-covers-the-grid self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`the-examination-covers-the-grid self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const missing = [ROUTE, PILLARS, GRID_FILE].filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`the-examination-covers-the-grid FAILED — ${missing.join(", ")} missing.`);
    process.exit(1);
  }
  const { gridRepos } = await import(join(ROOT, GRID_FILE));

  const problems = check({
    watch: existsSync(join(ROOT, WATCH)) ? read(WATCH) : "",
    route: read(ROUTE),
    pillars: read(PILLARS),
    heartbeat: existsSync(join(ROOT, HEARTBEAT)) ? read(HEARTBEAT) : null,
    gridRepoCount: gridRepos().length,
  });

  if (problems.length) {
    console.error("the-examination-covers-the-grid FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    console.error(
      "Silence because nothing needs her and silence because nothing ran must never look the same, and a\n" +
      "job that examines a dozen of her repositories must never start editing them.\n",
    );
    process.exit(1);
  }

  console.log(
    `the-examination-covers-the-grid: the daily pass iterates the grid (${gridRepos().length} repositories), ` +
    `records what it expected against what it reached, refuses to fix anything, names what it excluded, and ` +
    `the slot can surface only a \`needs_her\` observation it actually filed. OK.`,
  );
  selfTest();
}
