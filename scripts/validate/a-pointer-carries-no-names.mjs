#!/usr/bin/env node
/**
 * NOTHING THIS PATH WRITES TO D1 CARRIES A COUNTERPARTY, AN ASSET, A SIZE OR AN ADDRESS.
 *
 * ─── The boundary, in her words, stated in three places already ────────────
 *
 *   "Named counterparties, assets and sizes never reach the Boss OS database — not code-named,
 *    not counted."
 *
 * `scripts/ops/interest-match.mjs` says it at line 53. `src/worker/boss/today/subjects.ts` says it
 * again in the registry of what today's contract may be about. She is a registered representative of
 * a FINRA broker-dealer, and her clients' expressions of interest staying off a cloud database is
 * her decision, not a performance choice.
 *
 * ─── Why the rule needed a guard, having been stated three times ───────────
 *
 * Because today's brokerage line now DEPENDS on that ledger's output. It says "Monique has 3
 * crossings from your book this morning, sent 07:45 — they are in your inbox", and that sentence is
 * one small, reasonable-looking edit away from being useful in the wrong way. The edits that would
 * do it are the ones a person makes on a good day:
 *
 *   · "the pointer should say WHICH names, so she knows whether to open it now"
 *   · "let us store the subject line, it is only a summary"
 *   · "add a note field for the next action"
 *
 * Each one is a sentence somebody could defend in a standup. Each one puts a counterparty in a
 * cloud database. A rule that lives only in a comment cannot survive an argument like that; a
 * failing build can.
 *
 * ─── The two independent refusals this asserts ─────────────────────────────
 *
 * 1. THE TABLE CANNOT HOLD A NAME. Every column of `brokerage_pointers` is an INTEGER, or a TEXT
 *    with a CHECK constraint listing its only permitted values. There is nowhere to put "Fidelity",
 *    "OpenAI", "$500M" or an email address, so a wrong caller and a wrong handler both fail at
 *    SQLite rather than at review. A free TEXT column added to this table is the failure, whatever
 *    it is called and whatever the comment above it says.
 *
 * 2. THE HANDLER REFUSES ANYTHING ELSE. The endpoint takes an ALLOWLIST of three fields and rejects
 *    a body carrying any other, rather than ignoring the extra. That distinction is the whole point:
 *    an ignored field arrives quietly for six months and is then "already being sent, we may as well
 *    store it". A rejected one fails on its first run, in the duty log, where somebody reads it.
 *
 * 3. AND THE POSTER SENDS ONLY THOSE THREE, BUILT LITERALLY. A spread — `{ ...match, count }` — is
 *    how the asset field arrives without anybody deciding it should, so the body must be an object
 *    literal of primitives and must not spread anything.
 *
 * 4. THE CONTRACT LINE INTERPOLATES ONLY THE COUNT AND THE CLOCK. `brokerageMove`'s pointer branch
 *    may not read a column that does not exist, and may not reach for the ledger.
 *
 * RULE 0: if the table, the endpoint or the poster cannot be found, this HARD-FAILS. A scan whose
 * subject does not exist has proved nothing, and this is a scan whose silence would be read as
 * "the boundary holds".
 *
 *   node scripts/validate/a-pointer-carries-no-names.mjs
 *   node scripts/validate/a-pointer-carries-no-names.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const TABLE = "brokerage_pointers";
const ROUTE = "src/worker/boss/routes/capital.ts";
const POSTER = "scripts/ops/interest-match.mjs";
const PILLARS = "src/worker/boss/today/pillars.ts";

/** The three fields a pointer is allowed to carry, in both directions. */
export const ALLOWED_FIELDS = ["kind", "crossings", "sent_at"];

/**
 * The column definitions inside `CREATE TABLE <name> ( ... )`.
 *
 * SPLIT AT TOP-LEVEL COMMAS ONLY. A `CHECK (kind IN ('cross','revival'))` contains commas inside
 * parentheses, and splitting on every comma turns one column into three fragments — two of which
 * have no type at all and would be reported as free TEXT. A validator that invents a defect in the
 * thing it was written to approve teaches people to switch it off.
 */
export function columnsOf(sql, table) {
  const open = sql.search(new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\s*\\(`));
  if (open === -1) return null;
  let i = sql.indexOf("(", open);
  const start = i + 1;
  let depth = 0;
  for (; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  /*
   * COMMENTS COME OFF FIRST, BEFORE THE SPLIT, AND THE ORDER IS THE BUG THE FIRST DRAFT HAD.
   * Stripping them per-fragment afterwards is too late: this table's comments contain commas —
   * "a counterparty, an asset, a size" is one of them — so the split had already cut a single
   * column into four, and three of the pieces were prose with no type, reported as free TEXT
   * columns named "an", "which" and "so". A validator that invents a defect in the very file it
   * was written to approve is how people learn to switch validators off.
   */
  const inner = sql.slice(start, i).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

  const parts = [];
  let buf = "";
  let d = 0;
  for (const ch of inner) {
    if (ch === "(") d += 1;
    if (ch === ")") d -= 1;
    if (ch === "," && d === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  parts.push(buf);

  return parts
    .map((p) => p.trim())
    .filter((p) => p && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(p))
    .map((p) => {
      const m = /^["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+(.*)$/s.exec(p);
      return m ? { name: m[1], def: m[2].replace(/\s+/g, " ").trim() } : null;
    })
    .filter(Boolean);
}

/**
 * Can this column hold a name?
 *
 * INTEGER: no. TEXT with `CHECK (col IN ('a','b'))`: no — SQLite refuses anything outside the list.
 * Anything else: YES, and that is the failure, including `TEXT` with a length check, a NOT NULL, a
 * DEFAULT or a comment promising it will only ever hold a code.
 */
export function canHoldAName(col) {
  const def = col.def.toUpperCase();
  if (/^INTEGER\b/.test(def) || /^INT\b/.test(def) || /^REAL\b/.test(def) || /^NUMERIC\b/.test(def)) return false;
  const enumCheck = new RegExp(`CHECK\\s*\\(\\s*${col.name.toUpperCase()}\\s+IN\\s*\\(`, "i");
  if (/^TEXT\b/.test(def) && enumCheck.test(col.def)) return false;
  return true;
}

export function check({ migration, route, poster, pillars }) {
  const problems = [];

  // ── RULE 0 ────────────────────────────────────────────────────────────────
  const cols = migration ? columnsOf(migration, TABLE) : null;
  if (!cols || cols.length === 0) {
    problems.push(
      `No \`CREATE TABLE ${TABLE}\` this scan can read. The pointer table is the thing that makes the ` +
      `ledger boundary enforceable rather than merely stated, and a scan with no subject has proved ` +
      `nothing while looking exactly like a pass.`,
    );
  }
  if (!route || !/brokerage-pointer/.test(route)) {
    problems.push(`${ROUTE} has no \`brokerage-pointer\` endpoint, so nothing writes the pointer and this scan governs nothing.`);
  }
  if (!poster || !/brokerage-pointer/.test(poster)) {
    problems.push(`${POSTER} no longer posts a pointer. The local job is the only thing that may read the ledger; if it stopped reporting, the contract is blind again.`);
  }
  if (problems.length) return problems;

  // ── 1. The table cannot hold a name ───────────────────────────────────────
  for (const col of cols) {
    if (canHoldAName(col)) {
      problems.push(
        `${TABLE}.${col.name} is "${col.def}" — a column that can hold any string. A counterparty, an ` +
        `asset, a size or an email address fits in it, and the first person who wants the pointer to be ` +
        `"a little more useful" will put one there. Every column here must be an INTEGER, or a TEXT ` +
        `with CHECK (${col.name} IN (...)) listing its permitted values.`,
      );
    }
  }

  // ── 2. The handler refuses anything but the three fields ──────────────────
  const handlerAt = route.indexOf('capital.post("/brokerage-pointer"');
  const handler = handlerAt === -1 ? "" : route.slice(handlerAt);
  const code = handler.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  if (!/const ALLOWED\s*=\s*\[/.test(code)) {
    problems.push(
      `The \`brokerage-pointer\` handler has no field ALLOWLIST. A denylist of name-shaped fields cannot ` +
      `work here: it would have to guess what a future caller calls a counterparty, and it is wrong the ` +
      `first time somebody writes "party", "who" or "top".`,
    );
  } else {
    const decl = /const ALLOWED\s*=\s*\[([^\]]*)\]/.exec(code)?.[1] ?? "";
    const listed = [...decl.matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]);
    const widened = listed.filter((f) => !ALLOWED_FIELDS.includes(f));
    if (widened.length) {
      problems.push(
        `The pointer allowlist has been widened to include ${widened.join(", ")}. A pointer says HOW MANY ` +
        `and WHEN. It never says who, what or how much — that is the boundary, and widening it here is ` +
        `how the boundary is crossed while every comment still claims it holds.`,
      );
    }
    for (const f of ALLOWED_FIELDS) {
      if (!listed.includes(f)) problems.push(`The pointer allowlist has lost "${f}", so a valid post would be refused.`);
    }
  }
  if (!/extra\.length\s*>\s*0/.test(code) || !/throw badRequest/.test(code)) {
    problems.push(
      `The \`brokerage-pointer\` handler does not REFUSE a body carrying an unlisted field. Ignoring it is ` +
      `the quiet failure: the field arrives for six months, nobody sees it, and then it is "already ` +
      `being sent, we may as well store it".`,
    );
  }
  const inserted = /INSERT INTO brokerage_pointers \(([^)]*)\)/.exec(code)?.[1] ?? "";
  if (!inserted) {
    problems.push(`The handler does not INSERT INTO ${TABLE} in a form this scan can read.`);
  } else {
    for (const colName of inserted.split(",").map((s) => s.trim())) {
      if (!colName) continue;
      const col = cols.find((c) => c.name === colName);
      if (!col) {
        problems.push(`The handler inserts into ${TABLE}.${colName}, which the migration does not declare.`);
      } else if (canHoldAName(col)) {
        problems.push(`The handler writes ${TABLE}.${colName}, which can hold an arbitrary string.`);
      }
    }
  }

  // ── 3. The poster builds the body literally, from primitives ──────────────
  const postAt = poster.indexOf("async function postPointer");
  const post = postAt === -1 ? "" : poster.slice(postAt, postAt + 3000);
  if (!post) {
    problems.push(`${POSTER} has no \`postPointer\` this scan can read, so what it sends cannot be checked.`);
  } else {
    const body = /body:\s*JSON\.stringify\(\{([^}]*)\}\)/.exec(post.slice(post.indexOf("brokerage-pointer")))?.[1];
    if (!body) {
      problems.push(
        `${POSTER} does not build the pointer body as an object literal at the call. It must be three ` +
        `named primitives and nothing else — a spread is how the asset field arrives without anybody ` +
        `deciding it should.`,
      );
    } else {
      if (/\.\.\./.test(body)) {
        problems.push(
          `${POSTER} SPREADS something into the pointer body. Whatever is being spread today, the thing ` +
          `it is spread from is a match object carrying a principal, an asset and a size tomorrow.`,
        );
      }
      const keys = [...body.matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1]);
      const extra = keys.filter((k) => !ALLOWED_FIELDS.includes(k));
      if (extra.length) {
        problems.push(`${POSTER} sends ${extra.join(", ")} in the pointer body. The endpoint will refuse it, and it should never have been assembled.`);
      }
    }
    /*
     * THE POINTER FOLLOWS THE MAIL. A post before the send is a pointer to an email that may not
     * exist, which sends her looking for a message that never arrived — worse than no pointer,
     * because it is the line she would most trust.
     */
    const sendOk = poster.indexOf("if (res.ok) {");
    const postCall = poster.indexOf("await postPointer(");
    if (sendOk === -1 || postCall === -1 || postCall < sendOk) {
      problems.push(
        `${POSTER} does not call postPointer inside the successful-send branch. A pointer to an email ` +
        `that was never sent is the one failure this line cannot survive.`,
      );
    }
  }

  // ── 4. The contract line says only what it may ────────────────────────────
  const moveAt = pillars.indexOf("export async function brokerageMove");
  const move = moveAt === -1 ? "" : pillars.slice(moveAt, pillars.indexOf("counterparty_crossmatches", moveAt));
  if (!move) {
    problems.push(`${PILLARS} has no \`brokerageMove\` pointer branch this scan can read.`);
  } else {
    const selected = /SELECT ([a-z_,\s.]+)\n\s*FROM\s+brokerage_pointers/.exec(move)?.[1];
    if (!selected) {
      problems.push(`${PILLARS} does not read ${TABLE} in a form this scan can check.`);
    } else {
      for (const colName of selected.split(",").map((s) => s.trim().replace(/^\w+\./, ""))) {
        if (!colName) continue;
        const col = cols.find((c) => c.name === colName);
        if (!col) problems.push(`${PILLARS} selects ${TABLE}.${colName}, which does not exist.`);
        else if (canHoldAName(col)) problems.push(`${PILLARS} selects ${TABLE}.${colName}, a column that can hold an arbitrary string.`);
      }
    }
    for (const marker of [/ledger\.json/, /counterparty_interest/, /principal_email/]) {
      if (marker.test(move)) {
        problems.push(`${PILLARS}'s pointer branch reaches for ${marker.source}. The ledger is on her Mac and stays there.`);
      }
    }
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

const GOOD_MIGRATION = `
CREATE TABLE brokerage_pointers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- a comment mentioning a counterparty, an asset and a size, which must not be read as a column
  kind       TEXT NOT NULL CHECK (kind IN ('cross','revival')),
  crossings  INTEGER NOT NULL CHECK (crossings > 0),
  sent_at    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at    INTEGER
);
`;

const GOOD_ROUTE = `
capital.post("/brokerage-pointer", async (c) => {
  const body = await c.req.json();
  const ALLOWED = ["kind", "crossings", "sent_at"];
  const extra = Object.keys(body).filter((k) => !ALLOWED.includes(k));
  if (extra.length > 0) { throw badRequest("no"); }
  await c.env.DB.prepare(\`INSERT INTO brokerage_pointers (kind, crossings, sent_at, created_at) VALUES (?,?,?,?)\`).bind(kind, crossings, sentAt, now).run();
});
`;

const GOOD_POSTER = `
async function postPointer(kind, crossings, sentAt) {
  const res = await fetch(\`\${ORIGIN}/api/boss/capital/brokerage-pointer\`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind, crossings, sent_at: sentAt }),
  });
}
function send() {
    if (res.ok) {
      await postPointer(pointerKind, pointerCount, sentAt);
    }
}
`;

const GOOD_PILLARS = `
export async function brokerageMove(env, weekday) {
  const pointer = await env.DB.prepare(
    \`SELECT id, kind, crossings, sent_at
         FROM brokerage_pointers
        WHERE seen_at IS NULL LIMIT 1\`).first();
  if (pointer) return { action: \`Monique has \${pointer.crossings} crossings\`, why: "x" };
  const cross = await env.DB.prepare("SELECT candidate_name FROM counterparty_crossmatches").all();
  return null;
}
`;

function selfTest() {
  const G = { migration: GOOD_MIGRATION, route: GOOD_ROUTE, poster: GOOD_POSTER, pillars: GOOD_PILLARS };
  const cases = [
    { name: "the shipped shape passes", input: G, expect: 0 },
    {
      name: "THE DEFECT: a free TEXT column added to the pointer table",
      input: { ...G, migration: GOOD_MIGRATION.replace("  seen_at    INTEGER", "  summary    TEXT,\n  seen_at    INTEGER") },
      expect: 1,
    },
    {
      name: "a TEXT column with no enum, dressed as a code",
      input: { ...G, migration: GOOD_MIGRATION.replace("  sent_at    INTEGER NOT NULL,", "  asset_code TEXT NOT NULL DEFAULT '',\n  sent_at    INTEGER NOT NULL,") },
      expect: 1,
    },
    {
      name: "the kind column losing its CHECK, so it becomes free text",
      input: { ...G, migration: GOOD_MIGRATION.replace("TEXT NOT NULL CHECK (kind IN ('cross','revival'))", "TEXT NOT NULL") },
      expect: 1,
    },
    {
      name: "THE DEFECT: the allowlist widened to carry a name",
      input: { ...G, route: GOOD_ROUTE.replace(`["kind", "crossings", "sent_at"]`, `["kind", "crossings", "sent_at", "top_counterparty"]`) },
      expect: 1,
    },
    {
      name: "the handler ignoring an unlisted field instead of refusing it",
      input: { ...G, route: GOOD_ROUTE.replace("  if (extra.length > 0) { throw badRequest(\"no\"); }\n", "") },
      expect: 1,
    },
    {
      name: "THE DEFECT: the poster spreading a match object into the body",
      input: { ...G, poster: GOOD_POSTER.replace("{ kind, crossings, sent_at: sentAt }", "{ ...match, kind, crossings, sent_at: sentAt }") },
      expect: 1,
    },
    {
      name: "the poster adding an asset to the body",
      input: { ...G, poster: GOOD_POSTER.replace("{ kind, crossings, sent_at: sentAt }", "{ kind, crossings, sent_at: sentAt, asset: m.asset }") },
      expect: 1,
    },
    {
      name: "the pointer posted BEFORE the mail was accepted",
      input: { ...G, poster: GOOD_POSTER.replace("    if (res.ok) {\n      await postPointer(pointerKind, pointerCount, sentAt);\n    }", "    await postPointer(pointerKind, pointerCount, sentAt);\n    if (res.ok) { return; }") },
      expect: 1,
    },
    {
      name: "the contract line selecting a column the table does not have",
      input: { ...G, pillars: GOOD_PILLARS.replace("SELECT id, kind, crossings, sent_at", "SELECT id, kind, crossings, sent_at, summary") },
      expect: 1,
    },
    {
      name: "the contract line reaching for the ledger itself",
      input: { ...G, pillars: GOOD_PILLARS.replace('WHERE seen_at IS NULL LIMIT 1', 'WHERE seen_at IS NULL LIMIT 1`); const l = require("ledger.json"); //') },
      expect: 1,
    },
    { name: "RULE 0 — the table gone", input: { ...G, migration: "-- nothing here" }, expect: 1 },
    { name: "RULE 0 — the endpoint gone", input: { ...G, route: "export const capital = new Hono();" }, expect: 1 },
    { name: "RULE 0 — the local job stopped posting", input: { ...G, poster: "// no pointer" }, expect: 1 },
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
    console.error(`\na-pointer-carries-no-names self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-pointer-carries-no-names self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const missing = [ROUTE, POSTER, PILLARS].filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`a-pointer-carries-no-names FAILED — ${missing.join(" and ")} missing.`);
    process.exit(1);
  }

  /*
   * THE MIGRATION IS FOUND BY SEARCHING FOR THE TABLE, not by its filename. A rebuild — SQLite's
   * create-copy-drop-rename — lands in a later file, and a scan pinned to 0234 would go on approving
   * the original shape while the live table had a summary column bolted onto it.
   */
  const files = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  let migration = null;
  for (const f of files) {
    const sql = read(`migrations/${f}`);
    if (new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${TABLE}\\s*\\(`).test(sql)) migration = sql;
  }

  const problems = check({
    migration,
    route: read(ROUTE),
    poster: read(POSTER),
    pillars: read(PILLARS),
  });

  if (problems.length) {
    console.error("a-pointer-carries-no-names FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    console.error(
      "Her rule, stated in three places before this guard existed: \"Named counterparties, assets and\n" +
      "sizes never reach the Boss OS database — not code-named, not counted.\" She is a registered\n" +
      "representative and this is her decision.\n",
    );
    process.exit(1);
  }

  const cols = columnsOf(migration, TABLE);
  console.log(
    `a-pointer-carries-no-names: ${TABLE} has ${cols.length} columns and not one of them can hold a ` +
    `string of somebody's choosing; the endpoint refuses any field but ${ALLOWED_FIELDS.join(", ")}; the ` +
    `local job sends those three and posts only after the mail was accepted. OK.`,
  );
  selfTest();
}
