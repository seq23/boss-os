/**
 * IS EVERY BUILT THING ACTUALLY REACHABLE FROM HER DAY?
 *
 * The single most repeated defect in this system is not a wrong answer. It is a correct thing that
 * nothing invokes. In one session:
 *
 *   · `executive_reports` — a table with a reader, a duty, and NO WRITER anywhere. The block showed
 *     "no report yet" every morning for as long as it had existed, exactly as designed.
 *   · the gratitude sentence — fully composed in `spirit/practice.ts`, never called by the gate.
 *   · `scripts/sync-agent/runner.mjs` — a working agent runner that no launchd job, cron entry or
 *     login item ever started.
 *   · `relationships` — a scoring engine wired into Today, with zero rows.
 *
 * Every one looked finished from the inside and was absent from her side of the screen. No test
 * catches this, because each component passes its own tests. Nothing asked the question this file
 * asks: does anything downstream ever reach it?
 *
 * ─── The two checks ─────────────────────────────────────────────────────────
 *
 * 1. A table that is READ but never WRITTEN. That is the `executive_reports` shape precisely, and it
 *    is the highest-value check here: a reader with no writer renders an empty state for ever, and
 *    an empty state is indistinguishable from "nothing happened today".
 *
 * 2. An ops script that nothing invokes. A script in `scripts/ops/` must be named by the launch
 *    agent installer, by package.json, or by another script — otherwise it only runs when someone
 *    remembers it exists.
 *
 * ─── Why an allowlist rather than cleverness ────────────────────────────────
 *
 * Some tables are legitimately written by hand or by a migration and only ever read. Guessing which
 * would make this either noisy or useless, so each one is named with the reason it is exempt. A new
 * exemption is a line someone has to write and justify, which is the point.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir, out = []) => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
};

/**
 * Tables that are read and never written by code, with the reason each is legitimate.
 * A new name here needs a sentence, because "it's fine" is how the report table stayed empty.
 */
const WRITTEN_BY_MIGRATION_ONLY = new Map([
  ["lanes", "The four lanes are fixed by canon and seeded by 0152. Code that could add a lane would be code that could invent one."],
  ["schema_version", "Written by every migration's last line, which is SQL rather than application code."],
  ["data_policy", "Every entity's classification is declared in the migration that creates it, on purpose: a residency a running system could change is not a classification."],
  ["execution_backends", "Registered and commissioned by migration, so enabling a backend is a reviewable diff rather than a runtime call."],
  ["task_templates", "Seeded intake shapes. A template invented at runtime is an intake path nobody reviewed."],
  ["standing_duties", "Her recurring duties are declared in migrations for the same reason her arcs are in code: the count is the point."],
  ["promotion_rules", "Memory promotion thresholds, seeded by 0161. Rules a running system could rewrite are not rules."],
  ["workload_profiles", "Employee workload definitions, seeded with the roster."],
  ["knowledge_surfaces", "What each employee is expected to know, seeded with the roster."],
  ["pov_cards", "Each employee's point of view, seeded with the roster."],
  ["decision_rights", "What each employee may decide alone. Seeded, because a decision right a system could grant itself is not a right."],
  ["failure_playbooks", "What each employee does when something breaks, seeded with the roster."],
  ["brand_profiles", "Voice and standards per property, seeded."],
  ["deployment_stages", "The fixed release ladder."],
  ["trading_nevers", "The trading lane's absolute prohibitions. A never that code could add or remove is not a never."],
  ["vault_entries", "NAMED STOP, not an exemption: nothing writes document entries yet, and GET /vault/entries now says so in its own response instead of returning a bare empty list. Remove this line the moment a writer exists."],
]);

const errors = [];
const notes = [];

// ─── 1. Tables read but never written ────────────────────────────────────────

/*
 * BOSS TABLES ONLY. The West Peek chassis shares this repo and has its own conventions — a good
 * deal of it is seeded reference data that is read and never written by code, which is correct
 * there and would drown this scan in exemptions. Boss migrations are named `*_boss_*`, and Boss OS
 * is the half that renders her day.
 */
const migrations = readdirSync(join(ROOT, "migrations"))
  .filter((f) => f.endsWith(".sql") && f.includes("_boss_"))
  .map((f) => read(`migrations/${f}`))
  .join("\n");

const tables = [...migrations.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)]
  .map((m) => m[1].toLowerCase());

const sourceFiles = [...walk("src"), ...walk("scripts").filter((p) => !p.includes("/validate/"))];
const source = sourceFiles.map(read).join("\n");

let checked = 0;
for (const t of new Set(tables)) {
  // A boss table is one the Boss OS half owns; the chassis has its own and is not audited here.
  const writer = new RegExp(`(INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|UPDATE|DELETE\\s+FROM)\\s+\`?${t}\\b`, "i").test(source);
  const reader = new RegExp(`(FROM|JOIN)\\s+\`?${t}\\b`, "i").test(source);
  if (!reader) continue; // Nothing reads it: that is a different problem and not this check's claim.
  checked++;
  if (!writer && !WRITTEN_BY_MIGRATION_ONLY.has(t)) {
    errors.push(
      `TABLE READ BUT NEVER WRITTEN: ${t}\n` +
      `    Something renders this and nothing fills it, so it shows an empty state for ever.\n` +
      `    Either write the code path that populates it, or add it to WRITTEN_BY_MIGRATION_ONLY with the reason.`,
    );
  }
}

// ─── 2. Ops scripts nothing invokes ──────────────────────────────────────────

const invokers = [
  existsSync(join(ROOT, "scripts/ops/install-agent-launchd.sh")) ? read("scripts/ops/install-agent-launchd.sh") : "",
  read("package.json"),
  ...walk("scripts").map(read),
  ...readdirSync(join(ROOT, "docs/boss")).filter((f) => f.endsWith(".md")).map((f) => read(`docs/boss/${f}`)),
].join("\n");

const opsScripts = readdirSync(join(ROOT, "scripts/ops")).filter((f) => /\.(mjs|sh)$/.test(f));
let opsChecked = 0;
for (const f of opsScripts) {
  opsChecked++;
  // Its own file naturally contains its name; count references from anywhere else.
  const self = read(`scripts/ops/${f}`);
  const elsewhere = invokers.split(self).join("");
  if (!elsewhere.includes(f)) {
    errors.push(
      `OPS SCRIPT NOTHING INVOKES: scripts/ops/${f}\n` +
      `    No launch agent, npm script, sibling script or doc names it, so it runs only when someone remembers.`,
    );
  }
}

// ─── Rule 0 ──────────────────────────────────────────────────────────────────
// A validator that examined nothing must not exit 0 looking pleased.
if (checked === 0 || opsChecked === 0) {
  console.error(`REACHABILITY SCAN EXAMINED NOTHING (${checked} tables, ${opsChecked} scripts). That is a broken scan, not a clean repo.`);
  process.exit(2);
}

for (const n of notes) console.log(`  note: ${n}`);
if (errors.length) {
  console.error("REACHABILITY SCAN FAILED\n");
  for (const e of errors) console.error(`  ✗ ${e}\n`);
  process.exit(1);
}
console.log(`REACHABILITY SCAN PASSED: ${checked} read tables all have writers, ${opsChecked} ops scripts all have callers.`);
