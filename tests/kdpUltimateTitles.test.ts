import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { qualityFindings } from "../scripts/ops/kdp-books/quality-gate.mjs";
// @ts-expect-error — plain .mjs ops script, no types
import { seriesListing, frontHtml } from "../scripts/ops/kdp-books/series.mjs";

/**
 * HER "ULTIMATE GUIDE" TITLES (owner, 24 Nov 2026): "the names she changed my ultimate guide books to
 * tech and investment banking suck and don't capture the whole point of those books to be a one stop
 * ultimate guide for ppl and they don't have to go anywhere else".
 *
 * Amazon's own rules (KDP Metadata Guidelines, G201097560) bar sales-rank words ("bestselling") and
 * promotions in a title; "ultimate" is neither, so the gate lets it through while "best", "#1",
 * "number one" and "bestselling" still fail.
 */
const spec = JSON.parse(readFileSync("scripts/ops/kdp-books/ambitiousgrads.json", "utf8"));
const register = JSON.parse(readFileSync("scripts/ops/kdp-register.json", "utf8"));
const NEW = "The Ultimate Guide to Silicon Valley";

const W = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey yankee zulu".split(" ");
const para = (i: number) => `${W[i % 26]} ${W[(i * 7) % 26]} ${W[(i * 11) % 26]} ${W[Math.floor(i / 26) % 26]}: a worked example about tech interviews, roles, startups and stock options for new grads, told ${W[(i * 3) % 26]} ${W[(i * 5) % 26]}.`;
const body = Array.from({ length: 300 }, (_, i) => para(i)).join("\n");
const listing = { title: NEW, subtitle: "Everything You Need to Get a Job in Tech, in One Book", description: "Tech interviews, roles, startups and stock options for new grads.", ai_disclosure: { text_detail: "Extensive editing" } };
const codes = (l: object) => qualityFindings(l, body).map((f: { code: string }) => f.code);

describe("the Kindle gate reads promotion, not 'Ultimate'", () => {
  it("her titles pass, both of them", () => {
    expect(codes(listing)).toEqual([]);
    expect(codes({ ...listing, title: "The Ultimate Guide to Wall Street", subtitle: "Everything You Need to Break Into Investment Banking, in One Book" })).toEqual([]);
    expect(codes({ ...listing, title: "THE ULTIMATE GUIDE TO SILICON VALLEY" })).toEqual([]);
  });

  it.each([
    ["The Best Guide to Silicon Valley"],
    ["The #1 Guide to Silicon Valley"],
    ["#1 Guide to Silicon Valley"],
    ["The Bestselling Guide to Silicon Valley"],
    ["The Number One Guide to Silicon Valley"],
    ["The Complete Guide to Silicon Valley"],
  ])("%s still fails PROMO_WORDS", (title) => {
    expect(codes({ ...listing, title })).toContain("PROMO_WORDS");
  });

  it("a promo word in the subtitle fails too; a number that is not #1 does not", () => {
    expect(codes({ ...listing, subtitle: "The Best Book on Getting a Job in Tech" })).toContain("PROMO_WORDS");
    expect(codes({ ...listing, subtitle: "Guide #10 in the Series" })).not.toContain("PROMO_WORDS");
  });

  it("title + subtitle over Amazon's 200 characters still fails TITLE_TOO_LONG; 200 passes", () => {
    const sub = (n: number) => "x".repeat(n - NEW.length);
    expect(codes({ ...listing, subtitle: sub(200) })).not.toContain("TITLE_TOO_LONG");
    expect(codes({ ...listing, subtitle: sub(201) })).toContain("TITLE_TOO_LONG");
    expect(NEW.length + listing.subtitle.length).toBeLessThanOrEqual(200);
  });
});

describe("her Ultimate titles are recorded, and the Live titles stay as Amazon shows them", () => {
  // Both books are Live (Wall Street 19 Nov, tech 23 Nov 2026). Amazon locks a published eBook's title and
  // subtitle (KDP help G200736410), so the spec, the register and the cover keep the Live title, one value,
  // and her chosen title is recorded on the register row as not applied: only a new edition, a second book,
  // could carry it, and she declined one on 24 Nov 2026.
  const CHOSEN: Record<string, string> = {
    "ambitious-grads-wall-street": "The Ultimate Guide to Wall Street | Everything You Need to Break Into Investment Banking, in One Book",
    "ambitious-grads-silicon-valley": "The Ultimate Guide to Silicon Valley | Everything You Need to Get a Job in Tech, in One Book",
  };
  it.each(Object.keys(CHOSEN))("%s: spec, register and cover say the same Live title; her title is on record, not applied", (slug) => {
    const book = spec.series_books.find((b: { slug: string }) => b.slug === slug);
    const row = register.titles.find((t: { slug?: string }) => t.slug === slug);
    expect(row.status).toBe("LIVE");
    expect({ title: row.title, subtitle: row.subtitle }).toEqual({ title: book.title, subtitle: book.subtitle });
    expect(seriesListing(spec, book, { built_on: "2026-11-24" })).toMatchObject({ title: book.title, subtitle: book.subtitle });
    expect(frontHtml(spec, book).replace(/‑/g, "-")).toContain(`>${book.title}</h1>`);
    expect(row.ultimate_title).toMatchObject({ on: "2026-11-24", chosen: CHOSEN[slug] });
    expect(row.ultimate_title.not_applied).toMatch(/G200736410/);
    // 24 Nov 2026 she declined a new edition: the row says so, so no run or agent reads it as pending.
    expect(row.ultimate_title.declined).toMatch(/^2026-11-24: she said no new edition/);
    expect(book._title_why).toContain(CHOSEN[slug]!.split(" | ")[0]);
    const [t, sub] = CHOSEN[slug]!.split(" | ");
    expect(codes({ ...listing, title: t, subtitle: sub })).toEqual([]); // the gate would pass her title
  });
});
