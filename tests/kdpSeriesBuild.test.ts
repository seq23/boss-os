import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops libs, no types
import * as S from "../scripts/ops/kdp-books/series.mjs";
// @ts-expect-error — plain .mjs ops lib
import { underCaps } from "../scripts/ops/kdp-new-title.mjs";
// @ts-expect-error — plain .mjs ops lib
import { relinkHtml, changesFor } from "../scripts/ops/kdp-update-live.mjs";
// @ts-expect-error — plain .mjs ops lib
import { paperbackState, itemSetFor } from "../scripts/ops/kdp-paperback.mjs";
// @ts-expect-error — plain .mjs ops lib
import { promoWindow } from "../scripts/ops/kdp-promo.mjs";
// @ts-expect-error — plain .mjs ops lib
import { seriesToCreate } from "../scripts/ops/kdp-series.mjs";
// @ts-expect-error — plain .mjs ops lib
import { kdpLineValue } from "../scripts/ops/lib/scorecard-readers.mjs";

/**
 * THE SERIES BOOKS PIPELINE (KDP strategy, spry brain 8 Nov 2026): a line spec + a hand-written
 * manuscript → the Kindle EPUB, the cover, the paperback interior and full wrap, the listing Simone
 * types into KDP; then Amazon's caps, the series, the free days and the live-title updates. Behaviour
 * only: what a book gets, what stops it, and what Amazon's limits hold back.
 */

const line = {
  line: "wedding", author: "June Hollister", publisher: "Spry Labs",
  series: { name: "Simple Wedding Guides", description: "Short guides." },
  ai_disclosure: { text: "all", images: "none", tool_names: "Anthropic Claude" }, disclaimer: "none",
};
const para = "Write the way you speak to each other on an ordinary day, because the words that sound like you are the ones your partner remembers. ";
const md = [
  "# Start here", "", para.repeat(40), "", "Print the worksheet at {{companion}}.", "",
  "# The worksheet", "", "## Three questions", "", "- What did you notice first?", "- What do you promise?", "",
  "- [ ] Draft written", "- [ ] Read aloud", "", "<!-- rows: 5 -->", "| Date | Line | Note |", "|---|---|---|", "", para.repeat(40),
].join("\n");
const book = {
  slug: "wedding-vows", title: "Writing Your Wedding Vows", subtitle: "A calm step-by-step way to say what you mean in three minutes",
  series_number: 2, description: "Para one.\n\n- point a\n- point b", keywords: ["a1", "a2", "a3", "a4", "a5", "a6", "a7"],
  categories: ["Self-Help › Weddings"], price_usd: 0.99, paperback: { price_usd: 7.99, trim: "6x9" },
  companion_url: "https://weddingchecklistpdf.com/amazon/wedding-vows/", manuscript: "docs/kdp/books/wedding-vows.md",
};

describe("a series book is built from its spec and manuscript", () => {
  const chapters = S.parseManuscript(md);

  it("reads chapters, sections, lists, checklists and fill-in logs from the manuscript", () => {
    expect(chapters.map((c: { title: string }) => c.title)).toEqual(["Start here", "The worksheet"]);
    const kinds = chapters[1].blocks.map((b: Record<string, unknown>) => Object.keys(b)[0]);
    expect(kinds).toEqual(["h", "ul", "check", "table", "p"]);
    expect(chapters[1].blocks[3].table).toEqual({ head: ["Date", "Line", "Note"], body: [], rows: 5 });
  });

  it("prints the companion page as a live link tagged with the book's slug, front and back", () => {
    const link = S.companionLink(book);
    expect(link).toBe("https://weddingchecklistpdf.com/amazon/wedding-vows/?utm_source=kindle&utm_medium=book&utm_campaign=wedding-vows");
    const secs = S.seriesSections(line, book, chapters, { year: 2026 });
    const all = secs.map((s: { html: string }) => s.html).join("");
    expect(all.split(`href="${link.replace(/&/g, "&amp;")}"`).length - 1).toBeGreaterThanOrEqual(3);
    expect(all).toContain("Simple Wedding Guides, Book 2");
    expect(all).toMatch(/written with the help of AI writing tools/);
    expect(all).toContain("June Hollister");
  });

  it("the listing carries the series, the pen name, KDP Select and the royalty KDP allows at that price", () => {
    const l = S.seriesListing(line, book, { built_on: "2026-11-08", pages: 24 });
    expect(l).toMatchObject({ author: "June Hollister", publisher: "Spry Labs", series: { name: "Simple Wedding Guides", number: 2 }, kdp_select: true, royalty: 35, price_usd: 0.99 });
    expect(S.seriesListing(line, { ...book, price_usd: 2.99 }, { built_on: "x" }).royalty).toBe(70);
    expect(l.description_html).toBe("<p>Para one.</p><ul><li>point a</li><li>point b</li></ul>");
    expect(l.ai_disclosure.tool_names).toBe("Anthropic Claude");
  });

  it("a book's own pen name wins over the line's (keepmyproof.json keeps S. L. Taylor for the live book)", () => {
    expect(S.authorOf({ author: "S. L. Taylor" }, { author: "Reid Calloway" })).toBe("Reid Calloway");
    expect(S.authorOf({ author: "S. L. Taylor" }, {})).toBe("S. L. Taylor");
  });

  it("the gate passes a real book and stops a thin one, an owner-related or credentialed pen name, a missing link and a claim", () => {
    expect(S.seriesProblems(line, book, chapters)).toEqual([]);
    expect(S.seriesProblems(line, book, S.parseManuscript("# A\n\nToo short. {{companion}}")).join()).toMatch(/word floor/);
    expect(S.seriesProblems({ ...line, author: "Lanae Taylor" }, book, chapters).join()).toMatch(/related to the owner/);
    expect(S.seriesProblems({ ...line, author: "Dr. June Hollister" }, book, chapters).join()).toMatch(/credential/);
    expect(S.seriesProblems(line, book, S.parseManuscript(md.replace("{{companion}}", "the site"))).join()).toMatch(/never prints \{\{companion\}\}/);
    expect(S.seriesProblems(line, { ...book, companion_url: "https://weddingchecklistpdf.com/" }, chapters).join()).toMatch(/companion_url/);
    expect(S.seriesProblems(line, { ...book, price_usd: 4.99 }, chapters).join()).toMatch(/\$0\.99–\$2\.99/);
    const gated = { ...book, claim_gate: true };
    expect(S.seriesProblems(line, gated, S.parseManuscript(md + "\n\nThis log is court-ready."))).toEqual(expect.arrayContaining([expect.stringMatching(/claim gate: court-ready/)]));
  });

  it("the paperback wrap is back + spine (page count × 0.002252 in) + front, with bleed; spine text only from 79 pages", () => {
    const w = S.wrapSize("6x9", 100);
    expect(w).toMatchObject({ spine: 0.2252, height: 9.25 });
    expect(w.width).toBeCloseTo(0.25 + 12 + 0.2252, 4);
    expect([S.spineHasText(78), S.spineHasText(79)]).toEqual([false, true]);
    expect(S.wrapCoverHtml(line, book, { pages: 24, dpi: 96 }).html).not.toContain("rotate(90deg)");
    expect(S.wrapCoverHtml(line, book, { pages: 120, dpi: 96 }).html).toContain("rotate(90deg)");
  });
});

describe("Amazon's caps hold titles back as QUEUED, never dropped", () => {
  const t = (action: string, n: number) => ({ plan: { action }, book: { title: `B${n}` } });

  it("a new title needs a free draft slot under KDP's 10; resuming its own draft does not", () => {
    const { go, queued } = underCaps([t("create", 1), t("resume", 2), t("create", 3)], { drafts: 9, perRun: 5 });
    expect(go.map((x: { book: { title: string } }) => x.book.title)).toEqual(["B1", "B2"]);
    expect(queued.map((x: { why: string }) => x.why)).toEqual(["KDP's 10-draft cap"]);
  });

  it("at most the run's publish cap go; the rest wait for the next run", () => {
    const { go, queued } = underCaps(Array.from({ length: 8 }, (_, i) => t("create", i)), { drafts: 0, perRun: 5 });
    expect([go.length, queued.length]).toEqual([5, 3]);
    expect(queued[0].why).toMatch(/publish cap/);
  });
});

describe("the live titles' in-book link becomes a live, tagged link", () => {
  const companion = "https://approvalprep.com/amazon/credit-dispute-letter/";
  const link = "https://approvalprep.com/amazon/credit-dispute-letter/?utm_source=kindle&utm_medium=book&utm_campaign=credit-dispute-letter";

  it("plain text becomes a link; an existing link is re-pointed; nothing is wrapped twice", () => {
    const out = relinkHtml('<p>Go to approvalprep.com/amazon/credit-dispute-letter/.</p><p><a href="https://approvalprep.com/amazon/credit-dispute-letter/">approvalprep.com/amazon/credit-dispute-letter</a></p>', { companion, link });
    expect(out).toBe('<p>Go to <a href="https://approvalprep.com/amazon/credit-dispute-letter/?utm_source=kindle&amp;utm_medium=book&amp;utm_campaign=credit-dispute-letter">approvalprep.com/amazon/credit-dispute-letter</a>.</p><p><a href="https://approvalprep.com/amazon/credit-dispute-letter/?utm_source=kindle&amp;utm_medium=book&amp;utm_campaign=credit-dispute-letter">approvalprep.com/amazon/credit-dispute-letter</a></p>');
  });

  it("a link to the home page is re-pointed to the companion page when the row says so", () => {
    expect(relinkHtml('<a href="https://approvalprep.com">site</a>', { companion, link, also: ["https://approvalprep.com"] })).toContain("utm_campaign=credit-dispute-letter");
  });

  it("only what differs is changed; the author is never a change", () => {
    const c = changesFor({ subtitle: "A new promise", keywords: Array(7).fill("k"), categories: ["A › B"], price_usd: 2.99, cover: { preview: "x.jpg" } }, { title: "The Credit Dispute Letter: credit dispute letter", price_usd: 4.99 });
    expect(c).toEqual(["subtitle", "keywords", "categories", "price", "cover", "select"]);
    expect(changesFor({ subtitle: "credit dispute letter" }, { title: "The Credit Dispute Letter: credit dispute letter", price_usd: 2.99 })).toEqual(["select"]);
  });
});

describe("paperbacks, series and the free days", () => {
  it("reads the paperback's own state from a bookshelf row, and none when only '+ Create paperback' is offered", () => {
    expect(paperbackState(["T: S", "by X", "Kindle eBook", "Live", "Paperback", "In review", "Hardcover", "+ Create hardcover"])).toBe("IN_REVIEW");
    expect(paperbackState(["T: S", "by X", "Kindle eBook", "Live", "Paperback", "+ Create paperback", "Link existing paperback"])).toBeNull();
  });

  it("finds a Kindle title's item set id in the bookshelf markup (live shape, 8 Nov 2026)", () => {
    expect(itemSetFor('data-x="{&quot;digitalTitleId&quot;:&quot;A2A5Z547GQ7ESO&quot;,&quot;itemSetId&quot;:&quot;4JR2W2VHYS9&quot;}"', "A2A5Z547GQ7ESO")).toBe("4JR2W2VHYS9");
  });

  it("never creates a series twice: recorded or already on the bookshelf is skipped", () => {
    const lines = [{ line: "a", series: { name: "Alpha Guides" } }, { line: "b", series: { name: "Beta Guides" } }, { line: "c", series: { name: "Gamma Guides" } }];
    expect(seriesToCreate(lines, { a: { name: "Alpha Guides" } }, "… Beta Guides …").map((l: { line: string }) => l.line)).toEqual(["c"]);
  });

  it("the free days are 5 Pacific dates starting a few days out", () => {
    expect(promoWindow(Date.parse("2026-11-09T15:45:00Z"))).toEqual({ start: "2026-11-12", end: "2026-11-16" });
  });
});

describe("the batch's scorecard rows read one line's books out of the weekly sales read", () => {
  const o = { titles: {
    A: { title: "Writing Your Wedding Vows: A calm way", units: 9, free_units: 5, kenp: 0 },
    B: { title: "The Maid of Honor Handbook: x", units: 120, free_units: 120, kenp: 700 },
    C: { title: "The Credit Dispute Letter: y", units: 50, free_units: 0, kenp: 9000 },
  } };
  const titles = ["Writing Your Wedding Vows", "The Maid of Honor Handbook"];

  it("free downloads count only that line's books", () => {
    expect(kdpLineValue(o, { metric: "free_units" }, titles)).toBe(125);
  });

  it("day 60 is met by 500 KU pages a month OR a paid sale a week, whichever is nearer", () => {
    expect(kdpLineValue(o, { metric: "day60_pct" }, titles)).toBe(70); // 700 pages of 1000; 4 paid sales of 8.6
    expect(kdpLineValue({ titles: { A: { title: "Writing Your Wedding Vows", units: 10, free_units: 0, kenp: 0 } } }, { metric: "day60_pct" }, titles)).toBe(117);
  });

  it("a line with no book in the reports is a named stop, never a zero", () => {
    expect(() => kdpLineValue(o, { metric: "free_units" }, ["Some Other Book"])).toThrow(/KDP_LINE_NOT_ON_SALE|none of this line/);
  });
});

describe("her Monday line: the bookshelf, then the sales, never a 0 for something not read", () => {
  // @ts-expect-error — plain .mjs ops lib
  const load = () => import("../scripts/ops/kdp-week.mjs");
  const titles = ["Parallel Parenting", "Executive Dysfunction", "Writing Your Wedding Vows", "The Maid of Honor Handbook"];
  const rows = [
    { title: "Parallel Parenting: A Simple Record Book", state: "IN_REVIEW" },
    { title: "Executive Dysfunction: A Five-Role System", state: "LIVE" },
    { title: "The Maid of Honor Handbook: x", state: "BLOCKED" },
    { title: "The Credit Dispute Letter: y", state: "LIVE" },
  ];

  it("counts the series books from the live bookshelf rows: live, in review, queued (not on the shelf), stopped", async () => {
    const { shelfCounts } = await load();
    expect(shelfCounts(titles, rows)).toEqual({ live: 1, review: 1, queued: 1, stopped: 1, stoppedTitles: ["The Maid of Honor Handbook"] });
  });

  it("reads like her example and fits Today's 80 bytes, which the census line's grep counts", async () => {
    const { weekLine, OUTPUT_MAX } = await load();
    const line = weekLine({ shelf: { live: 2, review: 0, queued: 7, stopped: 0 }, units: { units_total: 3, kenp_total: 410 }, visits: { total: 120 } });
    expect(line).toBe("2 live, 0 in review, 7 queued, 0 stopped | 3 sold, 410 KU pages, 120 visits");
    expect(Buffer.byteLength(weekLine({ shelf: { live: 1234, review: 1234, queued: 1234, stopped: 1234 }, units: { units_total: 123456, kenp_total: 1234567 }, visits: { total: 123456 } }))).toBeLessThanOrEqual(OUTPUT_MAX);
  });

  it("a source not read says so, never 0", async () => {
    const { weekLine } = await load();
    expect(weekLine({ shelf: { unread: "signed out" }, units: { unread: "x" }, visits: { unread: "y" } })).toBe("bookshelf not read | sales not read, visits not read");
  });

  it("names a book stopped two Mondays running, and only that one", async () => {
    const { stoppedTwoWeeks } = await load();
    expect(stoppedTwoWeeks(["The Maid of Honor Handbook", "Gone Now"], ["The Maid of Honor Handbook", "New Stop"])).toEqual(["The Maid of Honor Handbook"]);
  });
});
