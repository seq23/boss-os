#!/usr/bin/env node
/**
 * A BRIEFING SECTION IS RENDERED, OR IT IS NAMED AS MISSING. NEVER SILENTLY ABSENT.
 *
 * ─── The defect this is the guard for, in her words ─────────────────────────
 *
 *   "the executive breifing section is missing some sections (and u can make it scrollable)...like
 *    major news (top 5 headlines) a one min summary section, markets dashboard a tech section a
 *    cpaital markets secondary ipo m&A section....."
 *
 * Measured on production the same morning: `executive_briefing` came back `status: "partial"` with
 * THREE sections, all thematic analyst essays. Every section she named was already mandated by §5
 * of `docs/boss/EXECUTIVE_INTELLIGENCE.md`, which lists ELEVEN in a fixed order.
 *
 * The producer was the wrong end and it was INSTRUCTED to be: migration 0205 told the run to
 * "ignore it entirely on length and structure" and capped it at four sections; 0195 had already
 * said "NOT its length". The consumer then applied `slice(0, 4)` on top. Nothing drifted — a spec
 * was overruled in two places and the screen showed the result.
 *
 * ─── What is checked, and why it is these three things ──────────────────────
 *
 *   1. THE REGISTRY IS THE SPECIFICATION. `BRIEFING_SECTIONS` in `today/briefing.ts` must match §5's
 *      headings exactly, in order. Two lists with no link between them is how one goes stale, and
 *      this repository has that failure written on its wall.
 *
 *   2. A MISSING SECTION IS NAMED. Run the SHIPPED `missingSections()` over a fixture holding two of
 *      eleven, and assert the other nine come back with titles and reasons — and that a gap the run
 *      itself named is used as the reason rather than a generic one. This is what makes
 *      `status: "partial"` mean something she can see instead of a short report that looks complete.
 *
 *      §2.1 IS WHY THIS IS THE RIGHT SHAPE. "Never invent market data" means an absent Markets &
 *      Macro Dashboard is often the CORRECT outcome. The honest answer is to say it is absent and
 *      why — never a plausible-looking table on a page a registered representative trades on.
 *
 *   3. BOTH ENDS ARE WIRED. The route hands `missing_sections` to the screen, the screen renders
 *      them, the `slice(0, 4)` is gone, and the block is scrollable as she asked. Work that exists
 *      and is not invoked is this repository's most-repeated defect.
 *
 *   4. THE PROMPT ASKS FOR ALL ELEVEN, by key. A screen that can show eleven sections over a run
 *      that is still told to file four is the same gap with the guard on the wrong side.
 *
 * RULE 0: zero spec sections parsed, zero registry entries, or a fixture that produces zero missing
 * sections is a HARD FAILURE. Every rule here is a loop, and a loop over nothing passes for ever.
 *
 *   node scripts/validate/every-spec-section-is-rendered-or-named.mjs
 *   node scripts/validate/every-spec-section-is-rendered-or-named.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SPEC = "docs/boss/EXECUTIVE_INTELLIGENCE.md";
const MODULE = "src/worker/boss/today/briefing.ts";
const ROUTE = "src/worker/boss/routes/today.ts";
const SCREEN = "src/client/boss/pages/Today.tsx";
const CSS = "src/client/boss/styles.css";

/**
 * §5's section headings, read out of the specification itself.
 *
 * The document's §5 is written as the report it is describing, so its sections are `#`/`##`
 * headings between "# 5. Report Structure" and "# 6. News Selection Algorithm". Everything that is
 * apparatus rather than a section — the title block, the per-headline template, the SpaceX
 * verification branches, the secondaries lenses, the removal notice for the astrology — is excluded
 * by name, and the count is asserted, so a future edit cannot quietly widen this list.
 */
export const NOT_A_SECTION = [
  "Executive Intelligence Report",
  "[Number]. [Headline]",
  "Why it matters",
  "Step 1: Public/private verification",
  "If publicly traded",
  "If privately held",
  "A. Public-equivalent value",
  "B. Security-level underwriting",
  "C. Liquidity versus impairment",
  "D. Price-discovery lesson",
  "E. Capital-structure lesson",
  "The astrology and the map are NOT in this report",
  "Absolute Final Line",
  // The amended Investor Insight's own four parts, which are its shape rather than sections.
  "1. The synthesis",
  "2. How it was reached",
  "3. The transferable frame",
  "4. What would falsify it",
  "§2.1 binds the reasoning, not only the numbers",
];

export function specSections(spec) {
  const start = spec.indexOf("# 5. Report Structure");
  const end = spec.indexOf("# 6. News Selection Algorithm");
  if (start === -1 || end === -1 || end < start) return [];
  return [...spec.slice(start, end).matchAll(/^#{1,2}\s+(.+?)\s*$/gm)]
    .map((m) => m[1].trim())
    .filter((h) => !h.startsWith("5. Report Structure"))
    .filter((h) => !NOT_A_SECTION.includes(h));
}

/** `BRIEFING_SECTIONS` as [{key, title}], read from the module. */
export function registry(source) {
  const m = /BRIEFING_SECTIONS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source);
  if (!m) return [];
  return [...m[1].matchAll(/key:\s*"([^"]+)"\s*,\s*title:\s*"([^"]+)"/g)].map((x) => ({ key: x[1], title: x[2] }));
}

/**
 * The `duty_exec_intel` prompt, from the newest migration that sets it.
 *
 * SQL COMMENTS ARE STRIPPED FIRST, and that is not tidiness. This repository documents the defect a
 * change fixes directly above the change, so migration 0237's own header QUOTES the instructions it
 * is removing — "FOUR AT MOST", "ignore it entirely on length and structure". Reading the file whole
 * made this scan fail the fix it was asking for, which is the fastest way to teach people to stop
 * explaining their work.
 */
export function newestPrompt(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let latest = null;
  for (const f of files) {
    const src = readFileSync(join(migrationsDir, f), "utf8")
      .split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    if (/\$\.prompt/.test(src) && /duty_exec_intel/.test(src)) latest = src;
  }
  return latest;
}

/** A report holding two of the eleven sections, plus a gap the run named for a third. */
export function fixtureReport(registryRows) {
  return {
    headline: "Capex commitments repriced the back end of the curve.",
    summary: "Two hyperscalers raised capex guidance and the ten-year sold off with it.",
    sections: [
      {
        key: registryRows[0]?.key,
        heading: registryRows[0]?.title,
        so_what: "Watch the discount rate, not the capex line.",
        bullets: ["Hyperscaler capex guidance rose and the long end sold off with it."],
      },
      {
        key: registryRows[4]?.key,
        heading: registryRows[4]?.title,
        so_what: "Infrastructure, not models, is where the money is going.",
        bullets: ["Data-center power scarcity is now the binding constraint on deployment."],
      },
    ],
    gaps: [
      { wanted: "Markets & Macro Dashboard", why: "No verified close was available at report time." },
    ],
  };
}

export function check({ spec, module: mod, route, screen, css, prompt, missing, registryRows }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

  const specRows = specSections(spec);

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (specRows.length === 0) {
    problems.push(
      `${SPEC} yielded no §5 section headings. Every rule here loops over them, so this scan would ` +
      `pass by examining nothing.`,
    );
    return problems;
  }
  if (registryRows.length === 0) {
    problems.push(`${MODULE} exports no readable BRIEFING_SECTIONS, so ${specRows.length} spec sections are unaccounted for.`);
    return problems;
  }

  // ── 1. The registry IS the specification ─────────────────────────────────
  if (registryRows.length !== specRows.length) {
    problems.push(
      `§5 names ${specRows.length} sections and ${MODULE} registers ${registryRows.length}. Two lists with ` +
      `no link between them is how one goes stale — and the stale one is the screen.`,
    );
  }
  for (let i = 0; i < Math.max(specRows.length, registryRows.length); i += 1) {
    const want = specRows[i];
    const got = registryRows[i]?.title;
    if (want !== undefined && got !== want) {
      problems.push(
        `Position ${i + 1} of §5 is "${want}" and the registry has ${got === undefined ? "nothing" : `"${got}"`}. ` +
        `§5's order IS the specification — she reads it top to bottom.`,
      );
    }
  }

  // ── 2. A missing section is named, with the run's own reason where it gave one ──
  if (!Array.isArray(missing) || missing.length === 0) {
    problems.push(
      `The fixture report carries 2 of ${registryRows.length} sections and \`missingSections()\` named NONE of ` +
      `the rest. A section that is absent and unmentioned is exactly what she opened this morning: a ` +
      `short report that looks complete.`,
    );
    return problems; // RULE 0 — nothing below has anything to examine.
  }
  const expectedMissing = registryRows.length - 2;
  if (missing.length !== expectedMissing) {
    problems.push(`The fixture has ${expectedMissing} absent sections and ${missing.length} were named.`);
  }
  for (const m of missing) {
    if (!m.title || !m.why) problems.push(`A missing section was named without a title or without a reason: ${JSON.stringify(m)}`);
  }
  const dash = missing.find((m) => m.title === "Markets & Macro Dashboard");
  if (dash && !/verified close/i.test(dash.why)) {
    problems.push(
      `The run named a gap for the Markets & Macro Dashboard and the screen reports a generic reason ` +
      `instead ("${String(dash.why).slice(0, 60)}"). §2.1 forbids inventing the data that would have ` +
      `filled it, so the RUN'S OWN reason is the whole content of that line.`,
    );
  }

  // ── 3. Both ends wired ───────────────────────────────────────────────────
  const routeCode = code(route);
  const screenCode = code(screen);
  if (!/missing_sections\s*:/.test(routeCode)) {
    problems.push(`${ROUTE} does not put \`missing_sections\` in the briefing payload, so the screen cannot show what is absent.`);
  }
  if (!/orderSections\s*\(/.test(routeCode)) {
    problems.push(`${ROUTE} does not order the delivered sections into §5's order.`);
  }
  if (!/missing_sections/.test(screenCode)) {
    problems.push(`${SCREEN} never renders \`missing_sections\`. Computed and unrendered is the defect with an extra step.`);
  }
  if (/sections\s*\?\?\s*\[\]\)\s*\.slice\(/.test(screenCode) || /\.slice\(0,\s*4\)/.test(screenCode)) {
    problems.push(
      `${SCREEN} still truncates the briefing's sections. The cap was on the wrong end: it hid research ` +
      `she paid for instead of fixing the run that produced the wrong shape.`,
    );
  }
  if (!/brief-scroll/.test(screenCode)) {
    problems.push(`${SCREEN} does not put the briefing in a scroll container. She asked for it: "and u can make it scrollable".`);
  }
  const scrollRule = /\.brief-scroll\s*\{([^}]*)\}/.exec(css);
  if (!scrollRule || !/overflow-y\s*:\s*auto/.test(scrollRule[1]) || !/max-height/.test(scrollRule[1])) {
    problems.push(
      `${CSS} has no \`.brief-scroll\` rule that both bounds the height and scrolls. Without both, the ` +
      `longest block on the page still pushes the rest of her morning off the bottom.`,
    );
  }

  // ── 4. The run is asked for all eleven ───────────────────────────────────
  if (!prompt) {
    problems.push(`No migration sets \`$.prompt\` on \`duty_exec_intel\`, so nothing asks the run for any of this.`);
  } else {
    for (const row of registryRows) {
      if (!prompt.includes(row.key)) {
        problems.push(
          `The duty prompt never mentions the section key \`${row.key}\`. A screen that can render eleven ` +
          `sections over a run still told to file four is the same gap with the guard on the wrong side.`,
        );
      }
    }
    if (/FOUR AT MOST|four at most/.test(prompt)) {
      problems.push(`The duty prompt still caps the run at four sections. That cap is what produced the three-section briefing.`);
    }
    if (/ignore it entirely on length and structure/i.test(prompt)) {
      problems.push(`The duty prompt still tells the run to ignore the specification's structure. That instruction IS the defect.`);
    }
    if (/\*\*markdown asterisks\*\*|Bold the key phrase/i.test(prompt)) {
      problems.push(
        `The duty prompt still asks for bold inside every bullet. When every bullet has bold the bold ` +
        `marks nothing, and it competes with the heading above it — her "some bold stuff that i feel ` +
        `like should not be".`,
      );
    }
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const mod = await import(`file://${join(ROOT, MODULE)}`);
  const spec = readFileSync(join(ROOT, SPEC), "utf8");
  const moduleSrc = readFileSync(join(ROOT, MODULE), "utf8");
  const registryRows = registry(moduleSrc);
  const report = fixtureReport(registryRows);

  const good = {
    spec,
    module: moduleSrc,
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    css: readFileSync(join(ROOT, CSS), "utf8"),
    prompt: newestPrompt(join(ROOT, "migrations")),
    missing: mod.missingSections(report.sections, report.gaps),
    registryRows,
  };

  /*
   * THE NEGATIVE PROOF SHE ASKED FOR, RUN THROUGH THE SHIPPED CODE: delete a section from the
   * fixture report and show it is NAMED rather than vanishing.
   */
  const withoutTech = { ...report, sections: [report.sections[0]] };
  const namedAfterDeletion = mod.missingSections(withoutTech.sections, withoutTech.gaps);
  const techTitle = registryRows[4]?.title;
  if (!namedAfterDeletion.some((m) => m.title === techTitle)) {
    console.error(`  FAIL  deleting "${techTitle}" from the report did not name it as missing.`);
    process.exit(1);
  }

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE ACTUAL DEFECT: nothing reports what is absent",
      input: { ...good, missing: [] },
      expect: 1,
    },
    {
      name: "a section named missing with no reason",
      input: { ...good, missing: good.missing.map((m) => ({ ...m, why: "" })) },
      expect: 1,
    },
    {
      name: "the run's own gap replaced by a generic reason",
      input: { ...good, missing: good.missing.map((m) => ({ ...m, why: "Not filed." })) },
      expect: 1,
    },
    {
      name: "the registry losing one of §5's sections",
      input: { ...good, registryRows: good.registryRows.slice(0, -1), missing: good.missing.slice(0, -1) },
      expect: 1,
    },
    {
      name: "the registry reordered away from §5",
      input: {
        ...good,
        registryRows: [good.registryRows[1], good.registryRows[0], ...good.registryRows.slice(2)],
      },
      expect: 1,
    },
    {
      name: "the route no longer handing missing_sections to the screen",
      input: { ...good, route: good.route.replaceAll("missing_sections", "unused_sections") },
      expect: 1,
    },
    {
      name: "the screen no longer rendering them",
      input: { ...good, screen: good.screen.replaceAll("missing_sections", "unused_sections") },
      expect: 1,
    },
    {
      name: "THE OLD CAP: slice(0, 4) restored on the screen",
      input: { ...good, screen: `${good.screen}\n{(c.sections ?? []).slice(0, 4).map(renderSection)}\n` },
      expect: 1,
    },
    {
      name: "the block no longer scrollable",
      input: { ...good, css: good.css.replace(/\.brief-scroll\s*\{[^}]*\}/, ".brief-scroll { padding: 0; }") },
      expect: 1,
    },
    {
      name: "the prompt no longer naming a section key",
      input: { ...good, prompt: good.prompt.replace(/markets_dashboard/g, "") },
      expect: 1,
    },
    {
      name: "the four-section cap restored in the prompt",
      input: { ...good, prompt: `${good.prompt}\nsections FOUR AT MOST. This is a hard cap.` },
      expect: 1,
    },
    {
      name: "the prompt told again to ignore the spec's structure",
      input: { ...good, prompt: `${good.prompt}\nignore it entirely on length and structure` },
      expect: 1,
    },
    {
      name: "bold-every-bullet asked for again",
      input: { ...good, prompt: `${good.prompt}\nBold the key phrase in every bullet.` },
      expect: 1,
    },
    { name: "RULE 0 — no §5 in the spec", input: { ...good, spec: "# nothing" }, expect: 1 },
    { name: "RULE 0 — no registry", input: { ...good, registryRows: [] }, expect: 1 },
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
    console.error(`\nevery-spec-section-is-rendered-or-named self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(
    `every-spec-section-is-rendered-or-named self-test: ${cases.length}/${cases.length} fixtures detected ` +
    `correctly, plus the deletion proof (removing "${techTitle}" from a report names it as missing).`,
  );
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [SPEC, MODULE, ROUTE, SCREEN, CSS].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`every-spec-section-is-rendered-or-named FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const mod = await import(`file://${join(ROOT, MODULE)}`);
  const moduleSrc = readFileSync(join(ROOT, MODULE), "utf8");
  const registryRows = registry(moduleSrc);
  const report = fixtureReport(registryRows);

  const problems = check({
    spec: readFileSync(join(ROOT, SPEC), "utf8"),
    module: moduleSrc,
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    css: readFileSync(join(ROOT, CSS), "utf8"),
    prompt: newestPrompt(join(ROOT, "migrations")),
    missing: mod.missingSections(report.sections, report.gaps),
    registryRows,
  });

  if (problems.length) {
    console.error("every-spec-section-is-rendered-or-named FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `every-spec-section-is-rendered-or-named: §5's ${registryRows.length} sections are registered in order, a ` +
    `fixture holding 2 of them names the other ${registryRows.length - 2} with reasons, the run is asked for all ` +
    `${registryRows.length} by key, and the block scrolls. OK.`,
  );
}
