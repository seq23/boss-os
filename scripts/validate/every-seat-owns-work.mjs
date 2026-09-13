#!/usr/bin/env node
/**
 * EVERY SEAT ON THE ROSTER OWNS WORK, AND NO SEAT CARRIES THE REST OF THEM.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "we dont need to retire them we might find work for them later"
 *   "and u should find something for those 2 (toni and zora) to do"
 *
 * Toni and Zora were AMBER on the employee roster, and the sentence under each was exactly right:
 * "holds no standing duty, so nothing here can say whether they work." An employee with no duty can
 * never be anything but amber — there is nothing to judge them on, for ever — and the honest fix is
 * work, not a colour.
 *
 * ─── The two rules, and why each is a rule ─────────────────────────────────
 *
 *   1. EVERY ACTIVE SEAT OWNS AT LEAST ONE STANDING DUTY. Otherwise the health dot is permanently
 *      undecidable for that seat, and a roster where two of eight can never go green is a roster
 *      that has stopped meaning anything.
 *
 *   2. NO SEAT OWNS MORE THAN HALF THE DUTIES. Monique held EIGHT of seventeen against Danielle's
 *      four and Camille's two, and one of the eight — reconciling a spreadsheet against the reply
 *      record — was not relationship work at all. Concentration like that is how work ends up on
 *      whoever was nearest rather than whoever the charter names, and it is invisible until someone
 *      counts. The ceiling is a smell test, not a quota: it fires only when one seat holds more than
 *      everyone else combined.
 *
 * ─── How ownership is read ─────────────────────────────────────────────────
 *
 * By REPLAYING the migrations in order — the `INSERT` that creates a duty and any later `UPDATE`
 * that re-owns it — so the answer is the one the database will actually hold rather than a list
 * maintained beside it. A second list of "who owns what" is this repository's most-produced defect,
 * and it would be an especially poor one here because the whole finding was that a seat's work had
 * drifted away from its charter.
 *
 * RULE 0: replaying zero duties, or finding zero seats, is a HARD FAILURE — a rule about "every
 * seat" over an empty roster is satisfied by nothing at all.
 *
 *   node scripts/validate/every-seat-owns-work.mjs
 *   node scripts/validate/every-seat-owns-work.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MIGRATIONS = "migrations";
/* Seats are seeded across several migrations, so the whole directory is read. */

/**
 * Duties that are deliberately not owned by a live seat, each named with its reason.
 *
 * KEPT SHORT AND EACH ONE JUSTIFIED. A long list here turns this scan into decoration, which is the
 * failure mode every allowlist in this repository is warned about.
 */
export const NOT_A_LIVE_SEAT = new Set(["emp_intake", "emp_router"]);

/** The final owner of each duty, by replaying every migration in order. */
export function ownershipFrom(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const owner = new Map();

  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

    // The seed: ('duty_x', 'Some name', 'emp_y', …)
    for (const m of sql.matchAll(/'(duty_[a-z0-9_]+)'\s*,\s*'[^']*'\s*,\s*'(emp_[a-z0-9_]+)'/g)) {
      owner.set(m[1], m[2]);
    }
    // A later re-owning: UPDATE standing_duties SET employee_id = 'emp_y' … WHERE id = 'duty_x'
    for (const m of sql.matchAll(
      /UPDATE standing_duties[\s\S]{0,400}?employee_id\s*=\s*'(emp_[a-z0-9_]+)'[\s\S]{0,300}?WHERE id\s*=\s*'(duty_[a-z0-9_]+)'/g,
    )) {
      owner.set(m[2], m[1]);
    }
  }
  return owner;
}

/**
 * The seats on the roster, read from the migration that creates them.
 *
 * NOT `CASTING.json`, and that is deliberate rather than convenient: the casting sheet carries a
 * name, a role and a LOOK, with no employee id in it at all — because appearance lives there and
 * identity does not. Its own header says so. The seats are created by `INSERT INTO employees`, so
 * that is where they are read from, and the ownership map is replayed out of the same directory.
 */
export function seatsFrom(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const seats = new Set();
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const block of sql.matchAll(/INSERT(?: OR IGNORE)? INTO employees[\s\S]*?;/g)) {
      for (const m of block[0].matchAll(/'(emp_[a-z0-9_]+)'/g)) seats.add(m[1]);
    }
    /*
     * A SEAT RETIRED LATER IS NO LONGER A SEAT. `emp_intake` and `emp_router` were retired by an
     * UPDATE rather than a delete — correctly, because the record of what they did survives — so
     * replaying the retirement is what keeps this list the live roster rather than every row that
     * ever existed.
     */
    for (const m of sql.matchAll(/UPDATE employees[\s\S]{0,300}?status\s*=\s*'retired'[\s\S]{0,200}?WHERE id\s*=\s*'(emp_[a-z0-9_]+)'/g)) {
      seats.delete(m[1]);
    }
  }
  return [...seats];
}

export function check({ owner, seats }) {
  const problems = [];
  const live = seats.filter((s) => !NOT_A_LIVE_SEAT.has(s));

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (owner.size === 0) {
    problems.push(`Replaying the migrations produced no duty ownership at all, so "every seat owns work" was checked against nothing.`);
    return problems;
  }
  if (live.length === 0) {
    problems.push(`No seats were found on the roster, so this scan has no one to check.`);
    return problems;
  }

  const counts = new Map(live.map((s) => [s, 0]));
  for (const [duty, emp] of owner) {
    if (NOT_A_LIVE_SEAT.has(emp)) continue;
    if (!counts.has(emp)) {
      problems.push(`\`${duty}\` is owned by \`${emp}\`, who is not a seat on the roster. Work owned by nobody is work nobody does.`);
      continue;
    }
    counts.set(emp, counts.get(emp) + 1);
  }

  // ── 1. Every seat owns something ─────────────────────────────────────────
  for (const [seat, n] of counts) {
    if (n === 0) {
      problems.push(
        `\`${seat}\` owns no standing duty. Their health dot can then never be anything but amber — ` +
        `"nothing here can say whether they work" — for ever. That is the state Toni and Zora were ` +
        `in, and she was explicit that retiring them is not the answer.`,
      );
    }
  }

  // ── 2. Nobody carries the rest of the roster ─────────────────────────────
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  for (const [seat, n] of counts) {
    if (total > 0 && n > total / 2) {
      problems.push(
        `\`${seat}\` owns ${n} of ${total} standing duties — more than everyone else combined. Monique ` +
        `held eight of seventeen and one of them was reconciling a spreadsheet, which is not ` +
        `relationship work at all. Concentration like that is how work lands on whoever was nearest ` +
        `rather than on the charter that names it, and it is invisible until someone counts.`,
      );
    }
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const owner = ownershipFrom(join(ROOT, MIGRATIONS));
  const seats = seatsFrom(join(ROOT, MIGRATIONS));
  const good = { owner, seats };
  const without = (dutyId) => {
    const m = new Map(owner);
    m.delete(dutyId);
    return m;
  };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE ACTUAL DEFECT: Toni left with no duty",
      input: { ...good, owner: without("duty_credentials") },
      expect: 1,
    },
    {
      name: "Zora left with no duty",
      input: { ...good, owner: without("duty_scooter_sheet") },
      expect: 1,
    },
    {
      name: "one seat carrying more than everyone else combined",
      input: {
        ...good,
        owner: new Map([...owner].map(([d, e]) => [d, e === "emp_intake" || e === "emp_router" ? e : "emp_relationship"])),
      },
      expect: 1,
    },
    {
      name: "a duty owned by someone who is not on the roster",
      input: { ...good, owner: new Map([...owner, ["duty_ghost", "emp_nobody"]]) },
      expect: 1,
    },
    { name: "RULE 0 — no ownership replayed", input: { ...good, owner: new Map() }, expect: 1 },
    { name: "RULE 0 — no seats on the roster", input: { ...good, seats: [] }, expect: 1 },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const okCase = c.expect === 0 ? found === 0 : found >= 1;
    if (!okCase) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\nevery-seat-owns-work self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`every-seat-owns-work self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (!existsSync(join(ROOT, MIGRATIONS))) {
  console.error(`every-seat-owns-work FAILED — ${MIGRATIONS} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const owner = ownershipFrom(join(ROOT, MIGRATIONS));
  const seats = seatsFrom(join(ROOT, MIGRATIONS));
  const problems = check({ owner, seats });

  if (problems.length) {
    console.error("every-seat-owns-work FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const live = seats.filter((s) => !NOT_A_LIVE_SEAT.has(s));
  const counts = live.map((s) => `${s.replace("emp_", "")}:${[...owner.values()].filter((e) => e === s).length}`);
  console.log(`every-seat-owns-work: all ${live.length} seats own work (${counts.join(" ")}), nobody carries the rest. OK.`);
}
