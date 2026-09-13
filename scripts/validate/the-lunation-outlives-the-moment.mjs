#!/usr/bin/env node
/**
 * THE SPIRIT PAGE NAMES THE LUNATION SHE IS INSIDE, NOT ONLY THE ONE THAT IS ABOUT TO ARRIVE.
 *
 * ─── The defect, in her words ──────────────────────────────────────────────
 *
 *   "spirit page is now passed the new moon in virgo but u should so the last major lunation so
 *    evn tho its sept 13 i should still be able to see the new moon in virgo section for 2 weeks
 *    until the next major lunation"
 *
 * MEASURED ON PRODUCTION, 13 Sep 2026: `major_event` was null and the page read "No major event in
 * the next two days" — while she was two days into the cycle the Virgo new moon opened on the 11th.
 * `major_event` looks forward forty-eight hours and six hours back, so the page forgot the event the
 * instant it passed.
 *
 * THE FIX IS NOT A WIDER HORIZON, AND THIS GUARD EXISTS TO STOP SOMEONE APPLYING ONE. A new moon is
 * not a notification that expires; it OPENS A CYCLE that runs until the next major lunation closes
 * it. Widening `major_event` to 14 days would make the page technically say Virgo on the 13th and
 * would be wrong in every way that matters: it would drift against a 29.53-day synodic month, it
 * would call a past event "upcoming", and it would still go dark for the last day of a long cycle.
 *
 * ─── What is actually checked ───────────────────────────────────────────────
 *
 *   1. `currentLunation` EXISTS AND IS COMPUTED. No database read, no fetch — it takes an instant
 *      and returns an answer. The almanac table is the right source for a calendar and the wrong
 *      source for this, because a lapse in its coverage would empty the section, and an empty
 *      "what cycle am I in" is indistinguishable from the bug being fixed.
 *   2. IT CANNOT RETURN NULL. There is always a lunation in progress. A signature or a body that
 *      admits null is the defect returning in a new shape.
 *   3. It searches BOTH new and full moons. A new moon is closed by a full moon; counting only new
 *      moons would give a 29-day window and call the waning half by the waxing half's name.
 *   4. The BOUNDARY IS COMPUTED, never a constant fortnight. No `14 * DAY`, no `TWO_WEEKS`.
 *   5. The payload carries it, and the PAGE RENDERS IT — including in the branch where
 *      `major_event` is null, which is the exact slot that used to read "No major event".
 *   6. THE DISCLAIMER SURVIVES. "Advisory only — context, never a cause and never a permission" is
 *      a standing editorial position on this page and a new panel must not quietly drop it.
 *   7. THE PRECISION RULES SURVIVE: degrees AND arcminutes, per the ephemeris rule this page
 *      already holds — "19.7° and 19°45′ are the same number and only one is an ephemeris".
 *
 * RULE 0: a missing function, a missing payload field, or a page that renders neither is a HARD
 * FAILURE. There is no loop here that could pass over an empty set, and no absent subject that
 * should read as success.
 *
 *   node scripts/validate/the-lunation-outlives-the-moment.mjs
 *   node scripts/validate/the-lunation-outlives-the-moment.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ASTRO = "src/worker/boss/spirit/astro.ts";
const DAY = "src/worker/boss/spirit/day.ts";
const PAGE = "src/client/boss/pages/Spirit.tsx";

/** A fixed-length window standing in for "until the next lunation". */
const FIXED_WINDOW = [
  /\b14\s*\*\s*DAY(_MS)?\b/,
  /\bTWO_WEEKS\b/,
  /\bFORTNIGHT\b/i,
  /\b1_209_600_000\b/,
  /\b1209600000\b/,
];

export function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start === -1) return null;
  let i = source.indexOf("(", start);
  let parens = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === "(") parens += 1;
    else if (source[i] === ")") { parens -= 1; if (parens === 0) break; }
  }
  if (i >= source.length) return null;
  // The body brace is the first at angle-depth zero: a `Promise<{ … }>` return type has braces too.
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
    else if (source[j] === "}") { depth -= 1; if (depth === 0) return source.slice(start, j + 1); }
  }
  return null;
}

/** The signature only, which is where a `| null` would be declared. */
export function signature(source, name) {
  const start = source.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start === -1) return null;
  const brace = source.indexOf("{", source.indexOf(")", start));
  return brace === -1 ? null : source.slice(start, brace);
}

export function check({ astro, day, page }) {
  const problems = [];
  const strip = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const astroCode = strip(astro);
  const dayCode = strip(day);
  const pageCode = strip(page);

  // ── 1 and RULE 0 ──────────────────────────────────────────────────────────
  const body = functionBody(astroCode, "currentLunation");
  if (!body) {
    problems.push(
      `${ASTRO} exports no \`currentLunation\`. Without it the page can only know about an event ` +
      `inside the next 48 hours, which is the defect: on 13 September it read "No major event in ` +
      `the next two days" while she was inside the Virgo new moon's cycle.`,
    );
    return problems;
  }

  if (/\bdb\b|\.prepare\(|SELECT |await fetch\(|astro_calendar/.test(body)) {
    problems.push(
      `\`currentLunation\` reads from a database or the network. It must be COMPUTED from the same ` +
      `Meeus series the almanac is built from: a lapse in \`astro_calendar\` coverage would empty ` +
      `this section, and an empty "what cycle am I in" is indistinguishable from the bug being fixed.`,
    );
  }

  // ── 2. It cannot be null ──────────────────────────────────────────────────
  const sig = signature(astroCode, "currentLunation") ?? "";
  if (/\|\s*null/.test(sig) || /return null/.test(body)) {
    problems.push(
      `\`currentLunation\` can return null. There is ALWAYS a lunation in progress — that is the whole ` +
      `point of the change — so a nullable answer is the old behaviour wearing a new name, and the ` +
      `screen would go blank again on exactly the days she complained about.`,
    );
  }

  // ── 3. Both kinds of major ────────────────────────────────────────────────
  if (!/"new"/.test(body) || !/"full"/.test(body)) {
    problems.push(
      `\`currentLunation\` does not search both new AND full moons. A new moon is closed by a full ` +
      `moon: counting only new moons gives a 29-day window and calls the waning half of the month by ` +
      `the waxing half's name.`,
    );
  }

  // ── 4. The boundary is computed ───────────────────────────────────────────
  for (const fixed of FIXED_WINDOW) {
    if (fixed.test(body)) {
      problems.push(
        `\`currentLunation\` uses a fixed window (${fixed.source}). Her words were "until the next ` +
        `major lunation", not "for two weeks" — and a fixed fortnight drifts against a 29.53-day ` +
        `synodic month and is wrong by a day every couple of cycles.`,
      );
    }
  }

  // ── 5. It reaches the payload and the page ────────────────────────────────
  if (!/current_lunation/.test(dayCode)) {
    problems.push(`${DAY} does not put \`current_lunation\` in the Spirit payload, so the page cannot render it.`);
  }
  if (!/currentLunation\(/.test(dayCode)) {
    problems.push(`${DAY} never calls \`currentLunation\`. A function nothing invokes is this repository's named defect.`);
  }
  if (!/current_lunation/.test(pageCode)) {
    problems.push(
      `${PAGE} never reads \`current_lunation\`. The payload would carry the answer and the screen ` +
      `would still say "No major event" — the data was never the problem the first time either.`,
    );
  }
  /*
   * THE SLOT THAT USED TO BE WRONG. The old copy is the marker: if that sentence is still the
   * fallback when `major_event` is null, nothing has actually changed for her.
   */
  /*
   * COMMENT-STRIPPED, and the first run of this scan is why it has to be said. `Spirit.tsx` now
   * carries a paragraph explaining that this slot USED TO READ "No major event in the next two
   * days" and why that was wrong — the most useful thing in the block — and an unstripped match read
   * that explanation as the defect it describes. A validator confused by its own record teaches
   * people to delete the record.
   */
  if (/No major event in the next two days/.test(pageCode)) {
    problems.push(
      `${PAGE} still renders "No major event in the next two days". That is the exact sentence she ` +
      `was reading on 13 September while inside the Virgo lunation. The slot must name the cycle she ` +
      `is in, which is never nothing.`,
    );
  }
  if (!/lunation\.current\.label|lunation\.current\b/.test(pageCode)) {
    problems.push(`${PAGE} does not render the current lunation's label, so the cycle is not actually named on screen.`);
  }
  if (!/lunation\.next\b/.test(pageCode)) {
    problems.push(
      `${PAGE} does not show when the next lunation is. "Ten days in" means nothing without "four to ` +
      `go" — she asked for the window, and a window has two ends.`,
    );
  }

  // ── 6. The disclaimer ─────────────────────────────────────────────────────
  const panels = (page.match(/never a cause and never a permission/g) ?? []).length;
  if (panels < 2) {
    problems.push(
      `${PAGE} carries the advisory disclaimer ${panels} time(s). Both the event panel and the ` +
      `lunation panel must carry it: it is a standing editorial position, and a new panel that ` +
      `quietly drops it has made a claim the page does not make anywhere else.`,
    );
  }

  // ── 7. Precision ──────────────────────────────────────────────────────────
  if (!/′/.test(page)) {
    problems.push(
      `${PAGE} no longer renders arcminutes. This page's own rule: "19.7° and 19°45′ are the same ` +
      `number and only one is an ephemeris."`,
    );
  }
  if (/degrees_in_sign\.toFixed\(1\)/.test(pageCode)) {
    problems.push(
      `${PAGE} renders a position to one decimal place. That is the precision this page already ` +
      `rejected for the ephemeris, and the lunation is the same kind of claim.`,
    );
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const goodAstro = `
export function currentLunation(ts: number): CurrentLunation {
  const k0 = lunationNumber(ts);
  const moments = [];
  for (let k = k0 - 5; k <= k0 + 5; k += 1) {
    moments.push(lunationMoment(phaseTime(k, "new"), "new_moon"));
    moments.push(lunationMoment(phaseTime(k + 0.5, "full"), "full_moon"));
  }
  moments.sort((a, b) => a.at - b.at);
  let current = moments[0];
  for (const m of moments) { if (m.at <= ts) current = m; else break; }
  const next = moments.find((m) => m.at > ts) ?? current;
  return { current, next, fraction: (ts - current.at) / (next.at - current.at) };
}
`;
  const goodDay = `
  const signal = {
    major_event: majorEvent,
    current_lunation: currentLunation(now),
  };
`;
  const goodPage = `
  const lunation = signal.current_lunation ?? null;
  const deg = (d) => Math.floor(d) + "°" + String(Math.round((d - Math.floor(d)) * 60)).padStart(2, "0") + "′";
  return major ? (
    <div>{major.label}
      <div className="row-sub">Advisory only — context, never a cause and never a permission.</div>
    </div>
  ) : lunation ? (
    <div>
      <div>{lunation.current.label}</div>
      <div>{deg(lunation.current.degrees_in_sign)} {lunation.current.sign}</div>
      <div>It runs until the {lunation.next.label}.</div>
      <div className="row-sub">Advisory only — context, never a cause and never a permission.</div>
    </div>
  ) : (
    <div>The sky could not be read</div>
  );
`;
  const G = { astro: goodAstro, day: goodDay, page: goodPage };
  const with_ = (over) => ({ ...G, ...over });

  const cases = [
    { name: "the shipped shape passes", input: G, expect: 0 },
    {
      name: "RULE 0 — currentLunation missing entirely",
      input: with_({ astro: "export function somethingElse(ts) { return 1; }" }),
      expect: 1,
    },
    {
      name: "THE WRONG FIX: a fixed fortnight instead of the next lunation",
      input: with_({ astro: goodAstro.replace("const next = moments.find((m) => m.at > ts) ?? current;", "const next = { at: current.at + 14 * DAY_MS };") }),
      expect: 1,
    },
    {
      name: "a nullable answer, which is the old behaviour renamed",
      input: with_({ astro: goodAstro.replace("): CurrentLunation {", "): CurrentLunation | null {") }),
      expect: 1,
    },
    {
      name: "a body that can return null",
      input: with_({ astro: goodAstro.replace("  const k0 = lunationNumber(ts);", "  if (!ts) return null;\n  const k0 = lunationNumber(ts);") }),
      expect: 1,
    },
    {
      name: "reading the almanac table instead of computing",
      input: with_({ astro: goodAstro.replace("const k0 = lunationNumber(ts);", "const rows = await db.prepare('SELECT kind FROM astro_calendar').all();") }),
      expect: 1,
    },
    {
      name: "only new moons searched, so the waning half wears the wrong name",
      input: with_({ astro: goodAstro.replace('    moments.push(lunationMoment(phaseTime(k + 0.5, "full"), "full_moon"));\n', "") }),
      expect: 1,
    },
    {
      name: "the payload never carries it",
      input: with_({ day: "  const signal = { major_event: majorEvent };" }),
      expect: 1,
    },
    {
      name: "THE ORIGINAL SENTENCE still on the page",
      input: with_({ page: goodPage.replace("<div>The sky could not be read</div>", "<div>No major event in the next two days</div>") }),
      expect: 1,
    },
    {
      name: "the page ignoring the field the payload carries",
      input: with_({ page: "  return <div>{major.label}</div>;" }),
      expect: 1,
    },
    {
      name: "no second end of the window",
      input: with_({ page: goodPage.replace("      <div>It runs until the {lunation.next.label}.</div>\n", "") }),
      expect: 1,
    },
    {
      name: "the new panel quietly dropping the disclaimer",
      input: with_({ page: goodPage.replace(
        '      <div>It runs until the {lunation.next.label}.</div>\n      <div className="row-sub">Advisory only — context, never a cause and never a permission.</div>\n',
        "      <div>It runs until the {lunation.next.label}.</div>\n",
      ) }),
      expect: 1,
    },
    {
      name: "precision dropped to one decimal place",
      input: with_({ page: goodPage.replace("{deg(lunation.current.degrees_in_sign)}", "{lunation.current.degrees_in_sign.toFixed(1)}°").replace(' + "′"', "") }),
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
    console.error(`\nthe-lunation-outlives-the-moment self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`the-lunation-outlives-the-moment self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const missing = [ASTRO, DAY, PAGE].filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`the-lunation-outlives-the-moment FAILED — missing ${missing.join(", ")}.`);
    process.exit(1);
  }

  const problems = check({
    astro: readFileSync(join(ROOT, ASTRO), "utf8"),
    day: readFileSync(join(ROOT, DAY), "utf8"),
    page: readFileSync(join(ROOT, PAGE), "utf8"),
  });

  if (problems.length) {
    console.error("the-lunation-outlives-the-moment FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    "the-lunation-outlives-the-moment: the current lunation is computed, cannot be null, searches " +
    "new and full moons, is bounded by the next one rather than a fortnight, and is rendered with " +
    "both ends of the window, the disclaimer and arcminutes. OK.",
  );
}
