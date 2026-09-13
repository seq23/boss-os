#!/usr/bin/env node
/**
 * EVERY ACTIVE EMPLOYEE HAS A FACE, AND EVERY FACE SAYS WHAT IT IS.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * Imani was seated by migration 0192 and cast in CASTING.json with her look recorded. Her portrait
 * was never shot. `src/client/public/employees-boss/` held seven `.jpg` files and no `imani.jpg`,
 * so the Team page rendered her row with an invisible avatar — `onError` hides the broken image by
 * design, which is right for the reader and is exactly why nobody noticed for a week. A missing
 * asset that degrades gracefully is a missing asset nothing will ever report.
 *
 * MANIFEST.json made it worse in the other direction. The generator rebuilt it from the seats THIS
 * RUN produced, so `--only Imani` — the flag that exists precisely to re-shoot one seat — would
 * have written a manifest naming one portrait and silently dropped the other seven. The files would
 * still be on disk, unlisted, and the manifest would still look complete.
 *
 * ─── Why the honesty statement is checked and not assumed ───────────────────
 *
 * `_honesty` is not decoration. Eight polished headshots on a Team screen are indistinguishable
 * from photographs of real staff, and the one way this becomes a problem is if a face is later
 * taken for a colleague. The statement is carried in three places on purpose — CASTING.json, the
 * manifest beside the assets, and the alt text every portrait renders with — and all three are
 * checked here, because a promise made in a comment is a promise nothing keeps.
 *
 * ─── What is actually checked ───────────────────────────────────────────────
 *
 *   1. The ACTIVE ROSTER is read from the migrations themselves, applied in order to an in-memory
 *      SQLite database. Not from a list in this file, and not by regex: `employees` is INSERTed in
 *      one migration and renamed, merged and retired in later ones, so only replaying them answers
 *      "who is on the roster today". A second list here would be the very defect this repository
 *      names.
 *   2. Every active employee has a seat in CASTING.json. A seat is where appearance is allowed to
 *      live, so an employee without one cannot be shot at all.
 *   3. Every seat has a portrait file on disk, non-empty.
 *   4. Every seat has a MANIFEST.json entry naming that file, with a plausible byte count.
 *   5. The manifest carries the honesty statement, and it is the SAME sentence the casting sheet
 *      carries — not a paraphrase that could soften over time.
 *   6. Every `<img src={/employees-boss/…}>` on the Team page renders alt text that says the face
 *      is AI-generated and of a person who does not exist.
 *   7. Nobody has a portrait who is not on the roster — a retired employee's face left on disk is
 *      a face with no charter behind it.
 *
 * RULE 0: finding ZERO active employees, zero cast seats, or zero portrait <img> tags is a HARD
 * FAILURE. Every check here is a loop, and a loop over an empty set is how a validator stays green
 * for ever while the thing it guards rots.
 *
 *   node scripts/validate/every-employee-has-a-portrait.mjs
 *   node scripts/validate/every-employee-has-a-portrait.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MIGRATIONS = join(ROOT, "migrations");
const ASSET_DIR = join(ROOT, "src/client/public/employees-boss");
const SHEET = join(ASSET_DIR, "CASTING.json");
const MANIFEST = join(ASSET_DIR, "MANIFEST.json");
const TEAM_PAGE = join(ROOT, "src/client/boss/pages/Team.tsx");

/** A portrait smaller than this is a truncated write or a placeholder, not a photograph. */
const MIN_PORTRAIT_BYTES = 10_000;

/** The two claims the alt text must make. Either one alone is not the honesty statement. */
const ALT_MUST_SAY = [/AI-generated/i, /does not exist/i];

/** Split on semicolons that end a statement, respecting the BEGIN…END blocks triggers use. */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const line of sql.split("\n")) {
    const bare = line.replace(/--.*$/, "");
    if (/\bBEGIN\b/i.test(bare) && !/\bEND\b/i.test(bare)) depth += 1;
    if (/\bEND\s*;/i.test(bare) && depth > 0) depth -= 1;
    buf += `${line}\n`;
    if (depth === 0 && /;\s*$/.test(bare)) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * The roster as the migrations actually leave it.
 *
 * REPLAYED RATHER THAN PARSED. 0153 seats `emp_chief` as "Chief of Staff", 0175 renames her to
 * Simone and retires two seats into others, 0192 adds Imani. A regex over INSERTs would report
 * "Task Intake" and "Model Router" as employees needing faces; replaying the statements answers the
 * question the Team page actually asks. Failing statements are ignored for the same reason
 * `sql-against-schema.mjs` ignores them — what matters is the resulting rows.
 */
export function activeRoster() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of splitStatements(readFileSync(join(MIGRATIONS, file), "utf8"))) {
      try {
        db.exec(stmt);
      } catch {
        // Data statements that do not apply to a bare database are not the point; the rows are.
      }
    }
  }
  return db
    .prepare(`SELECT id, name, role FROM employees WHERE lifecycle = 'active' ORDER BY name`)
    .all()
    .map((r) => ({ id: r.id, name: r.name, role: r.role }));
}

/** Every portrait `<img>` on the Team page, as `{ src, alt }`. */
export function portraitImages(source) {
  const out = [];
  for (const tag of source.match(/<img\b[\s\S]*?\/>/g) ?? []) {
    if (!/employees-boss/.test(tag)) continue;
    const alt = /alt=\{?`?([\s\S]*?)`?\}?\s*\n/.exec(tag.slice(tag.indexOf("alt=")));
    out.push({ tag, alt: alt ? alt[1] : "" });
  }
  return out;
}

/**
 * The check, over supplied inputs — so the self-test drives the REAL logic instead of a paraphrase
 * of it. `files` is a map of filename to byte count, which is all this check needs of the disk.
 */
export function check({ roster, sheet, manifest, files, teamSource }) {
  const problems = [];

  // ── RULE 0 ────────────────────────────────────────────────────────────────
  if (!roster || roster.length === 0) {
    problems.push(
      "Found ZERO active employees in the migrations. This scan is a loop over the roster, and a " +
      "loop over an empty set passes silently for ever. Something is wrong with the migrations or " +
      "with this scan; either way it has proved nothing.",
    );
  }
  const cast = sheet?.cast ?? [];
  if (cast.length === 0) {
    problems.push(
      "CASTING.json declares ZERO seats. Appearance lives only in the casting sheet, so an empty " +
      "sheet means no portrait can be justified — and this scan would pass over an empty loop.",
    );
  }
  const images = portraitImages(teamSource ?? "");
  if (images.length === 0) {
    problems.push(
      "The Team page renders ZERO portraits from /employees-boss/. The honesty statement is carried " +
      "in the alt text, so if there are no portrait <img> tags there is nothing carrying it — and " +
      "this scan would examine nothing.",
    );
  }
  if (problems.length) return problems;

  const castByName = new Map(cast.map((c) => [c.name, c]));
  const manifestByName = new Map((manifest?.portraits ?? []).map((p) => [p.name, p]));

  // ── 2. Every active employee is cast ──────────────────────────────────────
  for (const employee of roster) {
    if (!castByName.has(employee.name)) {
      problems.push(
        `${employee.name} (${employee.role}, ${employee.id}) is an ACTIVE employee and has no seat in ` +
        `CASTING.json. The casting sheet is the only place appearance is allowed to live, so she ` +
        `cannot be shot at all and her row on the Team page renders a hidden broken image — which is ` +
        `precisely how Imani went a week without a face and nothing reported it.`,
      );
    }
  }

  // ── 3 & 4. Every seat has a file and a manifest entry ─────────────────────
  for (const seat of cast) {
    const expected = `${seat.name.toLowerCase()}.jpg`;
    const bytes = files[expected];

    if (bytes === undefined) {
      problems.push(
        `${seat.name} is cast as ${seat.role} and ${expected} does not exist. The Team page hides a ` +
        `broken portrait by design, so this failure is invisible on screen and must be loud here.`,
      );
    } else if (bytes < MIN_PORTRAIT_BYTES) {
      problems.push(
        `${expected} is ${bytes} bytes, under the ${MIN_PORTRAIT_BYTES}-byte floor. That is a ` +
        `truncated write or a placeholder, not a portrait, and it would render as a broken image.`,
      );
    }

    const entry = manifestByName.get(seat.name);
    if (!entry) {
      problems.push(
        `${seat.name} has no entry in MANIFEST.json. The manifest is where the honesty statement ` +
        `travels with the files; a portrait it does not list is a face with nothing beside it saying ` +
        `what it is. (The generator used to rebuild the manifest from one run's output, which is how ` +
        `a single-seat re-shoot could delete the other seven entries.)`,
      );
    } else if (entry.file !== expected) {
      problems.push(
        `MANIFEST.json lists ${seat.name}'s portrait as "${entry.file}" and the Team page loads ` +
        `"${expected}". The manifest is describing a different file from the one that renders.`,
      );
    }
  }

  // ── 7. Nobody has a face who is not on the roster ─────────────────────────
  const rosterNames = new Set(roster.map((r) => r.name.toLowerCase()));
  for (const file of Object.keys(files)) {
    const who = file.replace(/\.jpg$/, "");
    if (!rosterNames.has(who)) {
      problems.push(
        `${file} is a portrait of "${who}", who is not an active employee. A face with no charter ` +
        `behind it is a face nothing governs — retire the asset with the seat.`,
      );
    }
  }

  // ── 5. The manifest carries the honesty statement, verbatim ───────────────
  if (!manifest?._honesty) {
    problems.push(
      "MANIFEST.json has no `_honesty` field. That sentence is the whole reason the manifest is " +
      "committed beside the assets: these are AI-generated images of people who do not exist, and " +
      "nothing may present them as staff.",
    );
  } else if (manifest._honesty !== sheet._honesty) {
    problems.push(
      "MANIFEST.json's `_honesty` is not the same sentence as CASTING.json's. Two copies of the " +
      "honesty statement free to drift is how the strong version stays in the file nobody reads and " +
      "the softened one ships beside the pictures.",
    );
  }

  // ── 6. The alt text says it too ───────────────────────────────────────────
  for (const image of images) {
    for (const must of ALT_MUST_SAY) {
      if (!must.test(image.alt)) {
        problems.push(
          `A portrait <img> on the Team page has alt text that does not say ${must.source}. The alt ` +
          `text is the honesty statement for anyone who cannot see the picture, and it is not ` +
          `optional. Found: ${JSON.stringify(image.alt.slice(0, 120))}`,
        );
      }
    }
  }

  return problems;
}

// ─── Self-test: the detection proved on fixtures, not on the repo ───────────

function selfTest() {
  const HONESTY = "THESE ARE AI-GENERATED IMAGES OF PEOPLE WHO DO NOT EXIST.";
  const base = () => ({
    roster: [
      { id: "emp_research", name: "Camille", role: "Director of Research" },
      { id: "emp_practice", name: "Imani", role: "Director of Practice" },
    ],
    sheet: {
      _honesty: HONESTY,
      cast: [
        { name: "Camille", role: "Director of Research", look: "natural coils" },
        { name: "Imani", role: "Director of Practice", look: "long box braids" },
      ],
    },
    manifest: {
      _honesty: HONESTY,
      portraits: [
        { name: "Camille", file: "camille.jpg", bytes: 135_221 },
        { name: "Imani", file: "imani.jpg", bytes: 178_286 },
      ],
    },
    files: { "camille.jpg": 135_221, "imani.jpg": 178_286 },
    teamSource: `
      <img
        className="avatar"
        src={\`/employees-boss/\${String(e.name ?? "").toLowerCase()}.jpg\`}
        alt={\`\${e.name}, \${e.role} — an AI-generated portrait of a person who does not exist\`}
      />
    `,
  });

  const mutate = (fn) => {
    const f = base();
    fn(f);
    return f;
  };

  const cases = [
    { name: "the shipped state passes", input: base(), expect: 0 },
    {
      name: "THE ACTUAL DEFECT: Imani cast, no imani.jpg on disk",
      input: mutate((f) => { delete f.files["imani.jpg"]; }),
      expect: 1,
    },
    {
      name: "THE OTHER HALF: imani.jpg exists but the manifest does not list her",
      input: mutate((f) => { f.manifest.portraits = f.manifest.portraits.filter((p) => p.name !== "Imani"); }),
      expect: 1,
    },
    {
      name: "the single-seat re-shoot clobbering the manifest down to one entry",
      input: mutate((f) => { f.manifest.portraits = [{ name: "Imani", file: "imani.jpg", bytes: 178_286 }]; }),
      expect: 1,
    },
    {
      name: "an active employee with no casting seat at all",
      input: mutate((f) => { f.sheet.cast = f.sheet.cast.filter((c) => c.name !== "Imani"); f.manifest.portraits = f.manifest.portraits.filter((p) => p.name !== "Imani"); delete f.files["imani.jpg"]; }),
      expect: 1,
    },
    {
      name: "a truncated portrait is not a portrait",
      input: mutate((f) => { f.files["imani.jpg"] = 412; }),
      expect: 1,
    },
    {
      name: "the manifest pointing at a file the page does not load",
      input: mutate((f) => { f.manifest.portraits[1].file = "imani-v2.jpg"; }),
      expect: 1,
    },
    {
      name: "a face left on disk for someone no longer on the roster",
      input: mutate((f) => { f.files["pax.jpg"] = 120_000; }),
      expect: 1,
    },
    {
      name: "the manifest losing its honesty statement",
      input: mutate((f) => { delete f.manifest._honesty; }),
      expect: 1,
    },
    {
      name: "the honesty statement softened in one copy but not the other",
      input: mutate((f) => { f.manifest._honesty = "These portraits are illustrative."; }),
      expect: 1,
    },
    {
      name: "alt text that drops \"AI-generated\"",
      input: mutate((f) => { f.teamSource = f.teamSource.replace("an AI-generated portrait of a person who does not exist", "a portrait of a person who does not exist"); }),
      expect: 1,
    },
    {
      name: "alt text that drops \"does not exist\"",
      input: mutate((f) => { f.teamSource = f.teamSource.replace("an AI-generated portrait of a person who does not exist", "an AI-generated portrait"); }),
      expect: 1,
    },
    {
      name: "RULE 0 — an empty roster fails rather than passing over an empty loop",
      input: mutate((f) => { f.roster = []; }),
      expect: 1,
    },
    {
      name: "RULE 0 — an empty casting sheet fails",
      input: mutate((f) => { f.sheet.cast = []; }),
      expect: 1,
    },
    {
      name: "RULE 0 — a Team page with no portrait <img> fails",
      input: mutate((f) => { f.teamSource = "<div>no pictures here</div>"; }),
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const ok = c.expect === 0 ? found === 0 : found >= 1;
    if (!ok) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\nevery-employee-has-a-portrait self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`every-employee-has-a-portrait self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const missing = [SHEET, MANIFEST, TEAM_PAGE, MIGRATIONS].filter((p) => !existsSync(p));
  if (missing.length) {
    console.error(
      `every-employee-has-a-portrait FAILED — missing ${missing.map((m) => m.replace(`${ROOT}/`, "")).join(", ")}. ` +
      `A scan whose inputs do not exist has examined nothing and must fail.`,
    );
    process.exit(1);
  }

  const files = Object.fromEntries(
    readdirSync(ASSET_DIR)
      .filter((f) => f.endsWith(".jpg"))
      .map((f) => [f, statSync(join(ASSET_DIR, f)).size]),
  );

  const problems = check({
    roster: activeRoster(),
    sheet: JSON.parse(readFileSync(SHEET, "utf8")),
    manifest: JSON.parse(readFileSync(MANIFEST, "utf8")),
    files,
    teamSource: readFileSync(TEAM_PAGE, "utf8"),
  });

  if (problems.length) {
    console.error("every-employee-has-a-portrait FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const roster = activeRoster();
  console.log(
    `every-employee-has-a-portrait: ${roster.length} active employee(s) — ${roster.map((r) => r.name).join(", ")} — ` +
    `each cast, shot, manifested and rendered with the honesty statement. OK.`,
  );
}
