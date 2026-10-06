#!/usr/bin/env node
/**
 * EVERY BOSS OS EMPLOYEE KEEPS THE SERVICE RULES — READ FROM THE DOCUMENT, CHECKED AGAINST THE CODE.
 *
 * The owner, 6 Oct 2026: "i need to make sure all of these things we just did for porter and west
 * peek OS agents — we need to apply it to boss os repo for all the boss os agents — same
 * capabilities and friction reduction." docs/SERVICE_RULES.md lists the 31 rules; this reads it.
 *
 * It fails the build when:
 *   1. the document holds no rules (Rule 0), a rule line is malformed, or a number repeats;
 *   2. an anchor (`path#export`, or `file.md#Heading`) does not exist in the tree;
 *   3. an ALL-KINDS rule is anchored in a lane-only file, or its export is reached only from one
 *      lane's files — the rule would then serve one employee, which is the defect West Peek OS's
 *      #228 found eleven of;
 *   4. a rule anchored on the shared prompt fragment has no line in SERVICE_PRACTICES, or the
 *      fragment carries a REPO-ONLY rule or one the document does not list;
 *   5. the shared layer is not wired at a door (INCLUSIONS — read in the code with comments stripped);
 *   6. any wait kind renders out of the three-part shape, or points her into Boss OS (only
 *      TIER2_DECISION may, and it must say so with `inBossOs`);
 *   7. a LIKE pattern is built from data under src/worker/boss (D1: "LIKE or GLOB pattern too complex").
 *
 * Prints `all-kinds rules: N (shared layer: N, lane-only: 0)`.
 *
 *   node scripts/validate/service-rules.mjs
 *   node scripts/validate/service-rules.mjs --self-test   # plants each failure and proves it is caught
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_PRACTICES } from "../../src/shared/boss/service/practices.mjs";
import { BOSS_WAITS, BOSS_WAIT_KINDS, bossWait, waitDetail, WAIT_SHAPE, WAIT_TEXT_FORBIDDEN } from "../../src/shared/boss/service/waits.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const DOC = "docs/SERVICE_RULES.md";

const RULE = /^- R(\d+) \[(ALL-KINDS|REPO-ONLY)\] (.+?) — owner: (.+?) — anchor: `([^`]+)`(.*)$/;

/** Files that belong to one lane only. An ALL-KINDS rule may not live in, or be reached only from, these. */
export const LANE_ONLY = /repoChange|repo-change|\/kdp|kdp-|commentWatch|comment-watch|\/capital\/|capital-|\/wealth\/|lp-|buyer-hunt|filing-hunt/;

/** Doors every employee's work passes through: a reference from one of these reaches all of them. */
export const UNIVERSAL_DOORS = [
  "src/worker/boss/intake/inboundMail.ts",
  "src/worker/boss/queue/consumer.ts",
  "src/worker/boss/routes/backends.ts",
  "src/worker/bossMount.ts",
  "src/worker/boss/index.ts",
];

/** Where the shared layer must be wired — each a file and a needle in its code (comments stripped). */
export const INCLUSIONS = [
  { file: "src/worker/boss/queue/consumer.ts", needle: "practicesBlock(env.DB)", why: "buildPrompt puts the practices and her constraints in front of every run, cloud and seat" },
  { file: "src/worker/boss/service/constraints.ts", needle: "servicePracticesBlock(", why: "practicesBlock composes the shared fragment with her register" },
  { file: "scripts/ops/repo-change.mjs", needle: "servicePracticesBlock(", why: "Danielle's Mac lane carries the same fragment" },
  { file: "scripts/ops/repo-change-prompt.md", needle: "{{PRACTICES}}", why: "the repo lane's prompt prints the fragment" },
  { file: "src/worker/boss/routes/repoChanges.ts", needle: "constraintsOnRecord(", why: "the claim carries her constraints to the Mac" },
  { file: "src/worker/boss/queue/consumer.ts", needle: "afterResult(", why: "a cloud result is followed through (deferrals, missing keys, the done email)" },
  { file: "src/worker/boss/routes/backends.ts", needle: "afterResult(", why: "a seat's result is followed through the same way" },
  { file: "src/worker/boss/queue/consumer.ts", needle: "tellHerItStopped(", why: "a final stop and a dead letter are one three-part notice" },
  { file: "src/worker/boss/intake/inboundMail.ts", needle: "secretDoor(", why: "the secret door runs before the message is kept" },
  { file: "src/worker/boss/intake/inboundMail.ts", needle: "answerBlockFromMail(", why: "a reply to a stopped task takes its door first" },
  { file: "src/worker/boss/intake/inboundMail.ts", needle: "recordConstraints(", why: "her standing lines are registered" },
  { file: "src/worker/boss/intake/inboundMail.ts", needle: "dueTimeIn(", why: "a deadline is read at the door" },
  { file: "src/worker/boss/intake/inboundMail.ts", needle: "recordDriveWatches(", why: "a Drive folder named in an ask is watched" },
  { file: "src/worker/boss/repoChange/answer.ts", needle: "blockReplyDoor(", why: "\"drop it\" closes a stopped repo change instead of retrying it" },
  { file: "scripts/ops/task-notices.mjs", needle: "askOrResolve(", why: "the vault is checked before she is asked for a key" },
  { file: "scripts/ops/repo-change.mjs", needle: "vaultLookup(", why: "the repo lane checks the vault before naming a key" },
  { file: "scripts/ops/notify.mjs", needle: "outboundFilesPlan(", why: "every Mac lane's email can carry files" },
  { file: "scripts/ops/agent-claim.sh", needle: "scripts/ops/service-tick.mjs", why: "her Mac's tick vaults keys, re-checks DNS, loads Drive folders" },
  { file: "src/worker/bossMount.ts", needle: "BOSS_OS_SECRET_HANDOFF_KEY: env.BOSS_OS_SECRET_HANDOFF_KEY", why: "the secret door's key reaches the Boss env (declared-and-unreachable otherwise)" },
  { file: "src/worker/boss/index.ts", needle: 'app.route("/api/service", service)', why: "her Mac's pass has its routes" },
  { file: "src/worker/boss/tasks/admit.ts", needle: "boss_repo_registry", why: "a repo she named by its GitHub address is registered at the door" },
];

/** Comments out, strings kept: block comments, and lines that are only a line or doc comment. */
export function stripComments(source) {
  return String(source ?? "").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*(\/\/|#(?!!)|\*)/.test(l)).join("\n");
}

export function parseRules(markdown) {
  const rules = [];
  const problems = [];
  for (const line of String(markdown).split(/\r?\n/)) {
    if (!line.startsWith("- R")) continue;
    const m = RULE.exec(line);
    if (!m) { problems.push(`a rule line does not match the shape: ${line.slice(0, 90)}`); continue; }
    const [, n, tag, text, owner, anchor] = m;
    const [file, exportName] = anchor.split("#");
    rules.push({ n: Number(n), tag, text, owner, file, exportName: exportName ?? "" });
  }
  const seen = new Set();
  for (const r of rules) {
    if (seen.has(r.n)) problems.push(`R${r.n} appears twice`);
    seen.add(r.n);
    if (!r.exportName) problems.push(`R${r.n} names no export in its anchor`);
    if (r.text.length < 20) problems.push(`R${r.n} is too short to be a rule`);
  }
  if (rules.length === 0) problems.push(`${DOC} holds no rules (Rule 0)`);
  return { rules, problems };
}

const readTree = (rel) => (existsSync(path.join(ROOT, rel)) ? readFileSync(path.join(ROOT, rel), "utf8") : null);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function anchorExists(file, exportName, readText = readTree) {
  const text = readText(file);
  if (text === null) return { ok: false, why: `${file} is not in the tree` };
  if (/\.md$/.test(file)) {
    return new RegExp(`^#{1,6}\\s+${esc(exportName)}\\s*$`, "m").test(text) ? { ok: true } : { ok: false, why: `${file} has no heading "${exportName}"` };
  }
  const declared = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${esc(exportName)}\\b`, "m").test(text);
  return declared ? { ok: true } : { ok: false, why: `${file} does not export ${exportName}` };
}

/** Every product source that could reference an anchor: src/ and the Mac scripts (not tests, not validators). */
export function productSources() {
  const out = {};
  const walk = (rel) => {
    for (const name of readdirSync(path.join(ROOT, rel))) {
      const r = `${rel}/${name}`;
      if (statSync(path.join(ROOT, r)).isDirectory()) { if (!/node_modules|validate$/.test(r)) walk(r); }
      else if (/\.(ts|tsx|mjs|sh|md)$/.test(name) && !/\.d\.mts$/.test(name)) out[r] = readFileSync(path.join(ROOT, r), "utf8");
    }
  };
  walk("src");
  walk("scripts/ops");
  walk("scripts/lib");
  walk("scripts/vault");
  return out;
}

/** Who references an export, outside its own file. */
export function referencesOf(exportName, ownFile, sources) {
  const re = new RegExp(`\\b${esc(exportName)}\\b`);
  return Object.entries(sources).filter(([rel, src]) => rel !== ownFile && re.test(stripComments(src))).map(([rel]) => rel);
}

/** The reach check for one ALL-KINDS rule. */
export function reachOf(rule, sources) {
  if (LANE_ONLY.test(rule.file)) return { ok: false, why: `R${rule.n} [ALL-KINDS] is anchored in a lane-only file (${rule.file})`, refs: [] };
  if (UNIVERSAL_DOORS.includes(rule.file)) return { ok: true, refs: [rule.file] };
  const refs = referencesOf(rule.exportName, rule.file, sources);
  const shared = refs.filter((f) => !LANE_ONLY.test(f));
  if (refs.length === 0) return { ok: false, why: `R${rule.n} [ALL-KINDS] ${rule.exportName} is referenced by nothing — exists, and nothing invokes it`, refs };
  if (shared.length === 0) return { ok: false, why: `R${rule.n} [ALL-KINDS] ${rule.exportName} is reached only from one lane (${refs.join(", ")}) — lift it to the shared layer`, refs };
  return { ok: true, refs };
}

export function checkWaits(waits = BOSS_WAITS, kinds = BOSS_WAIT_KINDS, forbidden = WAIT_TEXT_FORBIDDEN) {
  const v = [];
  if (!kinds.length) v.push("no wait kinds rendered (Rule 0)");
  const fill = { what: "THE_THING", why: "a reason", searched: "X_KEY, X_*", at: "10:00", record: { host: "a.example.com", type: "CNAME", name: "a", target: "b.pages.dev", liveAt: "a.pages.dev" } };
  for (const k of kinds) {
    const w = waits[k](fill);
    const p = `Waiting on: ${w.waiting}. Why: ${w.why}. To clear it by email: ${w.clear}.`;
    const rendered = waits === BOSS_WAITS ? waitDetail(k, fill) : p;
    if (!WAIT_SHAPE.test(rendered)) v.push(`wait ${k} is not three parts: ${rendered.slice(0, 120)}`);
    if (w.inBossOs && k !== "TIER2_DECISION") v.push(`wait ${k} claims inBossOs — only TIER2_DECISION may (docs/AUTHORITY_MODEL.md)`);
    if (!w.inBossOs) for (const re of forbidden) if (re.test(rendered)) v.push(`wait ${k} sends her somewhere other than her inbox (${re}): ${rendered.slice(0, 120)}`);
  }
  if (waits === BOSS_WAITS && bossWait("TIER2_DECISION").inBossOs !== true) v.push("TIER2_DECISION must say it clears in Boss OS (inBossOs), or the divergence is unrecorded in code");
  return v;
}

/** A LIKE pattern built from data: a `%${…}` template bound for a LIKE. */
export function likePatternsFromData(sources) {
  const v = [];
  for (const [rel, src] of Object.entries(sources)) {
    if (!rel.startsWith("src/worker/boss/")) continue;
    const code = stripComments(src);
    if (/\bLIKE\s+\?/i.test(code) && /`%[^`]*\$\{/.test(code)) v.push(`${rel} builds a LIKE pattern from data (\`%\${…}\`) — D1 refuses a long one ("LIKE or GLOB pattern too complex"); compare by equality`);
  }
  return v;
}

export function runAll({ markdown, sources, practices = SERVICE_PRACTICES, waits = BOSS_WAITS, kinds = BOSS_WAIT_KINDS, readText = readTree }) {
  const { rules, problems } = parseRules(markdown);
  const violations = [...problems];
  for (const r of rules) {
    const a = anchorExists(r.file, r.exportName, readText);
    if (!a.ok) violations.push(`R${r.n} [${r.tag}] anchor missing: ${a.why}`);
  }
  const allKinds = rules.filter((r) => r.tag === "ALL-KINDS");
  let laneOnly = 0;
  for (const r of allKinds) {
    const reach = reachOf(r, sources);
    if (!reach.ok) { laneOnly += 1; violations.push(reach.why); }
  }
  const inFragment = new Set((practices ?? []).map((p) => p.rule));
  for (const r of rules) if (r.exportName === "servicePracticesBlock" && !inFragment.has(`R${r.n}`)) violations.push(`R${r.n} is anchored on the shared prompt fragment but SERVICE_PRACTICES has no line for it`);
  if (!practices?.length) violations.push("SERVICE_PRACTICES is empty (Rule 0)");
  for (const p of practices ?? []) {
    const r = rules.find((x) => `R${x.n}` === p.rule);
    if (!r) violations.push(`SERVICE_PRACTICES carries ${p.rule}, which the rules document does not list`);
    else if (r.tag !== "ALL-KINDS") violations.push(`SERVICE_PRACTICES carries ${p.rule}, which is REPO-ONLY — a repo rule does not belong in every employee's prompt`);
  }
  for (const inc of INCLUSIONS) {
    const src = sources[inc.file] ?? readText(inc.file);
    if (src === null || src === undefined) violations.push(`${inc.file} is not in the tree (${inc.why})`);
    else if (!(/\.md$/.test(inc.file) ? src : stripComments(src)).includes(inc.needle)) violations.push(`${inc.file} does not wire the shared layer: ${inc.why} (looked for \`${inc.needle}\`)`);
  }
  violations.push(...checkWaits(waits, kinds));
  violations.push(...likePatternsFromData(sources));
  return { rules, allKinds, laneOnly, violations };
}

function selfTest() {
  const markdown = readFileSync(path.join(ROOT, DOC), "utf8");
  const sources = productSources();
  let failed = 0;
  const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed += 1; };
  const caught = (input, re) => runAll({ markdown, sources, ...input }).violations.some((x) => re.test(x));

  check("the shipped document and tree pass", runAll({ markdown, sources }).violations.length === 0);
  check("a document with no rules fails (Rule 0)", caught({ markdown: "# nothing here" }, /holds no rules/));
  check("a malformed rule line is caught", caught({ markdown: `${markdown}\n- R99 [SOMETIMES] nope` }, /does not match the shape/));
  check("a repeated rule number is caught", caught({ markdown: markdown.replace("- R2 [ALL-KINDS]", "- R1 [ALL-KINDS]") }, /R1 appears twice/));
  check("a dead export in an anchor is caught", caught({ markdown: markdown.replace("secretHandoff.ts#secretDoor`", "secretHandoff.ts#secretDoorThatIsGone`") }, /R3 .*anchor missing/));
  check("a missing file in an anchor is caught", caught({ markdown: markdown.replace("src/shared/boss/service/dueTime.mjs#dueTimeIn", "src/shared/boss/service/nope.mjs#dueTimeIn") }, /not in the tree/));
  check("a missing heading in a markdown anchor is caught", caught({ markdown: markdown.replace("repo-change-prompt.md#Standing rules, every phase`", "repo-change-prompt.md#No such heading`") }, /has no heading/));
  check("an ALL-KINDS rule anchored in a lane-only file is caught", caught({ markdown: markdown.replace("waits.mjs#waitDetail`", "../../scripts/ops/repo-change.mjs#runRequested`").replace("`src/shared/boss/service/../../scripts/ops/repo-change.mjs#runRequested`", "`scripts/ops/repo-change.mjs#runRequested`") }, /R7 \[ALL-KINDS\] is anchored in a lane-only file/));
  check("an ALL-KINDS rule reached only from one lane is caught", caught({ markdown: markdown.replace("practices.mjs#missingKeysIn`", "waits.mjs#missingSecretLine`") }, /R6 \[ALL-KINDS\] missingSecretLine is reached only from one lane/));
  check("an ALL-KINDS rule nothing invokes is caught", caught({ sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.replaceAll("missingKeysIn", "somethingElse")])) }, /R6 \[ALL-KINDS\] missingKeysIn is referenced by nothing/));
  check("a prompt-anchored rule missing from the fragment is caught", caught({ practices: SERVICE_PRACTICES.filter((p) => p.rule !== "R13") }, /R13 is anchored on the shared prompt fragment/));
  check("a REPO-ONLY rule in every employee's prompt is caught", caught({ practices: [...SERVICE_PRACTICES, { rule: "R29", line: "x" }] }, /R29, which is REPO-ONLY/));
  check("an empty fragment fails (Rule 0)", caught({ practices: [] }, /SERVICE_PRACTICES is empty/));
  check("buildPrompt dropping the fragment is caught", caught({ sources: { ...sources, "src/worker/boss/queue/consumer.ts": sources["src/worker/boss/queue/consumer.ts"].replace("practicesBlock(env.DB)", "nothing(env.DB)") } }, /consumer\.ts does not wire the shared layer: buildPrompt/));
  check("the seat path skipping the follow-through is caught", caught({ sources: { ...sources, "src/worker/boss/routes/backends.ts": sources["src/worker/boss/routes/backends.ts"].replaceAll("afterResult(", "skipped(") } }, /backends\.ts does not wire the shared layer/));
  check("the mail door skipping the secret door is caught", caught({ sources: { ...sources, "src/worker/boss/intake/inboundMail.ts": sources["src/worker/boss/intake/inboundMail.ts"].replaceAll("secretDoor(", "noDoor(") } }, /inboundMail\.ts does not wire the shared layer: the secret door/));
  check("the Mac tick not running the service pass is caught", caught({ sources: { ...sources, "scripts/ops/agent-claim.sh": sources["scripts/ops/agent-claim.sh"].replaceAll("service-tick.mjs", "nothing.mjs") } }, /agent-claim\.sh does not wire/));
  check("a commented-out inclusion does not count", caught({ sources: { ...sources, "src/worker/boss/queue/consumer.ts": sources["src/worker/boss/queue/consumer.ts"].replace("const practices = await practicesBlock(env.DB);", "// const practices = await practicesBlock(env.DB);\n  const practices = \"\";") } }, /buildPrompt puts the practices/));
  const rogue = { ...BOSS_WAITS, ROGUE: () => ({ waiting: "x", why: "y", clear: "open Boss OS and requeue the task" }) };
  check("a wait that points into Boss OS is caught", caught({ waits: rogue, kinds: [...BOSS_WAIT_KINDS, "ROGUE"] }, /wait ROGUE sends her somewhere/));
  check("a wait claiming inBossOs that is not Tier 2 is caught", caught({ waits: { ...BOSS_WAITS, SNEAK: () => ({ waiting: "x", why: "y", clear: "in Boss OS", inBossOs: true }) }, kinds: [...BOSS_WAIT_KINDS, "SNEAK"] }, /only TIER2_DECISION may/));
  check("a wait with an empty part is caught", caught({ waits: { ...BOSS_WAITS, EMPTY: () => ({ waiting: "", why: "", clear: "" }) }, kinds: [...BOSS_WAIT_KINDS, "EMPTY"] }, /wait EMPTY is not three parts/));
  check("no wait kinds fails (Rule 0)", caught({ kinds: [] }, /no wait kinds rendered/));
  check("a LIKE pattern built from data is caught", caught({ sources: { ...sources, "src/worker/boss/routes/x.ts": "db.prepare(`SELECT id FROM t WHERE payload LIKE ?`).bind(`%\"id\":\"${id}\"%`)" } }, /builds a LIKE pattern from data/));
  if (failed) { console.error(`service-rules self-test: ${failed} check(s) failed`); process.exit(1); }
  console.log("service-rules self-test: every planted failure was caught. OK.");
}

function main() {
  const markdown = readTree(DOC);
  if (markdown === null) { console.error(`service-rules: ${DOC} is missing — a rule list nothing can read`); process.exit(1); }
  const { rules, allKinds, laneOnly, violations } = runAll({ markdown, sources: productSources() });
  for (const v of violations) console.error(`✗ ${v}`);
  console.log(`service-rules: ${rules.length} rules; all-kinds rules: ${allKinds.length} (shared layer: ${allKinds.length - laneOnly}, lane-only: ${laneOnly}); ${INCLUSIONS.length} door inclusions, ${BOSS_WAIT_KINDS.length} wait kinds rendered.`);
  if (violations.length) process.exit(1);
  console.log("service-rules: OK.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--self-test")) selfTest(); else main();
}
