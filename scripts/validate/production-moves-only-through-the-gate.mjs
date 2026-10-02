#!/usr/bin/env node
/**
 * PRODUCTION MOVES ONLY THROUGH THE GATE — AND A SMALL CHANGE DOES NOT WAIT FOR A SUITE NOTHING RUNS.
 *
 * ─── The wait this closes ────────────────────────────────────────────────────
 *
 * 26 Sep 2026: the Playwright journeys left the merge path; production moved only to a sha they had
 * passed. 2 Oct 2026, morning: the journeys became ON DEMAND ONLY (no cron). From that moment a
 * small change — a CI comment, a validator self-test, a doc — merged, and then sat: `land <pr>`
 * printed WAITING for a green e2e run on its sha, and nothing would ever start one. #62 and #63
 * were merged and not in production.
 *
 * 2 Oct 2026, the owner (asked and answered): a SMALL change ships to production on the fast check
 * alone (typecheck, unit, validators). E2e gates production only after a LARGE change, or when
 * asked. `land` measures the change — its `large` block in seq23/seq-bin is the ONE definition of
 * "large", and nothing in this repo restates it — and either deploys at once or runs the journeys
 * first.
 *
 * ─── What must not be lost on the way ────────────────────────────────────────
 *
 * The old rule was simple and safe: no green e2e, no production. The new one must be at least as
 * hard to get round, so it is one decision in one file, `scripts/deploy/production-gate.mjs`:
 *
 *   · a sha with a green e2e run on it may ship; or
 *   · with a REASON (land's small-change verdict): CI green on exactly that sha, AND the journeys
 *     not KNOWN RED on main (the newest run that reached a verdict is success, or none ever did);
 *   · anything unread is a refusal.
 *
 * `deploy.yml`'s workflow_dispatch used to be a hole in the old rule — it deployed main's head with
 * no verdict of any kind. It now goes through the gate like every other path.
 *
 * ─── The rule, read from the files ───────────────────────────────────────────
 *
 *   1. deploy.yml triggers on EXACTLY workflow_run + workflow_dispatch — never push, never a cron.
 *   2. Its workflow_run names [e2e], types [completed], branches [main], and the job is gated on
 *      `workflow_run.conclusion == 'success'`: a red run fires it and is turned away.
 *   3. EVERY path runs `node scripts/deploy/production-gate.mjs` before anything deploys, and the
 *      workflow carries no deploy step that does not depend on that step.
 *   4. The dispatch takes `sha` and `reason`, hands the reason to the gate, and requires the sha
 *      to be on main; what is deployed is exactly the sha the gate passed.
 *   5. It deploys through `npm run deploy:production`, never a bare `wrangler deploy`; never
 *      cancels a deploy in progress; records a GitHub Deployment (environment production).
 *   6. The gate carries the decision and the known-red rule, reads e2e AND the fast check (ci.yml)
 *      on the sha, points at land for "large", and restates no threshold.
 *   7. The gate's own table decides every case correctly, and each broken gate is caught.
 *   8. docs/DEPLOYING.md points at the gate (a rule in code, a document that names it).
 *
 * RULE 0: a missing deploy.yml, a missing gate, or a gate table of zero cases is a hard failure.
 *
 *   node scripts/validate/production-moves-only-through-the-gate.mjs
 *   node scripts/validate/production-moves-only-through-the-gate.mjs --self-test
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selfTest as gateSelfTest } from "../deploy/production-gate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEPLOY = ".github/workflows/deploy.yml";
const GATE = "scripts/deploy/production-gate.mjs";
const DOC = "docs/DEPLOYING.md";
const GATE_RUN = "node scripts/deploy/production-gate.mjs";

/** The lines that run: comment lines say what a workflow means, only the rest is what it does. */
const live = (yaml) => yaml.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#.*$/, "")).join("\n");

/** The top-level `on:` block's trigger names. */
export function triggersIn(yaml) {
  const lines = live(yaml).split("\n");
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (!line.startsWith(" ")) break;
    const m = line.match(/^  ([A-Za-z_]+):/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The indented body of one trigger inside the `on:` block. */
export function triggerBody(yaml, name) {
  const lines = live(yaml).split("\n");
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start < 0) return "";
  let inside = false;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith(" ")) break;
    if (new RegExp(`^  ${name}:`).test(line)) { inside = true; continue; }
    if (/^  [A-Za-z_]+:/.test(line)) inside = false;
    if (inside) out.push(line);
  }
  return out.join("\n");
}

/** Each `- name:` / `- uses:` step of the workflow, as text, in order. */
export function stepsIn(yaml) {
  const body = live(yaml);
  const at = body.indexOf("\n    steps:\n");
  if (at < 0) return [];
  return body.slice(at + 12).split(/\n(?=      - )/).map((s) => s.trim()).filter(Boolean);
}

export function check({ deploy, gate, doc }, gateTable = gateSelfTest) {
  const problems = [];
  if (!deploy) { problems.push(`${DEPLOY} is missing — nothing in CI can ship production, and nothing here can be checked (Rule 0).`); return problems; }

  // 1–2. What may start it, and that a red run is turned away.
  const triggers = triggersIn(deploy).sort();
  if (triggers.join(",") !== "workflow_dispatch,workflow_run") problems.push(`${DEPLOY} triggers on [${triggers.join(", ")}] — exactly [workflow_run, workflow_dispatch] may deploy production; a push or a cron would ship with nothing asked.`);
  const wr = triggerBody(deploy, "workflow_run");
  if (!/workflows:\s*\[\s*e2e\s*\]/.test(wr)) problems.push(`${DEPLOY}'s workflow_run must name workflows: [e2e] and nothing else.`);
  if (!/types:\s*\[\s*completed\s*\]/.test(wr)) problems.push(`${DEPLOY}'s workflow_run must fire on types: [completed] (the conclusion is judged in the job).`);
  if (!/branches:\s*\[\s*main\s*\]/.test(wr)) problems.push(`${DEPLOY}'s workflow_run must be limited to branches: [main].`);
  const run = live(deploy);
  if (!/github\.event\.workflow_run\.conclusion\s*==\s*'success'/.test(run)) problems.push(`${DEPLOY}'s job is not gated on workflow_run.conclusion == 'success' — a red e2e run would deploy.`);

  // 3. Every path through the gate, and nothing deploys without it.
  const steps = stepsIn(deploy);
  const gateAt = steps.findIndex((s) => s.includes(GATE_RUN));
  const deployAt = steps.findIndex((s) => /npm run deploy:production/.test(s));
  if (gateAt < 0) problems.push(`${DEPLOY} does not run ${GATE} — a dispatch could deploy production with nothing checked.`);
  if (deployAt < 0) problems.push(`${DEPLOY} must deploy through \`npm run deploy:production\` (migrations, build, deploy, probe).`);
  if (gateAt >= 0 && deployAt >= 0 && gateAt > deployAt) problems.push(`${DEPLOY} runs the gate AFTER the deploy step — it decides nothing.`);
  if (gateAt >= 0 && /^\s+if:/m.test(steps[gateAt])) problems.push(`${DEPLOY}'s gate step is conditional — some path reaches the deploy without it.`);
  if (gateAt >= 0 && /continue-on-error:\s*true/.test(steps[gateAt])) problems.push(`${DEPLOY}'s gate step has continue-on-error — a refusal would not stop the deploy.`);
  if (/REFUSED: no successful e2e run/.test(run)) problems.push(`${DEPLOY} carries its own inline e2e check — the rule lives in ${GATE}, once.`);

  // 4. The dispatch names a sha and a reason; the sha is on main; that sha is what is deployed.
  const wd = triggerBody(deploy, "workflow_dispatch");
  if (!/\n\s{6}sha:/.test(`\n${wd}`)) problems.push(`${DEPLOY}'s dispatch takes no sha — the commit that was judged could not be named.`);
  if (!/\n\s{6}reason:/.test(`\n${wd}`)) problems.push(`${DEPLOY}'s dispatch takes no reason — a small change (land's verdict) could never ship from here, and production would wait on a suite nothing runs.`);
  if (!/REASON: \$\{\{ github\.event\.inputs\.reason \}\}/.test(run)) problems.push(`${DEPLOY} does not hand the dispatch reason to the gate (env REASON).`);
  if (!/RUN_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/.test(run)) problems.push(`${DEPLOY} does not take the e2e run's head_sha — main's head may have moved past what was proven.`);
  if (!/git merge-base --is-ancestor "\$sha" origin\/main/.test(run)) problems.push(`${DEPLOY} does not require the sha to be on main.`);
  if (!/git checkout -q "\$\{\{ steps\.pick\.outputs\.sha \}\}"/.test(run)) problems.push(`${DEPLOY} does not check out exactly the sha the gate passed before deploying.`);

  // 5. How it deploys, and the record it leaves.
  if (/^\s*(-\s*)?run:.*\bwrangler deploy\b/m.test(run)) problems.push(`${DEPLOY} runs a bare \`wrangler deploy\` (stale client, local dev bindings).`);
  if (!/cancel-in-progress:\s*false/.test(run)) problems.push(`${DEPLOY} must not cancel a deploy in progress (a half-applied migration set).`);
  if (!/"environment":"production"/.test(run) || !/deployments:\s*write/.test(run)) problems.push(`${DEPLOY} must record a GitHub Deployment (environment production) with deployments: write — \`land\` reads it to know what production runs.`);

  // 6. The gate itself.
  if (!gate) { problems.push(`${GATE} is missing — nothing decides what may reach production (Rule 0).`); return problems; }
  if (!/export function decide\(/.test(gate) || !/KNOWN RED/.test(gate)) problems.push(`${GATE} no longer carries the decision (decide) or the known-red rule.`);
  if (!/actions\/workflows\/\$\{E2E_WF\}\/runs\?head_sha=/.test(gate)) problems.push(`${GATE} does not check for a green e2e run on the sha.`);
  if (!/actions\/workflows\/\$\{FAST_WF\}\/runs\?head_sha=/.test(gate) || !/GATE_FAST_WF \|\| ["']ci\.yml["']/.test(gate)) problems.push(`${GATE} does not check the fast check (ci.yml) on the sha.`);
  if (!/seq23\/seq-bin/.test(gate)) problems.push(`${GATE} no longer points at land (seq23/seq-bin) for what "large" means.`);
  if (/LAND_LARGE_|changedFiles|additions \+ deletions/.test(gate)) problems.push(`${GATE} restates land's size rule — there is one definition, in land.`);

  // 7. Its own table. A rule nobody runs is a wish.
  const t = gateTable();
  if (!t || t.cases === 0 || t.mutants === 0) problems.push(`${GATE} self-test examined nothing (Rule 0).`);
  else {
    for (const w of t.wrong) problems.push(`${GATE} decides wrongly: ${w}.`);
    for (const u of t.uncaught) problems.push(`${GATE} self-test would not catch a gate that ${u}.`);
  }

  // 8. The document points at the code.
  if (!doc) problems.push(`${DOC} is missing — the deploy path is undocumented.`);
  else if (!doc.includes(GATE)) problems.push(`${DOC} does not name ${GATE} — the document must point at the rule, not restate it.`);
  return problems;
}

function selfTest() {
  const read = (f) => readFileSync(join(ROOT, f), "utf8");
  const deploy = read(DEPLOY), gate = read(GATE), doc = read(DOC);
  const good = { deploy, gate, doc };
  const sw = (from, to) => { if (!deploy.includes(from)) throw new Error(`fixture cannot be built: ${DEPLOY} has no ${JSON.stringify(from)}`); return deploy.replace(from, to); };
  const cases = [
    ["the shipped shape passes", good, 0],
    ["deploy.yml back on push to main", { ...good, deploy: sw("\non:\n", "\non:\n  push:\n    branches: [main]\n") }, 1],
    ["deploy.yml on a cron", { ...good, deploy: sw("\non:\n", "\non:\n  schedule:\n    - cron: \"0 7 * * *\"\n") }, 1],
    ["deploy.yml firing on CI instead of e2e", { ...good, deploy: sw("workflows: [e2e]", "workflows: [CI]") }, 1],
    ["deploy.yml that ships on any e2e conclusion", { ...good, deploy: sw("github.event.workflow_run.conclusion == 'success'", "true") }, 1],
    ["deploy.yml that skips the production gate", { ...good, deploy: sw(GATE_RUN, "true") }, 1],
    ["deploy.yml whose gate step is conditional", { ...good, deploy: sw("      - name: Pick the sha and pass the production gate (every path)\n", "      - name: Pick the sha and pass the production gate (every path)\n        if: github.event_name == 'workflow_run'\n") }, 1],
    ["deploy.yml whose gate may fail and carry on", { ...good, deploy: sw("      - name: Pick the sha and pass the production gate (every path)\n", "      - name: Pick the sha and pass the production gate (every path)\n        continue-on-error: true\n") }, 1],
    ["deploy.yml back to its own inline e2e-only check", { ...good, deploy: sw(GATE_RUN, `echo "::error::REFUSED: no successful e2e run on $sha"; ${GATE_RUN}`) }, 1],
    ["the break-glass dispatch back: no sha, no reason", { ...good, deploy: deploy.replace(/  workflow_dispatch:\n    inputs:\n(?:      .*\n)+/, "  workflow_dispatch:\n") }, 2],
    ["a dispatch that takes no reason", { ...good, deploy: deploy.replace(/\n      reason:\n(?:        .*\n)+/, "\n") }, 1],
    ["a dispatch that drops the reason on the floor", { ...good, deploy: sw("REASON: ${{ github.event.inputs.reason }}", 'REASON: ""') }, 1],
    ["a sha that need not be on main", { ...good, deploy: sw('git merge-base --is-ancestor "$sha" origin/main', "true") }, 1],
    ["deploying main's head instead of the sha the gate passed", { ...good, deploy: sw('git checkout -q "${{ steps.pick.outputs.sha }}"', "git checkout -q origin/main") }, 1],
    ["a bare wrangler deploy", { ...good, deploy: sw("run: npm run deploy:production", "run: npx wrangler deploy --env production") }, 2],
    ["a deploy that cancels the one in progress", { ...good, deploy: sw("cancel-in-progress: false", "cancel-in-progress: true") }, 1],
    ["no deployment record", { ...good, deploy: sw('"environment":"production","auto_merge"', '"environment":"preview","auto_merge"').replace('{"state":"success","environment":"production"', '{"state":"success","environment":"preview"') }, 1],
    ["a gate with no known-red rule", { ...good, gate: gate.replaceAll("KNOWN RED", "known") }, 1],
    ["a gate that never reads the fast check", { ...good, gate: gate.replace("actions/workflows/${FAST_WF}/runs?head_sha=", "x") }, 1],
    ["a gate that reads some other fast check", { ...good, gate: gate.replace("process.env.GATE_FAST_WF || 'ci.yml'", "process.env.GATE_FAST_WF || 'lint.yml'") }, 1],
    ["a gate that never reads e2e on the sha", { ...good, gate: gate.replace("actions/workflows/${E2E_WF}/runs?head_sha=", "x") }, 1],
    ["a gate that restates land's thresholds", { ...good, gate: gate + "\nconst LAND_LARGE_LINES = 200;\n" }, 1],
    ["a gate that no longer points at land", { ...good, gate: gate.replaceAll("seq23/seq-bin", "somewhere") }, 1],
    ["a gate table that decides a case wrongly", good, 1, () => ({ cases: 17, mutants: 5, wrong: ["small change, suite KNOWN RED (failure): refused"], uncaught: [] })],
    ["a gate table that would not catch a broken gate", good, 1, () => ({ cases: 17, mutants: 5, wrong: [], uncaught: ["ships past a known-red suite"] })],
    ["RULE 0: a gate table of zero cases", good, 1, () => ({ cases: 0, mutants: 0, wrong: [], uncaught: [] })],
    ["RULE 0: the gate missing", { ...good, gate: "" }, 1],
    ["RULE 0: deploy.yml missing", { ...good, deploy: "" }, 1],
    ["DEPLOYING.md that does not point at the gate", { ...good, doc: doc.replaceAll(GATE, "the rule") }, 1],
  ];
  let wrong = 0;
  for (const [name, input, min, table] of cases) {
    const p = check(input, table);
    const ok = min === 0 ? p.length === 0 : p.length >= min;
    if (!ok) { wrong += 1; console.error(`  ✗ ${name}: ${p.length} problem(s)\n    ${p.join("\n    ")}`); }
  }
  if (wrong) { console.error(`production-moves-only-through-the-gate self-test: ${wrong} case(s) wrong`); process.exit(1); }
  console.log(`production-moves-only-through-the-gate self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }
const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return ""; } };
const problems = check({ deploy: read(DEPLOY), gate: read(GATE), doc: read(DOC) });
if (problems.length) {
  console.error("PRODUCTION CAN MOVE WITHOUT THE GATE:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
const t = gateSelfTest();
console.log(`production-moves-only-through-the-gate: ${DEPLOY} fires on a green e2e or a dispatch, every path runs ${GATE} (a green e2e on the sha; or a reason + CI green on the sha + the journeys not known red), deploys exactly that sha through deploy:production and records it; gate table ${t.cases} cases, ${t.mutants} broken gates caught. OK.`);
