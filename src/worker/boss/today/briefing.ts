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
  /**
   * THE SAME SENTENCE UNDER THE NAME A READER REACHES FOR.
   *
   * A reviewer read `missing_sections[].reason`, got `undefined`, and reported that every absence
   * had come back with an empty explanation — a serious regression, if it had been true. It was
   * not: the field is `why` and it was populated on all six. But a payload where the obvious name
   * returns nothing is a footgun that will be stepped on again, and the cost of both is one line.
   */
  reason: string;
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
    const why = named ? named.trim() : "The research run did not file this section and did not say why.";
    return { key: s.key, title: s.title, why, reason: why };
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
export function citationOverlap(fact: string, corpus: string | Set<string>): number {
  const wanted = significantWords(fact);
  if (wanted.length === 0) return 0;
  // A caller checking several cites against one report tokenises the report once and passes the
  // set: tokenising seventeen kilobytes per cite was most of the briefing block's CPU.
  const have = corpus instanceof Set ? corpus : new Set(significantWords(corpus));
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

  /*
   * SILENCE WITH NO REASON TEACHES NOTHING, which is the whole point of this section.
   *
   * This returned `withheld_because: null` whenever the run filed no insight, and the screen then
   * rendered nothing at all — indistinguishable from the feature being broken, on the one section
   * that exists to show her how a conclusion was reached. Measured live: the briefing came back
   * `{"insight":null,"grounded":false,"withheld_because":null}` and the block was simply absent.
   *
   * TWO ABSENCES, TOLD APART. A run that filed no Investor Insight section at all is a different
   * morning from one that filed a section with nothing usable in it, and she is owed both
   * sentences rather than a blank where an idea should be.
   */
  if (!raw) {
    return {
      insight: null,
      grounded: false,
      withheld_because: block
        ? "The Investor Insight section was filed with nothing in it, so there is no synthesis to show."
        : "Today's run filed no Investor Insight. On a thin day that is the honest outcome — a forced daily insight is horoscope writing — but it means there is nothing here to learn from this morning.",
    };
  }

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
  const corpus = new Set(significantWords(reportCorpus(report)));

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


// ─── A figure carries its source, or it does not print ───────────────────────

/**
 * THE $72 OIL FIGURE, AND WHY NOTHING CAUGHT IT.
 *
 * Friday's report published Brent at roughly $72/bbl. The actual Friday close was $104.61 — a 45%
 * error in a headline figure, in a report she reads at 7am to make decisions. It was corrected two
 * days later only because that run happened to re-check. Nothing required it to.
 *
 * ─── WHAT WAS ACTUALLY ENFORCED: NOTHING ──────────────────────────────────
 *
 * The duty's `success_criteria` reads "every figure carries a named source and the time it was
 * read". `success_criteria` is a TEXT COLUMN. `author.ts` writes it, two screens display it, and no
 * code in this repository has ever evaluated one. It is prose the run is told, not a check.
 *
 * AND THE MORE SERIOUS HALF: even an enforced criterion would have had nothing to check against.
 * `sources` is a REPORT-LEVEL array. Figures live in a section's `bullets`, `items` and `table`.
 * Nothing related one to the other — no section ever named which source a number came from. Two
 * halves of the same payload, each keeping its own list, with no link between them. That is this
 * repository's most-produced defect, sitting under its most decision-bearing screen.
 *
 * ─── The rule ──────────────────────────────────────────────────────────────
 *
 * A section that prints a FIGURE must name a source that RESOLVES — present in `sources`, with a
 * URL and a readable `read_at`. A section that cannot does not print; it is named in
 * `missing_sections` with that as the reason, so the absence is loud rather than silent.
 *
 * THE CORRECTIONS MECHANISM STAYS. It is what caught the $72 and it is the only thing that can
 * catch a figure that is wrong but sourced — a citation proves provenance, never accuracy.
 */
export interface ReportSource {
  name: string;
  url: string;
  read_at: string;
}

/** A number that asserts something about the world: money, a percentage, or a magnitude. */
const FIGURE = /(?:[$£€]\s?\d|\d[\d,.]*\s?%|\b\d[\d,.]*\s?(?:bn|bps|pts|billion|trillion|million|basis points)\b)/i;

export function hasFigure(text: unknown): boolean {
  if (typeof text === "string") return FIGURE.test(text);
  if (Array.isArray(text)) return text.some(hasFigure);
  if (text && typeof text === "object") return Object.values(text as Record<string, unknown>).some(hasFigure);
  return false;
}

/**
 * The sources a report carries that are actually usable as citations.
 *
 * A NAME ALONE IS NOT A SOURCE. Without a URL nobody can go and look, and without a read time a
 * citation cannot distinguish today's close from Friday's — which is the precise shape of the error
 * this exists to stop.
 */
export function usableSources(report: { sources?: unknown }): ReportSource[] {
  return (Array.isArray(report.sources) ? report.sources : [])
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((s) => ({
      name: typeof s.name === "string" ? s.name.trim() : "",
      url: typeof s.url === "string" ? s.url.trim() : "",
      read_at: typeof s.read_at === "string" ? s.read_at.trim() : "",
    }))
    .filter((s) => s.name !== "" && /^https?:\/\//.test(s.url) && !Number.isNaN(Date.parse(s.read_at)));
}

/**
 * Does this section's figure-bearing content name a source that resolves?
 *
 * A section may cite by INDEX into `sources` or by NAME; both are checked against the usable list,
 * so a citation pointing at a source that was never filed fails exactly as a missing one does.
 */
export function sectionSourcing(
  sec: Record<string, unknown>,
  sources: ReportSource[],
): { needed: boolean; ok: boolean; why: string } {
  const body = { so_what: sec.so_what, bullets: sec.bullets, items: sec.items, table: sec.table, body: sec.body };
  if (!hasFigure(body)) return { needed: false, ok: true, why: "" };

  const cited = Array.isArray(sec.sources) ? sec.sources : [];
  if (cited.length === 0) {
    return {
      needed: true,
      ok: false,
      why:
        "It printed figures and named no source. Friday's report published Brent at ~$72/bbl against " +
        "an actual close of $104.61 and nothing required it to cite where that came from, so nothing " +
        "caught it.",
    };
  }

  const resolves = cited.some((ref) => {
    if (typeof ref === "number") return Boolean(sources[ref]);
    if (typeof ref === "string") {
      const want = ref.trim().toLowerCase();
      return sources.some((s) => s.name.toLowerCase().includes(want) || want.includes(s.name.toLowerCase()) || s.url === ref.trim());
    }
    return false;
  });

  if (!resolves) {
    return {
      needed: true,
      ok: false,
      why: "It cited a source that is not in the report's own source list, so the citation cannot be followed.",
    };
  }
  return { needed: true, ok: true, why: "" };
}

/**
 * STRIP THE UNSOURCED FIGURES, KEEP THE SECTION.
 *
 * ─── Why deleting the section was the wrong trade ──────────────────────────
 *
 * The first version of this gate withheld a whole section when its figures named no source, and a
 * real run showed what that costs: eleven sections filed, SIX removed — including the One-Minute
 * Summary and the Top 5 Headlines, the two she asked for by name. A guard that silently deletes
 * half her morning is not safer than an unsourced number; it is the same screen failing quietly.
 *
 * Losing a sourced sentence because an unsourced figure sat next to it is the wrong trade. So the
 * FIGURE is what goes, not the section: every line carrying an uncited number is dropped and
 * COUNTED, the prose around it survives, and the section says how much it lost.
 *
 * THE $72 RULE IS NOT SOFTENED BY THIS. An uncited figure still never reaches her — that is the
 * whole point, and it is why the error went two days uncaught. What changes is that the sentence
 * beside it is no longer collateral.
 *
 * A SECTION THAT LOSES EVERYTHING IS STILL WITHHELD, because a heading over nothing is an absence
 * with more ceremony, and it is named with its reason like every other absence.
 */
export function stripUnsourcedFigures(sec: Record<string, unknown>): {
  section: Record<string, unknown> | null;
  dropped: number;
} {
  let dropped = 0;
  const next: Record<string, unknown> = { ...sec };

  for (const field of ["so_what", "body", "bullets", "items"] as const) {
    const value = next[field];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const kept = value.filter((item) => !hasFigure(item));
      dropped += value.length - kept.length;
      if (kept.length === 0) delete next[field];
      else next[field] = kept;
    } else if (hasFigure(value)) {
      dropped += 1;
      delete next[field];
    }
  }

  /* A dashboard IS its figures, so an uncited table goes whole rather than half. */
  if (next.table && typeof next.table === "object" && hasFigure(next.table)) {
    dropped += 1;
    delete next.table;
  }

  if (dropped > 0) next.dropped_for_sourcing = dropped;

  const survives = sectionHasContent(next) || (typeof next.insight === "object" && next.insight !== null);
  return { section: survives ? next : null, dropped };
}

/**
 * Split a report's sections into the ones that may print and the ones that may not.
 *
 * ─── A RULE IS NOT APPLIED TO WORK DONE BEFORE IT EXISTED ──────────────────
 *
 * This is a regression caught on the live screen minutes after shipping, and it is worth writing
 * down rather than quietly patching. Every report in the database predates per-section `sources` —
 * the field did not exist — so the gate withheld TEN OF ELEVEN sections of the report she had just
 * read, and her Executive Briefing went from a full morning to one section and ten identical
 * paragraphs about a $72 oil figure.
 *
 * That is precisely the failure this repository already warns about in the client, about a
 * different change: "a format change that made historical days render empty would look exactly like
 * a regression on the screen it was meant to fix." Written down, and then done anyway.
 *
 * A REPORT THAT DECLARES NO PER-SECTION SOURCE ANYWHERE PREDATES THE RULE. It is rendered whole,
 * and the fact is said ONCE rather than eleven times — the same shape as the five identical somatic
 * reasons. A report where even one section cites its sources was written under the rule, so every
 * section in it is held to it.
 *
 * This is deliberately not a date comparison. A timestamp cut-off is a second thing to keep in step
 * with a migration; the payload's own shape already answers the question.
 */
export function withheldForSourcing(
  sections: unknown[],
  report: { sources?: unknown },
): { kept: Record<string, unknown>[]; withheld: MissingSection[]; pre_rule: boolean } {
  const sources = usableSources(report);
  const ordered = orderSections(sections);
  const underTheRule = ordered.some((sec) => Array.isArray(sec.sources) && sec.sources.length > 0);

  if (!underTheRule) {
    return { kept: ordered, withheld: [], pre_rule: ordered.length > 0 };
  }

  const kept: Record<string, unknown>[] = [];
  const withheld: MissingSection[] = [];

  for (const sec of ordered) {
    const verdict = sectionSourcing(sec, sources);
    if (verdict.ok) {
      kept.push(sec);
      continue;
    }
    const key = sectionKeyOf(sec);
    const known = BRIEFING_SECTIONS.find((b) => b.key === key);
    const title = known?.title ?? (typeof sec.heading === "string" ? sec.heading : "An unnamed section");

    /* DEGRADE FIRST. Only a section that loses everything is actually absent. */
    const stripped = stripUnsourcedFigures(sec);
    if (stripped.section) {
      kept.push(stripped.section);
      continue;
    }

    const reasonGiven =
      verdict.why ||
      `Every line in "${title}" carried a figure with no source, so nothing in it could be shown.`;
    withheld.push({
      key: key ?? "unkeyed",
      title,
      /*
       * NEVER EMPTY. `sectionSourcing` returns a reason on every failure path, and this fallback
       * exists so a future branch that forgets one cannot produce a section that vanishes in
       * silence — indistinguishable from a broken feature, and the argument that got
       * `withheld_because` fixed an hour earlier.
       */
      why: reasonGiven,
      reason: reasonGiven,
    });
  }
  return { kept, withheld, pre_rule: false };
}

// ─── What "partial" means ────────────────────────────────────────────────────

/**
 * A REPORT THAT FILED EVERYTHING IT WAS ASKED FOR IS COMPLETE, EVEN IF IT WANTS TOMORROW'S NEWS.
 *
 * ─── The defect ────────────────────────────────────────────────────────────
 *
 * A run filed all ELEVEN sections, withheld nothing, grounded its insight — and reported
 * `status: "partial"`. The reason was four `gaps`, and every one of them was a FUTURE EVENT:
 * Monday's Starship flight outcome, Sunday-evening escalation in the Red Sea, the Anthropic IPO's
 * pricing date, secondary spreads after Wednesday's FOMC.
 *
 * Wanting tomorrow's news is not an incomplete report. It is a correct one. Her CLAIM against this
 * system is written in her own standing rules: a legitimate stop should read GREEN and
 * self-explaining rather than amber, or the amber stops meaning anything.
 *
 * ─── The separation ────────────────────────────────────────────────────────
 *
 *   partial   — something the spec REQUIRED is absent: a section missing, a section withheld for
 *               having no source, an insight that could not be grounded, or a figure it tried to
 *               verify and could not.
 *   watching  — forward-looking. It has not happened yet. Its own field, its own word, and it never
 *               touches the status.
 *
 * THE STATUS IS DERIVED, NOT BELIEVED. The run's self-reported status is the one thing here that
 * was never checked — it said "partial" and the system wrote "partial" down. Missing sections and
 * insight grounding are both computed here from the report itself, so the only thing still taken on
 * the run's word is which gaps are forward-looking, and the prompt is explicit about that line.
 */
export interface ReportStanding {
  status: "complete" | "partial" | "failed";
  /** Why it is not complete, when it is not. Empty when it is. */
  shortfalls: string[];
  /** Forward-looking, and deliberately not a shortfall. */
  watching: unknown[];
}

export function reportStanding(args: {
  runStatus: "complete" | "partial" | "failed";
  missing: MissingSection[];
  withheldForSources: MissingSection[];
  gaps: unknown[];
  watching: unknown[];
  insightWithheld: boolean;
  /** True when the run filed an Investor Insight section at all. */
  insightAttempted: boolean;
}): ReportStanding {
  if (args.runStatus === "failed") {
    return { status: "failed", shortfalls: ["The research run did not produce a usable report."], watching: args.watching };
  }

  const shortfalls: string[] = [];
  if (args.missing.length > 0) {
    shortfalls.push(
      `${args.missing.length} section${args.missing.length === 1 ? "" : "s"} the specification asks for ${args.missing.length === 1 ? "is" : "are"} not here.`,
    );
  }
  if (args.withheldForSources.length > 0) {
    shortfalls.push(`${args.withheldForSources.length} section${args.withheldForSources.length === 1 ? "" : "s"} printed figures with no source and ${args.withheldForSources.length === 1 ? "was" : "were"} withheld.`);
  }
  if (args.gaps.length > 0) {
    shortfalls.push(`${args.gaps.length} thing${args.gaps.length === 1 ? "" : "s"} could not be verified.`);
  }
  if (args.insightAttempted && args.insightWithheld) {
    shortfalls.push("The Investor Insight could not be grounded in today's own material.");
  }

  return { status: shortfalls.length === 0 ? "complete" : "partial", shortfalls, watching: args.watching };
}
