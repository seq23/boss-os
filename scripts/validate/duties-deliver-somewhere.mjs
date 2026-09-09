#!/usr/bin/env node
/**
 * A STANDING DUTY MUST DELIVER SOMEWHERE, AND THE PLACE MUST EXIST.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * `duty_practice_week` declared `delivers: 'practice_week'` in migration 0192. `deliverReport.ts`
 * handled four keys and that was not one of them. No table of that name existed — only a
 * `data_policy` row classifying one. So Imani's duty fired every Sunday at 17:00 Central, cost its
 * ~$0.15 of the owner's Claude Max plan, wrote its `delivers.json`, and the Worker matched the key
 * against four handlers, missed all four, and dropped the payload. Eleven Sundays.
 *
 * NOTHING FAILED. `last_run_at` advanced, the task closed, an approval was raised, the tests passed.
 * That is the defect class this codebase produces most and it has a name: runs but inert.
 *
 * ─── Why the existing validators could not see it ───────────────────────────
 *
 * `validate:reachable` asks whether a TABLE that is read has a writer. `practice_week` had no
 * table at all, so there was nothing for it to ask about. `validate:classification` did catch it —
 * on the orphan policy row — and that validator was not wired into `npm run validate`, so it caught
 * it into a terminal nobody was reading. Two guards and a gap between them.
 *
 * This asks the question neither of them asks: for every duty, is there a path from what it
 * PRODUCES to somewhere a person can read it?
 *
 * ─── The five things it checks, and why each is separate ────────────────────
 *
 * A delivery is a chain, and any one link breaking produces the same silent nothing:
 *
 *   1. Every duty declares how it delivers — a `delivers` key, or a `local_job` script for work an
 *      agent cannot do. A duty declaring neither runs into nothing by construction.
 *   2. Every `delivers` key has a handler in `deliverReport.ts` that guards on it.
 *   3. That handler is actually CALLED from `routes/backends.ts`. A handler nobody invokes is the
 *      same defect one layer down, and this repo has shipped exactly that before.
 *   4. The key names a real table, created by a migration.
 *   5. The handler WRITES to that table. A handler that guards on the key and inserts nowhere is
 *      the shape of a fix that was started and abandoned.
 *
 * And for local jobs — work with an employee's name on it that executes from launchd, because the
 * Claude Code runner strips every credential and cannot read her accounts:
 *
 *   6. The named script exists in `scripts/ops/`.
 *   7. `install-agent-launchd.sh` names it, so it is installed and repairable rather than a file
 *      someone once put in `~/bin`. Two components each keeping their own list with no link is the
 *      named defect this closes.
 *   8. If the duty names a model, the script names the SAME model. A duty row saying Haiku while
 *      the shell script silently runs the default is how one briefing cost $3.88.
 *
 * And for a local job that ALSO declares a `delivers` key — 0204's mailbox sweep, which reads her
 * mail on her Mac and posts code-named findings — the chain runs through a route rather than
 * `deliverReport.ts`, because a local job never produces a `/backends/report` evidence packet:
 *
 *   9. A route writes to the table, a route is registered at the matching path, and a script in
 *      `scripts/ops` actually POSTS to it. That last one is the link that broke for Simone: the KDP
 *      watcher ran correctly for five days and reported into a log file nobody opens.
 *
 * RULE 0: examining zero duties is a failure, not a pass. A loop over an empty set is how a
 * validator ends up green for ever while the thing it guards rots.
 *
 *   node scripts/validate/duties-deliver-somewhere.mjs
 *   node scripts/validate/duties-deliver-somewhere.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const DELIVER = "src/worker/boss/duties/deliverReport.ts";
const CALLER = "src/worker/boss/routes/backends.ts";
const INSTALLER = "scripts/ops/install-agent-launchd.sh";

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Every duty an INSERT into `standing_duties` defines, with the text of its own tuple.
 *
 * SPLIT ON THE DUTY ID rather than trying to parse SQL. A duty's tuple always opens `('duty_...'`
 * and every duty in this repo is defined in one statement, so slicing from one id to the next gives
 * each duty its own text — including its `task_input`, which is where `delivers` lives. A real SQL
 * parser would be more correct and would also be a dependency in a file whose whole job is to be
 * obviously right.
 */
export function dutiesIn(sql) {
  const out = [];
  const inserts = [...sql.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+standing_duties\b/gi)];
  for (const ins of inserts) {
    const block = sql.slice(ins.index);
    const ids = [...block.matchAll(/\(\s*'(duty_[a-z0-9_]+)'/gi)];
    for (let i = 0; i < ids.length; i += 1) {
      const from = ids[i].index;
      const to = i + 1 < ids.length ? ids[i + 1].index : block.length;
      out.push({ id: ids[i][1], text: block.slice(from, to) });
    }
  }
  return out;
}

/**
 * Does anything in the migration history name a model for this duty?
 *
 * ─── WHY THIS CANNOT JUST READ THE CREATING INSERT ─────────────────────────
 *
 * The first version of this check did, and it reported five false positives immediately —
 * `duty_exec_intel`, `duty_brokerage_sourcing` and three others were all created BEFORE 0196 and
 * given their models by an UPDATE in it. Their creating statements are silent and their live rows
 * are correct.
 *
 * A FALSE ALARM FROM A VALIDATOR IS WORSE THAN NO VALIDATOR: it sends someone chasing a problem that
 * does not exist and teaches them to ignore the next one, which is the same lesson the launchd
 * installer's verifier learned. So this asks the question the live database would answer — does any
 * statement anywhere both name this duty and set a model — rather than the question that happened to
 * be easy.
 */
let ALL_MIGRATION_STATEMENTS = [];

function namesAModel(dutyId, ownText) {
  /*
   * THREE SHAPES, BECAUSE THIS REPOSITORY WRITES ALL THREE. `json_object('model', '…')` in a
   * creating INSERT, `json_set(…, '$.requested.model', '…')` in a later UPDATE — which is how 0196
   * fixed five duties at once — and the raw JSON form. A pattern that knew only the first reported
   * those five as silent while their live rows were correct.
   */
  const MODEL = /('model'\s*,\s*'[a-z0-9.\-]+'|'\$\.requested\.model'\s*,\s*'[a-z0-9.\-]+'|"model"\s*:\s*"[a-z0-9.\-]+")/i;
  if (MODEL.test(ownText)) return true;
  return ALL_MIGRATION_STATEMENTS.some((st) => st.includes(dutyId) && MODEL.test(st));
}

/** The `delivers` key a duty's text declares, in either shape this repo writes. */
export function deliversKey(text) {
  // json_object('delivers', 'practice_week', …)
  const jsonObject = /'delivers'\s*,\s*'([a-z_][a-z0-9_]*)'/.exec(text);
  if (jsonObject) return jsonObject[1];
  // '{"delivers":"executive_reports"}'
  const raw = /"delivers"\s*:\s*"([a-z_][a-z0-9_]*)"/.exec(text);
  if (raw) return raw[1];
  return null;
}

/**
 * The ops script a locally-executed duty names, if it is one.
 *
 * THE VALUE MUST LOOK LIKE A SCRIPT, and that is not decoration. `executor` is itself the literal
 * `'local_job'`, so a naive match on `'local_job', '...'` reads the NEXT COLUMN — it returned
 * `ops`, the task kind, and the validator then reported that `scripts/ops/ops` did not exist.
 * Requiring a `.sh` or `.mjs` filename distinguishes the json_object key from the column value
 * without the parser having to know the column order.
 */
export function localJobScript(text) {
  const m = /'local_job'\s*,\s*'([A-Za-z0-9_.-]+\.(?:sh|mjs))'/.exec(text)
    ?? /"local_job"\s*:\s*"([A-Za-z0-9_.-]+\.(?:sh|mjs))"/.exec(text);
  return m ? m[1] : null;
}

/** The model a duty asks for, if it names one. */
export function requestedModel(text) {
  const m = /'\$\.requested\.model'\s*,\s*'([A-Za-z0-9._-]+)'/.exec(text)
    ?? /'model'\s*,\s*'([A-Za-z0-9._-]+)'/.exec(text);
  return m ? m[1] : null;
}

/**
 * Each exported handler in `deliverReport.ts`, with its body.
 *
 * The body is what carries both the guard (`input.delivers !== "key"`) and the writer
 * (`INTO key`), and keeping them together is the point: a handler that guards on a key and writes
 * to a different table would otherwise pass two checks that were really one.
 */
export function handlersIn(source) {
  const out = [];
  const marks = [...source.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)];
  for (let i = 0; i < marks.length; i += 1) {
    const from = marks[i].index;
    const to = i + 1 < marks.length ? marks[i + 1].index : source.length;
    out.push({ name: marks[i][1], body: source.slice(from, to) });
  }
  return out;
}

/** Tables any migration creates. Drops are not tracked here; `validate:classification` owns that. */
function createdTables(allSql) {
  return new Set(
    [...allSql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([A-Za-z_][A-Za-z0-9_]*)/gi)]
      .map((m) => m[1]),
  );
}

// ─── The scan ─────────────────────────────────────────────────────────────────

function scan() {
  const files = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const allSql = files.map((f) => read(`migrations/${f}`)).join("\n");
  // Statement-by-statement, so "this duty" and "a model" have to appear in the SAME statement — a
  // whole-file search would let an unrelated UPDATE three hundred lines away vouch for a silent row.
  ALL_MIGRATION_STATEMENTS = allSql.split(";");

  const duties = [];
  for (const f of files) {
    for (const d of dutiesIn(read(`migrations/${f}`))) duties.push({ ...d, file: f });
  }

  const tables = createdTables(allSql);
  const deliverSrc = read(DELIVER);
  const callerSrc = read(CALLER);
  const installerSrc = existsSync(join(ROOT, INSTALLER)) ? read(INSTALLER) : "";
  const handlers = handlersIn(deliverSrc);

  const problems = [];

  for (const duty of duties) {
    /*
     * ── EVERY DUTY NAMES ITS MODEL ────────────────────────────────────────
     *
     * `claude -p` and the agent envelope both fall back to the DEFAULT model when none is named, and
     * the default is the most expensive one available. That is what made a single executive briefing
     * cost $3.88; 0196 fixed every duty that existed at the time and `duty_mailbox_sweep` was
     * written afterwards, in 0204, without one — a fixed defect coming back through a new row.
     *
     * IT WAS FOUND BY A SCREEN, NOT BY THIS SCAN, which is the argument for adding it here: the
     * roster rendered "NO MODEL NAMED" the first time anyone looked at all nine duties together, and
     * until that screen existed nothing in the system would ever have said so.
     */
    if (!namesAModel(duty.id, duty.text)) {
      problems.push(
        `${duty.id} (${duty.file}): names no model in $.requested.model, so it inherits the default —\n` +
        `      which is the most expensive one available. That is the $3.88 briefing, and it is\n` +
        `      invisible until a bill or a screen says so.`,
      );
    }

    const key = deliversKey(duty.text);
    const job = localJobScript(duty.text);

    if (!key && !job) {
      problems.push(
        `${duty.id} (${duty.file}): declares neither a \`delivers\` key nor a \`local_job\` script.\n` +
        `      It will fire on its cadence, spend its budget, and its output will land nowhere.`,
      );
      continue;
    }

    /*
     * A LOCAL JOB'S DELIVERY IS AN ENDPOINT, NOT A `deliverReport.ts` HANDLER — and until 0204 this
     * validator could not express that, so it demanded the wrong link in the chain.
     *
     * `deliverReport.ts` handles the payload of a `/backends/report` evidence packet. A `local_job`
     * duty never produces one: it runs from launchd on her Mac and posts its own findings to its own
     * route, because the thing it read (her mail) may not cross the machine boundary at all. So for
     * these the chain is: the reporter posts → the route writes → the table exists → a screen reads.
     *
     * THE CHECK IS NOT WEAKENED, IT IS REDIRECTED. Every link is still required, and one more is
     * added that the agent path does not have: the local reporter must actually name the endpoint.
     * A job whose reporter posts nowhere is the same silence as a handler nobody calls, and this
     * repository has shipped that shape twice.
     */
    if (key && job) {
      const routeFiles = readdirSync(join(ROOT, "src/worker/boss/routes")).filter((f) => f.endsWith(".ts"));
      const routeSrc = routeFiles.map((f) => read(`src/worker/boss/routes/${f}`)).join("\n");
      const reporters = readdirSync(join(ROOT, "scripts/ops")).filter((f) => /\.(mjs|sh)$/.test(f));
      const reporterSrc = reporters.map((f) => read(`scripts/ops/${f}`)).join("\n");

      if (!new RegExp(`INSERT INTO\\s+${key}\\b`, "i").test(routeSrc)) {
        problems.push(
          `${duty.id} (${duty.file}): is a local job delivering '${key}' and no route in src/worker/boss/routes writes to that table.\n` +
          `      The job runs on her Mac, posts its result, and the result lands nowhere.`,
        );
      }
      // The endpoint's path, as the route file spells it. `mailbox_findings` → `mailbox-findings`.
      const path = key.replace(/_/g, "-");
      if (!new RegExp(`["'\`]/${path}["'\`]|/${path}\\b`).test(routeSrc)) {
        problems.push(
          `${duty.id} (${duty.file}): no route is registered at a path matching '${path}', so nothing can receive this job's output.`,
        );
      }
      if (!new RegExp(`/${path}\\b`).test(reporterSrc)) {
        problems.push(
          `${duty.id} (${duty.file}): no script in scripts/ops posts to /${path}.\n` +
          `      The job would read, decide, write a file, and tell Boss OS nothing — which is where\n` +
          `      Simone's KDP determinations sat for five days.`,
        );
      }
      if (!tables.has(key)) {
        problems.push(
          `${duty.id} (${duty.file}): delivers '${key}' and no migration creates a table called '${key}'.\n` +
          `      Create it, and classify it — an unclassified table is refused at runtime.`,
        );
      }
    } else if (key) {
      const handler = handlers.find((h) => h.body.includes(`input.delivers !== "${key}"`));
      if (!handler) {
        problems.push(
          `${duty.id} (${duty.file}): delivers '${key}', and no handler in ${DELIVER} guards on it.\n` +
          `      The payload arrives, matches no handler, and is dropped with no error anywhere.`,
        );
      } else {
        if (!new RegExp(`\\b${handler.name}\\s*\\(`).test(callerSrc)) {
          problems.push(
            `${duty.id} (${duty.file}): '${key}' has handler ${handler.name}() and ${CALLER} never calls it.\n` +
            `      A handler nobody invokes is the same silence one layer down.`,
          );
        }
        if (!new RegExp(`INTO\\s+${key}\\b`, "i").test(handler.body)) {
          problems.push(
            `${duty.id} (${duty.file}): ${handler.name}() guards on '${key}' and writes to no table of that name.\n` +
            `      A handler that receives a payload and stores nothing is a fix that was started and left.`,
          );
        }
      }
      if (!tables.has(key)) {
        problems.push(
          `${duty.id} (${duty.file}): delivers '${key}' and no migration creates a table called '${key}'.\n` +
          `      Create it, and classify it — an unclassified table is refused at runtime.`,
        );
      }
    }

    if (job) {
      if (!existsSync(join(ROOT, "scripts/ops", job))) {
        problems.push(
          `${duty.id} (${duty.file}): names local job scripts/ops/${job}, which does not exist.`,
        );
      } else if (!installerSrc.includes(job)) {
        problems.push(
          `${duty.id} (${duty.file}): local job ${job} is not named by ${INSTALLER}.\n` +
          `      Nothing installs or repairs it, so the duty has an owner and no executor.`,
        );
      } else {
        const model = requestedModel(duty.text);
        if (model && !read(`scripts/ops/${job}`).includes(model)) {
          problems.push(
            `${duty.id} (${duty.file}): asks for model '${model}' and scripts/ops/${job} does not name it.\n` +
            `      A duty row that says Haiku while the script runs the default is how one run cost $3.88.`,
          );
        }
      }
    }
  }

  return { duties, problems };
}

// ─── Self-test ────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    name: "a json_object duty's delivers key is found",
    sql: `INSERT OR IGNORE INTO standing_duties (id, name) VALUES\n  ('duty_x', json_object('delivers', 'widgets'));`,
    ids: ["duty_x"], key: "widgets",
  },
  {
    name: "a raw-JSON duty's delivers key is found",
    sql: `INSERT INTO standing_duties (id, input) VALUES ('duty_y', '{"spec":"a.md","delivers":"reports"}');`,
    ids: ["duty_y"], key: "reports",
  },
  {
    name: "two duties in one statement do not share a tuple",
    sql: `INSERT INTO standing_duties (id, input) VALUES\n ('duty_a', json_object('delivers','one')),\n ('duty_b', json_object('delivers','two'));`,
    ids: ["duty_a", "duty_b"], key: "one",
  },
  {
    name: "a duty declaring nothing yields no key",
    sql: `INSERT INTO standing_duties (id, input) VALUES ('duty_z', '{}');`,
    ids: ["duty_z"], key: null,
  },
];

function selfTest() {
  let failed = 0;
  for (const f of FIXTURES) {
    const got = dutiesIn(f.sql);
    const ids = got.map((d) => d.id);
    if (JSON.stringify(ids) !== JSON.stringify(f.ids)) {
      console.error(`  ✗ ${f.name}: expected ids ${JSON.stringify(f.ids)}, got ${JSON.stringify(ids)}`);
      failed += 1;
      continue;
    }
    const key = deliversKey(got[0].text);
    if (key !== f.key) {
      console.error(`  ✗ ${f.name}: expected key ${JSON.stringify(f.key)}, got ${JSON.stringify(key)}`);
      failed += 1;
    }
  }

  // The handler splitter must not let one function's guard vouch for its neighbour's writer.
  const handlers = handlersIn(
    `export async function a(){ if (input.delivers !== "one") return null; await q("INSERT INTO one"); }\n` +
    `export async function b(){ if (input.delivers !== "two") return null; }`,
  );
  if (handlers.length !== 2 || handlers[1].body.includes("INTO one")) {
    console.error("  ✗ handler bodies bleed into each other");
    failed += 1;
  }

  // A local job's script name is read in both shapes.
  if (localJobScript(`json_object('local_job', 'kdp-watch.sh')`) !== "kdp-watch.sh") {
    console.error("  ✗ local_job script not parsed");
    failed += 1;
  }

  if (failed) {
    console.error(`\nSELF-TEST FAILED: ${failed} case(s)`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${FIXTURES.length + 2}/${FIXTURES.length + 2} cases.`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const { duties, problems } = scan();

/*
 * RULE 0. A scan that found no duties has not proved anything about this repo — it has proved that
 * the way duties are written changed and this file did not keep up. Exiting 0 there is exactly how
 * a validator becomes decoration.
 */
if (duties.length === 0) {
  console.error(
    "DUTY DELIVERY SCAN EXAMINED NO DUTIES. `standing_duties` inserts are no longer shaped the way\n" +
    "this scan reads them. That is a broken scan, not a clean repo.",
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error("DUTY DELIVERY SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(
    "A duty whose output has nowhere to land still fires, still costs her Claude Max capacity, and\n" +
    "still reports success. Give it a handler and a table, or a local job that is actually installed.",
  );
  process.exit(1);
}

const delivering = duties.filter((d) => deliversKey(d.text)).length;
const local = duties.filter((d) => localJobScript(d.text)).length;
console.log(
  `DUTY DELIVERY SCAN PASSED: ${duties.length} standing duties — ${delivering} deliver to a handled ` +
  `table, ${local} to an installed local job, and none into nothing.`,
);
selfTest();
