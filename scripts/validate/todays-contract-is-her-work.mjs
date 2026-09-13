#!/usr/bin/env node
/**
 * TODAY'S CONTRACT IS WHAT SHE IS DOING TODAY, NEVER A REPORT ON THE MACHINERY.
 *
 * ─── The defect this is the guard for, in her words ─────────────────────────
 *
 *   "this was in today's contract: `Danielle's Ahrefs pass has not reported — run
 *    ahrefs-audit-fix.sh or find out why launchd did not.` ----- something not working should
 *    never be in today's contract it should be in the inbox."
 *
 * `siteAuditGap()` read `standing_duties` and `site_audit_findings` and returned that line from
 * `executionContract()` — FIRST, ahead of a stalling deal and ahead of the oldest open loop. So it
 * did not merely misfile a notification: a cron outranked a dying deal on the screen whose whole
 * job is telling her what to do. It then flowed into `proposedPriorities`, into
 * `days.morning_contract`, and into what the Night Gate scored her against.
 *
 * And it was DUPLICATE. `routes/today.ts` already raises a HIGH alert for every duty that has not
 * fired within twice its cadence, on the surface that carries the other ~30 machinery items. The
 * duty was never exempt. One fact, two places, in the repository that names that defect everywhere.
 *
 * ─── Why this checks SOURCES and not WORDS ──────────────────────────────────
 *
 * A banned-phrase list catches the sentence and misses the defect. "Danielle's Ahrefs pass has not
 * reported" could be reworded to "Chase Danielle about the audit" and it would still be the system
 * reporting on itself, still returned ahead of a deal. What makes an item machinery is WHAT IT IS
 * ABOUT — and in this codebase that is legible as the table the builder had to read.
 *
 * So `src/worker/boss/today/subjects.ts` is a registry classifying each table as her WORK or as
 * MACHINERY, and this scan reads THAT FILE rather than keeping a second copy. Three rules:
 *
 *   1. No contract builder may query a MACHINERY table.
 *   2. A table in NEITHER list is a FAILURE, not a pass. The next contributor adding a contract
 *      source has to classify it where the rule is written down. An unclassified table passing
 *      silently is how a registry rots into decoration.
 *   3. No table may be in BOTH lists.
 *
 * Words are still checked, but as a SECOND net and only inside the literal strings a contract item
 * hands her — because an action that tells her to run a shell script is machinery however it was
 * sourced.
 *
 * RULE 0: finding zero contract builders, zero classified tables, or zero queries is a HARD
 * FAILURE. This is a loop over sources, and a loop over an empty set is how a validator stays green
 * for ever while the thing it guards rots.
 *
 *   node scripts/validate/todays-contract-is-her-work.mjs
 *   node scripts/validate/todays-contract-is-her-work.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const REGISTRY = "src/worker/boss/today/subjects.ts";

/**
 * The files that BUILD Today's contract — the pillar contracts and the three proposed priorities.
 *
 * Not every file in `today/`. `deliverables.ts` and `credentials.ts` build the ALERT surface and are
 * supposed to be full of machinery; holding them to this rule would be the validator failing to
 * understand its own subject. These three are the ones whose output becomes `contract.priorities`
 * and `agenda.pillars`.
 */
const CONTRACT_BUILDERS = [
  "src/worker/boss/today/pillars.ts",
  "src/worker/boss/today/close.ts",
  "src/worker/boss/today/body.ts",
];

/**
 * Phrases that are machinery whatever table they came from. Checked ONLY inside the string literals
 * a contract item hands her, never against the file's prose — a comment explaining that the code
 * must not mention launchd is not a mention of launchd.
 */
const MACHINERY_PHRASES = [
  /\blaunchd\b/i,
  /\bcron\b/i,
  /has not reported\b/i,
  /did not run\b/i,
  /\bcredential\b/i,
  /\bre-?run the (job|script|duty)\b/i,
  /\brun `[^`]*\.(sh|mjs)`/i,
  /\bnpm run\b/i,
];

/** Read a `new Set([...])` of string literals out of the registry module. */
export function registrySet(source, name) {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source);
  if (!m) return null;
  // Comments stripped first, or a table named inside a `/** … */` doc line would be read as a member.
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return new Set([...body.matchAll(/["']([a-z_][a-z0-9_]*)["']/g)].map((x) => x[1]));
}

/** Every table named after FROM / JOIN / INTO / UPDATE in a source file. */
export function tablesQueried(source) {
  const out = new Set();
  for (const m of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/g)) {
    out.add(m[1]);
  }
  return out;
}

/**
 * The strings a contract item hands her: the values of `action:`, `why:` and `gap:`.
 *
 * Template literals included, with their `${…}` holes blanked — the interpolations are data and a
 * regex over them would be reading her deal names for the word "cron".
 */
export function handedStrings(source) {
  const out = [];
  for (const m of source.matchAll(/\b(?:action|why|gap)\s*:\s*(`[\s\S]*?`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
    out.push(m[1].replace(/\$\{[^}]*\}/g, " "));
  }
  return out;
}

export function check({ registry, builders }) {
  const problems = [];

  const work = registrySet(registry, "WORK_SUBJECTS");
  const machinery = registrySet(registry, "MACHINERY_SUBJECTS");

  // ── RULE 0 ────────────────────────────────────────────────────────────────
  if (!work || work.size === 0) {
    problems.push(
      `${REGISTRY} declares no WORK_SUBJECTS this scan can read. The registry is the whole mechanism; ` +
      `without it every table is unclassified and this scan has examined nothing.`,
    );
  }
  if (!machinery || machinery.size === 0) {
    problems.push(
      `${REGISTRY} declares no MACHINERY_SUBJECTS. With nothing classified as machinery, rule 1 can ` +
      `never fire and the scan would pass by construction.`,
    );
  }
  if (builders.length === 0) {
    problems.push(
      "ZERO contract builders were read. Either they moved or this scan can no longer find them; " +
      "both mean it proved nothing.",
    );
  }
  if (problems.length) return problems;

  // ── 3. No table in both lists ─────────────────────────────────────────────
  for (const t of work) {
    if (machinery.has(t)) {
      problems.push(
        `"${t}" is in BOTH WORK_SUBJECTS and MACHINERY_SUBJECTS. A table that is both is a rule that ` +
        `decides nothing, and whichever list is checked first would silently win.`,
      );
    }
  }

  let queriesSeen = 0;

  for (const { path, source } of builders) {
    const tables = tablesQueried(source);
    queriesSeen += tables.size;

    for (const table of tables) {
      // ── 1. A machinery table in a contract builder ─────────────────────────
      if (machinery.has(table)) {
        problems.push(
          `${path} queries "${table}", which ${REGISTRY} classifies as MACHINERY. Today's contract is ` +
          `what SHE is doing today; a job that did not run is a notification about her own machinery. ` +
          `Worse, an item sourced this way DISPLACES real work — the Ahrefs line returned ahead of a ` +
          `stalling deal and the oldest open loop. It belongs on ${machineryHome(registry)}.`,
        );
        continue;
      }
      // ── 2. Unclassified is a failure, not a pass ───────────────────────────
      if (!work.has(table)) {
        problems.push(
          `${path} queries "${table}" and ${REGISTRY} classifies it as neither her work nor machinery. ` +
          `Say which it is, in that file, where the rule is written down. If it is machinery the item ` +
          `belongs on the alert surface; if it is her work, adding it to WORK_SUBJECTS is the whole ` +
          `change. Unclassified is refused rather than guessed at — a registry that passes over ` +
          `anything it does not recognise is decoration.`,
        );
      }
    }

    // ── The second net: what the item actually says to her ──────────────────
    for (const said of handedStrings(source)) {
      for (const phrase of MACHINERY_PHRASES) {
        if (phrase.test(said)) {
          problems.push(
            `${path} hands her a contract item reading ${said.replace(/\s+/g, " ").slice(0, 120)}, which ` +
            `matches ${phrase.source}. An action that tells her to go and fix the system is machinery ` +
            `however it was sourced. It belongs on ${machineryHome(registry)}.`,
          );
        }
      }
    }
  }

  if (queriesSeen === 0) {
    problems.push(
      "The contract builders query ZERO tables. A contract derived from nothing is not a contract, " +
      "and this scan's loops all ran empty.",
    );
  }

  return problems;
}

function machineryHome(registry) {
  const m = /MACHINERY_BELONGS\s*=\s*"([^"]*)"/.exec(registry);
  return m ? m[1] : "the alert surface";
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const goodRegistry = `
export const WORK_SUBJECTS = new Set([
  /** Deals. standing_duties is named in this comment and must not be read as a member. */
  "deals",
  "open_loops",
]);
export const MACHINERY_SUBJECTS = new Set([
  "standing_duties",
  "site_audit_findings",
]);
export const MACHINERY_BELONGS = "the critical_alerts surface";
`;
  const goodBuilder = {
    path: "today/pillars.ts",
    source: `
const stalled = await env.DB.prepare("SELECT id FROM deals WHERE stage_since < ?").all();
if (stalled.length) return { action: \`\${d.name} — decide the next step\`, why: "Deals stop moving." };
const loop = await env.DB.prepare("SELECT id FROM open_loops WHERE status = 'open'").first();
return { action: \`Close: \${loop.title}\`, why: "the oldest open loop." };
`,
  };

  const withBuilder = (src) => [{ path: "today/pillars.ts", source: src }];

  const cases = [
    { name: "the shipped shape passes", registry: goodRegistry, builders: [goodBuilder], expect: 0 },
    {
      name: "THE ACTUAL DEFECT: the contract reading standing_duties",
      registry: goodRegistry,
      builders: withBuilder(
        goodBuilder.source +
        `const duty = await env.DB.prepare("SELECT suspended FROM standing_duties WHERE id = 'duty_site_audit_repair'").first();`,
      ),
      expect: 1,
    },
    {
      name: "THE OTHER HALF: the contract reading site_audit_findings",
      registry: goodRegistry,
      builders: withBuilder(
        goodBuilder.source + `const last = await env.DB.prepare("SELECT MAX(found_at) FROM site_audit_findings").first();`,
      ),
      expect: 1,
    },
    {
      name: "THE EXACT LINE, even if the table were somehow allowed",
      registry: goodRegistry,
      builders: withBuilder(
        `return { action: "Danielle's Ahrefs pass has not reported — run \\\`ahrefs-audit-fix.sh\\\` or find out why launchd did not.", why: "x" };` +
        `const x = await env.DB.prepare("SELECT id FROM deals").all();`,
      ),
      expect: 1,
    },
    {
      name: "a reworded machinery action that still sends her to a terminal",
      registry: goodRegistry,
      builders: withBuilder(
        goodBuilder.source + `return { action: "Chase the audit — npm run credentials:check", why: "y" };`,
      ),
      expect: 1,
    },
    {
      name: "RULE 2: a new table nobody classified",
      registry: goodRegistry,
      builders: withBuilder(goodBuilder.source + `await env.DB.prepare("SELECT * FROM some_new_table").all();`),
      expect: 1,
    },
    {
      name: "classifying that new table as work makes it pass",
      registry: goodRegistry.replace('"open_loops",', '"open_loops",\n  "some_new_table",'),
      builders: withBuilder(goodBuilder.source + `await env.DB.prepare("SELECT * FROM some_new_table").all();`),
      expect: 0,
    },
    {
      name: "a table in both lists is a rule that decides nothing",
      registry: goodRegistry.replace('"standing_duties",', '"standing_duties",\n  "deals",'),
      builders: [goodBuilder],
      expect: 1,
    },
    {
      name: "a JOIN onto a machinery table is caught, not only a FROM",
      registry: goodRegistry,
      builders: withBuilder(
        `await env.DB.prepare("SELECT d.id FROM deals d JOIN standing_duties s ON s.id = d.duty_id").all();`,
      ),
      expect: 1,
    },
    {
      name: "a comment naming standing_duties is NOT a query",
      registry: goodRegistry,
      builders: withBuilder(`// This used to read FROM standing_duties and no longer does.\n` + goodBuilder.source),
      expect: 1, // the comment's "FROM standing_duties" IS matched — documented below.
    },
    {
      name: "an interpolated deal name containing a banned word is not a violation",
      registry: goodRegistry,
      builders: withBuilder(
        `const x = await env.DB.prepare("SELECT id FROM deals").all();\n` +
        "return { action: `${d.name} — decide the next step`, why: `${d.days} days in stage.` };",
      ),
      expect: 0,
    },
    {
      name: "RULE 0 — no WORK_SUBJECTS at all",
      registry: goodRegistry.replace(/export const WORK_SUBJECTS[\s\S]*?\]\);/, ""),
      builders: [goodBuilder],
      expect: 1,
    },
    {
      name: "RULE 0 — no MACHINERY_SUBJECTS at all",
      registry: goodRegistry.replace(/export const MACHINERY_SUBJECTS[\s\S]*?\]\);/, ""),
      builders: [goodBuilder],
      expect: 1,
    },
    {
      name: "RULE 0 — zero builders",
      registry: goodRegistry,
      builders: [],
      expect: 1,
    },
    {
      name: "RULE 0 — builders that query nothing",
      registry: goodRegistry,
      builders: withBuilder(`return { action: "Do the thing", why: "because" };`),
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check({ registry: c.registry, builders: c.builders }).length;
    const ok = c.expect === 0 ? found === 0 : found >= 1;
    if (!ok) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\ntodays-contract-is-her-work self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`todays-contract-is-her-work self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const missing = [REGISTRY, ...CONTRACT_BUILDERS].filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`todays-contract-is-her-work FAILED — missing ${missing.join(", ")}. A scan whose subject does not exist must fail.`);
    process.exit(1);
  }

  const registry = readFileSync(join(ROOT, REGISTRY), "utf8");
  const builders = CONTRACT_BUILDERS.map((path) => ({
    path,
    /*
     * COMMENTS STRIPPED before the table scan, and that is not cosmetic. `pillars.ts` now carries a
     * long comment explaining that the Ahrefs check USED to read `standing_duties` and why it was
     * deleted — the most valuable paragraph in the file — and an unstripped scan reads that
     * explanation as the violation it describes. A validator confused by its own record teaches
     * people to delete the record.
     */
    source: readFileSync(join(ROOT, path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  }));

  const problems = check({ registry, builders });

  if (problems.length) {
    console.error("todays-contract-is-her-work FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const work = registrySet(registry, "WORK_SUBJECTS");
  const machinery = registrySet(registry, "MACHINERY_SUBJECTS");
  const tables = new Set(builders.flatMap((b) => [...tablesQueried(b.source)]));
  console.log(
    `todays-contract-is-her-work: ${builders.length} contract builder(s) reading ${tables.size} table(s), ` +
    `every one classified as her work; ${machinery.size} machinery subject(s) barred; ` +
    `${work.size} work subject(s) declared. OK.`,
  );
}
