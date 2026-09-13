/**
 * THE EXECUTIVE BRIEFING HAS ELEVEN SECTIONS, AND NONE OF THEM MAY GO MISSING QUIETLY.
 *
 * ─── The defect, in her words ──────────────────────────────────────────────
 *
 *   "the executive breifing section is missing some sections (and u can make it scrollable)...like
 *    major news (top 5 headlines) a one min summary section, markets dashboard a tech section a
 *    cpaital markets secondary ipo m&A section....."
 *
 * Every section she named is ALREADY REQUIRED by the specification the duty is handed.
 * `docs/boss/EXECUTIVE_INTELLIGENCE.md` §5 lists eleven, in order, and production was delivering
 * three thematic analyst essays.
 *
 * ─── Which end was wrong, and how that was established ─────────────────────
 *
 * THE PRODUCER, not the consumer, and the evidence is in the repository's own migration history.
 * `0195` told the run "follow its standards for sourcing and honesty, but NOT its length", and
 * `0205` went further: "ignore it entirely on length and structure — THIS PROMPT GOVERNS THOSE",
 * then specified `sections: [{ heading, so_what, bullets }] — FOUR AT MOST`. The run was doing
 * exactly what it was told. The spec was never outvoted by a model; it was overruled by us.
 *
 * Both of those were written for a real defect — a twenty-section newspaper she could not read at
 * 7am — and the fix was aimed at the wrong thing. The problem was never that §5 has eleven
 * sections; it was that a section was a wall of figures with no answer in it. §5's own sections are
 * SHORT and each one has a job. So the prompt returns to §5's structure and keeps 0205's rules
 * about writing: answer first, bullets not paragraphs, no invented data, gaps named.
 *
 * ─── What this file is ─────────────────────────────────────────────────────
 *
 * The registry of §5's sections and the two rules that make the delivery honest:
 *
 *   1. A SECTION IS RENDERED OR IT IS NAMED AS MISSING. Never silently absent. `status: "partial"`
 *      then means something she can see, instead of a short report that looks complete.
 *
 *   2. AN INSIGHT RESTS ON THE DAY'S OWN MATERIAL. The Investor Insight cites the facts it joined,
 *      and a citation that is not in today's report is not a synthesis — it is a pattern
 *      manufactured out of a thin news day, on a page read by a registered representative. An
 *      ungrounded insight is WITHHELD and reported, not printed with a hedge.
 */

/** One section of §5, in §5's order. `title` is the spec's own heading, verbatim. */
export interface BriefingSection {
  key: string;
  title: string;
}

/**
 * §5's eleven sections, in §5's order.
 *
 * `scripts/validate/every-spec-section-is-rendered-or-named.mjs` parses the headings out of
 * `docs/boss/EXECUTIVE_INTELLIGENCE.md` and fails if this list and that document disagree — so the
 * registry cannot drift from the specification it claims to implement, in either direction.
 */
export const BRIEFING_SECTIONS: BriefingSection[] = [
  { key: "one_minute_summary", title: "One-Minute Executive Summary" },
  { key: "top_5_headlines", title: "Top 5 Headlines" },
  { key: "markets_dashboard", title: "Markets & Macro Dashboard" },
  { key: "spacex_watch", title: "SpaceX Watch" },
  { key: "ai_technology", title: "AI & Technology" },
  { key: "capital_markets", title: "Capital Markets / IPO / M&A" },
  { key: "private_markets", title: "VC / Private Markets / Secondaries Roundup" },
  { key: "government_legal", title: "Government / Legal / Supreme Court / Regulation" },
  { key: "investor_insight", title: "Investor Insight" },
  { key: "key_events", title: "Key Events Today" },
  { key: "one_thing_to_watch", title: "One Thing to Watch" },
];

const BY_KEY = new Map(BRIEFING_SECTIONS.map((s) => [s.key, s]));

/** Loose enough to survive an ampersand, a slash or a stray capital; strict enough not to collide. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

const BY_TITLE = new Map(BRIEFING_SECTIONS.map((s) => [normalise(s.title), s.key]));

/**
 * Which §5 section a delivered block is, or null if it is not one of them.
 *
 * The `key` is the contract and the heading is the fallback, because every report written before
 * this change carries a thematic heading and no key at all. Recognising those where we honestly
 * can costs nothing and keeps a historical day from reporting eleven absences.
 */
export function sectionKeyOf(sec: Record<string, unknown> | null | undefined): string | null {
  if (!sec || typeof sec !== "object") return null;
  const key = typeof sec.key === "string" ? sec.key.trim() : "";
  if (key && BY_KEY.has(key)) return key;
  const heading = typeof sec.heading === "string" ? sec.heading : "";
  return heading ? BY_TITLE.get(normalise(heading)) ?? null : null;
}

/**
 * §5's order, with anything the run filed beyond §5 kept at the end.
 *
 * EXTRA SECTIONS ARE NOT DISCARDED. A run that found something real and filed it under a heading
 * of its own has done work she paid for; dropping it here would be the same class of loss as the
 * old `slice(0, 4)`, which silently threw away ten sections of research on 8 September.
 */
export function orderSections(sections: unknown[]): Record<string, unknown>[] {
  const rows = sections.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object");
  const rank = (s: Record<string, unknown>) => {
    const key = sectionKeyOf(s);
    return key ? BRIEFING_SECTIONS.findIndex((x) => x.key === key) : BRIEFING_SECTIONS.length;
  };
  return rows
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s);
}

/** Is there anything in this block worth calling content? */
export function sectionHasContent(sec: Record<string, unknown>): boolean {
  const nonEmpty = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : Boolean(v));
  return (
    nonEmpty(sec.so_what) || nonEmpty(sec.body) || nonEmpty(sec.bullets) ||
    nonEmpty(sec.items) || nonEmpty(sec.insight) ||
    (Boolean(sec.table) && typeof sec.table === "object" && Array.isArray((sec.table as any).rows) && (sec.table as any).rows.length > 0)
  );
}

export interface MissingSection {
  key: string;
  title: string;
  why: string;
}

/**
 * The §5 sections this report does not carry, each with the reason it does not.
 *
 * A GAP THE RUN ALREADY NAMED IS USED AS THE REASON, rather than replaced by a generic one. The
 * `gaps` array is the honest mechanism the spec already has and it already works — §2.1 says never
 * invent market data, so a Markets & Macro Dashboard with nothing verified is SUPPOSED to be
 * absent, and what she needs to see is that it is absent and why, not a plausible-looking table.
 *
 * A section filed with no content in it counts as missing. A heading over nothing is the same
 * absence with more ceremony.
 */
export function missingSections(sections: unknown[], gaps: unknown[]): MissingSection[] {
  const present = new Set<string>();
  for (const s of orderSections(sections)) {
    const key = sectionKeyOf(s);
    if (key && sectionHasContent(s)) present.add(key);
  }

  const gapText = (gaps ?? [])
    .map((g) => (typeof g === "string" ? g : g && typeof g === "object" ? `${(g as any).wanted ?? (g as any).what ?? ""} ${(g as any).why ?? ""}` : ""))
    .filter((t) => t.trim() !== "");

  return BRIEFING_SECTIONS.filter((s) => !present.has(s.key)).map((s) => {
    const named = gapText.find((t) => normalise(t).includes(normalise(s.title)) || normalise(t).includes(s.key.replace(/_/g, " ")));
    return {
      key: s.key,
      title: s.title,
      why: named ? named.trim() : "The research run did not file this section and did not say why.",
    };
  });
}

// ─── The Investor Insight ────────────────────────────────────────────────────

export interface InvestorInsight {
  /** The deeper pattern across the day. Never a restated headline. */
  synthesis: string;
  /** Which facts were joined, and what made them connect. The move, named. */
  how_reached: string;
  /** The question to ask next time this shape appears. The part that teaches. */
  transferable_frame: string;
  /** The observation that would break it. An insight she cannot test is entertainment. */
  falsified_by: string;
  /** The facts it rests on, each naming the section of TODAY'S report it came from. */
  cites: { fact: string; from: string }[];
}

const STOPWORDS = new Set([
  "about", "after", "again", "against", "because", "been", "before", "being", "between", "both",
  "could", "does", "doing", "during", "each", "from", "have", "into", "more", "most", "other",
  "over", "same", "should", "some", "such", "than", "that", "their", "them", "then", "there",
  "these", "they", "this", "those", "through", "under", "until", "were", "what", "when", "where",
  "which", "while", "with", "would", "your",
]);

/** The words that carry meaning, plus anything with a digit in it — a figure is the fact. */
export function significantWords(text: string): string[] {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9.%$-]+/)
    .map((w) => w.replace(/^[.$-]+|[.%-]+$/g, ""))
    .filter((w) => w !== "")
    .filter((w) => /\d/.test(w) || (w.length >= 4 && !STOPWORDS.has(w)));
}

/** Everything the report says, minus the insight itself. The corpus a citation must be found in. */
export function reportCorpus(report: { summary?: unknown; headline?: unknown; sections?: unknown[] }): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(push);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(push);
  };
  push(report.headline);
  push(report.summary);
  for (const sec of orderSections(report.sections ?? [])) {
    if (sectionKeyOf(sec) === "investor_insight") continue;
    push(sec);
  }
  return parts.join(" \n ");
}

/**
 * How much of a claimed fact is actually in the day's material, 0 to 1.
 *
 * A citation is not required to be a verbatim quote — the insight paraphrases, and demanding an
 * exact substring would fail every honest synthesis and pass a copy-paste. What it IS required to
 * be is MADE OF the day's words: the proportion of its content words that appear in the rest of the
 * report.
 */
export function citationOverlap(fact: string, corpus: string): number {
  const wanted = significantWords(fact);
  if (wanted.length === 0) return 0;
  const have = new Set(significantWords(corpus));
  return wanted.filter((w) => have.has(w)).length / wanted.length;
}

/** Below this, the citation is about something that is not in today's report. */
export const CITATION_FLOOR = 0.6;

export interface GroundedInsight {
  insight: InvestorInsight | null;
  grounded: boolean;
  /** Why it was withheld, when it was. Shown to her rather than swallowed. */
  withheld_because: string | null;
}

/**
 * THE INSIGHT IS ONLY SHOWN IF IT RESTS ON TODAY'S OWN MATERIAL.
 *
 * Her instruction added the teaching: "u r also supposed to use the intelligence of the LLM to
 * develop an investor insights section to help me learn how to think about the stuff im reading".
 * That is a request to be taught the MOVE, not handed a conclusion — so the section carries how the
 * facts were joined, the frame to reuse tomorrow, and what would falsify it.
 *
 * And it is exactly the section §2.1 is most easily evaded in. Numbers are obviously fabricable and
 * everyone watches them; REASONING is fabricable in a way that reads like insight. A pattern joined
 * out of facts that are not in the report is a horoscope with a Bloomberg accent, and this page is
 * read by a registered representative before she trades.
 *
 * So: at least one citation, every citation naming a section of today's report and made of today's
 * words. Failing that the insight is WITHHELD with a reason she can see — the spec's own escape
 * hatch, "today's material does not support a synthesis worth writing", enforced rather than
 * requested.
 */
export function groundInsight(report: { headline?: unknown; summary?: unknown; sections?: unknown[] }): GroundedInsight {
  const sections = orderSections(report.sections ?? []);
  const block = sections.find((s) => sectionKeyOf(s) === "investor_insight");
  const raw = block && typeof block.insight === "object" && block.insight ? (block.insight as Record<string, unknown>) : null;
  if (!raw) return { insight: null, grounded: false, withheld_because: null };

  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const insight: InvestorInsight = {
    synthesis: text(raw.synthesis),
    how_reached: text(raw.how_reached),
    transferable_frame: text(raw.transferable_frame),
    falsified_by: text(raw.falsified_by),
    cites: (Array.isArray(raw.cites) ? raw.cites : [])
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
      .map((c) => ({ fact: text(c.fact), from: text(c.from) }))
      .filter((c) => c.fact !== ""),
  };

  if (insight.synthesis === "") {
    return { insight: null, grounded: false, withheld_because: "The Investor Insight was filed with no synthesis in it." };
  }
  if (insight.cites.length === 0) {
    return {
      insight: null,
      grounded: false,
      withheld_because:
        "The Investor Insight named no facts from today's report, so there is no way to check it rests " +
        "on the day rather than on the model's memory. It is withheld rather than shown.",
    };
  }

  const presentKeys = new Set(sections.map((s) => sectionKeyOf(s)).filter((k): k is string => Boolean(k)));
  const corpus = reportCorpus(report);

  for (const c of insight.cites) {
    if (c.from && !presentKeys.has(c.from)) {
      return {
        insight: null,
        grounded: false,
        withheld_because:
          `The Investor Insight cites "${c.from}", which is not a section of today's report. An insight ` +
          `resting on material that is not here is withheld.`,
      };
    }
    if (citationOverlap(c.fact, corpus) < CITATION_FLOOR) {
      return {
        insight: null,
        grounded: false,
        withheld_because:
          `The Investor Insight rests on "${c.fact.slice(0, 90)}", which does not appear anywhere else in ` +
          `today's report. Today's material does not support a synthesis worth writing, and one was ` +
          `written anyway, so it is withheld.`,
      };
    }
  }

  return { insight, grounded: true, withheld_because: null };
}
