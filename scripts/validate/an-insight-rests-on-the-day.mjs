#!/usr/bin/env node
/**
 * AN INVESTOR INSIGHT RESTS ON TODAY'S OWN MATERIAL, OR IT IS WITHHELD.
 *
 * ─── What she asked for ─────────────────────────────────────────────────────
 *
 *   "u r also supposed to use the intelligence of the LLM to develop an investor insights section
 *    to help me learn how to think about the stuff im reading....."
 *
 * The specification already mandated an Investor Insight and every example in it is a CONCLUSION —
 * "the AI cycle is shifting from growth scarcity to capital productivity". She is asking to be
 * taught the REASONING THAT REACHES ONE, so she can make the move herself on tomorrow's news with
 * the report closed. The spec is amended to carry four parts: the synthesis, how it was reached,
 * the transferable frame, and what would falsify it.
 *
 * ─── Why this guard exists, and why it is not a style check ─────────────────
 *
 * §2.1 says never invent market data, and it binds the REASONING as hard as it binds the numbers.
 * Numbers are obviously fabricable and everyone watches them; reasoning is fabricable in a way that
 * reads like insight. A pattern joined out of facts that are not in the report is a horoscope with
 * a Bloomberg accent, and this page is read by a registered representative before she trades.
 *
 * A forced DAILY insight is the specific failure mode: on a thin news day the honest answer is
 * "today's material does not support a synthesis worth writing", and a model asked for an insight
 * every morning will produce one every morning.
 *
 * So the delivered insight must CITE the facts it joined, each naming a section of the same report,
 * and the shipped `groundInsight()` checks the citations are made of the day's own words. An
 * insight that fails is WITHHELD with its reason on the screen — not printed with a hedge, and not
 * dropped silently either.
 *
 * ─── What is checked ────────────────────────────────────────────────────────
 *
 *   1. A GROUNDED INSIGHT IS SHOWN, with all four parts intact. A guard that only ever refuses is a
 *      guard nobody can ship behind.
 *   2. AN INSIGHT CITING A FACT THAT IS NOT IN THE REPORT IS WITHHELD, and the reason names the fact.
 *   3. AN INSIGHT CITING A SECTION THAT IS NOT IN THE REPORT IS WITHHELD.
 *   4. AN INSIGHT WITH NO CITATIONS AT ALL IS WITHHELD — an uncheckable claim is the thing this
 *      exists to stop, and "it cited nothing" must not be the loophole that passes.
 *   5. THE SPEC AND THE PROMPT ASK FOR ALL FOUR PARTS, and the screen renders all four. Three of
 *      them are the teaching; a synthesis alone is the conclusion she already had.
 *
 * RULE 0: a fixture whose insight is examined against ZERO citations, or a run of this scan that
 * grounds zero insights, is a HARD FAILURE.
 *
 *   node scripts/validate/an-insight-rests-on-the-day.mjs
 *   node scripts/validate/an-insight-rests-on-the-day.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MODULE = "src/worker/boss/today/briefing.ts";
const SPEC = "docs/boss/EXECUTIVE_INTELLIGENCE.md";
const SCREEN = "src/client/boss/pages/Today.tsx";
const ROUTE = "src/worker/boss/routes/today.ts";

/** The four parts, by the field the delivered insight carries them in. */
export const INSIGHT_PARTS = ["synthesis", "how_reached", "transferable_frame", "falsified_by"];

/**
 * A report whose insight is honestly built out of its own two sections.
 *
 * The facts cited are paraphrases of what the sections say, not copies — because that is what an
 * honest synthesis looks like, and a check that demanded verbatim quotes would fail every real one
 * and pass a copy-paste.
 */
export function groundedFixture() {
  return {
    headline: "Capex commitments repriced the back end of the curve.",
    summary: "Hyperscaler capex guidance rose and the ten-year sold off with it.",
    sections: [
      {
        key: "capital_markets",
        heading: "Capital Markets / IPO / M&A",
        so_what: "Watch the discount rate rather than the capex line.",
        bullets: [
          "Hyperscaler capex guidance rose again and the long end of the curve sold off with it.",
          "A late-stage secondary book repriced inside a week on the same discount rate move.",
        ],
      },
      {
        key: "private_markets",
        heading: "VC / Private Markets / Secondaries Roundup",
        so_what: "Secondary bids are tracking the curve, not the marks.",
        bullets: ["Secondary bids widened as the discount rate moved, ahead of any change in carrying marks."],
      },
      {
        key: "investor_insight",
        heading: "Investor Insight",
        insight: {
          synthesis: "Private marks are now a lagging print of the public discount rate.",
          how_reached:
            "Two lines are the same fact seen from different sides: hyperscaler capex guidance moved the long end, " +
            "and secondary bids widened on that same discount rate before any carrying mark changed.",
          transferable_frame:
            "When a spending commitment and a bid move together and a carrying mark does not, ask which of the three " +
            "is the price and which is the accounting.",
          falsified_by:
            "Secondary bids holding steady through a further move in the long end would break it.",
          cites: [
            { fact: "Hyperscaler capex guidance rose and the long end sold off with it.", from: "capital_markets" },
            { fact: "Secondary bids widened as the discount rate moved, ahead of carrying marks.", from: "private_markets" },
          ],
        },
      },
    ],
  };
}

/** The same report, with the insight resting on something that is nowhere in it. */
export function ungroundedFixture() {
  const r = groundedFixture();
  const insight = r.sections[2].insight;
  return {
    ...r,
    sections: [
      r.sections[0],
      r.sections[1],
      {
        ...r.sections[2],
        insight: {
          ...insight,
          cites: [
            { fact: "Japanese pension allocators rotated out of domestic duration overnight.", from: "capital_markets" },
          ],
        },
      },
    ],
  };
}

/** The newest migration prompt for the report duty, with SQL comments stripped. */
export function newestPrompt(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let latest = null;
  for (const f of files) {
    const src = readFileSync(join(migrationsDir, f), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    if (/\$\.prompt/.test(src) && /duty_exec_intel/.test(src)) latest = src;
  }
  return latest;
}

export function check({ grounded, ungrounded, noCites, badSection, noSection, emptySection, citeCount, spec, screen, route, prompt }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!citeCount || citeCount === 0) {
    problems.push(
      `The fixture insight was checked against ZERO citations. Every rule below is about what a ` +
      `citation must satisfy, and a loop over no citations passes all of them while proving nothing.`,
    );
    return problems;
  }

  // ── 1. A grounded insight is shown, whole ────────────────────────────────
  if (!grounded?.grounded || !grounded.insight) {
    problems.push(
      `An insight built out of the report's own two sections was WITHHELD${grounded?.withheld_because ? `: ${grounded.withheld_because}` : ""}. ` +
      `A guard that only ever refuses is one nobody can ship behind, and the section would be dead on ` +
      `arrival every morning.`,
    );
  } else {
    for (const part of INSIGHT_PARTS) {
      if (!grounded.insight[part]) {
        problems.push(
          `The grounded insight came back with no \`${part}\`. Three of the four parts ARE the teaching — ` +
          `"help me learn how to think about the stuff im reading" — and a synthesis on its own is the ` +
          `conclusion she already had.`,
        );
      }
    }
  }

  // ── 2, 3, 4. The three ways an insight fails to rest on the day ──────────
  if (ungrounded?.grounded || ungrounded?.insight) {
    problems.push(
      `An insight resting on "Japanese pension allocators rotated out of domestic duration overnight" — ` +
      `a fact that appears NOWHERE in the fixture report — was shown as analysis. §2.1 binds the ` +
      `reasoning as hard as the numbers, and she trades on this page.`,
    );
  } else if (!/Japanese pension|does not appear/i.test(ungrounded?.withheld_because ?? "")) {
    problems.push(
      `The ungrounded insight was withheld without naming what was wrong with it: ` +
      `"${String(ungrounded?.withheld_because).slice(0, 90)}". A silent refusal is indistinguishable ` +
      `from a quiet news day.`,
    );
  }
  /*
   * A WITHHELD INSIGHT ALWAYS SAYS WHY, and this rule was missing when the first version shipped.
   * Live production returned `{"insight":null,"grounded":false,"withheld_because":null}` and the
   * block rendered nothing at all — indistinguishable from the feature being broken, on the one
   * section whose entire purpose is showing her how a conclusion was reached.
   */
  for (const [what, state] of [["no section at all", noSection], ["an empty section", emptySection]]) {
    if (state && !state.grounded && !state.withheld_because) {
      problems.push(
        `An insight withheld because there was ${what} says nothing about why. Silence with no reason ` +
        `teaches nothing — and on this section that is the whole point.`,
      );
    }
  }

  if (badSection?.grounded) {
    problems.push(`An insight citing a section that is not in the report was shown. The citation cannot be checked, so it is not a citation.`);
  }
  if (noCites?.grounded) {
    problems.push(
      `An insight citing NOTHING was shown. That must not be the loophole: an uncheckable claim is ` +
      `precisely what this guard exists to stop, and "it cited nothing" is the easiest way to produce one.`,
    );
  }

  // ── 5. The spec, the prompt and the screen all ask for the four parts ────
  const specText = spec;
  for (const [what, pattern] of [
    ["how the synthesis was reached", /how it was reached/i],
    ["the transferable frame", /transferable frame/i],
    ["what would falsify it", /falsif/i],
    ["that the facts joined must be in today's report", /appeared in today's report|appear elsewhere in the same report/i],
    ["that one insight a day is the whole of it", /ONE insight per day|One concise, synthesized idea/],
  ]) {
    if (!pattern.test(specText)) {
      problems.push(`${SPEC}'s Investor Insight section no longer requires ${what}.`);
    }
  }
  if (!prompt) {
    problems.push(`No migration sets the report duty's prompt, so nothing asks the run for an insight at all.`);
  } else {
    for (const part of INSIGHT_PARTS) {
      if (!prompt.includes(part)) problems.push(`The duty prompt never names \`${part}\`, so the run is not asked for it.`);
    }
    if (!/cites/.test(prompt)) {
      problems.push(`The duty prompt does not ask the insight to cite its facts, so nothing it delivers can be checked and everything will be withheld.`);
    }
  }

  const screenCode = code(screen);
  for (const part of INSIGHT_PARTS) {
    if (!new RegExp(`insight\\.${part}`).test(screenCode)) {
      problems.push(`${SCREEN} never renders \`${part}\`. Delivered, checked, and then not on the screen is the same absence with more work behind it.`);
    }
  }
  if (!/withheld_because/.test(screenCode)) {
    problems.push(
      `${SCREEN} does not render the reason an insight was withheld. A section that silently disappears ` +
      `on the days the check bites looks like the feature is broken.`,
    );
  }
  if (!/groundInsight\s*\(/.test(code(route))) {
    problems.push(`${ROUTE} does not run \`groundInsight\`, so the insight reaches her unchecked.`);
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const mod = await import(`file://${join(ROOT, MODULE)}`);
  const grounded = groundedFixture();

  const noCitesReport = structuredClone(grounded);
  noCitesReport.sections[2].insight.cites = [];
  const badSectionReport = structuredClone(grounded);
  badSectionReport.sections[2].insight.cites = [
    { fact: "Hyperscaler capex guidance rose and the long end sold off with it.", from: "spacex_watch" },
  ];

  const good = {
    grounded: mod.groundInsight(grounded),
    ungrounded: mod.groundInsight(ungroundedFixture()),
    noCites: mod.groundInsight(noCitesReport),
    badSection: mod.groundInsight(badSectionReport),
    /* The two shapes of ABSENCE, which must each carry their own sentence. */
    noSection: mod.groundInsight({ sections: [{ key: "ai_technology", heading: "AI & Technology", bullets: ["x"] }] }),
    emptySection: mod.groundInsight({ sections: [{ key: "investor_insight", heading: "Investor Insight" }] }),
    citeCount: grounded.sections[2].insight.cites.length,
    spec: readFileSync(join(ROOT, SPEC), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    prompt: newestPrompt(join(ROOT, "migrations")),
  };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE DEFECT THIS EXISTS FOR: an ungrounded insight shown as analysis",
      input: { ...good, ungrounded: { grounded: true, insight: grounded.sections[2].insight, withheld_because: null } },
      expect: 1,
    },
    {
      name: "an insight citing nothing, shown",
      input: { ...good, noCites: { grounded: true, insight: grounded.sections[2].insight, withheld_because: null } },
      expect: 1,
    },
    {
      name: "an insight citing a section that is not in the report, shown",
      input: { ...good, badSection: { grounded: true, insight: grounded.sections[2].insight, withheld_because: null } },
      expect: 1,
    },
    {
      name: "an honest insight refused, so the section is dead every morning",
      input: { ...good, grounded: { grounded: false, insight: null, withheld_because: "nope" } },
      expect: 1,
    },
    {
      name: "the teaching parts dropped, leaving only the conclusion",
      input: {
        ...good,
        grounded: { ...good.grounded, insight: { ...good.grounded.insight, transferable_frame: "", falsified_by: "" } },
      },
      expect: 1,
    },
    {
      name: "withheld without saying what was wrong",
      input: { ...good, ungrounded: { grounded: false, insight: null, withheld_because: "Not shown." } },
      expect: 1,
    },
    {
      name: "the spec amendment reverted to a conclusion-only section",
      input: { ...good, spec: good.spec.replace(/transferable frame/gi, "idea") },
      expect: 1,
    },
    {
      name: "the prompt no longer asking for the falsification test",
      input: { ...good, prompt: good.prompt.replace(/falsified_by/g, "") },
      expect: 1,
    },
    {
      name: "the prompt no longer asking for citations",
      input: { ...good, prompt: good.prompt.replace(/cites/g, "") },
      expect: 1,
    },
    {
      name: "the screen rendering the synthesis and none of the teaching",
      input: { ...good, screen: good.screen.replace(/insight\.transferable_frame/g, "insight.synthesis") },
      expect: 1,
    },
    {
      name: "the screen hiding the reason an insight was withheld",
      input: { ...good, screen: good.screen.replaceAll("withheld_because", "unused") },
      expect: 1,
    },
    {
      name: "the route not grounding it at all",
      input: { ...good, route: good.route.replaceAll("groundInsight", "passThrough") },
      expect: 1,
    },
    {
      name: "THE LIVE DEFECT: withheld with no reason at all",
      input: { ...good, noSection: { grounded: false, insight: null, withheld_because: null } },
      expect: 1,
    },
    {
      name: "an empty insight section withheld silently",
      input: { ...good, emptySection: { grounded: false, insight: null, withheld_because: null } },
      expect: 1,
    },
    { name: "RULE 0 — zero citations examined", input: { ...good, citeCount: 0 }, expect: 1 },
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
    console.error(`\nan-insight-rests-on-the-day self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`an-insight-rests-on-the-day self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [MODULE, SPEC, SCREEN, ROUTE].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`an-insight-rests-on-the-day FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const mod = await import(`file://${join(ROOT, MODULE)}`);
  const grounded = groundedFixture();
  const noCitesReport = structuredClone(grounded);
  noCitesReport.sections[2].insight.cites = [];
  const badSectionReport = structuredClone(grounded);
  badSectionReport.sections[2].insight.cites = [
    { fact: "Hyperscaler capex guidance rose and the long end sold off with it.", from: "spacex_watch" },
  ];

  const problems = check({
    grounded: mod.groundInsight(grounded),
    ungrounded: mod.groundInsight(ungroundedFixture()),
    noCites: mod.groundInsight(noCitesReport),
    badSection: mod.groundInsight(badSectionReport),
    /* The two shapes of ABSENCE, which must each carry their own sentence. */
    noSection: mod.groundInsight({ sections: [{ key: "ai_technology", heading: "AI & Technology", bullets: ["x"] }] }),
    emptySection: mod.groundInsight({ sections: [{ key: "investor_insight", heading: "Investor Insight" }] }),
    citeCount: grounded.sections[2].insight.cites.length,
    spec: readFileSync(join(ROOT, SPEC), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    prompt: newestPrompt(join(ROOT, "migrations")),
  });

  if (problems.length) {
    console.error("an-insight-rests-on-the-day FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `an-insight-rests-on-the-day: an insight built from the report's own sections is shown with all ` +
    `${INSIGHT_PARTS.length} parts; one resting on a fact that is not in the day, one citing a section that ` +
    `is not there, and one citing nothing are all withheld with reasons. OK.`,
  );
}
