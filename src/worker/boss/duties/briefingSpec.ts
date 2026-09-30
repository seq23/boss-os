import { BRIEFING_SECTIONS, hasFigure, sectionKeyOf, usableSources } from "../today/briefing";
import { dateTimeFormat, OWNER_TIMEZONE } from "@shared/boss/timezone";

/**
 * THE EXECUTIVE BRIEFING'S PRODUCTION SPECIFICATION, AS CODE THE LANE READS.
 *
 * ─── What she asked for, 19 September 2026 ─────────────────────────────────
 *
 *   "I keep opening my OpenAI app and the executive briefing there is far superior to anything in
 *    Boss OS and West Peek OS. I created a txt file of today's briefing, the model prompt, and the
 *    list of sources and which model. Fix Boss OS's daily executive briefing to be just like the one
 *    in my txt file. Delivered automatically daily to me only. ... Leave astrology and travel-map
 *    colours out — those live in the Spirit tab."
 *
 * The file is `~/Desktop/executive intelligence briefing v2.txt`: a full report, its source stack,
 * and the reproducible production prompt it was made with. This module is that prompt, ported and
 * adapted to her, minus everything astrological — and it is a MODULE rather than a migration
 * string, because the last eight rewrites of this prompt each landed as `UPDATE standing_duties SET
 * task_input = json_set(...)` in a numbered SQL file, and four validators had to hunt the newest
 * migration for `$.prompt` to find out what the run was actually being told. A specification that
 * lives in a data row nobody can diff is one every rewrite silently forks.
 *
 * `materialise.ts` composes the prompt from here on every firing. `deliverReport.ts` grades what
 * comes back against the same schema. `scripts/validate/the-briefing-is-on-par.mjs` runs both over
 * the fixture the live run produced. One module, three readers, no second copy.
 *
 * ─── Measured, on the last fourteen days of production (CONFIRMED, 19 Sep 2026) ────
 *
 *   · Every run was `claude-haiku-4-5` on Claude Code with a 900 s leash; 3–7 minutes; four bullets
 *     a section, bold forbidden, no numbers allowed to open a sentence. A newspaper cut to a memo.
 *   · The dashboard on 19 Sep read S&P 500 7,637.76 (+1.1%), Nasdaq 26,418 (+1.7%), Dow 51,778
 *     (+0.6%). Yahoo's chart API for the same close: 7,650.5 (+0.17%), 26,522.5 (+0.40%),
 *     51,682.6 (−0.18%). Three of three index figures wrong, every one cited to a source.
 *   · The prompt said "SpaceX is not publicly listed; never invent a ticker" — a FACT baked into an
 *     instruction whose own specification says to verify it every day. SPCX quoted $152.71 on
 *     18 Sep. The 14 Sep and 16 Sep reports said public; the 19 Sep report said private.
 *   · 15 Sep's report is byte-identical to 14 Sep's. The run was killed at 900 s having spent $0,
 *     and the runner read the PREVIOUS day's `delivers.json` from the shared workspace and graded
 *     it "complete". She read Sunday's briefing on Tuesday, labelled Tuesday.
 *   · The duty says 06:30 Central. The Worker's cron is hourly, so it fires at 07:00; the Mac's
 *     next slot is 07:10; the report lands 07:18–07:25. "By 07:00" was never once met.
 *
 * Every one of those has a fix in this change, and every fix has a guard.
 */

/** Bumped on every material change to the prompt or schema. Recorded on each report row. */
export const BRIEFING_PROMPT_VERSION = "2026-09-30.1";

/** The file's edition framing, which the Worker renders from the evidence rather than the prose. */
export const EDITION_LABEL = "Morning Edition • Central Time";

// ─── Sources ─────────────────────────────────────────────────────────────────

export interface SourceTier {
  tier: string;
  purpose: string;
  sources: { name: string; url: string }[];
}

/**
 * The file's source stack, minus its astronomy block. Tier 1 is primary and authoritative; a claim
 * that can be checked against Tier 1 should be. Tier 2 is the wires. Tier 3 is specialist.
 */
export const SOURCE_TIERS: SourceTier[] = [
  {
    tier: "Tier 1 — primary / authoritative",
    purpose: "Markets, macro, government, courts, filings. Prefer these for any number that will be traded on.",
    sources: [
      { name: "Federal Reserve", url: "https://www.federalreserve.gov/" },
      { name: "U.S. Treasury", url: "https://home.treasury.gov/" },
      { name: "Bureau of Labor Statistics", url: "https://www.bls.gov/" },
      { name: "Bureau of Economic Analysis", url: "https://www.bea.gov/" },
      { name: "SEC / EDGAR", url: "https://www.sec.gov/" },
      { name: "Federal Trade Commission", url: "https://www.ftc.gov/" },
      { name: "Department of Justice", url: "https://www.justice.gov/" },
      { name: "Federal Communications Commission", url: "https://www.fcc.gov/" },
      { name: "Supreme Court of the United States", url: "https://www.supremecourt.gov/" },
      { name: "White House", url: "https://www.whitehouse.gov/" },
      { name: "Congress.gov", url: "https://www.congress.gov/" },
      { name: "SpaceX", url: "https://www.spacex.com/" },
      { name: "NASA", url: "https://www.nasa.gov/" },
      { name: "FAA", url: "https://www.faa.gov/" },
      { name: "Anthropic", url: "https://www.anthropic.com/" },
      { name: "OpenAI", url: "https://openai.com/" },
      { name: "NVIDIA", url: "https://www.nvidia.com/" },
    ],
  },
  {
    tier: "Tier 2 — high-quality news / financial reporting",
    purpose: "Original reporting on the day. Deduplicate syndication: one underlying event is one story.",
    sources: [
      { name: "Reuters", url: "https://www.reuters.com/" },
      { name: "Bloomberg", url: "https://www.bloomberg.com/" },
      { name: "Financial Times", url: "https://www.ft.com/" },
      { name: "Wall Street Journal", url: "https://www.wsj.com/" },
      { name: "CNBC", url: "https://www.cnbc.com/" },
      { name: "Associated Press", url: "https://apnews.com/" },
      { name: "New York Times", url: "https://www.nytimes.com/" },
      { name: "Washington Post", url: "https://www.washingtonpost.com/" },
    ],
  },
  {
    tier: "Tier 3 — venture / private markets / technology",
    purpose: "Rounds, secondaries, GP-leds, continuation vehicles, tenders, NAV lending, DPI pressure.",
    sources: [
      { name: "PitchBook", url: "https://pitchbook.com/" },
      { name: "Crunchbase", url: "https://www.crunchbase.com/" },
      { name: "TechCrunch", url: "https://techcrunch.com/" },
      { name: "The Information", url: "https://www.theinformation.com/" },
      { name: "Axios", url: "https://www.axios.com/" },
      { name: "Fortune", url: "https://fortune.com/" },
      { name: "Secondaries Investor", url: "https://www.secondariesinvestor.com/" },
      { name: "Buyouts", url: "https://www.buyoutsinsider.com/" },
      { name: "Private Equity International", url: "https://www.privateequityinternational.com/" },
      { name: "Institutional Investor", url: "https://www.institutionalinvestor.com/" },
    ],
  },
];

/** Search terms the file names for the private-markets section. Carried so the run does not improvise them. */
export const PRIVATE_MARKETS_QUERIES = [
  "GP-led secondaries", "LP-led secondaries", "continuation vehicles", "tender offers", "employee liquidity",
  "late-stage private-company secondary pricing", "NAV financing", "fund restructurings", "LP liquidity",
  "private-market discounts and premiums", "secondary fund fundraising", "institutional allocation changes",
  "DPI and distribution pressure",
];

// ─── Live market data ────────────────────────────────────────────────────────

export interface WatchlistEntry {
  /** The symbol the feed knows. */
  symbol: string;
  /** How the row reads on her screen. */
  label: string;
  kind: "index" | "yield" | "futures" | "crypto" | "equity";
  /** What the figure is: a close, a futures front-month, a spot, a par yield. Labelled, never mixed. */
  session_note: string;
}

/**
 * The file's dashboard set plus her one name. SPCX is on it BECAUSE it is public — the feed answers
 * the public/private question every morning with a quote or a refusal, which is the daily
 * verification the specification demands and the old prompt hard-coded the wrong answer to.
 */
export const MARKET_WATCHLIST: WatchlistEntry[] = [
  { symbol: "^GSPC", label: "S&P 500", kind: "index", session_note: "index close" },
  { symbol: "^IXIC", label: "Nasdaq Composite", kind: "index", session_note: "index close" },
  { symbol: "^DJI", label: "Dow Jones Industrial", kind: "index", session_note: "index close" },
  { symbol: "US10Y", label: "10-year Treasury", kind: "yield", session_note: "Treasury par yield, daily" },
  { symbol: "US2Y", label: "2-year Treasury", kind: "yield", session_note: "Treasury par yield, daily" },
  { symbol: "BZ=F", label: "Brent crude", kind: "futures", session_note: "front-month futures settle" },
  { symbol: "CL=F", label: "WTI crude", kind: "futures", session_note: "front-month futures settle" },
  { symbol: "GC=F", label: "Gold", kind: "futures", session_note: "front-month futures settle" },
  { symbol: "BTC-USD", label: "Bitcoin", kind: "crypto", session_note: "spot, 24h" },
  { symbol: "SPCX", label: "SpaceX (SPCX)", kind: "equity", session_note: "regular-session close" },
];

/** Free, keyless, and named. Yahoo's chart endpoint for quotes; the Treasury's own CSV for yields. */
export const MARKET_FEEDS = {
  yahoo_chart: "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d",
  treasury_par_yield_csv:
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv",
} as const;

/** One fetched figure, with its provenance. Written by `scripts/ops/market-snapshot.mjs`. */
export interface MarketQuote {
  symbol: string;
  label: string;
  kind: WatchlistEntry["kind"];
  /** Null when the feed did not answer. The row then reads "not available at HH:MM CT". */
  value: number | null;
  change_pct: number | null;
  previous_close: number | null;
  /** ISO instant the figure is AS OF (the session it belongs to), not when it was fetched. */
  as_of: string | null;
  session_note: string;
  /** Where it came from — a real URL — and when the snapshot opened it. */
  source_url: string;
  fetched_at: string;
  /** Present when the feed refused or returned nothing usable. */
  error?: string;
  /** Closes for the last five sessions, oldest first, when the feed gave them. */
  closes?: number[];
}

export interface MarketData {
  fetched_at: string;
  quotes: MarketQuote[];
  /** Every URL the snapshot opened, with the outcome. The "sources consulted" ledger for the data half. */
  consulted: { url: string; status: string; fetched_at: string }[];
}

// ─── What the report may not contain ────────────────────────────────────────

/**
 * Astrology and the Money / Career / Travel Map live on the Spirit page. Her mail of 12 Sep 2026
 * moved them; her brief of 19 Sep repeats it. A report that grows either back is mixing them again,
 * and it is stripped here with the section named — never quietly rendered.
 *
 * The dashboard's own 🟢 🟡 🔴 regime labels are analyst classifications and are NOT the map; the
 * map is matched on its words, not its colours.
 */
export const EXCLUDED_CONTENT: { name: string; pattern: RegExp }[] = [
  {
    name: "astrology",
    pattern: /\b(astrolog\w*|zodiac|ephemeris|retrograde|lunation|full moon|new moon|moon phase|void[- ]of[- ]course|natal chart|tropical\/geocentric|mercury (?:direct|station)|harvest moon)\b/i,
  },
  {
    name: "travel map",
    pattern: /\b(travel map|travel guidance|map transition|reset window|money\s*\/\s*career|locked (?:2026 )?(?:map|framework|planning framework)|operating instruction|peak money week)\b/i,
  },
];

// ─── The section schema ──────────────────────────────────────────────────────

export interface SectionShape {
  key: string;
  heading: string;
  /** What the run must put in it, in the file's terms. */
  brief: string;
  /** Minimum bullets/items for the section to count as filled. */
  min_items: number;
  /** Ceiling, so a quiet day is a short report and a loud day is not a newspaper. */
  max_items: number;
  /** Every item must carry at least one figure and one inline citation. */
  numbers_and_citations_required: boolean;
}

const HEADING = new Map(BRIEFING_SECTIONS.map((s) => [s.key, s.title]));

/**
 * The eleven sections of §5, each with the depth the file has.
 *
 * ORDER AND KEYS ARE §5's — `BRIEFING_SECTIONS` is the registry every screen and validator already
 * reads, and renaming would fork it. The DEPTH is the file's: five summary items with numbers, five
 * headlines each with a data block and a why-it-matters, six-line sections elsewhere. The 0243
 * four-bullet cap is what made the Boss OS briefing a memo beside the OpenAI report.
 */
export const SECTION_SHAPES: SectionShape[] = [
  {
    key: "one_minute_summary", heading: HEADING.get("one_minute_summary")!,
    brief: "The 3–5 developments an investor needs first. Each: what happened, the key number(s), what changed, why it matters. Two or three sentences each. EVERY item carries a figure and an inline citation [n].",
    min_items: 3, max_items: 5, numbers_and_citations_required: true,
  },
  {
    key: "top_5_headlines", heading: HEADING.get("top_5_headlines")!,
    brief: "Exactly five unless fewer are genuinely material. Each item: headline (the claim, not the topic); summary (what happened, versus prior expectations); numbers (a data block of 2–6 lines, each a labelled figure with [n]; the FIRST line is the single figure that defines the story, written as a bold callout); why_it_matters (two to four short paragraphs: second-order effects, who benefits, who is exposed, what the market may be missing, what to monitor next; where the story splits the market, set the two competing readings side by side as Narrative A and Narrative B and say what each implies for rates, duration assets and private-market marks); importance X/10 on the file's weights, never inflated.",
    min_items: 3, max_items: 5, numbers_and_citations_required: true,
  },
  {
    key: "markets_dashboard", heading: HEADING.get("markets_dashboard")!,
    brief: "The table is built BY THE SYSTEM from MARKETS.json — do not type figures into it. Your job here is the regime read: 3–6 bullets classifying equities, rates, oil, AI fundamentals, AI valuations, IPO market, private-market liquidity and the secondaries opportunity as 🟢 constructive / 🟡 mixed / 🔴 adverse, with one sentence each on what rates + inflation + growth + liquidity + earnings + risk appetite are doing to prices. Close with the single question the quarter turns on, in the form 'what if X is not temporary?', and what private-market pricing assumed about it.",
    min_items: 3, max_items: 8, numbers_and_citations_required: false,
  },
  {
    key: "spacex_watch", heading: HEADING.get("spacex_watch")!,
    brief: "MANDATORY. MARKETS.json answers public/private for today: a SPCX quote means it trades; a null means say so and use verified private references. Items, each with bullets: 'SPCX' (close, % move, prior close, volume if notable, IPO price and % versus it, market capitalisation where a cited source gives one, recent high/low and the session's open/high/low, after-hours if reported — from MARKETS.json and cited sources); 'Price Map' (real recent support and resistance zones from actual trading history, each with why it matters, closing with 'trading references, not forecasts' — never invented); 'Starship Watch' (next flight, verified date, regulatory status, objectives, milestones); 'Starlink Watch'; 'Supply / Lockup Watch' (lockups, insider sales, index inclusion or rebalancing, ownership changes).",
    min_items: 2, max_items: 5, numbers_and_citations_required: false,
  },
  {
    key: "ai_technology", heading: HEADING.get("ai_technology")!,
    brief: "The most consequential AI/technology developments and what each changes in the investment thesis: frontier models, enterprise AI, agents, inference, chips, compute, data centres, power, robotics, AI security, model economics, hyperscaler capex, major funding and M&A. Not a roundup — the pattern. Separate AI CAPABILITY (moving fast) from AI ECONOMICS (compute and infrastructure commitments, hyperscaler dependency, distribution, unit economics, the cost of governance and assurance), and say what the moat is measured in beyond model quality.",
    min_items: 2, max_items: 6, numbers_and_citations_required: false,
  },
  {
    key: "capital_markets", heading: HEADING.get("capital_markets")!,
    brief: "IPO filings and pricings, first-day trading, follow-ons, debt and converts, large acquisitions, restructurings. For each: valuation, structure, proceeds, who led, what it says about what investors will actually pay today, and the read-through to private marks.",
    min_items: 2, max_items: 6, numbers_and_citations_required: false,
  },
  {
    key: "private_markets", heading: HEADING.get("private_markets")!,
    brief: "HIGH PRIORITY — this is her business. GP-led and LP-led secondaries, continuation vehicles, tenders, employee liquidity, secondary pricing, late-stage resets, allocation changes, LP liquidity, DPI pressure, NAV financing, fund restructurings, secondary fundraises. Distinguish headline preferred valuation from common-equivalent economics; liquidity stress from asset impairment. Ask what each item says about liquidity, price discovery, buyer demand, seller motivation, duration and capital availability. Give one bullet on the secondaries setup of the moment in the file's frame: QUALITY WITHOUT LIQUIDITY, not distress — where a good company and a motivated owner (DPI need, exit slipping, ageing fund life, LPs preferring a liquid yield) produce a spread between ASSET VALUE and OWNER VALUE, and how the risk-free rate moves it.",
    min_items: 2, max_items: 6, numbers_and_citations_required: false,
  },
  {
    key: "government_legal", heading: HEADING.get("government_legal")!,
    brief: "Group under AI governance, courts, trade and regulation where the day has them. Only consequential items: White House, Congress, Supreme Court, SEC, FTC, DOJ, FCC, Treasury, Fed, major federal courts, state actions with national economic consequences. Investor consequences, never theatre; politically neutral; proposed vs enacted vs blocked vs litigated; emergency order vs injunction vs appellate vs merits vs final.",
    min_items: 1, max_items: 6, numbers_and_citations_required: false,
  },
  {
    key: "investor_insight", heading: HEADING.get("investor_insight")!,
    brief: "ONE genuinely non-obvious insight joining several of today's developments — for example that counterparty concentration, not revenue concentration, is the hidden variable: who is simultaneously investor, supplier, distributor and competitor. Observation → mechanism → implication, good enough to repeat in an investment committee. Four parts (synthesis, how_reached, transferable_frame, falsified_by) and cites into this report's own sections. If today's material does not support one, say so and file none.",
    min_items: 1, max_items: 1, numbers_and_citations_required: false,
  },
  {
    key: "key_events", heading: HEADING.get("key_events")!,
    brief: "Today's and this week's scheduled catalysts in Central Time — releases, Fed events, earnings, IPO pricings, decisions, launches, deadlines — each with WHAT TO WATCH (for a print, name the lines that matter, e.g. headline vs core vs services inflation; for earnings, the signals that matter for the AI buildout). On a closed-market day, the questions heading into the next session: does the 10-year hold below 5%? does crude keep retreating? how is the filing digested?",
    min_items: 2, max_items: 8, numbers_and_citations_required: false,
  },
  {
    key: "one_thing_to_watch", heading: HEADING.get("one_thing_to_watch")!,
    brief: "ONE emerging story that could matter more over days, weeks or months. What is happening; why investors may be underestimating it; what evidence would confirm it; what would invalidate it; the public and private-market implications, and — for secondaries — the underwriting questions: revenue quality, concentration, compute commitments, dependency, capital needs, exit timing, then WHAT DOES THE OWNER NEED? One of the most thoughtful sections, written as an argument with an analogy, not a list.",
    min_items: 3, max_items: 6, numbers_and_citations_required: false,
  },
];

// ─── The prompt ──────────────────────────────────────────────────────────────

export interface PromptContext {
  /** "Saturday, September 19, 2026" in her zone. */
  dayLabel: string;
  /** Whether MARKETS.json will be in the workspace. The prompt is honest about what is there. */
  hasMarketData: boolean;
  /** Today's diary lines, if the system has them. Optional; the report is not about her calendar. */
  calendar?: string[];
}

/**
 * The production prompt, composed on every firing.
 *
 * PORTED FROM THE FILE'S "Daily Morning Investor Intelligence Report — Production Prompt" — the
 * astrology-free version the OpenAI model itself produced when asked to strip it — and adapted in
 * exactly four places: the reader (her businesses, her watchlist), the evidence packet (MARKETS.json
 * and SKY.json are on disk), the output contract (delivers.json, which the Worker grades), and the
 * rules this repository already enforces and the file leaves implicit (per-section sources, gaps vs
 * watching, the closed-market dashboard rule, no bold in bullets).
 *
 * The phrases the older validators pin — "Not just the dashboard.", "sources REQUIRED", "RENDER THE
 * LAST CLOSE AND LABEL IT", every section key — are kept deliberately. They are still the rules.
 */
export function composeBriefingPrompt(ctx: PromptContext): string {
  const sectionList = SECTION_SHAPES
    .map((s) => `  ${s.key.padEnd(20)} ${s.heading} — ${s.brief}`)
    .join("\n\n");

  const tiers = SOURCE_TIERS
    .map((t) => `${t.tier}. ${t.purpose}\n` + t.sources.map((s) => `  - ${s.name} — ${s.url}`).join("\n"))
    .join("\n\n");

  const watchlist = MARKET_WATCHLIST.map((w) => `  ${w.label} (${w.symbol}) — ${w.session_note}`).join("\n");

  const calendar = ctx.calendar && ctx.calendar.length
    ? `\nHER DIARY TODAY, from the system (context only, never a section):\n${ctx.calendar.map((c) => `  - ${c}`).join("\n")}\n`
    : "";

  return [
`# EXECUTIVE INTELLIGENCE ENGINE
## Daily Morning Investor Intelligence Report — Production Prompt ${BRIEFING_PROMPT_VERSION}

Today is ${ctx.dayLabel}, America/Chicago. She reads this at 7am, standing up, with coffee, before a
day of work. It has to replace the briefing she currently gets from another product, which she
described as far superior to this one. Match its depth, its numbers and its sourcing.

You are an Executive Intelligence Engine for a sophisticated venture-capital, private-markets,
late-stage secondaries, technology and capital-markets investor. She runs a venture fund, is a
registered representative at a brokerage, is raising from family offices and endowments, and holds
small web properties that live or die on search. Weight everything toward late-stage secondaries and
private markets.

Your job is NOT to summarize the internet. Determine: what materially changed in the last 24 hours;
what actually matters to an investor/operator; what is noise; what deserves attention today; and the
second- and third-order investment implications. The finished product should read like a private
morning briefing prepared by a macro strategist, a venture capitalist, a late-stage secondaries
investor, a technology analyst, an AI analyst, a capital-markets analyst, a geopolitical analyst, a
CIO and a chief of staff, working together.

NO IMAGES. Default timezone: America/Chicago / Central Time.

==================================================
CORE PRINCIPLE
==================================================

DO NOT merely summarize headlines. For every major development determine: What happened? What
materially changed? Why does it matter? Who benefits? Who is exposed? What does the market appear to
be pricing? What could investors be missing? What are the second-order effects? What should a
sophisticated investor monitor next?

Separate FACT from ANALYSIS from INFERENCE. Never present speculation as fact.

Never invent: prices, valuations, funding rounds, acquisitions, IPOs, earnings, market movements,
government actions, legislation, regulatory actions, court decisions, company announcements, launch
dates, quotes, sources. If information cannot be verified, explicitly say so. Accuracy beats
completeness. Freshness is mandatory: current prices, news, events, transactions and regulatory
developments MUST come from retrieved evidence, never from model memory.

==================================================
THE EVIDENCE PACKET ALREADY IN YOUR WORKING DIRECTORY
==================================================

${ctx.hasMarketData
  ? `MARKETS.json — LIVE MARKET DATA fetched by this system minutes ago from Yahoo Finance's chart API
and the U.S. Treasury's own daily par-yield CSV. Every figure carries its symbol, value, % change,
previous close, the instant it is AS OF, its session (index close / futures front-month / spot / par
yield) and the URL it came from. THE MARKETS DASHBOARD TABLE IS BUILT BY THE SYSTEM FROM THIS FILE;
you do not type its figures. Use its numbers everywhere else you need them (the summary, the
headlines, SpaceX Watch) and cite MARKETS.json's entries by copying them into your sources list.
A quote with value null was not available — say "not available at the time of the snapshot" and
never fill it from memory or from a search result. Any OTHER figure you cannot verify from a source
you opened is written as "not available at HH:MM CT" (the Central time you looked), never estimated.

  SPCX IS ON THE WATCHLIST. A quote for it means SpaceX is publicly traded today and the SpaceX
  Watch leads with the stock. A null means the feed did not confirm a listing — then verify from
  current sources before writing a price, and if you cannot, state plainly that no verified public
  price exists and use the latest verified tender or secondary reference instead.`
  : `MARKETS.json is NOT present this morning — the live market snapshot did not run. Verify every
market figure from a Tier 1 or Tier 2 source you actually open, label its session and date, and cite
it. If a figure cannot be verified, write "not available at HH:MM CT" in its place.`}

EXECUTIVE_INTELLIGENCE.md — the long-form specification. Its §5 order and its truth rules govern.

SKY.json — planetary positions computed by this system. IT IS NOT FOR THIS REPORT. Astrology and the
Money / Career / Travel Map live on her Spirit page. Do not include either, in any form, in any
section. A report containing them is stripped and named on her screen.
${calendar}
Watchlist the dashboard carries (for reference — the system builds the table):
${watchlist}

==================================================
RESEARCH WINDOW AND SOURCES
==================================================

Primary research window: LAST 24 HOURS. Expand to 72 hours for developing stories, 7 days when
context is necessary, older only for essential background. Prioritize primary sources, then original
reporting, then high-quality financial news, then specialist industry sources. Do not elevate a story
because many publications repeated it. Deduplicate syndication: ONE UNDERLYING EVENT = ONE STORY.

Verify important developments against a primary source where one exists: monetary policy → Federal
Reserve; securities → SEC/EDGAR/exchange filings; M&A → company announcement plus filing; IPO →
S-1/F-1/prospectus; government → the agency, the White House, Congress; courts → the opinion, order or
docket; companies → newsroom, IR, filing; market data → MARKETS.json; space → SpaceX, NASA, FAA, FCC.
If an article contradicts a primary source, prefer the primary source.

SOURCE STACK:

${tiers}

For the private-markets section search specifically for: ${PRIVATE_MARKETS_QUERIES.join("; ")}.

OPEN EVERYTHING YOU CITE. You have web search and page fetching (WebSearch and WebFetch; on the
OpenAI seat, the native web_search tool and curl in the shell). Use them generously — twenty to forty
fetches is normal for a report of this depth. A source you did not open is not a source. Every entry
in your sources list is a REAL, ARTICLE-LEVEL URL (never a homepage or a category page) with the ISO
time you actually opened it; a fabricated read_at is a fabricated source.

==================================================
EDITORIAL FILTER, STORY SELECTION AND SCORING
==================================================

Include only developments likely to matter to sophisticated, venture, private-market, late-stage and
technology investors, founders/operators and capital allocators, across: major U.S.-relevant news;
macro; rates; inflation; energy; capital markets; AI; technology; venture capital; private markets;
secondaries; major rounds; M&A; IPOs; corporate developments; federal policy; regulation; major
litigation; the Supreme Court; economically relevant geopolitics; SpaceX / Starlink / Starship.

IGNORE celebrity news, viral stories, routine political theater, minor rounds, incremental product
releases, low-impact PR, repetitive market commentary and anything without an identifiable investor
consequence.

Rank candidates on economic magnitude, market impact, capital-allocation implications, durability,
private-market relevance, technology significance, policy significance, second-order consequences,
novelty and change versus prior expectations. Ask: "Did this change the underwriting?" If not, it is
not in the Top 5.

INVESTOR IMPORTANCE SCORE X/10 on each headline: 25% magnitude, 20% capital-market impact, 20%
durability, 15% private-market relevance, 10% technology/competitive, 10% policy/geopolitical.
9.5–10 potentially regime-changing; 9.0–9.4 major; 8.0–8.9 highly consequential; 7.0–7.9 important
but narrower; below 7 usually not Top 5. Do not inflate.

==================================================
REPORT STRUCTURE — THE ELEVEN SECTIONS, THEIR KEYS, AND THE DEPTH EACH NEEDS
==================================================

The system stamps the edition ("${EDITION_LABEL}", "Information checked through HH:MM CT") from
your sources' read times and MARKETS.json and numbers the sources. You file
the sections, in this order, under these keys:

${sectionList}

EVERY FIGURE CARRIES ITS SOURCE, IN EVERY SECTION. Not just the dashboard. Put the source in the
SECTION's own \`sources\` field on every section that prints a figure, AND cite inline with [n] —
the 1-based index into your \`sources\` list — immediately after the sentence the source supports.
The one-minute summary and every headline's data block MUST carry inline [n] citations on every
figure; the system removes an uncited figure before she sees it and names the section that lost it.
A citation proves provenance, never accuracy: check the number against the source you opened.

ON A DAY THE MARKET WAS CLOSED, RENDER THE LAST CLOSE AND LABEL IT — the system does this for the
dashboard from MARKETS.json's as-of dates; you do it in prose ("Friday's close"). Clearly distinguish
CLOSE, PREMARKET, INTRADAY and FUTURES and never mix them without labels.

A SECTION YOU CANNOT FILL IS OMITTED AND NAMED IN gaps. Never file a heading over nothing, and never
fill a section with plausible-looking data to avoid leaving it out. A quiet day is a shorter report
and that is a good outcome.

WRITING RULES:
  - The answer first, the evidence after. Lead with what it MEANS for her.
  - Direct, high-signal, numerically precise, sophisticated but readable, decisive about relevance,
    skeptical about facts, comfortable saying "not verified."
  - Bullets are one to three sentences; a headline's why_it_matters may run two to four short
    paragraphs. Depth over brevity where the depth is evidence; never padding.
  - BOLD IS FOR TWO THINGS ONLY, written **like this**: the one-sentence claim that opens each
    one-minute-summary item, and the defining figure that opens a headline's data block. Nowhere else.
  - A summary item is: the bold claim, then two or three sentences carrying the key numbers and why
    the day moves because of it, each figure cited [n].
  - A headline's why_it_matters opens by naming the lens in a few words ("Two competing narratives",
    "Ecosystem concentration", "Geopolitical premium versus physical supply") and then argues it.
    Short paragraphs, white space, one idea each. Lists of three to six parallel nouns are fine.
  - Say what changed, then the figure. Do not open a bullet with a bare number.
  - Never file a section that is a title, a date line, a cutoff note or a description of this report.
  - No fluff, no motivational language, no clickbait, no fake certainty, no unsupported claims.

THE INVESTOR INSIGHT is teaching, not commentary: ONE synthesized idea (never a restated headline),
how it was reached (which of today's facts were joined and what made them connect), the transferable
frame (the question to ask next time this shape appears), and what would falsify it. Pitch it at the
level of analytical frame — how an allocator connects a capex commitment to a discount rate to a
secondary bid — never at the level of definitions. She knows what a secondary is. Commit; do not
hedge. Every fact it joins must appear elsewhere in this report and be cited in \`cites\`; the system
checks this and withholds an insight whose facts are not in the day's material.

==================================================
FACTUAL INTEGRITY AND THE FINAL QUALITY-CONTROL PASS
==================================================

For every NUMBER: where did it come from, and what is its timestamp/session? For every EVENT: has it
actually happened? For every TRANSACTION: can I verify it? For every POLICY item: proposed, announced,
enacted, effective, blocked or litigated? For every COURT item: what exactly did the court rule?
Rumors are labelled rumors; anonymous sourcing is said. If two credible sources conflict, identify the
disagreement, seek a primary source, prefer primary evidence, preserve uncertainty if unresolved —
never silently choose the more interesting version. Did any stale fact from a previous report get
treated as current? Was SpaceX's public/private status established TODAY from MARKETS.json or a
source you opened, not inherited?

Before writing delivers.json for the last time, independently check: date and timezone correct;
sessions labelled; prices current; percentage changes arithmetically right; funding amounts vs
valuations distinguished; primary vs secondary transactions distinguished; duplicates removed; Top 5
actually the most consequential; every importance score defensible; private-markets section is
synthesis not summary; insight genuinely non-obvious; every major factual statement source-supported;
nothing stated with more certainty than the evidence allows.

ACCURACY > COMPLETENESS. SIGNAL > VOLUME. ANALYSIS > SUMMARY. EVIDENCE > CONFIDENCE.

==================================================
OUTPUT — delivers.json IN THE CURRENT WORKING DIRECTORY
==================================================

Write delivers.json as you go — after the summary, after the headlines, after each section — so a
kill at the leash leaves a real partial report rather than nothing. The system derives status; file
"partial" if you know a section is absent or a figure is unverified.

  status      "complete" or "partial".
  headline    ONE line, twelve words at most, no figures. The single thing that changed today.
  summary     Two or three short sentences: what the morning means for her, not what happened.
  sections    [{ key, heading, so_what, bullets, items, insight, sources }] in the order above.
                key       one of the eleven keys above.
                heading   the section name above.
                so_what   one sentence: what she should do or watch because of this section.
                bullets   strings, one to three sentences each, with inline [n] citations. Up to the
                          section's ceiling above.
                sources   REQUIRED on any section that prints a figure: an array of 1-based indexes
                          into your \`sources\` list (or names). A section that prints a money amount,
                          a percentage or a magnitude and names no resolvable source is not shown.
                items     top_5_headlines: [{ headline, as_of, summary, numbers: [string with [n]], why_it_matters, importance }]
                          as_of is the YYYY-MM-DD of the development itself. A Top 5 story is from the
                          last 24 hours; 72 hours only when it is still developing and you say what is
                          new today. The system flags a headline older than that. The 19 Sep run led
                          with a 3 Sep acquisition and a 13 Sep attack while that morning's Reuters
                          exclusive and an IPO filing from the day before went unmentioned.
                          spacex_watch: [{ headline, bullets: [..] }] for SPCX, Technical / Reference
                          Map, Starship Watch, Starlink Watch, Supply / Lockup Watch.
                insight   investor_insight only: { synthesis, how_reached, transferable_frame, falsified_by, cites: [{ fact, from }] }
                          where \`from\` is the key of the section in THIS report the fact came from.
  sources     [{ name, url, read_at }] — article-level URLs you opened, read_at the ISO instant you
              opened each. Include MARKETS.json's source entries for any of its figures you used.
  gaps        [{ wanted, why }] — things that EXIST and you could NOT verify, plus every section you
              could not fill, by name. A gap makes the report partial.
  watching    [{ wanted, why }] — FORWARD-LOOKING only: events that have not happened yet. These never
              make a report partial. A future event goes here and never in gaps.
  corrections [{ was, now, why }] — where today's verified reading contradicts a previous report.

Write nothing about her agenda, her coach, her schedule or what to do next; the report ends with its last section.`,
  ].join("\n");
}

// ─── Grading what came back ──────────────────────────────────────────────────

/** `[3]` or `[3][7]` or `[3, 7]` — the inline citation shapes the run may use. */
const INLINE_CITE = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

export function inlineCitations(text: unknown): number[] {
  if (typeof text !== "string") return [];
  const out: number[] = [];
  for (const m of text.matchAll(INLINE_CITE)) {
    for (const n of (m[1] ?? "").split(",")) {
      const v = Number(n.trim());
      if (Number.isFinite(v) && v > 0) out.push(v);
    }
  }
  return out;
}

export interface BriefingAssessment {
  /** Hard problems: sections the spec requires that are absent or thin. */
  problems: string[];
  sections_present: string[];
  sections_missing: string[];
  /** Summary items that carry a figure with no inline citation. The file cites every one. */
  summary_items_uncited: number;
  /** Headline data-block lines with a figure and no inline citation. */
  headline_numbers_uncited: number;
  /** Inline [n] references that point past the end of the sources list. */
  unresolved_citations: number[];
  /** Sources without an article-level URL or a parseable read_at. */
  unusable_sources: number;
  /** Sources that are a bare homepage rather than the article that was read. */
  homepage_sources: string[];
  /** Excluded content found, by section key and rule name. */
  excluded_hits: { key: string; rule: string }[];
  /** True when nothing at all was filed — Rule 0's own case. */
  empty: boolean;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Everything printable in a section, flattened, for the exclusion scan. */
export function sectionText(sec: Record<string, unknown>): string {
  const parts: string[] = [text(sec.heading), text(sec.so_what), text(sec.body)];
  for (const b of Array.isArray(sec.bullets) ? sec.bullets : []) parts.push(text(b));
  for (const it of Array.isArray(sec.items) ? sec.items : []) {
    if (typeof it === "string") parts.push(it);
    else if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      parts.push(text(o.headline), text(o.summary), text(o.why_it_matters));
      for (const n of Array.isArray(o.numbers) ? o.numbers : []) parts.push(text(n));
      for (const b of Array.isArray(o.bullets) ? o.bullets : []) parts.push(text(b));
    }
  }
  if (sec.insight && typeof sec.insight === "object") {
    const o = sec.insight as Record<string, unknown>;
    parts.push(text(o.synthesis), text(o.how_reached), text(o.transferable_frame), text(o.falsified_by));
  }
  if (sec.table && typeof sec.table === "object") parts.push(JSON.stringify(sec.table));
  return parts.filter(Boolean).join("\n");
}

/**
 * Grade a delivered report against the file's shape.
 *
 * RUN BY THE WORKER ON DELIVERY AND BY THE VALIDATOR ON THE FIXTURE. Neither side has a private
 * copy of the rules. A problem here is a shortfall on her screen and a red build in CI.
 */
export function assessBriefing(report: {
  sections?: unknown;
  sources?: unknown;
}, opts: {
  /** The day the report is for, YYYY-MM-DD in her zone. Enables the 72-hour freshness check. */
  dayId?: string;
  /** When the run finished. A source read after this was typed, not opened. */
  finishedAt?: number;
} = {}): BriefingAssessment {
  const sections = (Array.isArray(report.sections) ? report.sections : [])
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object");
  const rawSources = Array.isArray(report.sources) ? report.sources : [];
  const usable = usableSources({ sources: rawSources });

  const present = new Set<string>();
  const problems: string[] = [];
  const excluded: { key: string; rule: string }[] = [];
  const unresolved = new Set<number>();
  let summaryUncited = 0;
  let headlineUncited = 0;

  const noteCites = (s: unknown) => {
    for (const n of inlineCitations(s)) if (n > rawSources.length) unresolved.add(n);
  };
  const staleHeadlines: string[] = [];

  for (const sec of sections) {
    const key = sectionKeyOf(sec);
    const shape = SECTION_SHAPES.find((s) => s.key === key);
    const body = sectionText(sec);

    for (const rule of EXCLUDED_CONTENT) {
      if (rule.pattern.test(body)) excluded.push({ key: key ?? "unkeyed", rule: rule.name });
    }

    // Every inline citation anywhere must resolve.
    noteCites(sec.so_what);
    for (const b of Array.isArray(sec.bullets) ? sec.bullets : []) noteCites(b);
    for (const it of Array.isArray(sec.items) ? sec.items : []) {
      if (it && typeof it === "object") {
        const o = it as Record<string, unknown>;
        noteCites(o.summary); noteCites(o.why_it_matters);
        for (const n of Array.isArray(o.numbers) ? o.numbers : []) noteCites(n);
        for (const b of Array.isArray(o.bullets) ? o.bullets : []) noteCites(b);
      } else noteCites(it);
    }

    if (!key || !shape) continue;

    const items = Array.isArray(sec.items) ? sec.items : Array.isArray(sec.bullets) ? sec.bullets : [];
    const count = key === "investor_insight"
      ? (sec.insight && typeof sec.insight === "object" ? 1 : 0)
      : key === "markets_dashboard"
        ? items.length + (sec.table && typeof sec.table === "object" ? 1 : 0)
        : items.length;

    if (count >= Math.min(shape.min_items, 1)) present.add(key);
    if (count > 0 && count < shape.min_items) {
      problems.push(`${shape.heading} has ${count} item${count === 1 ? "" : "s"}; the specification asks for at least ${shape.min_items}.`);
    }

    if (key === "one_minute_summary") {
      for (const b of Array.isArray(sec.bullets) ? sec.bullets : []) {
        if (hasFigure(b) && inlineCitations(b).length === 0) summaryUncited++;
      }
    }
    if (key === "top_5_headlines") {
      for (const [i, it] of (Array.isArray(sec.items) ? sec.items : []).entries()) {
        if (!it || typeof it !== "object") continue;
        const o = it as Record<string, unknown>;
        const lines = Array.isArray(o.numbers) ? o.numbers : [];
        for (const n of lines) if (hasFigure(n) && inlineCitations(n).length === 0) headlineUncited++;
        if (lines.length === 0 && hasFigure(o.summary) && inlineCitations(o.summary).length === 0) headlineUncited++;
        /*
         * FRESHNESS IS GRADED WHEN THE RUN DATES ITS STORY. The file's research window is 24 hours,
         * 72 for a developing story. A headline dated further back than that is yesterday's paper.
         */
        if (opts.dayId && typeof o.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
          const age = (Date.parse(`${opts.dayId}T12:00:00Z`) - Date.parse(`${o.as_of}T12:00:00Z`)) / 86_400_000;
          if (age > 3) staleHeadlines.push(`Headline ${i + 1} is dated ${o.as_of}, ${Math.round(age)} days before the report`);
        }
      }
    }
  }

  const missing = SECTION_SHAPES.map((s) => s.key).filter((k) => !present.has(k));
  for (const k of missing) problems.push(`${HEADING.get(k) ?? k} is not in the report.`);
  if (summaryUncited > 0) problems.push(`${summaryUncited} summary item${summaryUncited === 1 ? "" : "s"} carr${summaryUncited === 1 ? "ies" : "y"} a figure with no inline [n] citation.`);
  if (headlineUncited > 0) problems.push(`${headlineUncited} headline figure${headlineUncited === 1 ? "" : "s"} carr${headlineUncited === 1 ? "ies" : "y"} no inline [n] citation.`);
  if (unresolved.size > 0) problems.push(`Inline citations ${[...unresolved].sort((a, b) => a - b).map((n) => `[${n}]`).join(" ")} point past the end of the sources list.`);
  const unusable = rawSources.length - usable.length;
  if (unusable > 0) problems.push(`${unusable} source${unusable === 1 ? "" : "s"} lack${unusable === 1 ? "s" : ""} an article URL or a readable read time.`);
  /*
   * A HOMEPAGE IS WHERE A SOURCE LIVES, NOT WHAT WAS READ. The file's eighteen footnotes are every
   * one an article. The live run of 19 Sep cited spaceflightnow.com/ bare, once in thirty — so the
   * rule is graded rather than assumed, and she sees which ones.
   */
  const homepages = usable.filter((s) => /^https?:\/\/[^/]+\/?$/.test(s.url)).map((s) => s.url);
  if (homepages.length > 0) problems.push(`${homepages.length} source${homepages.length === 1 ? " is" : "s are"} a bare homepage, not the article read: ${homepages.join(", ")}.`);
  /*
   * A READ TIME AFTER THE RUN FINISHED WAS TYPED, NOT OBSERVED. The 19 Sep live run finished at
   * 14:40:04Z and filed read_at values through 14:5xZ, one minute apart — a sequence, not a log.
   * The stamp already ignores them; her screen now says so too.
   */
  if (typeof opts.finishedAt === "number") {
    const typed = usable.filter((s) => Date.parse(s.read_at) > opts.finishedAt!).length;
    if (typed > 0) problems.push(`${typed} source read time${typed === 1 ? " is" : "s are"} after the run finished, so ${typed === 1 ? "it was" : "they were"} typed rather than observed.`);
  }
  for (const p of staleHeadlines) problems.push(`${p}; the research window is 24 hours, 72 for a developing story.`);
  for (const hit of excluded) problems.push(`${HEADING.get(hit.key) ?? hit.key} contains ${hit.rule} content, which belongs on the Spirit page.`);

  return {
    problems,
    sections_present: [...present],
    sections_missing: missing,
    summary_items_uncited: summaryUncited,
    headline_numbers_uncited: headlineUncited,
    unresolved_citations: [...unresolved].sort((a, b) => a - b),
    unusable_sources: unusable,
    homepage_sources: homepages,
    excluded_hits: excluded,
    empty: sections.length === 0,
  };
}

/** Sections with excluded content removed, so a stripped report can still print the rest. */
export function stripExcludedSections(sections: unknown[]): { kept: unknown[]; removed: { key: string; rule: string }[] } {
  const kept: unknown[] = [];
  const removed: { key: string; rule: string }[] = [];
  for (const sec of sections) {
    if (!sec || typeof sec !== "object") continue;
    const body = sectionText(sec as Record<string, unknown>);
    const hit = EXCLUDED_CONTENT.find((r) => r.pattern.test(body));
    if (hit) removed.push({ key: sectionKeyOf(sec as Record<string, unknown>) ?? "unkeyed", rule: hit.name });
    else kept.push(sec);
  }
  return { kept, removed };
}

// ─── The edition stamp ───────────────────────────────────────────────────────

function ctClock(ts: number): string {
  return dateTimeFormat("en-US", { timeZone: OWNER_TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(ts))
    .replace(/ /g, " ");
}

export function ctDayLabel(ts: number): string {
  return dateTimeFormat("en-US", { timeZone: OWNER_TIMEZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" })
    .format(new Date(ts));
}

/**
 * "Information checked through 6:28 AM CT" — DERIVED FROM THE EVIDENCE, NEVER TYPED BY THE RUN.
 *
 * The latest instant anything was actually read: the newest source read_at, the market snapshot's
 * fetch time, and the run's own finish, whichever is latest but never later than delivery. A run
 * that fabricated read times two hours before it started (19 Sep: read_at 07:15Z on a run dispatched
 * 12:00Z) cannot move this earlier than the snapshot it was handed.
 */
export function checkedThrough(args: {
  sources: unknown;
  market?: MarketData | null;
  finishedAt: number;
}): { at: number; label: string } {
  let latest = 0;
  for (const s of usableSources({ sources: args.sources })) {
    const t = Date.parse(s.read_at);
    if (Number.isFinite(t) && t <= args.finishedAt) latest = Math.max(latest, t);
  }
  const fetched = args.market?.fetched_at ? Date.parse(args.market.fetched_at) : NaN;
  if (Number.isFinite(fetched) && fetched <= args.finishedAt) latest = Math.max(latest, fetched);
  if (latest === 0) latest = args.finishedAt;
  return { at: latest, label: `Information checked through ${ctClock(latest)} CT` };
}

// ─── The dashboard, built from data ──────────────────────────────────────────

const fmt = (n: number, kind: WatchlistEntry["kind"]): string => {
  if (kind === "yield") return `${n.toFixed(2)}%`;
  if (kind === "futures" || kind === "equity" || kind === "crypto") return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};
const pct = (n: number): string => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;

/**
 * The Markets & Capital Dashboard, from MARKETS.json.
 *
 * NO MODEL TYPED THESE. Three of three index figures were wrong on 19 September with a citation
 * beside each — provenance without accuracy. A table the system builds from a feed it opened itself
 * is the only shape of this section that can be checked, and a row the feed did not answer reads
 * "not available at HH:MM CT" by construction rather than by the run's good behaviour.
 *
 * Returns the table, the source entries its rows rest on (appended to the report's sources), and
 * the count of rows that were not available.
 */
export function dashboardFromMarketData(market: MarketData, now: number): {
  table: { columns: string[]; rows: string[][] };
  sources: { name: string; url: string; read_at: string }[];
  unavailable: number;
  session_label: string;
} {
  const rows: string[][] = [];
  const sources: { name: string; url: string; read_at: string }[] = [];
  const seen = new Set<string>();
  let unavailable = 0;

  const asOfDates = market.quotes.map((q) => (q.as_of ? Date.parse(q.as_of) : NaN)).filter((t) => Number.isFinite(t));
  const newest = asOfDates.length ? Math.max(...asOfDates) : NaN;
  const sessionLabel = Number.isFinite(newest)
    ? dateTimeFormat("en-US", { timeZone: OWNER_TIMEZONE, weekday: "long", month: "short", day: "numeric" }).format(new Date(newest))
    : "Latest";

  for (const entry of MARKET_WATCHLIST) {
    const q = market.quotes.find((x) => x.symbol === entry.symbol);
    if (!q || q.value === null || !Number.isFinite(q.value)) {
      unavailable++;
      rows.push([entry.label, `not available at ${ctClock(now)} CT`, "—", entry.session_note]);
      continue;
    }
    const asOf = q.as_of ? dateTimeFormat("en-US", { timeZone: OWNER_TIMEZONE, month: "short", day: "numeric" }).format(new Date(Date.parse(q.as_of))) : "";
    rows.push([
      entry.label,
      fmt(q.value, entry.kind),
      q.change_pct === null ? "—" : pct(q.change_pct),
      `${entry.session_note}${asOf ? `, ${asOf}` : ""}`,
    ]);
    if (!seen.has(q.source_url)) {
      seen.add(q.source_url);
      sources.push({ name: `Market data — ${entry.label} (${q.symbol})`, url: q.source_url, read_at: q.fetched_at });
    }
  }

  return {
    table: { columns: ["Indicator", `${sessionLabel} latest`, "Change", "Session"], rows },
    sources,
    unavailable,
    session_label: sessionLabel,
  };
}

/** The SpaceX public/private answer, from the same feed, for the SpaceX Watch's first line. */
export function spacexStatus(market: MarketData | null | undefined): { public: boolean | null; line: string } {
  const q = market?.quotes.find((x) => x.symbol === "SPCX");
  if (!q) return { public: null, line: "SpaceX's listing status was not checked by the market snapshot this morning." };
  if (q.value === null) return { public: false, line: "The market feed returned no SPCX quote; no verified public SpaceX price exists in this report." };
  return {
    public: true,
    line: `SPCX ${fmt(q.value, "equity")}${q.change_pct === null ? "" : ` (${pct(q.change_pct)})`}${q.previous_close ? `, prior close ${fmt(q.previous_close, "equity")}` : ""} — ${q.session_note}.`,
  };
}

/**
 * The edition block the screen renders above the report:
 *
 *   Saturday, September 19, 2026 • Morning Edition • Central Time
 *   Information checked through 6:28 AM CT
 *
 * The day is the day the report is FOR (`day_id`), never the day it was written; the stamp is the
 * derived `checked_through` instant, or absent for rows written before it existed.
 */
export function editionStamp(args: { dayId: string; checkedThrough: number | null | undefined }): {
  day_label: string;
  edition_label: string;
  checked_through_label: string | null;
} {
  const [y, m, d] = args.dayId.split("-").map((v) => Number(v));
  const noon = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 18); // 18:00 UTC is midday-ish in Chicago on either side of DST
  return {
    day_label: ctDayLabel(noon),
    edition_label: EDITION_LABEL,
    checked_through_label:
      typeof args.checkedThrough === "number" && Number.isFinite(args.checkedThrough)
        ? `Information checked through ${ctClock(args.checkedThrough)} CT`
        : null,
  };
}

// ─── Applying the feed to a delivered report ─────────────────────────────────

/**
 * THE DASHBOARD IS BUILT FROM THE FEED, AND THE REPORT IS GRADED AGAINST THE FILE.
 *
 * Both are done HERE, on delivery, and not left to the prompt — see `briefingSpec.ts` for the
 * fourteen days of measurement behind that. What this adds to the row:
 *
 *   · `market_data`   — MARKETS.json as the runner observed it, verbatim. The dashboard table is
 *                       rebuilt from it; a symbol the feed did not answer reads "not available at
 *                       HH:MM CT" by construction. The run's own table, if it typed one, is replaced.
 *   · `checked_through` — the edition stamp, derived from the newest source read time and the
 *                       snapshot, never later than delivery and never taken from the run's prose.
 *   · `prompt_version` — which specification the run was handed, so a report can be read against
 *                       the rules that produced it.
 *   · `consulted`     — the sources-consulted ledger: every feed URL the snapshot opened with its
 *                       outcome, and every source the run cited with when it read it.
 *
 * Astrology or travel-map content in any section removes THAT SECTION and names it — the Spirit
 * page owns both, by her instruction of 12 September and again of 19 September.
 */
export function applyMarketData(
  sections: Record<string, unknown>[],
  sources: unknown[],
  market: MarketData | null | undefined,
  now: number,
): { sections: Record<string, unknown>[]; sources: unknown[]; unavailable: number; dashboard_built: boolean } {
  if (!market || !Array.isArray(market.quotes) || market.quotes.length === 0) {
    return { sections, sources, unavailable: 0, dashboard_built: false };
  }
  const built = dashboardFromMarketData(market, now);
  const nextSources = [...sources];
  const indexes: number[] = [];
  for (const src of built.sources) {
    const existing = nextSources.findIndex((s) => s && typeof s === "object" && (s as { url?: unknown }).url === src.url);
    if (existing >= 0) { indexes.push(existing); continue; }
    nextSources.push(src);
    indexes.push(nextSources.length - 1);
  }

  const out = sections.map((sec) => ({ ...sec }));
  const dashIdx = out.findIndex((sec) => sectionKeyOf(sec) === "markets_dashboard");
  const dashboard: Record<string, unknown> = dashIdx >= 0 ? out[dashIdx]! : { key: "markets_dashboard", heading: "Markets & Macro Dashboard" };
  const priorCited = Array.isArray(dashboard.sources) ? dashboard.sources : [];
  dashboard.table = built.table;
  dashboard.table_built_by = "system";
  dashboard.sources = [...new Set([...priorCited, ...indexes])];
  if (typeof dashboard.so_what !== "string" || !dashboard.so_what.trim()) {
    dashboard.so_what = `${built.session_label}'s figures, fetched by the system from the feeds named in the source list.`;
  }
  if (dashIdx >= 0) out[dashIdx] = dashboard;
  else out.splice(Math.min(2, out.length), 0, dashboard);

  // SpaceX's public/private answer for today leads the SpaceX Watch, from the same feed.
  const status = spacexStatus(market);
  const spxIdx = out.findIndex((sec) => sectionKeyOf(sec) === "spacex_watch");
  if (spxIdx >= 0 && status.public !== null) {
    const sec = out[spxIdx]!;
    const bullets = Array.isArray(sec.bullets) ? [...sec.bullets] : [];
    const spcxIndex = indexes[MARKET_SPCX_INDEX(market)] ?? null;
    bullets.unshift(`${status.line}${spcxIndex !== null ? ` [${spcxIndex + 1}]` : ""}`);
    sec.bullets = bullets;
    sec.sources = [...new Set([...(Array.isArray(sec.sources) ? sec.sources : []), ...(spcxIndex !== null ? [spcxIndex] : [])])];
    sec.spacex_public = status.public;
  }

  return { sections: out, sources: nextSources, unavailable: built.unavailable, dashboard_built: true };
}

/** Which of the dashboard's source entries is SPCX's, in the order `dashboardFromMarketData` emits them. */
function MARKET_SPCX_INDEX(market: MarketData): number {
  const seen: string[] = [];
  for (const q of market.quotes) {
    if (q.value === null || !Number.isFinite(q.value)) continue;
    if (!seen.includes(q.source_url)) seen.push(q.source_url);
    if (q.symbol === "SPCX") return seen.indexOf(q.source_url);
  }
  return -1;
}
