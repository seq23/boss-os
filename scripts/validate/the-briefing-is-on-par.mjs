#!/usr/bin/env node
/**
 * THE BRIEFING IS ON PAR WITH THE ONE SHE PAYS FOR.
 *
 * ─── Her brief, 19 September 2026 ──────────────────────────────────────────
 *
 *   "I keep opening my OpenAI app and the executive briefing there is far superior to anything in
 *    Boss OS ... Fix Boss OS's daily executive briefing to be just like the one in my txt file.
 *    Delivered automatically daily to me only. ... Leave astrology and travel-map colours out."
 *
 * The file is a full report, its source stack and the production prompt. This validator holds the
 * lane to it by RUNNING THE SHIPPED CODE — `briefingSpec.ts` and `deliverReport.ts` — over the
 * report the live run actually produced (`tests/fixtures/briefing/live-*.delivers.json`) and the
 * market snapshot it was handed, and by reading the wiring that puts both in front of the run.
 *
 * ─── What is checked ───────────────────────────────────────────────────────
 *
 *   1. THE FIXTURE HAS EVERY SECTION the specification names, to the depth the file has: a 3–5 item
 *      summary, 3–5 headlines each with a data block, a grounded insight. Zero sections is a HARD
 *      FAILURE, not a pass over an empty loop.
 *   2. EVERY FIGURE IN THE SUMMARY AND EVERY HEADLINE NUMBER CARRIES AN INLINE [n] CITATION, and
 *      every [n] anywhere resolves to a source that has an article URL and a readable read time.
 *   3. NO ASTROLOGY, NO TRAVEL MAP, in any section. Both live on the Spirit page.
 *   4. THE DASHBOARD IS BUILT FROM THE FEED: every watchlist symbol has a row; a symbol the feed did
 *      not answer reads "not available at HH:MM CT"; SpaceX's listing status comes from the feed.
 *   5. THE EDITION STAMP IS DERIVED — never later than delivery, never earlier than the snapshot.
 *   6. THE PROMPT THE RUN IS HANDED carries the file's rules: never invent, verify SpaceX daily,
 *      inline citations, the source tiers, the exclusion, every section key, the closed-market rule.
 *   7. THE WIRING: the materialiser composes from the module; the delivery grades with it; the route
 *      passes market data; the runner clears a stale delivers.json before the run and reads
 *      MARKETS.json; the Mac fetches the market before it claims and has a 06:05 slot; migration
 *      0257 moved the duty to 06:00 and took `$.prompt` out of the row; the screen renders the
 *      edition, the citations, the numbered sources and the final line.
 *
 *   node scripts/validate/the-briefing-is-on-par.mjs
 *   node scripts/validate/the-briefing-is-on-par.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBriefingSpec, currentBriefingPrompt } from "./lib/briefing-prompt.mjs";
import { registerTsResolve } from "./lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = "tests/fixtures/briefing";
const FILES = {
  materialise: "src/worker/boss/duties/materialise.ts",
  deliver: "src/worker/boss/duties/deliverReport.ts",
  route: "src/worker/boss/routes/backends.ts",
  today: "src/worker/boss/routes/today.ts",
  runner: "scripts/sync-agent/runner.mjs",
  snapshot: "scripts/ops/market-snapshot.mjs",
  launchd: "scripts/ops/install-agent-launchd.sh",
  screen: "src/client/boss/pages/Today.tsx",
  migration: "migrations/0257_boss_the_briefing_on_par_with_the_one_she_pays_for.sql",
};

/** The newest live fixture pair in the folder. */
export function newestFixture(dir) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((f) => /^live-\d{4}-\d{2}-\d{2}\.delivers\.json$/.test(f)).sort();
  const last = names[names.length - 1];
  if (!last) return null;
  const day = last.slice("live-".length, "live-".length + 10);
  const markets = join(dir, `live-${day}.markets.json`);
  return {
    day,
    delivers: JSON.parse(readFileSync(join(dir, last), "utf8")),
    markets: existsSync(markets) ? JSON.parse(readFileSync(markets, "utf8")) : null,
  };
}

async function loadDeliver() {
  registerTsResolve();
  return import(new URL("../../src/worker/boss/duties/deliverReport.ts", import.meta.url).href);
}

/**
 * Everything checkable, over a report + snapshot + prompt + sources.
 * Returns the list of problems; empty means on par.
 */
export async function check({ spec, deliver, fixture, prompt, files, deliveredAt }) {
  const problems = [];

  if (!fixture) {
    problems.push(`No live fixture in ${FIXTURES}/ (live-YYYY-MM-DD.delivers.json). The lane has never been run end to end and saved.`);
    return problems;
  }

  const sections = Array.isArray(fixture.delivers?.sections) ? fixture.delivers.sections : [];
  if (sections.length === 0) {
    problems.push("The fixture has ZERO sections. Rule 0: nothing was examined, so nothing passes.");
    return problems;
  }

  // ── 3, 4: the delivery path, as shipped ──────────────────────────────────
  const excluded = spec.stripExcludedSections(sections);
  for (const r of excluded.removed) problems.push(`Section "${r.key}" carries ${r.rule} content. The Spirit page owns that.`);

  const applied = deliver.applyMarketData(excluded.kept, Array.isArray(fixture.delivers.sources) ? fixture.delivers.sources : [], fixture.markets, deliveredAt);
  if (fixture.markets) {
    if (!applied.dashboard_built) problems.push("A market snapshot was present and the dashboard was not built from it.");
    const dash = applied.sections.find((s) => spec.sectionKeyOf?.(s) === "markets_dashboard" || s.key === "markets_dashboard");
    const rows = dash?.table?.rows ?? [];
    for (const w of spec.MARKET_WATCHLIST) {
      const row = rows.find((r) => r[0] === w.label);
      if (!row) { problems.push(`The dashboard has no row for ${w.label}.`); continue; }
      const q = fixture.markets.quotes.find((x) => x.symbol === w.symbol);
      if ((!q || q.value === null) && !/^not available at \d{1,2}:\d{2} (AM|PM) CT$/.test(row[1])) {
        problems.push(`${w.label} was not answered by the feed and its row reads "${row[1]}" rather than "not available at HH:MM CT".`);
      }
      if (q && q.value !== null && /not available/.test(row[1])) problems.push(`${w.label} was answered by the feed and its row reads "not available".`);
    }
    const spx = applied.sections.find((s) => s.key === "spacex_watch");
    if (spx && typeof spx.spacex_public !== "boolean") problems.push("The SpaceX Watch does not carry the feed's public/private answer.");
  } else {
    problems.push(`No market snapshot fixture (${FIXTURES}/live-${fixture.day}.markets.json). The dashboard cannot be proven built from data.`);
  }

  // ── 1, 2: the grade ──────────────────────────────────────────────────────
  const graded = spec.assessBriefing({ sections: applied.sections, sources: applied.sources });
  if (graded.empty) problems.push("Nothing to grade.");
  for (const p of graded.problems) problems.push(`Graded: ${p}`);
  const summary = applied.sections.find((s) => s.key === "one_minute_summary");
  const n = Array.isArray(summary?.bullets) ? summary.bullets.length : 0;
  if (n < 3 || n > 5) problems.push(`The One-Minute Executive Summary has ${n} items; the file has 3–5.`);
  const headlines = applied.sections.find((s) => s.key === "top_5_headlines");
  const items = Array.isArray(headlines?.items) ? headlines.items : [];
  if (items.length < 3) problems.push(`Top 5 Headlines has ${items.length} items.`);
  for (const [i, it] of items.entries()) {
    if (!Array.isArray(it?.numbers) || it.numbers.length === 0) problems.push(`Headline ${i + 1} has no data block (numbers[]). The file's headlines each carry theirs.`);
    if (typeof it?.why_it_matters !== "string" || it.why_it_matters.length < 120) problems.push(`Headline ${i + 1}'s why-it-matters is thin (${it?.why_it_matters?.length ?? 0} chars).`);
    if (typeof it?.importance !== "number" && typeof it?.importance !== "string") problems.push(`Headline ${i + 1} carries no importance score.`);
  }
  const usable = spec.usableSources ? spec.usableSources({ sources: applied.sources }) : null;
  const sourceCount = applied.sources.length;
  if (sourceCount < 10) problems.push(`Only ${sourceCount} sources. The file's report rests on 18 article-level URLs; a run at this depth opens twenty to forty.`);
  const homepages = applied.sources.filter((s) => typeof s?.url === "string" && /^https?:\/\/[^/]+\/?$/.test(s.url));
  if (homepages.length > 0) problems.push(`${homepages.length} source${homepages.length === 1 ? " is" : "s are"} a bare homepage, not an article: ${homepages.map((s) => s.url).join(", ")}`);
  void usable;

  // ── 5: the stamp ─────────────────────────────────────────────────────────
  const stamp = spec.checkedThrough({ sources: applied.sources, market: fixture.markets, finishedAt: deliveredAt });
  if (stamp.at > deliveredAt) problems.push("The edition stamp is later than delivery.");
  const fetched = fixture.markets ? Date.parse(fixture.markets.fetched_at) : NaN;
  if (Number.isFinite(fetched) && stamp.at < fetched) problems.push("The edition stamp is earlier than the market snapshot it was handed.");
  if (!/^Information checked through \d{1,2}:\d{2} (AM|PM) CT$/.test(stamp.label)) problems.push(`The stamp reads "${stamp.label}".`);

  // ── 6: the prompt ────────────────────────────────────────────────────────
  if (!prompt) problems.push("No prompt could be composed.");
  else {
    const must = [
      [/Never invent/, "the never-invent rule"],
      [/not available at HH:MM CT/, "the 'not available at HH:MM CT' rule for an unverifiable figure"],
      [/SPCX IS ON THE WATCHLIST|verify from\s+current sources before writing a price/i, "the daily SpaceX public/private verification"],
      [/Astrology and the\s+Money \/ Career \/ Travel Map live on her Spirit page\. Do not include either/i, "the astrology and travel-map exclusion"],
      [/inline with \[n\]/, "inline [n] citations"],
      [/Not just the dashboard\./, "per-section sources beyond the dashboard"],
      [/sources\s+REQUIRED/, "sources REQUIRED on a figure-bearing section"],
      [/RENDER THE LAST CLOSE AND LABEL IT/, "the closed-market dashboard rule"],
      [/Tier 1 — primary \/ authoritative/, "the source tiers"],
      [/Reuters/, "Reuters in the source stack"],
      [/Information checked through HH:MM CT/, "the edition stamp"],
      [new RegExp(spec.FINAL_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the final line"],
      [/INVESTOR IMPORTANCE SCORE X\/10/, "the importance-score weights"],
    ];
    for (const [re, what] of must) if (!re.test(prompt)) problems.push(`The prompt does not carry ${what}.`);
    for (const shape of spec.SECTION_SHAPES) if (!prompt.includes(shape.key)) problems.push(`The prompt never names the section key ${shape.key}.`);
    if (/\b(ephemeris|natal|zodiac)\b/i.test(prompt.replace(/SKY\.json[^\n]*\n[^\n]*\n[^\n]*/g, ""))) problems.push("The prompt asks for astrological content outside the exclusion notice.");
    if (/SpaceX is not publicly listed/i.test(prompt)) problems.push("The prompt hard-codes SpaceX's listing status. The specification says verify it daily; the feed answers it.");
    if (/FOUR AT MOST|four at most|No section may exceed four bullets/i.test(prompt)) problems.push("The prompt still caps sections at four bullets — the memo the owner compared unfavourably to the file.");
  }
  if (spec.SOURCE_TIERS.length < 3) problems.push("Fewer than three source tiers.");
  if (!spec.MARKET_WATCHLIST.some((w) => w.symbol === "SPCX")) problems.push("SPCX is not on the watchlist, so nothing answers the public/private question.");
  if (!spec.MARKET_WATCHLIST.some((w) => w.kind === "yield")) problems.push("No Treasury yield on the watchlist.");
  if (spec.EXCLUDED_CONTENT.length < 2) problems.push("The exclusion list has lost a rule.");

  // ── 7: the wiring ────────────────────────────────────────────────────────
  const F = files;
  if (!/composeBriefingPrompt\(/.test(F.materialise) || !/spec_module === "executive_briefing"/.test(F.materialise)) problems.push("materialise.ts does not compose the briefing prompt from the module.");
  if (!/prompt_version: BRIEFING_PROMPT_VERSION/.test(F.materialise)) problems.push("materialise.ts does not stamp the prompt version on the task.");
  for (const fn of ["applyMarketData", "assessBriefing", "stripExcludedSections", "checkedThrough"]) {
    if (!new RegExp(`\\b${fn}\\(`).test(F.deliver)) problems.push(`deliverReport.ts does not call ${fn}.`);
  }
  if (!/marketData: \(ev\.market_data/.test(F.route)) problems.push("routes/backends.ts does not pass the runner's market_data to the delivery.");
  if (!/editionStamp\(/.test(F.today) || !/final_line: FINAL_LINE/.test(F.today)) problems.push("routes/today.ts does not expose the edition stamp and the final line.");
  const clearIdx = F.runner.indexOf("await clearStaleDelivers(envelope.repo_path)");
  const runIdx = F.runner.indexOf("result = await runner({ envelope, prompt, sentinel, forbidden, cwd: envelope.repo_path })");
  if (clearIdx === -1 || runIdx === -1 || clearIdx > runIdx) problems.push("runner.mjs does not remove a stale delivers.json BEFORE the backend starts (15 Sep's report was 14 Sep's, refiled).");
  if (!/readMaterialJson\(envelope\.repo_path, "MARKETS\.json"\)/.test(F.runner) || !/market_data: marketData/.test(F.runner)) problems.push("runner.mjs does not carry MARKETS.json as observed evidence.");
  if (!/MARKET_WATCHLIST/.test(F.snapshot) || !/MARKET_FEEDS/.test(F.snapshot)) problems.push("market-snapshot.mjs does not read the watchlist and feeds from the module (two lists).");
  const chain = /market-snapshot\.mjs;[\s\S]*?agent\.mjs work-once/.test(F.launchd);
  if (!chain) problems.push("The launchd chain does not run the market snapshot before the claim.");
  if (!/<key>Hour<\/key><integer>6<\/integer><key>Minute<\/key><integer>5<\/integer>/.test(F.launchd)) problems.push("The launchd job has no 06:05 slot to claim a 06:00 duty.");
  if (!/local_hour = 6,\s*local_minute = 0/.test(F.migration)) problems.push("Migration 0257 does not move the duty to 06:00 Central.");
  if (!/'\$\.prompt'\s*\)/.test(F.migration) || !/json_remove/.test(F.migration)) problems.push("Migration 0257 does not remove $.prompt from the duty row.");
  if (!/'\$\.spec_module', 'executive_briefing'/.test(F.migration)) problems.push("Migration 0257 does not point the duty at the module.");
  for (const [re, what] of [
    [/brief-edition/, "the edition stamp"], [/brief-src-\$\{/, "anchored numbered sources"], [/c\.final_line/, "the final line"],
    [/it\.numbers/, "headline data blocks"], [/brief-ref/, "inline citation marks"],
  ]) if (!re.test(F.screen)) problems.push(`Today.tsx does not render ${what}.`);

  return problems;
}

async function load() {
  const spec = await loadBriefingSpec();
  const deliver = await loadDeliver();
  const briefing = await import(new URL("../../src/worker/boss/today/briefing.ts", import.meta.url).href);
  spec.sectionKeyOf = briefing.sectionKeyOf;
  spec.usableSources = briefing.usableSources;
  const files = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : ""]));
  const fixture = newestFixture(join(ROOT, FIXTURES));
  const deliveredAt = fixture?.delivers?.delivered_at ? Date.parse(fixture.delivers.delivered_at) : Date.parse(`${fixture?.day ?? "2026-09-19"}T12:00:00Z`);
  return { spec, deliver, files, fixture, prompt: await currentBriefingPrompt(), deliveredAt };
}

async function selfTest() {
  const good = await load();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const withDelivers = (mut) => { const f = clone(good.fixture); mut(f); return { ...good, fixture: f }; };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    { name: "a report with zero sections is a hard failure", input: withDelivers((f) => { f.delivers.sections = []; }), expect: 1 },
    { name: "no fixture at all is a failure, not a pass", input: { ...good, fixture: null }, expect: 1 },
    { name: "an astrology section is caught", input: withDelivers((f) => { f.delivers.sections.push({ key: "x", heading: "Moon Dashboard", bullets: ["Waxing Moon in Capricorn; Mercury direct."] }); }), expect: 1 },
    { name: "the travel map is caught", input: withDelivers((f) => { f.delivers.sections.push({ key: "y", heading: "Map", bullets: ["Next map transition September 21 — prepare for October."] }); }), expect: 1 },
    { name: "a missing section is caught", input: withDelivers((f) => { f.delivers.sections = f.delivers.sections.filter((s) => s.key !== "private_markets"); }), expect: 1 },
    { name: "a summary figure with its citation stripped is caught", input: withDelivers((f) => { const s = f.delivers.sections.find((x) => x.key === "one_minute_summary"); s.bullets[0] = s.bullets[0].replace(/\s*\[\d+(?:,\s*\d+)*\]/g, ""); if (!/\d/.test(s.bullets[0])) s.bullets[0] += " It moved 2.5%."; }), expect: 1 },
    { name: "a citation past the end of the source list is caught", input: withDelivers((f) => { const s = f.delivers.sections.find((x) => x.key === "one_minute_summary"); s.bullets[0] += " [99]"; }), expect: 1 },
    { name: "a headline with no data block is caught", input: withDelivers((f) => { const s = f.delivers.sections.find((x) => x.key === "top_5_headlines"); delete s.items[0].numbers; }), expect: 1 },
    { name: "a snapshot symbol the feed refused must read 'not available' — and does", input: withDelivers((f) => { f.markets.quotes[0].value = null; }), expect: 0 },
    { name: "a homepage cited as a source is caught", input: withDelivers((f) => { f.delivers.sources.push({ name: "TechCrunch", url: "https://techcrunch.com/", read_at: "2026-09-19T11:00:00Z" }); }), expect: 1 },
    { name: "a prompt that hard-codes SpaceX's status is caught", input: { ...good, prompt: `${good.prompt}\nSpaceX is not publicly listed; never invent a ticker.` }, expect: 1 },
    { name: "a prompt that lost the never-invent rule is caught", input: { ...good, prompt: good.prompt.replace(/Never invent/g, "Try not to invent") }, expect: 1 },
    { name: "a prompt that restored the four-bullet cap is caught", input: { ...good, prompt: `${good.prompt}\nNo section may exceed four bullets.` }, expect: 1 },
    { name: "a runner that reads delivers.json without clearing it first is caught", input: { ...good, files: { ...good.files, runner: good.files.runner.replace("await clearStaleDelivers(envelope.repo_path)", "false") } }, expect: 1 },
    { name: "a launchd chain without the market snapshot is caught", input: { ...good, files: { ...good.files, launchd: good.files.launchd.replace(/node scripts\/ops\/market-snapshot\.mjs;/g, "") } }, expect: 1 },
    { name: "a materialiser that stopped composing from the module is caught", input: { ...good, files: { ...good.files, materialise: good.files.materialise.replace("composeBriefingPrompt(", "oldPrompt(") } }, expect: 1 },
    { name: "a screen that dropped the final line is caught", input: { ...good, files: { ...good.files, screen: good.files.screen.replace(/c\.final_line/g, "c.nothing") } }, expect: 1 },
  ];

  let ok = 0;
  for (const c of cases) {
    const problems = await check(c.input);
    const pass = c.expect === 0 ? problems.length === 0 : problems.length > 0;
    if (pass) ok++;
    else console.error(`  ✗ ${c.name}\n    ${problems.length ? problems.join("\n    ") : "(no problems reported)"}`);
  }
  if (ok !== cases.length) {
    console.error(`the-briefing-is-on-par self-test FAILED: ${ok}/${cases.length}`);
    process.exit(1);
  }
  console.log(`the-briefing-is-on-par self-test: ${ok}/${cases.length} fixtures detected correctly.`);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const input = await load();
  const problems = await check(input);
  if (problems.length) {
    console.error("the-briefing-is-on-par FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }
  const n = input.fixture.delivers.sections.length;
  const src = input.fixture.delivers.sources.length;
  console.log(
    `the-briefing-is-on-par: the live fixture (${input.fixture.day}) carries ${n} sections and ${src} article-level sources; ` +
    `every summary figure and headline number is cited inline, every [n] resolves, the dashboard is built from ` +
    `${input.fixture.markets.quotes.length} feed quotes, nothing astrological, and the prompt, runner, launchd, migration and screen are wired. OK.`,
  );
}
