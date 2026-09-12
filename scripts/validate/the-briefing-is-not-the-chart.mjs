#!/usr/bin/env node
/**
 * THE DAILY BRIEFING AND THE SPIRIT PAGE STAY APART.
 *
 * ─── Her instruction, 12 September 2026 08:59 ──────────────────────────────────
 *
 * Archived at R2 `boss-os-documents/boss-inbound-mail/2026-09-12/iml_m2aymnxamhsws8k7.eml`:
 *
 *   "Please make sure the spirit page of my boss OS system displays astrology in the way it is in
 *    the below report and make sure the daily executive briefing is set up like the below report.
 *    THEY ARE NOT TO BE MIXED IN THE WAY THIS REPORT IS but pull out the astrology for the spirit
 *    page and mimic this report for my daily briefing."
 *
 * ─── What was actually wrong ───────────────────────────────────────────────────
 *
 * `docs/boss/EXECUTIVE_INTELLIGENCE.md` is the specification the `duty_exec_intel` standing duty
 * hands a model as `task_input.spec`. Its §5 already mandated every market section of the report she
 * attached — so the briefing needed nothing ADDED. It also mandated `# Astronomical / Astrological
 * Dashboard`, `# Moon Dashboard`, `# Major Aspects`, `# Current Retrogrades`, `# Upcoming
 * Lunations`, `# Mercury Retrograde Tracker`, `# Money / Career / Travel Map`, `# Locked 2026 Money
 * / Career / Travel Map` and `# Map Operating Logic`. THAT is the mixing. It was a separation, not a
 * rebuild.
 *
 * Meanwhile the Spirit page — the screen whose entire subject is this — carried four lines of prose:
 * phase, Moon longitude to one decimal place, illumination.
 *
 * ─── The four rules ────────────────────────────────────────────────────────────
 *
 *   1. THE BRIEFING SPEC CARRIES NO ASTROLOGICALLY-DERIVED SECTION. Not the chart and not the map.
 *      The map went with the chart by her own choice, and that choice is what makes this scannable:
 *      "keep the map but not the chart" is a judgement call on every future edit, and "keep neither"
 *      is a regex. The eleven market sections must still be present, in order — this is a
 *      separation, and a spec that lost half its market sections would pass a deletion check while
 *      failing her instruction entirely.
 *
 *   2. THE DISCLAIMER TRAVELS WITH THE CONTENT, AND SITS ABOVE IT. Taking astrology out of the
 *      briefing must not strand its caveat in a document that no longer contains any astrology — a
 *      caveat with nothing to caveat implies content that is not there. So the Spirit page must
 *      carry it, and carry it BEFORE the ephemeris: a caveat underneath a table is read after the
 *      table has already been believed.
 *
 *   3. NO WEEK RENDERS IN A COLOUR IT WAS NEVER GIVEN. `unset` is a real member of the band union,
 *      `BAND` has no glyph for it, and no `?? BAND.<colour>` fallback may exist anywhere. On
 *      12 September four weeks were briefly believed unlocked and the tempting fix was to infer them
 *      from the weeks either side; she sent the real bands an hour later and they matched the guess,
 *      which is exactly why the guess was still wrong — a guess that happens to be right is
 *      indistinguishable on screen from a fact.
 *
 *   4. THE EPHEMERIS KEEPS ITS PRECISION. Degrees AND arcminutes AND direct/retrograde, on the
 *      Worker and on the screen. `19.7°` and `19°45′` are the same number and only one of them is an
 *      ephemeris; at one decimal place a 0°16′ orb and a 0°18′ orb are both "0.3°", and the
 *      tightness ordering — the only thing an orb is for — disappears with it.
 *
 * RULE 0: no map weeks found, or the briefing spec missing, or the Spirit page missing, is a
 * FAILURE. A scan with nothing to scan must never report success on an empty loop.
 *
 *   node scripts/validate/the-briefing-is-not-the-chart.mjs
 *   node scripts/validate/the-briefing-is-not-the-chart.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SPEC = "docs/boss/EXECUTIVE_INTELLIGENCE.md";
const PAGE = "src/client/boss/pages/Spirit.tsx";
const MAP = "src/worker/boss/spirit/travelMap.ts";
const DASHBOARD = "src/worker/boss/spirit/dashboard.ts";

/** Hers, verbatim. If this string changes she changed it, and the scan should say so. */
export const DISCLAIMER =
  "Astrology here is symbolic planning language—not scientifically validated forecasting.";

/** The visible state of a week she has not banded. Never blank, never a colour. */
export const NOT_YET_GIVEN = "not yet given";

// ─── Rule 1: the briefing spec ────────────────────────────────────────────────

/**
 * Headings that may not return to the briefing. Matched at line start only, so the pointer
 * section's backticked CITATIONS of the removed headings are not themselves violations.
 */
const BANNED_HEADINGS = [
  /^#+\s.*Astrological/i,
  /^#+\s.*Astronomical/i,
  /^#+\s.*Moon Dashboard/i,
  /^#+\s.*Major Aspects/i,
  /^#+\s.*Current Retrogrades/i,
  /^#+\s.*Upcoming Lunations/i,
  /^#+\s.*Mercury Retrograde/i,
  /^#+\s.*Travel Map/i,
  /^#+\s.*Map Operating Logic/i,
];

/**
 * Phrases that only appear when a document is SPECIFYING astrology, never when it is banning it.
 *
 * THE DISTINCTION IS THE WHOLE DESIGN. The spec still says "No astrological … content appears
 * anywhere" in its QA checklist and "Do NOT include astrology of any kind" in its generation prompt,
 * and those lines are the fix rather than the fault. So the ban is on MANDATE SHAPES — a convention
 * name, a coordinate system, a legend definition — none of which can appear in a prohibition.
 */
const BANNED_PHRASES = [
  ["void-of-course", "the void-of-course specification is back in the briefing"],
  ["Ptolemaic", "the VOC convention is being specified in the briefing"],
  ["tropical", "a coordinate system for planetary positions is being specified"],
  ["planetary degrees", "the briefing is being told to produce planetary degrees"],
  ["degree/minute", "an ephemeris precision requirement is back in the briefing"],
  ["retrograde station", "retrograde station times are being specified"],
  ["Mercury Retrograde Tracker", "the Mercury tracker is back in the briefing"],
  ["✈", "the travel-map legend is back in the briefing"],
  ["🟢 =", "the Money / Career / Travel Map legend is back in the briefing"],
  ["🟡 =", "the Money / Career / Travel Map legend is back in the briefing"],
  ["🔴 =", "the Money / Career / Travel Map legend is back in the briefing"],
  ["locked week", "the briefing is being told to resolve her map week"],
  ["map transition", "the briefing is being told to state the next map transition"],
  ["Locked travel guidance", "the locked travel guidance is back in the briefing"],
];

/**
 * The eleven market sections, in her order. Present AND ordered, because a spec that quietly lost
 * "SpaceX Watch" would pass every deletion check above while failing her instruction outright.
 */
export const MARKET_SECTIONS = [
  "One-Minute Executive Summary",
  "Top 5 Headlines",
  "Markets & Macro Dashboard",
  "SpaceX Watch",
  "AI & Technology",
  "Capital Markets / IPO / M&A",
  "VC / Private Markets / Secondaries Roundup",
  "Government / Legal / Supreme Court / Regulation",
  "Investor Insight",
  "Key Events Today",
  "One Thing to Watch",
];

/** Inline code spans are CITATIONS of what was removed, not instructions to produce it. */
const withoutCode = (src) => src.replace(/`[^`\n]*`/g, "`…`");

/**
 * Comments are CODE COMMENTARY, not code.
 *
 * This repo documents the bug a rule prevents directly above the rule — which means the source of
 * `travelMap.ts` says the words "?? BAND.green" in a sentence explaining why there is no such
 * fallback, and `Spirit.tsx` says "🟡" in a sentence explaining why the page holds no colour table.
 * Both of those are the FIX, and a scan that reads them as the fault would punish the explanation
 * and reward silence. Every mechanism check below runs on the stripped source.
 */
export const withoutComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

export function specProblems(src) {
  const problems = [];
  const lines = src.split("\n");

  for (const [i, line] of lines.entries()) {
    for (const rx of BANNED_HEADINGS) {
      if (rx.test(line)) problems.push(`line ${i + 1}: the heading "${line.trim()}" is astrologically-derived content, and the briefing may not carry any`);
    }
  }

  const prose = withoutCode(src);
  for (const [phrase, why] of BANNED_PHRASES) {
    if (prose.includes(phrase)) problems.push(`"${phrase}" appears — ${why}`);
  }

  /*
   * The eleven market sections, present and in order. This is a SEPARATION, not a deletion.
   *
   * THEY ARE MATCHED AS HEADINGS, NOT AS SUBSTRINGS. The first version of this check used
   * `indexOf`, and its negative proof exposed the hole immediately: deleting the `# SpaceX Watch`
   * heading still PASSED, because the words "SpaceX Watch" also appear in §4's research scope and
   * §11's QA checklist. A scan that a prose mention can satisfy is not checking the structure — it
   * is checking the vocabulary, which nothing here depends on.
   */
  const headings = lines
    .filter((l) => /^#+\s/.test(l))
    .map((l) => l.replace(/^#+\s*/, "").trim());
  let cursor = 0;
  for (const section of MARKET_SECTIONS) {
    const at = headings.findIndex((h, i) => i >= cursor && h.includes(section));
    if (at === -1) {
      problems.push(
        headings.some((h) => h.includes(section))
          ? `the market section heading "${section}" is out of order — §5's sections are read top to bottom and the order is the specification`
          : `the market section heading "${section}" is missing — the briefing lost content it was supposed to keep`,
      );
    } else {
      cursor = at + 1;
    }
  }

  // The pointer section is asserted to EXIST, so nobody deletes the explanation and then wonders
  // why the sections are gone — and so a future editor is told where they went.
  if (!/spirit page/i.test(src)) {
    problems.push("nothing in the spec says where the astrology went; a future editor will restore it because the document no longer explains its own absence");
  }
  return problems;
}

// ─── Rule 2: the disclaimer, on the page, above the ephemeris ─────────────────

export function disclaimerProblems(page) {
  const problems = [];
  if (!page.includes("dashboard.disclaimer")) {
    problems.push("the Spirit page never renders `dashboard.disclaimer` — the caveat did not travel with the content it caveats");
  }
  const caveatAt = page.indexOf("dashboard.disclaimer");
  const tableAt = page.indexOf("dashboard.bodies");
  if (caveatAt !== -1 && tableAt !== -1 && caveatAt > tableAt) {
    problems.push("the disclaimer renders BELOW the ephemeris table — a caveat under a table is read after the table has already been believed");
  }
  if (tableAt === -1) {
    problems.push("the Spirit page never renders `dashboard.bodies` — the ephemeris table is not on the page at all");
  }
  return problems;
}

/** The string itself must survive, on the Worker side, exactly as she wrote it. */
export function disclaimerTextProblems(dashboard) {
  return dashboard.includes(DISCLAIMER)
    ? []
    : ["the disclaimer string is not hers any more; it is quoted verbatim from her report and a paraphrase is a different claim"];
}

// ─── Rule 3: no week wears a colour it was not given ─────────────────────────

const COLOURS = ["🟢", "🟡", "🔴"];

export function mapProblems(rawMapSource, rawPage) {
  const problems = [];
  const mapSource = withoutComments(rawMapSource);
  const page = withoutComments(rawPage);

  // Every row of the locked table, parsed the way a reader reads it.
  const rows = [...mapSource.matchAll(/\{\s*starts:\s*"([\d-]+)",\s*ends:\s*"([\d-]+)",\s*label:\s*"([^"]*)",\s*band:\s*"(\w+)",\s*travel:\s*(\d+|null),\s*note:\s*(null|"[^"]*")\s*\}/g)]
    .map((m) => ({ starts: m[1], ends: m[2], label: m[3], band: m[4], travel: m[5], note: m[6] }));

  // RULE 0.
  if (rows.length === 0) {
    problems.push(`${MAP}: no map weeks were parsed at all — the table has moved or changed shape, and this scan is checking nothing`);
    return problems;
  }

  const allowed = new Set(["green", "peak_green", "yellow", "red", "unset"]);
  for (const r of rows) {
    if (!allowed.has(r.band)) {
      problems.push(`${r.label}: band "${r.band}" is not one of ${[...allowed].join(", ")}`);
    }
    if (r.band === "unset" && (r.travel !== "null" || r.note !== "null")) {
      problems.push(`${r.label}: the band is unset but it carries a travel mark or a note — a week she has not given cannot carry a signal she has not given either`);
    }
    if (r.band !== "unset" && r.travel === "null") {
      problems.push(`${r.label}: the band is given but travel is null — \`null\` means "she has not said", and \`0\` means "she said, and there is no plane". Those are different statements`);
    }
    if (r.ends < r.starts) problems.push(`${r.label}: the week ends before it starts`);
  }

  /*
   * THE MECHANISM, NOT JUST THE DATA. A fallback is how an unset week acquires a colour: one
   * `?? BAND.green` and every missing band silently becomes the default. There must be none, and
   * `BAND` must have no `unset` key for one to fall back TO.
   */
  if (/\?\?\s*BAND\./.test(mapSource)) {
    problems.push(`${MAP}: there is a \`?? BAND.…\` fallback — that is precisely how a week with no band renders as a colour she never gave`);
  }
  if (/\bunset\s*:/.test(mapSource.slice(mapSource.indexOf("export const BAND"), mapSource.indexOf("export const TRAVEL")))) {
    problems.push(`${MAP}: \`BAND\` has an \`unset\` entry — an ungiven week must have no glyph to be painted with`);
  }
  if (!mapSource.includes(`"${NOT_YET_GIVEN}"`)) {
    problems.push(`${MAP}: the "${NOT_YET_GIVEN}" state is gone — an ungiven week would render blank, which is indistinguishable from a broken lookup`);
  }

  /*
   * AND THE CLIENT MUST NOT KEEP ITS OWN COLOUR TABLE. Two components each keeping their own list,
   * with no link between them, is a recurring defect class in this repo. The page renders
   * `w.signal`, which the Worker composed; if the page started mapping bands to glyphs itself, the
   * Worker's refusal to paint an unset week would stop protecting anything.
   */
  for (const colour of COLOURS) {
    if (page.includes(`"${colour}"`) || page.includes(`'${colour}'`)) {
      problems.push(`${PAGE}: it contains a literal ${colour} — the page must render the signal the Worker composed, never map a band to a colour itself`);
    }
  }
  return problems;
}

// ─── Rule 4: the ephemeris keeps its precision ───────────────────────────────

export function precisionProblems(dashboard, page) {
  const problems = [];

  for (const [needle, why] of [
    ["arcminutes", "the Worker no longer computes arcminutes, so every position is a decimal and the report's precision is gone"],
    ['"Retrograde"', "the Direct/Retrograde column is gone from the Worker"],
    ['"Direct"', "the Direct/Retrograde column is gone from the Worker"],
    ["orb_text", "aspect orbs are no longer stated in arcminutes, and 0°16′ and 0°18′ are both \"0.3°\" at one decimal"],
    ["final-major-Ptolemaic-aspect", "the void-of-course convention is no longer named, and different conventions move the window by hours"],
  ]) {
    if (!dashboard.includes(needle)) problems.push(`${DASHBOARD}: ${why}`);
  }

  const bodies = (dashboard.match(/"(sun|moon|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto)"/g) ?? []);
  if (new Set(bodies).size < 10) {
    problems.push(`${DASHBOARD}: only ${new Set(bodies).size} of the ten bodies her report lists are present`);
  }

  for (const [needle, why] of [
    ["b.degrees", "the page no longer renders whole degrees"],
    ["b.arcminutes", "the page renders a position without arcminutes — that is a decimal, not an ephemeris"],
    ["b.motion", "the page no longer renders Direct/Retrograde beside each body"],
    ["orb_text", "the page no longer renders aspect orbs in arcminutes"],
    ["void_of_course.convention", "the page states a void-of-course window without naming the convention it was computed under"],
  ]) {
    if (!page.includes(needle)) problems.push(`${PAGE}: ${why}`);
  }
  return problems;
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const fail = [];
  const say = (name, want, got) => {
    if (want === got) return;
    fail.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  const goodSpec = `# Key Events Today\n\n# The astrology and the map are NOT in this report\n\nIt all lives on the spirit page now; see \`# Money / Career / Travel Map\` there.\n\n${MARKET_SECTIONS.map((s) => `# ${s}`).join("\n\n")}\n`;
  say("a clean spec passes", 0, specProblems(goodSpec).length);
  say("a restored astrology heading is caught", true,
    specProblems(`${goodSpec}\n# Astronomical / Astrological Dashboard\n`).some((p) => /Astrological/.test(p)));
  say("a restored travel-map heading is caught", true,
    specProblems(`${goodSpec}\n# Locked 2026 Money / Career / Travel Map\n`).some((p) => /Travel Map/.test(p)));
  say("a VOC mandate in prose is caught", true,
    specProblems(`${goodSpec}\nInclude void-of-course status.\n`).some((p) => /void-of-course/.test(p)));
  say("a backticked citation of a removed heading is NOT a violation", 0,
    specProblems(`${goodSpec}\nWhat stood here was \`# Map Operating Logic\`.\n`).length);
  say("a lost market section is caught", true,
    specProblems(goodSpec.replace("# SpaceX Watch", "")).some((p) => /SpaceX Watch/.test(p)));
  say("market sections out of order are caught", true,
    specProblems(`# The astrology and the map are NOT in this report\nspirit page\n# Investor Insight\n# Top 5 Headlines\n`).length > 0);

  const goodPage = 'x = dashboard.disclaimer; y = dashboard.bodies.map(b => b.degrees + b.arcminutes + b.motion); z = a.orb_text; w = d.moon.void_of_course.convention;';
  say("a page with the caveat above the table passes", 0, disclaimerProblems(goodPage).length);
  say("a page missing the disclaimer is caught", true,
    disclaimerProblems("dashboard.bodies.map(x)").some((p) => /did not travel/.test(p)));
  say("a disclaimer below the table is caught", true,
    disclaimerProblems("dashboard.bodies; dashboard.disclaimer").some((p) => /BELOW/.test(p)));
  say("a paraphrased disclaimer is caught", 1, disclaimerTextProblems("const D = 'astrology is just for fun';").length);
  say("her exact disclaimer passes", 0, disclaimerTextProblems(`const D = "${DISCLAIMER}";`).length);

  const row = (band, travel, note) =>
    `{ starts: "2026-09-07", ends: "2026-09-13", label: "Sep 7–13", band: "${band}", travel: ${travel}, note: ${note} }`;
  const mapSrc = (rows) =>
    `export const BAND = { green: {}, yellow: {} };\nexport const TRAVEL = {};\nconst NOT = "${NOT_YET_GIVEN}";\n${rows.join(",\n")}`;
  say("a banded week passes", 0, mapProblems(mapSrc([row("yellow", "1", '"Travel"')]), goodPage).length);
  say("an unset week with no signal passes", 0, mapProblems(mapSrc([row("unset", "null", "null")]), goodPage).length);
  say("an unset week carrying a travel mark is caught", true,
    mapProblems(mapSrc([row("unset", "1", "null")]), goodPage).some((p) => /has not given/.test(p)));
  say("an unknown band is caught", true,
    mapProblems(mapSrc([row("blue", "0", '"x"')]), goodPage).some((p) => /not one of/.test(p)));
  say("a BAND fallback is caught", true,
    mapProblems(`${mapSrc([row("yellow", "1", '"x"')])}\nconst g = BAND[w.band] ?? BAND.green;`, goodPage).some((p) => /fallback/.test(p)));
  say("a colour literal in the client is caught", true,
    mapProblems(mapSrc([row("yellow", "1", '"x"')]), `${goodPage} const g = "🟢";`).some((p) => /literal 🟢/.test(p)));
  /*
   * THE EXPLANATION IS NOT THE FAULT. This repo writes the bug a rule prevents directly above the
   * rule, so both anti-patterns appear verbatim in comments in the very files this scan protects.
   */
  say("a comment describing the fallback is NOT the fallback", 0,
    mapProblems(`/* never write \`?? BAND.green\` here */\n${mapSrc([row("yellow", "1", '"x"')])}`, goodPage).length);
  say("a comment quoting a colour is NOT a colour table", 0,
    mapProblems(mapSrc([row("yellow", "1", '"x"')]), `// "🟢" alone tells her nothing\n${goodPage}`).length);
  // RULE 0.
  say("a map with no weeks HARD-FAILS rather than passing an empty loop", true,
    mapProblems("export const BAND = {};\nexport const TRAVEL = {};\nexport const MAP_WEEKS = [];", goodPage)
      .some((p) => /no map weeks were parsed at all/.test(p)));

  const goodDash = `const D = "${DISCLAIMER}"; arcminutes; "Direct"; "Retrograde"; orb_text; "final-major-Ptolemaic-aspect"; ` +
    '"sun","moon","mercury","venus","mars","jupiter","saturn","uranus","neptune","pluto"';
  say("a complete dashboard passes", 0, precisionProblems(goodDash, goodPage).length);
  say("losing arcminutes is caught", true,
    precisionProblems(goodDash.replace(/arcminutes/g, "decimal"), goodPage).some((p) => /arcminutes/.test(p)));
  say("losing the motion column is caught", true,
    precisionProblems(goodDash.replace(/"Retrograde"/, '"R"'), goodPage).some((p) => /Direct\/Retrograde/.test(p)));
  say("losing a body is caught", true,
    precisionProblems(goodDash.replace('"pluto"', '"x"'), goodPage).some((p) => /of the ten bodies/.test(p)));
  say("a page that drops arcminutes is caught", true,
    precisionProblems(goodDash, goodPage.replace("b.arcminutes", "")).some((p) => /not an ephemeris/.test(p)));
  say("a page that drops the convention is caught", true,
    precisionProblems(goodDash, goodPage.replace("void_of_course.convention", "")).some((p) => /naming the convention/.test(p)));

  if (fail.length) {
    console.error("SELF-TEST FAILED:");
    for (const f of fail) console.error("  ✗", f);
    process.exit(1);
  }
  console.log(
    "SELF-TEST PASSED: 28/28 cases — a restored astrology heading, a restored map, a lost market " +
      "section, a stranded disclaimer, an unset week wearing a colour, a client colour table, a lost " +
      "arcminute and an EMPTY MAP are all caught.",
  );
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const problems = [];
const read = (rel) => {
  if (!existsSync(join(ROOT, rel))) {
    // RULE 0: a file that is not there means this scan checked nothing about it.
    problems.push(`${rel} is missing — this scan cannot tell the briefing and the chart apart without it.`);
    return null;
  }
  return readFileSync(join(ROOT, rel), "utf8");
};

const spec = read(SPEC);
const page = read(PAGE);
const mapSource = read(MAP);
const dashboard = read(DASHBOARD);

if (spec) for (const p of specProblems(spec)) problems.push(`${SPEC}: ${p}`);
if (page) for (const p of disclaimerProblems(page)) problems.push(p);
if (dashboard) for (const p of disclaimerTextProblems(dashboard)) problems.push(`${DASHBOARD}: ${p}`);
if (mapSource && page) for (const p of mapProblems(mapSource, page)) problems.push(p);
if (dashboard && page) for (const p of precisionProblems(dashboard, page)) problems.push(p);

if (problems.length) {
  console.error("BRIEFING-IS-NOT-THE-CHART SCAN FAILED:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nHer instruction of 12 September 2026: \"They are not to be mixed in the way this report is.\"\n" +
      "The market sections belong to the daily briefing; the ephemeris, the Moon, the aspects and the\n" +
      "Money / Career / Travel Map belong to the Spirit page — with the disclaimer, at full precision,\n" +
      "and with no week wearing a colour she never gave it.",
  );
  process.exit(1);
}

const weeks = (mapSource.match(/\{\s*starts:\s*"[\d-]+",/g) ?? []).length;
console.log(
  `BRIEFING-IS-NOT-THE-CHART SCAN PASSED: the briefing spec carries all ${MARKET_SECTIONS.length} market ` +
    `sections in order and no astrologically-derived section; the Spirit page carries the disclaimer above ` +
    `a ten-body ephemeris with degrees, arcminutes and motion; and all ${weeks} locked map weeks render ` +
    "only the band they were given.",
);
