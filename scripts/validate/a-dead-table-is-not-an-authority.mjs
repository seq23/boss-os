#!/usr/bin/env node
/**
 * BOSS OS DOES NOT READ THE CHASSIS'S SPEND TABLES.
 *
 * ─── The problem ────────────────────────────────────────────────────────────
 *
 * Boss OS was built by cloning West Peek OS, and the clone's fund code (the chassis) retired on
 * 22 Nov 2026. Its tables stay (migrations are additive only), so there are still TWO parallel sets of model-and-money tables and only one of them is live:
 *
 *   LIVE       `providers`, `models`, `budgets`, `usage_ledger`   — 0152, the Boss OS router's
 *   INHERITED  `provider_registry`, `provider_model`, `budget_policy`, `ai_run`  — 0004 and 0015
 *
 * They do not agree and they are not supposed to. `budget_policy` carries $25/day and $2/run — the
 * chassis lane's own figures — while the ops lane Boss OS actually enforces is $1.75/day and
 * $52.50/month. `ai_run` has zero rows. Anyone who opens the wrong one is out by more than an order
 * of magnitude, or concludes nothing has ever run.
 *
 * ─── Why this is a scan and not a deletion ──────────────────────────────────
 *
 * Migrations are additive only: the tables stay, so this is the boundary. Until 22 Nov 2026
 * `spend/reconcile.ts` deliberately read `ai_run` through the chassis's `firmSpend`; that ledger
 * had zero rows in production ever, and it went with the chassis, so `ai_run` is dead too.
 *
 * ─── What is checked ────────────────────────────────────────────────────────
 *
 *   1. NO BOSS OS FILE READS A DEAD TABLE. Nothing under `src/worker/boss/` or `src/client/boss/`
 *      may mention `provider_registry`, `provider_model`, `budget_policy` or `ai_run` in SQL.
 *   2. THE LABEL IS IN THE DATA. The latest `budget_policy` row says whose lane it governs, so
 *      somebody querying the table directly is told before they act on it.
 *
 * RULE 0: zero Boss OS files scanned is a HARD FAILURE. An empty file list would report a clean
 * boundary over a codebase nobody looked at.
 *
 *   node scripts/validate/a-dead-table-is-not-an-authority.mjs
 *   node scripts/validate/a-dead-table-is-not-an-authority.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Boss OS's own halves. */
const BOSS_DIRS = ["src/worker/boss", "src/client/boss"];

/** The inherited tables nothing in Boss OS may touch. */
const DEAD = ["provider_registry", "provider_model", "budget_policy", "ai_run"];

function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) walk(relative(ROOT, full), out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(relative(ROOT, full));
  }
  return out;
}

/**
 * Strip comments, so the PROSE explaining why a table is dead does not trip the scan that keeps it
 * dead. Every migration header and file comment in this area names these tables on purpose.
 */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|--)/.test(l))
    .join("\n");

export function check({ files, sources, latestPolicy }) {
  const bad = [];

  // ── RULE 0 ─────────────────────────────────────────────────────────────────
  if (!Array.isArray(files) || files.length === 0) {
    return ["no Boss OS files were scanned, so the boundary was checked over nothing"];
  }

  // ── 1. The boundary ────────────────────────────────────────────────────────
  for (const f of files) {
    const src = code(sources[f] ?? "");
    for (const table of DEAD) {
      if (new RegExp(`\\b${table}\\b`).test(src)) {
        bad.push(
          `${f} touches \`${table}\`, which is a West Peek chassis table and not Boss OS's. `
          + `Boss OS spends against \`budgets\`, \`models\` and \`usage_ledger\`; reading the `
          + `inherited set is how "what may this spend" comes back $25/day instead of $1.75.`,
        );
      }
    }
  }

  // ── 2. The label is in the data ────────────────────────────────────────────
  if (!latestPolicy) {
    bad.push("there is no budget_policy row at all, so nothing tells a reader whose lane it governs");
  } else {
    if (!/NOT BOSS OS GOVERNANCE/i.test(String(latestPolicy.set_by ?? ""))) {
      bad.push(
        "the latest budget_policy row does not say whose lane it governs. It is the field a human "
        + "reads beside $25/day, and unlabelled it reads as this system's budget.",
      );
    }
  }

  return bad;
}

// ─── Gathering ──────────────────────────────────────────────────────────────

function gather() {
  const files = BOSS_DIRS.flatMap((d) => walk(d));
  const sources = Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));

  const db = new DatabaseSync(":memory:");
  const dir = join(ROOT, "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try { db.exec(readFileSync(join(dir, f), "utf8")); } catch { /* unparseable here; see below */ }
  }
  let latestPolicy = null;
  try {
    latestPolicy = db
      .prepare(`SELECT cost_mode, daily_cap_usd, set_by FROM budget_policy ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get() ?? null;
  } catch { /* the table did not survive the replay; check() reports the absence */ }
  db.close();

  return { files, sources, latestPolicy };
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const good = gather();
  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "RULE 0: no files scanned",
      input: { ...good, files: [] },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: a Boss OS file reading the chassis's budget table",
      input: {
        ...good,
        files: [...good.files, "src/worker/boss/routes/fake.ts"],
        sources: { ...good.sources, "src/worker/boss/routes/fake.ts": "const q = `SELECT * FROM budget_policy`;" },
      },
      expect: 1,
    },
    {
      name: "a Boss OS file reading the retired ai_run ledger",
      input: {
        ...good,
        files: [...good.files, "src/worker/boss/routes/fake2.ts"],
        sources: { ...good.sources, "src/worker/boss/routes/fake2.ts": "const q = `SELECT * FROM ai_run`;" },
      },
      expect: 1,
    },
    {
      name: "prose about the dead tables does not trip it",
      input: {
        ...good,
        files: [...good.files, "src/worker/boss/routes/fake3.ts"],
        sources: {
          ...good.sources,
          "src/worker/boss/routes/fake3.ts": "// budget_policy and provider_registry are the chassis's, not ours.\nconst x = 1;",
        },
      },
      expect: 0,
    },
    {
      name: "an unlabelled policy row",
      input: { ...good, latestPolicy: { cost_mode: "NORMAL", daily_cap_usd: 25, set_by: "system" } },
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const ok = c.expect === 0 ? found === 0 : found > 0;
    if (!ok) {
      failed++;
      console.error(`  ✘ ${c.name}: expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }
  if (failed) {
    console.error(`\na-dead-table-is-not-an-authority self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-dead-table-is-not-an-authority self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const world = gather();
  const problems = check(world);
  if (problems.length) {
    console.error("A DEAD TABLE IS NOT AN AUTHORITY — SCAN FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }
  console.log(
    `A DEAD TABLE IS NOT AN AUTHORITY OK — ${world.files.length} Boss OS files scanned; none reads `
    + `${DEAD.join(", ")}, and the latest budget_policy row labels the chassis lane.`,
  );
}
