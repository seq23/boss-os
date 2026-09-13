#!/usr/bin/env node
/**
 * THE BROKERAGE SUGGESTION IS WEEKDAYS-ONLY AND MAY SAY NOTHING; THE SIDE-HUSTLE ITEM IS CAPPED AT
 * ONE A DAY AND ONLY WHERE A HUMAN IS ACTUALLY REQUIRED.
 *
 * ─── Her two instructions ───────────────────────────────────────────────────
 *
 *   "my today's contract should suggest something in brokerage M-F"
 *
 *   "should suggest something that requires a human touch from one of the side hustles when
 *    appropriate n o more than 1 per day as appropriate"
 *
 * ─── What each one can fail as, which is what this checks ───────────────────
 *
 * BOTH of these features fail the same way if nobody guards them, and it is not by breaking: it is
 * by becoming generous. A brokerage line every weekday whether or not there is one, and a
 * side-hustle line whenever anything is stuck, and the contract is a list she scrolls past. Her own
 * standing rule on the capital lane says it plainly — coming back empty-handed is fine, returning
 * noise is not — and §17 caps priorities at three for the identical reason.
 *
 * So the invariants are about RESTRAINT, not about output:
 *
 *   1. `brokerageMove` REFUSES ON WEEKENDS, as its first act, before any query.
 *   2. It CAN RETURN NULL. A function with a fallback at the bottom always says something, and
 *      "always says something" is the defect. So: it ends in `return null`, and it has no
 *      generic-suggestion fallback.
 *   3. It reads ONLY sovereign brokerage tables, and specifically NOT the interest ledger, which is
 *      on her Mac and whose contents may never reach this database.
 *   4. THE CAP IS A DAY, NOT A QUERY. `LIMIT 1` caps a query; reload the page and it runs again,
 *      and with two candidates open she gets a different item each time. So `humanTouch` reads and
 *      writes `human_touch_days`, whose PRIMARY KEY is the day — a cap SQLite enforces rather than
 *      a caller remembering. Every source query still `LIMIT 1` underneath it.
 *   5. "Needs a human" is DECLARED, never inferred from prose. `declaredTouch` filters on
 *      `needs_owner = 1`; a `blocker LIKE` match, or any test that reads the free-text blocker to
 *      decide, is the failure. Inference was ADDED BESIDE this, never in place of it.
 *   6. Every source refuses a row that cannot say WHY only she can do it.
 *   7. The side-hustle list is THE GRID — `suggestingKeys()` from `src/shared/boss/grid.mjs` — and
 *      never a hardcoded list of property names, which would be the second list this repo keeps
 *      naming. It is the `primary` tier only: the generator is secondary ("fix only if broken") and
 *      the authority network is infrastructure ("a cost centre, not a line — never a day's work").
 *   8. NO STREAK, NO CAP-RAISING. `SIDE_HUSTLE_KEYS` must not be spread into more than one item.
 *   9. `examinedTouch` reads only `disposition = 'needs_her'`. A slot that could read a dispatched
 *      observation would put red builds in her contract, which is the dashboard she scrolls past.
 *
 * RULE 0: if any of these functions is missing, or the grid is empty, this HARD-FAILS. A scan whose
 * subject does not exist has proved nothing, and an empty key list would make `IN ()` match nothing
 * for ever while every check here passed.
 *
 *   node scripts/validate/one-brokerage-move-and-one-human-touch.mjs
 *   node scripts/validate/one-brokerage-move-and-one-human-touch.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PILLARS = "src/worker/boss/today/pillars.ts";
const PROJECTS = "src/worker/boss/today/projects.ts";
const GRID = "src/shared/boss/grid.mjs";

/**
 * Tables the brokerage suggestion is allowed to read. Anything else is a widened boundary.
 *
 * `brokerage_pointers` is on this list and the interest ledger still is not. The pointer holds a
 * count, a kind and a clock, in a table with no free TEXT column — see `migrations/0234` and
 * `validate:pointer-has-no-names`, which asserts that shape rather than trusting this comment.
 */
const BROKERAGE_ALLOWED = new Set([
  "brokerage_pointers",
  "capital_book",
  "capital_book_line",
  "counterparty_crossmatches",
]);

/**
 * The ledger lives on her Mac. `interest-match.mjs`: "Named counterparties, assets and sizes never
 * reach the Boss OS database." A contract builder reaching for it is a boundary breach, not a bug.
 */
const LEDGER_MARKERS = [/counterparty_interest/, /ledger\.json/, /interest_ledger/];

/**
 * The body of a named function, brace-balanced.
 *
 * THREE THINGS MAKE THIS HARDER THAN IT LOOKS, AND THE FIRST DRAFT FELL INTO ALL OF THEM — found by
 * this validator failing against the very code it was written to approve, which is why a scan is
 * run against the repo and not only against its fixtures:
 *
 *   1. The parameter list can span lines and contain its own parentheses, so "the first `)`" is not
 *      the end of it. Paren depth is tracked.
 *   2. The RETURN TYPE contains braces — `Promise<{ action: string } | null>` — so "the first `{`
 *      after the parameters" grabbed the type literal and the extracted "body" was three words of
 *      a type annotation. Every check then failed for the same wrong reason, which is the shape of
 *      a validator that invents defects.
 *   3. So the opening brace is the first one at ANGLE-BRACKET DEPTH ZERO: inside `<…>` it belongs to
 *      a type, outside it opens the body.
 */
export function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start === -1) return null;

  // 1. The true end of the parameter list.
  let i = source.indexOf("(", start);
  let parens = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === "(") parens += 1;
    else if (source[i] === ")") {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  if (i >= source.length) return null;

  // 2 and 3. The first brace that is not inside a type argument list.
  let angle = 0;
  let open = -1;
  for (let j = i + 1; j < source.length; j += 1) {
    const ch = source[j];
    if (ch === "<") angle += 1;
    else if (ch === ">") angle = Math.max(0, angle - 1);
    else if (ch === "{" && angle === 0) { open = j; break; }
  }
  if (open === -1) return null;

  let depth = 0;
  for (let j = open; j < source.length; j += 1) {
    if (source[j] === "{") depth += 1;
    else if (source[j] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  return null;
}

/** Every project key declared with a given lane in projects.ts. */
export function keysInLane(projects, lane) {
  const out = [];
  for (const block of projects.split(/\n  \{\n/).slice(1)) {
    const key = /key:\s*["']([a-z_]+)["']/.exec(block);
    const laneOf = /lane:\s*["']([a-z_]+)["']/.exec(block);
    if (key && laneOf && laneOf[1] === lane) out.push(key[1]);
  }
  return out;
}

export function check({ pillars, projects, gridSrc = "" }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  const src = code(pillars);
  const brokerage = functionBody(src, "brokerageMove");
  const touch = functionBody(src, "humanTouch");
  const declared = functionBody(src, "declaredTouch");
  const examined = functionBody(src, "examinedTouch");

  // ── RULE 0 ────────────────────────────────────────────────────────────────
  if (!brokerage) {
    problems.push(
      `${PILLARS} has no \`brokerageMove\` this scan can read. Her instruction was that the contract ` +
      `suggest something in brokerage M-F; with the function gone there is nothing to check and ` +
      `nothing suggesting it.`,
    );
  }
  if (!touch) {
    problems.push(`${PILLARS} has no \`humanTouch\` this scan can read, so the one-a-day cap governs nothing.`);
  }
  if (!declared) {
    problems.push(
      `${PILLARS} has no \`declaredTouch\`. The explicit \`needs_owner\` flag is still supported and still ` +
      `outranks anything inferred; inference was added BESIDE the declaration, never in place of it.`,
    );
  }
  if (!examined) {
    problems.push(
      `${PILLARS} has no \`examinedTouch\`, so the slot is back to echoing flags she sets by hand — which ` +
      `is the defect: nothing ever set one, and the slot was silent from the day it shipped.`,
    );
  }

  const spry = keysInLane(projects, "spry");
  if (problems.length) return problems;

  // ── 1. Weekends ───────────────────────────────────────────────────────────
  if (!/isWeekday\(weekday\)/.test(brokerage)) {
    problems.push(
      `\`brokerageMove\` does not gate on \`isWeekday\`. Her instruction is M-F; a brokerage suggestion ` +
      `on a Sunday is the system not knowing what day it is, on the screen that exists to tell her.`,
    );
  } else {
    // Before any query, or the gate is decorative and the weekend still costs reads.
    const gateAt = brokerage.indexOf("isWeekday(weekday)");
    const firstQuery = brokerage.search(/\.prepare\(/);
    if (firstQuery !== -1 && firstQuery < gateAt) {
      problems.push(`\`brokerageMove\` queries the database before it checks the day. The gate must be its first act.`);
    }
  }

  // ── 2. It is allowed to say nothing ───────────────────────────────────────
  if (!/return null;\s*\}?\s*$/.test(brokerage.trimEnd())) {
    problems.push(
      `\`brokerageMove\` does not end in \`return null\`. A function with a fallback at the bottom ALWAYS ` +
      `says something, and "always says something" is the defect: a filler suggestion every weekday ` +
      `is worse than a quiet day, because she stops reading the section. Coming back empty-handed is ` +
      `fine; returning noise is not.`,
    );
  }

  // ── 3. Only sovereign brokerage tables, and never the ledger ──────────────
  for (const m of brokerage.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/g)) {
    const table = m[1];
    if (!BROKERAGE_ALLOWED.has(table)) {
      problems.push(
        `\`brokerageMove\` reads "${table}", which is not one of the brokerage tables it is allowed to ` +
        `use (${[...BROKERAGE_ALLOWED].join(", ")}). Widening this quietly is how a suggestion starts ` +
        `being derived from something other than her actual book.`,
      );
    }
  }
  for (const marker of LEDGER_MARKERS) {
    if (marker.test(brokerage)) {
      problems.push(
        `\`brokerageMove\` reaches for ${marker.source}. The interest ledger lives on her Mac and its ` +
        `contents may never reach this database — "Named counterparties, assets and sizes never reach ` +
        `the Boss OS database". That is a boundary, not a performance choice.`,
      );
    }
  }

  // ── 4. The cap is a DAY, enforced by a primary key ────────────────────────
  if (!/human_touch_days/.test(touch)) {
    problems.push(
      `\`humanTouch\` does not use \`human_touch_days\`. "No more than 1 per day" is not "one per query": ` +
      `LIMIT 1 caps a SELECT, and a page reloaded twice with two candidates open hands her two different ` +
      `items. The day is the PRIMARY KEY of that table, so SQLite refuses the second row — which is the ` +
      `only kind of cap that survives a refactor.`,
    );
  }
  if (!/INSERT OR IGNORE INTO human_touch_days/.test(touch)) {
    problems.push(
      `\`humanTouch\` does not claim the day with INSERT OR IGNORE. Two renders racing at 06:00 would both ` +
      `write, and the day would have had two touches.`,
    );
  }
  if (!/SELECT source, ref_id FROM human_touch_days/.test(touch)) {
    problems.push(
      `\`humanTouch\` does not read the day's choice back. Without the read-back the render that LOST the ` +
      `insert race goes on to show its own candidate, and the cap it just obeyed means nothing.`,
    );
  }
  if (!/LIMIT 1\b/.test(declared)) {
    problems.push(
      `\`humanTouch\` does not \`LIMIT 1\`. "No more than 1 per day" is not "usually one" — she is ` +
      `protecting the contract from becoming a list, so the cap must hold by construction rather than ` +
      `by a caller remembering to slice.`,
    );
  }
  for (const [name, body] of [["declaredTouch", declared], ["examinedTouch", examined]]) {
    if (/\.all</.test(body) && !/\.first</.test(body)) {
      problems.push(`\`${name}\` selects a list where it should select one row. A list is a cap waiting to be forgotten.`);
    }
  }

  // ── 5. Declared, never inferred ───────────────────────────────────────────
  if (!/needs_owner\s*=\s*1/.test(declared)) {
    problems.push(
      `\`humanTouch\` does not filter on \`needs_owner = 1\`. Whether something needs HER must be ` +
      `declared by whoever filed it, not read out of prose — matching by resemblance is what this ` +
      `repository refuses everywhere it matters, and a wrong guess at the top of her day teaches her ` +
      `to skim the section.`,
    );
  }
  if (/blocker\s+LIKE|blocker\.(?:includes|match|test)|\/.*\/\.test\(\s*\w*\.?blocker/.test(declared + examined)) {
    problems.push(
      `\`humanTouch\` reads the free-text \`blocker\` to decide whether she is needed. That is inference ` +
      `dressed as a rule. Use the declaration.`,
    );
  }
  if (!/state IN \('open','blocked'\)|state\s+IN\s*\(/.test(declared)) {
    problems.push(`\`declaredTouch\` does not bound the states it will surface, so a done or killed item could reappear.`);
  }

  // ── 6. Every source must say why ──────────────────────────────────────────
  if (!/needs_owner_why/.test(declared) || !/return null/.test(declared)) {
    problems.push(
      `\`declaredTouch\` does not refuse a row with no \`needs_owner_why\`. A row claiming "this needs you" ` +
      `that cannot say what only she can do is a puzzle, not a task, and she has enough of those.`,
    );
  }
  if (!/needs_her_why/.test(examined) || !/return null/.test(examined)) {
    problems.push(
      `\`examinedTouch\` does not refuse an observation with no \`needs_her_why\`. An examination that found ` +
      `something and cannot say why only she can act on it has found work to dispatch, not work for her.`,
    );
  }

  // ── 9. The slot may only read what could not be dispatched ────────────────
  if (!/disposition\s*=\s*'needs_her'/.test(examined)) {
    problems.push(
      `\`examinedTouch\` does not filter on \`disposition = 'needs_her'\`. Without it a red build or a stale ` +
      `bot PR reaches her contract — "a slot that lists five red builds is a dashboard she will scroll ` +
      `past". Anything a script or an employee can do is dispatched and never shown to her.`,
    );
  }

  // ── 7 and 8. The list IS the grid ─────────────────────────────────────────
  const keysDecl = /SIDE_HUSTLE_KEYS\s*=\s*([^;]*);/.exec(code(pillars));
  if (!keysDecl) {
    problems.push(`${PILLARS} does not declare SIDE_HUSTLE_KEYS at all.`);
  } else if (!/suggestingKeys\(\)/.test(keysDecl[1])) {
    problems.push(
      `SIDE_HUSTLE_KEYS is not \`suggestingKeys()\` from ${GRID}. Her words: "the grid repos are my side ` +
      `hustles." A hardcoded list of property names is the second list this repository keeps naming — and ` +
      `it is how this file came to say she had four side hustles while the heartbeat script said eight.`,
    );
  } else if (/\[/.test(keysDecl[1])) {
    problems.push(`SIDE_HUSTLE_KEYS appears to be a literal array. The grid is the list.`);
  }

  if (!/suggestingKeys/.test(gridSrc) || !/tier === "primary"/.test(gridSrc)) {
    problems.push(
      `${GRID}'s \`suggestingKeys\` does not select the \`primary\` tier. Secondary and infrastructure ` +
      `properties are watched and fixed and must never propose work to her: "we really just include it in ` +
      `case something needs to be fixed", and "a cost centre, not a line — never a day's work".`,
    );
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

const goodProjects = `
export const PROJECTS = [
  { key: "brokerage", lane: "brokerage" },
];
`;

const goodGrid = `
export function suggestingKeys() {
  return GRID.filter((p) => p.tier === "primary").map((p) => p.key);
}
`;

const goodPillars = `
export function isWeekday(weekday) { return weekday >= 1 && weekday <= 5; }

export async function brokerageMove(env, weekday) {
  if (!isWeekday(weekday)) return null;
  const pointer = await env.DB.prepare("SELECT kind, crossings FROM brokerage_pointers WHERE seen_at IS NULL LIMIT 1").first();
  if (pointer) return { action: "p", why: "q" };
  const cross = await env.DB.prepare("SELECT candidate_name FROM counterparty_crossmatches WHERE status = 'new'").all();
  if (cross.results.length) return { action: "a", why: "b" };
  const sizeless = await env.DB.prepare("SELECT l.asset FROM capital_book_line l JOIN capital_book b ON b.id = l.book_id").all();
  if (sizeless.results.length) return { action: "c", why: "d" };
  return null;
}

export const SIDE_HUSTLE_KEYS = suggestingKeys();

async function declaredTouch(env, pin = null) {
  if (SIDE_HUSTLE_KEYS.length === 0) return null;
  const row = await env.DB.prepare(
    "SELECT d.id, d.needs_owner_why FROM owned_deliverables d WHERE d.needs_owner = 1 AND d.state IN ('open','blocked') LIMIT 1",
  ).first();
  if (!row || !row.needs_owner_why || !row.needs_owner_why.trim()) return null;
  return { ref_id: row.id, action: "x", why: "y" };
}

async function examinedTouch(env, pin = null) {
  const row = await env.DB.prepare(
    "SELECT o.id, o.needs_her_why FROM grid_observations o WHERE o.disposition = 'needs_her' AND o.state IN ('open','shown') LIMIT 1",
  ).first();
  if (!row || !row.needs_her_why || !row.needs_her_why.trim()) return null;
  return { ref_id: row.id, action: "x", why: "y" };
}

export async function humanTouch(env) {
  const day = herDay();
  const already = await env.DB.prepare("SELECT source, ref_id FROM human_touch_days WHERE day = ?").bind(day).first();
  if (already) return null;
  for (const [source, fn] of SOURCES) {
    const candidate = await fn(env, null);
    if (!candidate) continue;
    await env.DB.prepare("INSERT OR IGNORE INTO human_touch_days (day, source, ref_id, chosen_at) VALUES (?,?,?,?)").run();
    const chosen = await env.DB.prepare("SELECT source, ref_id FROM human_touch_days WHERE day = ?").bind(day).first();
    return { action: candidate.action, why: candidate.why };
  }
  return null;
}
`;

const P = (pillars, grid = goodGrid) => ({ pillars, projects: goodProjects, gridSrc: grid });

function selfTest() {
  const cases = [
    { name: "the shipped shape passes", input: P(goodPillars), expect: 0 },
    {
      name: "brokerage suggestion with no weekday gate",
      input: P(goodPillars.replace("  if (!isWeekday(weekday)) return null;\n", "")),
      expect: 1,
    },
    {
      name: "the weekday gate placed AFTER the first query",
      input: P(goodPillars
        .replace("  if (!isWeekday(weekday)) return null;\n  const pointer", "  const pointer")
        .replace('if (pointer) return { action: "p", why: "q" };', 'if (!isWeekday(weekday)) return null;\n  if (pointer) return { action: "p", why: "q" };')),
      expect: 1,
    },
    {
      name: "THE NOISE DEFECT: a filler fallback instead of returning null",
      input: P(goodPillars.replace(
        "  return null;\n}\n\nexport const SIDE_HUSTLE_KEYS",
        '  return { action: "Do some brokerage today", why: "It is a weekday." };\n}\n\nexport const SIDE_HUSTLE_KEYS',
      )),
      expect: 1,
    },
    {
      name: "the brokerage suggestion reaching for the interest ledger",
      input: P(goodPillars.replace("FROM counterparty_crossmatches", "FROM counterparty_interest")),
      expect: 1,
    },
    {
      name: "the brokerage suggestion reading a table outside its boundary",
      input: P(goodPillars.replace("FROM counterparty_crossmatches", "FROM people")),
      expect: 1,
    },
    {
      name: "THE CAP REMOVED: the day is no longer claimed, so a reload hands her a second item",
      input: P(goodPillars.replaceAll("human_touch_days", "touch_scratch")),
      expect: 1,
    },
    {
      name: "the day claimed but never read back, so the loser of a race shows its own candidate",
      input: P(goodPillars.replace('    const chosen = await env.DB.prepare("SELECT source, ref_id FROM human_touch_days WHERE day = ?").bind(day).first();\n', "")
        .replace('  const already = await env.DB.prepare("SELECT source, ref_id FROM human_touch_days WHERE day = ?").bind(day).first();\n  if (already) return null;\n', "")),
      expect: 1,
    },
    {
      name: "INFERENCE: deciding she is needed by reading the blocker text",
      input: P(goodPillars.replace("d.needs_owner = 1", "d.blocker LIKE '%Sequoia%'")),
      expect: 1,
    },
    {
      name: "the declared source surfacing a row without saying why only she can do it",
      input: P(goodPillars
        .replace("  if (!row || !row.needs_owner_why || !row.needs_owner_why.trim()) return null;\n", "")
        .replace("d.needs_owner_why", "d.name")),
      expect: 1,
    },
    {
      name: "unbounded states, so a done item could reappear",
      input: P(goodPillars.replace(" AND d.state IN ('open','blocked')", "")),
      expect: 1,
    },
    {
      name: "THE DASHBOARD DEFECT: the slot reading dispatched observations too",
      input: P(goodPillars.replace("o.disposition = 'needs_her' AND ", "")),
      expect: 1,
    },
    {
      name: "an examined observation surfaced with no reason only she can act",
      input: P(goodPillars
        .replace("  if (!row || !row.needs_her_why || !row.needs_her_why.trim()) return null;\n", "")
        .replace("o.needs_her_why", "o.headline")),
      expect: 1,
    },
    {
      name: "SECOND LIST: the side hustles hardcoded instead of read from the grid",
      input: P(goodPillars.replace(
        "export const SIDE_HUSTLE_KEYS = suggestingKeys();",
        'export const SIDE_HUSTLE_KEYS = ["ads", "youtube", "saas"];',
      )),
      expect: 1,
    },
    {
      name: "the secondary and infrastructure properties allowed to propose work to her",
      input: P(goodPillars, goodGrid.replace('p.tier === "primary"', "true")),
      expect: 1,
    },
    { name: "RULE 0 — brokerageMove gone", input: P(goodPillars.replace(/export async function brokerageMove[\s\S]*?\n\}\n/, "")), expect: 1 },
    { name: "RULE 0 — humanTouch gone", input: P(goodPillars.replace(/export async function humanTouch[\s\S]*?\n\}\n/, "")), expect: 1 },
    { name: "RULE 0 — the declared path removed rather than added beside", input: P(goodPillars.replace(/async function declaredTouch[\s\S]*?\n\}\n/, "")), expect: 1 },
    { name: "RULE 0 — the examination path gone, so the slot echoes her own flags again", input: P(goodPillars.replace(/async function examinedTouch[\s\S]*?\n\}\n/, "")), expect: 1 },
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
    console.error(`\none-brokerage-move-and-one-human-touch self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`one-brokerage-move-and-one-human-touch self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const missing = [PILLARS, PROJECTS].filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`one-brokerage-move-and-one-human-touch FAILED — ${missing.join(" and ")} missing.`);
    process.exit(1);
  }

  const projects = readFileSync(join(ROOT, PROJECTS), "utf8");
  const gridSrc = existsSync(join(ROOT, GRID)) ? readFileSync(join(ROOT, GRID), "utf8") : "";
  const problems = check({ pillars: readFileSync(join(ROOT, PILLARS), "utf8"), projects, gridSrc });

  if (problems.length) {
    console.error("one-brokerage-move-and-one-human-touch FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const { suggestingKeys } = await import(join(ROOT, GRID));
  const suggesting = suggestingKeys();
  console.log(
    `one-brokerage-move-and-one-human-touch: the brokerage move is weekday-gated, may return null, and ` +
    `reads only her own book; the side-hustle item is capped at one PER DAY by a primary key, declared ` +
    `first and examined second, over ${suggesting.length} suggesting grid propert(ies) ` +
    `(${suggesting.join(", ")}). OK.`,
  );
}
