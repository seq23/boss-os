/*
 * KEEPMYPROOF KINDLE BOOKS (owner, 7 Nov 2026): a front-door book per folder, divorce first, drafts
 * only, nothing on Amazon without her yes. These hold the behaviour that keeps the books honest:
 * only quote-verified facts, the claim gate on model prose, the listing rules KDP enforces, which
 * folder the monthly run drafts next, and the bookshelf — not a click — deciding "Live".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs
import * as L from "../scripts/ops/kdp-books/lib.mjs";
// @ts-expect-error plain .mjs
import { nextBook, unpublished, registerEntry, KDP_DRAFT_LIMIT } from "../scripts/ops/kdp-kmp-draft.mjs";
// @ts-expect-error plain .mjs
import { shelfState, aiAnswers } from "../scripts/ops/kdp-new-title.mjs";
// @ts-expect-error plain .mjs
import { question } from "../scripts/ops/kdp-kmp-raise.mjs";

const spec = JSON.parse(readFileSync("scripts/ops/kdp-books/keepmyproof.json", "utf8"));
const register = JSON.parse(readFileSync("scripts/ops/kdp-register.json", "utf8"));
const fact = (url: string, quote: string, claim = "A plain sourced claim.") => ({ claim_en: claim, claim_es: "x", source_url: url, source_name: "Court", quote, checked: "2026-11-02" });

describe("facts: only quote-verified ones reach the book", () => {
  const book = { facts: [{ file: "a.json", label: "Custody", max: 1 }, { file: "b.json", label: "Records", max: 2 }] };
  const ok = fact("https://courts.example.gov/a", "the quoted words");
  const unverified = fact("https://courts.example.gov/b", "words nobody checked");
  const files = {
    "a.json": { states: { TN: { facts: [unverified, ok, fact("https://x.gov/c", "a second verified one")] }, AK: { facts: [unverified] } } },
    "b.json": { states: { AK: { facts: [ok] } } },
  };
  const verified = { facts: { [L.factKey(ok)]: "2026-11-02", [L.factKey(fact("https://x.gov/c", "a second verified one"))]: "2026-11-02" } };
  it("drops unverified facts, keeps the per-file cap, sorts states by name", () => {
    const s = L.selectFacts(book, files, verified);
    expect(s.map((x: any) => x.code)).toEqual(["AK", "TN"]);
    expect(s[1].groups[0].facts).toHaveLength(1);
    expect(s[1].groups[0].facts[0].source_url).toBe("https://courts.example.gov/a");
    expect(L.factCount(s)).toBe(2);
  });
  it("names every state the book leaves out, never silently", () => {
    const missing = L.missingStates(L.selectFacts(book, files, verified));
    expect(missing).toContain("Wyoming");
    expect(missing).not.toContain("Tennessee");
    expect(missing).toHaveLength(49);
    expect(L.whereLabel([{ code: "TN" }, { code: "DC" }])).toBe("1 states and DC");
  });
});

describe("the claim gate on model prose", () => {
  it.each([
    ["This log proves what happened."], ["Keep it court-ready."], ["Screenshots are admissible."], ["The judge will look at your log."],
    ["Studies show logs help."], ["Write it within 24 hours."], ["See www.example.com for more."], ["You can win your case!"], ["This is the best app."],
  ])("refuses %s", (s) => { expect(L.claimProblems(s, { prose: true }).length).toBeGreaterThan(0); });
  it("passes plain, scoped prose, the custody standard and 911", () => {
    expect(L.claimProblems("Write the date and time first. A record you kept helps you state facts plainly. Courts use the best interests of the child standard. If you are in danger, call 911.", { prose: true })).toEqual([]);
  });
  it("parses the one format and refuses an empty or thin answer", () => {
    const body = Array.from({ length: 40 }, () => "Write what happened, the same day.").join(" ");
    const b = L.parseChapter(`## A heading\n\n**${body}**\n\n- one\n- two`);
    expect(b[0]).toEqual({ h: "A heading" });
    expect(b[1].p).not.toMatch(/\*\*/);
    expect(b[2]).toEqual({ ul: ["one", "two"] });
    expect(L.parseChapter("too short")).toBeNull();
    expect(L.parseChapter("")).toBeNull();
  });
});

describe("the listing passes KDP's own rules, for all five books", () => {
  for (const b of spec.books as any[]) {
    it(b.folder, () => { expect(L.listingProblems({ ...b, author: spec.author }, "<p>A plain description.</p>")).toEqual([]); });
  }
  it("catches the Gift Letter defect (a word shared by title and subtitle) and a wrong keyword count", () => {
    const b = spec.books[0];
    expect(L.listingProblems({ ...b, subtitle: "A Co-Parenting Log Workbook" }, "<p>x</p>").join()).toMatch(/repeat/);
    expect(L.listingProblems({ ...b, keywords: b.keywords.slice(0, 6) }, "<p>x</p>").join()).toMatch(/6 keywords/);
    expect(L.listingProblems({ ...b, price_usd: 0.99 }, "<p>x</p>").join()).toMatch(/price/);
  });
  it("the real description passes the gate", () => {
    const d = L.description({ ...spec.books[0], author: spec.author }, { where: "all 50 states and DC", facts: 321, checklist: ["Pay stubs and tax returns"] });
    expect(L.listingProblems({ ...spec.books[0], author: spec.author }, d)).toEqual([]);
  });
});

describe("the monthly run: which folder next, and the KDP draft cap", () => {
  it("divorce is on the register, so the next book is workplace; all five registered ends the duty", () => {
    expect(register.titles.find((t: any) => t.title_ref === "draft:kmp-divorce")).toMatchObject({ line: "keepmyproof", kmp_folder: "divorce", target: "LIVE", ai_disclosure: true });
    expect(nextBook(spec, register).folder).toBe("workplace");
    const all = { titles: spec.books.map((b: any) => ({ line: "keepmyproof", kmp_folder: b.folder })) };
    expect(nextBook(spec, all)).toBeNull();
    expect(nextBook(spec, { titles: [] }).folder).toBe("divorce");
  });
  it("counts every non-Live title against KDP's 10 unpublished drafts", () => {
    expect(KDP_DRAFT_LIMIT).toBe(10);
    expect(unpublished({ titles: [{ status: "LIVE" }, { status: "DRAFT_LOCAL" }, { status: "IN_REVIEW" }] })).toBe(2);
  });
  it("a register row says the draft is not on Amazon and waits for her yes", () => {
    const e = registerEntry({ ...spec.books[1] }, { day: "2026-12-01", dir: "/x/workplace" });
    expect(e).toMatchObject({ title_ref: "draft:kmp-workplace", status: "DRAFT_LOCAL", target: "LIVE", author: "S. L. Taylor", publisher: "Spry Labs" });
    expect(e.note).toMatch(/never Save as Draft/);
  });
});

describe("going up: her yes first, the bookshelf decides Live", () => {
  it("reads the bookshelf's words, never the click", () => {
    expect(shelfState("The Co-Parenting Log  Live  Kindle eBook")).toBe("LIVE");
    expect(shelfState("In review")).toBe("IN_REVIEW");
    expect(shelfState("Draft")).toBe("DRAFT");
    expect(shelfState("")).toBeNull();
  });
  it("discloses AI for text and cover, none for translations", () => {
    expect(aiAnswers(spec)).toMatchObject({ used: true, translations: "None" });
  });
  it("the Inbox card says what approving does", () => {
    const q = question({ title: "T", subtitle: "S", author: "S. L. Taylor", publisher: "Spry Labs", price_usd: 4.99, facts: 3, where: "1 states", keywords: ["a"], categories: ["b"], folder: "divorce" });
    expect(q).toMatch(/\$4\.99/);
    expect(q).toMatch(/Approve and it goes on Kindle/);
    expect(q).toMatch(/AI disclosure on/);
  });
});
