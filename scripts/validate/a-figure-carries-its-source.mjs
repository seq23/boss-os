#!/usr/bin/env node
/**
 * A FIGURE CARRIES ITS SOURCE, AND "partial" MEANS SOMETHING IS MISSING.
 *
 * ─── Two findings from one hand-fired run ──────────────────────────────────
 *
 * THE $72 OIL FIGURE. Friday's report published Brent at roughly $72/bbl. The Friday close was
 * $104.61 — a 45% error in a headline figure, in the report read at 7am to make decisions. Sunday's
 * run corrected it, and only because that run happened to re-check.
 *
 * The duty's `success_criteria` already said "every figure carries a named source and the time it
 * was read". IT WAS NOT ENFORCED AND COULD NOT HAVE BEEN. `success_criteria` is a TEXT column that
 * `duties/author.ts` writes and two screens display; no code in this repository has ever evaluated
 * one. And the more serious half: even an enforced criterion had nothing to check against, because
 * `sources` is a REPORT-LEVEL array while figures live inside a section's `bullets`, `items` and
 * `table`, and no section had ever named which source a number came from. Two halves of one
 * payload, each keeping its own list, with no link between them.
 *
 * "partial" ON A COMPLETE REPORT. A run filed all eleven sections, withheld nothing and grounded its
 * insight — and reported `partial`, because it listed four things it wanted: Monday's Starship
 * outcome, Sunday-evening escalation in the Red Sea, an IPO pricing date, post-FOMC spreads. Every
 * one an event that has not happened yet. Wanting tomorrow's news is a correct report, not an
 * incomplete one, and an amber that fires on correct behaviour stops meaning anything.
 *
 * ─── What is checked, by running the shipped code ──────────────────────────
 *
 *   1. A SECTION THAT PRINTS A FIGURE AND CITES NOTHING DOES NOT PRINT. It is withheld and named,
 *      because the absence has to be louder than the number was.
 *   2. A SECTION WITH NO FIGURES IS LEFT ALONE. A prose section needs no citation and demanding one
 *      would teach the run to bolt a URL onto everything, which is the same defect wearing a
 *      citation.
 *   3. A CITATION THAT DOES NOT RESOLVE FAILS LIKE A MISSING ONE — a source with no URL, no
 *      read time, or that is not in the report's list at all.
 *   4. "partial" MEANS A SHORTFALL. Eleven sections, zero missing, a grounded insight and a full
 *      `watching` list is COMPLETE. A missing section, a withheld-for-sourcing section, an
 *      unverified figure, or an ungrounded insight is PARTIAL — and it says which.
 *   5. THE DECISIONS REACH THE PRODUCER: the prompt asks for per-section sources, separates
 *      `watching` from `gaps`, and carries the closed-market dashboard rule.
 *   6. THE CORRECTIONS MECHANISM SURVIVES. A citation proves provenance and never accuracy; it is
 *      what caught the $72.
 *
 * RULE 0: zero sourcing cases or zero standing cases exercised is a HARD FAILURE.
 *
 *   node scripts/validate/a-figure-carries-its-source.mjs
 *   node scripts/validate/a-figure-carries-its-source.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTsResolve } from "./lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const BRIEFING = "src/worker/boss/today/briefing.ts";
const DELIVER = "src/worker/boss/duties/deliverReport.ts";
const SPEC = "docs/boss/EXECUTIVE_INTELLIGENCE.md";
const SCREEN = "src/client/boss/pages/Today.tsx";

/** A real source, shaped as the report files them. */
const GOOD_SOURCE = {
  name: "CNBC — Oil prices fall Friday; Brent down 2.8% to $104.61",
  url: "https://www.cnbc.com/2026/09/11/oil-price-today.html",
  read_at: "2026-09-13T20:35:00Z",
};

export const SOURCING_CASES = [
  {
    name: "A REPORT WRITTEN BEFORE THE RULE: no section anywhere cites a source",
    section: { key: "markets_dashboard", heading: "Markets & Macro Dashboard", bullets: ["Brent fell 2.8% to ~$72/bbl."] },
    sources: [GOOD_SOURCE],
    preRule: true,
    keep: true,
    why:
      "every report in the database predates per-section sources, and holding them to the rule " +
      "withheld TEN OF ELEVEN sections of the briefing she had just read — a format change that " +
      "makes historical days render empty is the regression this repo already warns about",
  },
  {
    name: "a section printing figures and citing a real source",
    section: { key: "markets_dashboard", heading: "Markets & Macro Dashboard", bullets: ["Brent closed at $104.61, down 2.8%."], sources: [0] },
    sources: [GOOD_SOURCE],
    keep: true,
    why: "a sourced figure is exactly what the rule asks for and must print",
  },
  {
    name: "THE $72 CASE: a section printing figures and citing nothing",
    section: { key: "markets_dashboard", heading: "Markets & Macro Dashboard", bullets: ["Brent fell 2.8% to ~$72/bbl."] },
    sources: [GOOD_SOURCE],
    keep: false,
    why: "this is the shape that published a 45% error and went two days uncaught",
  },
  {
    name: "a prose section with no figures in it",
    section: { key: "ai_technology", heading: "AI & Technology", bullets: ["Infrastructure credibility is replacing adoption as the anchor."] },
    sources: [GOOD_SOURCE],
    keep: true,
    why: "demanding a citation for prose teaches the run to bolt a URL onto everything",
  },
  {
    name: "a citation pointing at a source that was never filed",
    section: { key: "capital_markets", heading: "Capital Markets / IPO / M&A", bullets: ["A $2 trillion valuation."], sources: [7] },
    sources: [GOOD_SOURCE],
    keep: false,
    why: "a citation nobody can follow is not a citation",
  },
  {
    name: "a source with no URL",
    section: { key: "capital_markets", heading: "Capital Markets / IPO / M&A", bullets: ["A $2 trillion valuation."], sources: [0] },
    sources: [{ name: "Someone told me", url: "", read_at: "2026-09-13T20:35:00Z" }],
    keep: false,
    why: "without a URL nobody can go and look",
  },
  {
    name: "a source with no read time",
    section: { key: "capital_markets", heading: "Capital Markets / IPO / M&A", bullets: ["A $2 trillion valuation."], sources: [0] },
    sources: [{ name: "CNBC", url: "https://www.cnbc.com/x", read_at: "" }],
    keep: false,
    why: "without a read time a citation cannot tell today's close from Friday's, which is the error itself",
  },
];

export const STANDING_CASES = [
  {
    name: "THE DEFECT: eleven sections, nothing missing, four forward-looking notes",
    args: { runStatus: "partial", missing: [], withheldForSources: [], gaps: [], watching: [{ wanted: "Monday's Starship outcome" }, {}, {}, {}], insightWithheld: false, insightAttempted: true },
    want: "complete",
    why: "wanting tomorrow's news is a correct report, and an amber that fires on correct behaviour stops meaning anything",
  },
  {
    name: "a section the spec asked for is absent",
    args: { runStatus: "complete", missing: [{ key: "key_events", title: "Key Events Today", why: "not filed" }], withheldForSources: [], gaps: [], watching: [], insightWithheld: false, insightAttempted: true },
    want: "partial",
    why: "that is what partial is for",
  },
  {
    name: "a section withheld for printing figures with no source",
    args: { runStatus: "complete", missing: [], withheldForSources: [{ key: "markets_dashboard", title: "Markets & Macro Dashboard", why: "no source" }], gaps: [], watching: [], insightWithheld: false, insightAttempted: true },
    want: "partial",
    why: "a withheld section is a missing section with a reason",
  },
  {
    name: "something that exists and could not be verified",
    args: { runStatus: "complete", missing: [], withheldForSources: [], gaps: [{ wanted: "Friday's close" }], watching: [], insightWithheld: false, insightAttempted: true },
    want: "partial",
    why: "an unverified figure in a report she trades on is the original meaning of the word",
  },
  {
    name: "an insight that could not be grounded",
    args: { runStatus: "complete", missing: [], withheldForSources: [], gaps: [], watching: [], insightWithheld: true, insightAttempted: true },
    want: "partial",
    why: "the section was attempted and could not stand up",
  },
  {
    name: "a quiet day that filed no insight at all",
    args: { runStatus: "complete", missing: [], withheldForSources: [], gaps: [], watching: [{ wanted: "Monday" }], insightWithheld: true, insightAttempted: false },
    want: "complete",
    why: "the spec permits filing no insight on a thin day, and a permitted stop must read green",
  },
  {
    name: "a run that failed",
    args: { runStatus: "failed", missing: [], withheldForSources: [], gaps: [], watching: [], insightWithheld: false, insightAttempted: false },
    want: "failed",
    why: "a failed run is not a partial one",
  },
];

export function newestPrompt(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let latest = null;
  for (const f of files) {
    const src = readFileSync(join(migrationsDir, f), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    if (/\$\.prompt/.test(src) && /duty_exec_intel/.test(src)) latest = src;
  }
  return latest;
}

export function check({ sourcing, standing, deliver, spec, screen, prompt }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!Array.isArray(sourcing) || sourcing.length === 0 || !Array.isArray(standing) || standing.length === 0) {
    problems.push(`Zero sourcing or zero standing cases were exercised, so nothing below was run.`);
    return problems;
  }

  // ── 1–3. Sourcing ────────────────────────────────────────────────────────
  for (const c of sourcing) {
    if (c.kept !== c.keep) {
      problems.push(
        `${c.name}: the section was ${c.kept ? "PRINTED" : "WITHHELD"} and must be ${c.keep ? "PRINTED" : "WITHHELD"} — ${c.why}.`,
      );
    }
    if (c.pre_rule && !String(c.name).startsWith("A REPORT WRITTEN BEFORE")) {
      problems.push(
        `${c.name}: was treated as PRE-RULE even though the report cites sources elsewhere, so the ` +
        `gate would never fire on a report written under the rule.`,
      );
    }
    if (!c.keep && c.kept === false && !c.why_given) {
      problems.push(`${c.name}: withheld with no reason, so the absence is silent.`);
    }
  }

  // ── 4. What partial means ────────────────────────────────────────────────
  for (const c of standing) {
    if (c.got !== c.want) {
      problems.push(`${c.name}: came out "${c.got}" and must be "${c.want}" — ${c.why}.`);
    }
    if (c.want === "partial" && c.shortfalls.length === 0) {
      problems.push(`${c.name}: reported partial with no shortfall named, so the word sends her looking for what is wrong.`);
    }
    if (c.want === "complete" && c.shortfalls.length > 0) {
      problems.push(`${c.name}: reported complete while naming a shortfall.`);
    }
  }

  // ── The status is derived rather than believed ───────────────────────────
  /*
   * SCOPED TO `deliverExecutiveReport`, and the first draft was not — it matched the whole file and
   * went red on `deliverPracticeWeek`, where `any gap ⇒ partial` is still CORRECT. The practice
   * week has no forward-looking notion: its gaps are rituals it could not source, which is exactly
   * what the word was always for. Only the briefing gained a `watching` field, so only the briefing
   * changes meaning, and a rule about one function must not be written as a rule about a file.
   */
  const wholeFile = code(deliver);
  const deliverCode = /export async function deliverExecutiveReport[\s\S]*$/.exec(wholeFile)?.[0] ?? "";
  if (deliverCode === "") {
    problems.push(`${DELIVER} has no \`deliverExecutiveReport\` this scan can read, so the status rules examined nothing.`);
    return problems;
  }
  if (!/reportStanding\s*\(/.test(deliverCode)) {
    problems.push(
      `${DELIVER} does not derive the status. The run said "partial" and the delivery wrote "partial" ` +
      `down — the one claim in the payload nothing ever checked.`,
    );
  }
  if (/status === "complete" && gaps\.length > 0 \? "partial"/.test(deliverCode)) {
    problems.push(`${DELIVER} still downgrades on any gap, which is what made a complete report call itself partial.`);
  }
  if (!/withheldForSourcing\s*\(/.test(deliverCode)) {
    problems.push(`${DELIVER} does not apply the sourcing gate, so an unsourced figure is stored as if it were fine.`);
  }
  if (!/corrections/.test(wholeFile)) {
    problems.push(
      `${DELIVER} no longer stores corrections. A citation proves provenance and never accuracy — ` +
      `corrections are what actually caught the $72, and they must survive this change.`,
    );
  }

  // ── 5. The decisions reach the producer ──────────────────────────────────
  if (!prompt) {
    problems.push(`No migration sets the report duty's prompt.`);
  } else {
    /*
     * ONE DISTINCTIVE PHRASE PER RULE, not an alternation. The first draft accepted either of two
     * phrasings for each rule, and its own negative proofs did not fire: deleting "sources REQUIRED"
     * left the other branch matching, so a prompt that had stopped asking for citations passed. A
     * guard with an OR in it is a guard you have to break twice.
     */
    for (const [what, re] of [
      ["per-section sources", /sources\s+REQUIRED/],
      ["the watching / gaps split", /FORWARD-LOOKING only/],
      ["the closed-market dashboard rule", /RENDER THE LAST CLOSE AND LABEL IT/],
    ]) {
      if (!re.test(prompt)) problems.push(`The duty prompt does not carry ${what}, so the producer decides it afresh every morning.`);
    }
  }

  // ── The spec records the decisions ───────────────────────────────────────
  for (const [what, re] of [
    ["the closed-market dashboard rule", /RENDER IT, LABELLED/],
    ["what partial means", /Status: what .partial. means|`watching` \| Forward-looking/],
    ["that a figure carries its source", /every section that prints a figure carries `sources`/i],
  ]) {
    if (!re.test(spec)) problems.push(`${SPEC} no longer records ${what}, so it goes back to being re-argued per run.`);
  }

  // ── The screen tells them apart ──────────────────────────────────────────
  const screenCode = code(screen);
  if (!/c\.watching/.test(screenCode)) {
    problems.push(`${SCREEN} does not render \`watching\`, so forward-looking notes are invisible or read as absences.`);
  }
  if (!/shortfalls/.test(screenCode)) {
    problems.push(`${SCREEN} does not say WHY a report is partial, which is what sent her looking in the first place.`);
  }

  return problems;
}

// ─── Running the shipped code ───────────────────────────────────────────────

async function evaluate() {
  registerTsResolve();
  const mod = await import(`file://${join(ROOT, BRIEFING)}`);

  /*
   * A REPORT UNDER THE RULE IS ONE WHERE SOMETHING CITES, so every case except the pre-rule one is
   * evaluated alongside a section that does cite — which is what a real post-rule report looks like.
   * Judging a lone uncited section would make every fixture pre-rule and the gate would never fire.
   */
  const CITING = { key: "one_thing_to_watch", heading: "One Thing to Watch", bullets: ["A move worth $1 billion."], sources: [0] };
  const sourcing = SOURCING_CASES.map((c) => {
    const filed = c.preRule ? [c.section] : [c.section, CITING];
    const out = mod.withheldForSourcing(filed, { sources: c.sources });
    return {
      name: c.name, keep: c.keep, why: c.why,
      kept: out.kept.some((k) => k.key === c.section.key),
      why_given: out.withheld[0]?.why ?? "",
      pre_rule: out.pre_rule,
    };
  });

  const standing = STANDING_CASES.map((c) => {
    const out = mod.reportStanding(c.args);
    return { name: c.name, want: c.want, why: c.why, got: out.status, shortfalls: out.shortfalls };
  });

  return { sourcing, standing };
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const { sourcing, standing } = await evaluate();
  const good = {
    sourcing,
    standing,
    deliver: readFileSync(join(ROOT, DELIVER), "utf8"),
    spec: readFileSync(join(ROOT, SPEC), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    prompt: newestPrompt(join(ROOT, "migrations")),
  };

  const suite = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE $72 CASE: an unsourced figure printed anyway",
      input: { ...good, sourcing: good.sourcing.map((c) => (c.name.startsWith("THE $72 CASE") ? { ...c, kept: true } : c)) },
      expect: 1,
    },
    {
      name: "THE REGRESSION: a pre-rule report held to the rule and emptied",
      input: { ...good, sourcing: good.sourcing.map((c) => (c.name.startsWith("A REPORT WRITTEN BEFORE") ? { ...c, kept: false } : c)) },
      expect: 1,
    },
    {
      name: "a prose section demanded to carry a citation",
      input: { ...good, sourcing: good.sourcing.map((c) => (c.name.includes("prose section") ? { ...c, kept: false } : c)) },
      expect: 1,
    },
    {
      name: "a citation that resolves to nothing accepted",
      input: { ...good, sourcing: good.sourcing.map((c) => (c.name.includes("never filed") ? { ...c, kept: true } : c)) },
      expect: 1,
    },
    {
      name: "THE DEFECT: a complete report still calling itself partial",
      input: { ...good, standing: good.standing.map((c, i) => (i === 0 ? { ...c, got: "partial", shortfalls: ["x"] } : c)) },
      expect: 1,
    },
    {
      name: "a missing section no longer making a report partial",
      input: { ...good, standing: good.standing.map((c, i) => (i === 1 ? { ...c, got: "complete", shortfalls: [] } : c)) },
      expect: 1,
    },
    {
      name: "partial with no reason given",
      input: { ...good, standing: good.standing.map((c, i) => (i === 1 ? { ...c, shortfalls: [] } : c)) },
      expect: 1,
    },
    {
      name: "the status believed from the run again",
      input: { ...good, deliver: good.deliver.replaceAll("reportStanding", "trustTheRun") },
      expect: 1,
    },
    {
      name: "the sourcing gate removed from delivery",
      input: { ...good, deliver: good.deliver.replaceAll("withheldForSourcing", "noGate") },
      expect: 1,
    },
    {
      name: "corrections dropped in the name of citations",
      input: { ...good, deliver: good.deliver.replaceAll("corrections", "dropped") },
      expect: 1,
    },
    {
      name: "the prompt no longer asking for per-section sources",
      input: { ...good, prompt: good.prompt.replace(/sources\s+REQUIRED/, "sources are optional") },
      expect: 1,
    },
    {
      name: "the dashboard rule taken back out of the prompt",
      input: { ...good, prompt: good.prompt.replace(/RENDER THE LAST CLOSE AND LABEL IT/, "decide for yourself") },
      expect: 1,
    },
    {
      name: "the spec forgetting the closed-market decision",
      input: { ...good, spec: good.spec.replace(/RENDER IT, LABELLED/, "decide per run") },
      expect: 1,
    },
    {
      name: "the screen not rendering watching",
      input: { ...good, screen: good.screen.replaceAll("c.watching", "c.unused") },
      expect: 1,
    },
    {
      name: "the screen not saying why a report is partial",
      input: { ...good, screen: good.screen.replaceAll("shortfalls", "unused") },
      expect: 1,
    },
    { name: "RULE 0 — nothing exercised", input: { ...good, standing: [] }, expect: 1 },
  ];

  let failed = 0;
  for (const c of suite) {
    const found = check(c.input).length;
    const okCase = c.expect === 0 ? found === 0 : found >= 1;
    if (!okCase) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\na-figure-carries-its-source self-test: ${failed}/${suite.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-figure-carries-its-source self-test: ${suite.length}/${suite.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missing = [BRIEFING, DELIVER, SPEC, SCREEN].filter((f) => !existsSync(join(ROOT, f)));
if (missing.length) {
  console.error(`a-figure-carries-its-source FAILED — ${missing.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const { sourcing, standing } = await evaluate();
  const problems = check({
    sourcing,
    standing,
    deliver: readFileSync(join(ROOT, DELIVER), "utf8"),
    spec: readFileSync(join(ROOT, SPEC), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    prompt: newestPrompt(join(ROOT, "migrations")),
  });

  if (problems.length) {
    console.error("a-figure-carries-its-source FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `a-figure-carries-its-source: ${sourcing.length} sourcing cases and ${standing.length} status cases run ` +
    `against the shipped code — an unsourced figure does not print, a prose section is left alone, ` +
    `and a report that filed everything reads COMPLETE however much it is watching for. OK.`,
  );
}
