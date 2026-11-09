import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs ops libs, no types
import * as S from "../scripts/ops/kdp-books/series.mjs";
// @ts-expect-error — plain .mjs ops lib
import { manuscriptPath } from "../scripts/ops/kdp-build.mjs";
// @ts-expect-error — plain .mjs ops lib
import { queueOrder } from "../scripts/ops/kdp-new-title.mjs";

/**
 * AMBITIOUS GRADS (owner, 9 Nov 2026): her own 2018 career guides go on Kindle "opportunistically …
 * no extra landing pages". So a line can have no companion page, carry her own byline, keep its
 * manuscript outside this public repo, disclose only the refresh as AI text, and jump the publish
 * queue. Behaviour only: what the book prints, what the gate refuses, which title goes first.
 */
const own = {
  line: "ambitious-grads", author: "S. L. Taylor", own_name: true, publisher: "Spry Labs", companion: false,
  series: { name: "Ambitious Grads", description: "Career guides." },
  ai_disclosure: { text: "some_minimal", images: "none", tool_names: "Anthropic Claude", note: "Only the 2026 refresh was drafted with AI tools." },
  about_author: "S. L. Taylor wrote the Ambitious Grads guides.", disclaimer: "careers",
};
const para = "Networking is about finding what you share with the other person and helping them first, so they have a reason to help you later. ";
const md = ["# Start here", "", para.repeat(45), "", "# Your first year", "", para.repeat(45)].join("\n");
const book = {
  slug: "ambitious-grads-test", title: "How to Break Into Investment Banking", subtitle: "Networking emails, interview answers and your first year",
  series_number: 1, description: "Para one.", keywords: ["a1", "a2", "a3", "a4", "a5", "a6", "a7"],
  categories: ["Business & Money › Job Hunting & Careers › Interviewing"], price_usd: 2.99, manuscript: "~/.boss-os/kdp/x.md",
};
const sibling = { ...book, slug: "ambitious-grads-tech", title: "How to Get a Job in Tech", series_number: 2 };

describe("a book line with no companion page", () => {
  const chapters = S.parseManuscript(md);

  it("passes the gate with no companion_url and no {{companion}}, and prints no site link anywhere", () => {
    expect(S.seriesProblems(own, book, chapters)).toEqual([]);
    const html = S.seriesSections(own, book, chapters, { year: 2026, siblings: [sibling] }).map((s: { html: string }) => s.html).join("");
    expect(html).not.toMatch(/href="http/);
    expect(html).not.toMatch(/Free printables|Your next step/);
    expect(html).toContain("How to Get a Job in Tech");
    expect(html).toContain("S. L. Taylor wrote the Ambitious Grads guides.");
    const listing = S.seriesListing(own, book, { built_on: "2026-11-09" });
    expect(listing.companion_url).toBeNull();
    expect(listing.companion_link).toBeNull();
  });

  it("refuses a {{companion}} placeholder the line cannot fill", () => {
    expect(S.seriesProblems(own, book, S.parseManuscript(md + "\n\nSee {{companion}}.")).join()).toMatch(/no companion page/);
  });

  it("still asks every other line for its companion page", () => {
    const linked = { ...own, companion: undefined, own_name: undefined, author: "June Hollister" };
    expect(S.seriesProblems(linked, book, chapters).join()).toMatch(/no companion_url/);
  });
});

describe("her own byline and her own words", () => {
  const chapters = S.parseManuscript(md);

  it("allows her name only on a line marked as her own writing", () => {
    expect(S.seriesProblems(own, book, chapters).join()).not.toMatch(/pen name/);
    expect(S.seriesProblems({ ...own, own_name: undefined }, book, chapters).join()).toMatch(/related to the owner/);
  });

  it("never lets a placeholder for her words reach Amazon", () => {
    const held = S.parseManuscript(md.replace("# Start here", "# Start here\n\nThis guide first came out in 2018. [HER LINE]"));
    expect(S.seriesProblems(own, book, held).join()).toMatch(/placeholder "\[HER LINE\]"/);
  });

  it("discloses only the refreshed sections as AI text, and prints the line's own AI note", () => {
    expect(S.seriesAi(own)).toEqual({ text_detail: "Some sections, with minimal or no editing", images_detail: "None", tool_names: "Anthropic Claude" });
    expect(S.aiNote(own)).toBe("Only the 2026 refresh was drafted with AI tools.");
    const html = S.seriesSections(own, book, chapters, { year: 2026 }).map((s: { html: string }) => s.html).join("");
    expect(html).toContain("Only the 2026 refresh was drafted with AI tools.");
  });

  it("reads a ~/ manuscript from the home folder, never from the public checkout", () => {
    expect(manuscriptPath("/repo", book, "/Users/me")).toBe("/Users/me/.boss-os/kdp/x.md");
    expect(manuscriptPath("/repo", { slug: "wedding-vows" }, "/Users/me")).toBe("/repo/docs/kdp/books/wedding-vows.md");
  });
});

describe("the publish queue", () => {
  const approved = [{ id: "1", title: "Hostile Work Environment" }, { id: "2", title: "Writing Your Wedding Vows" }, { id: "3", title: "How to Get a Job in Tech" }, { id: "4", title: "How to Break Into Investment Banking" }];
  const register = { titles: [{ title: "How to Break Into Investment Banking", queue_priority: 1 }, { title: "How to Get a Job in Tech", queue_priority: 2 }] };

  it("puts titles with a queue_priority first, lowest first, and keeps everyone else in approval order", () => {
    expect(queueOrder(approved, register).map((a: { id: string }) => a.id)).toEqual(["4", "3", "1", "2"]);
    expect(queueOrder(approved, { titles: [] }).map((a: { id: string }) => a.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("the real register puts both Ambitious Grads books at the front", () => {
    const real = JSON.parse(readFileSync("scripts/ops/kdp-register.json", "utf8"));
    const spec = JSON.parse(readFileSync("scripts/ops/kdp-books/ambitiousgrads.json", "utf8"));
    const queued = real.titles.filter((t: { status: string }) => t.status === "APPROVED_QUEUED").map((t: { title: string }) => ({ title: t.title }));
    const order = queueOrder(queued, real).map((a: { title: string }) => a.title);
    expect(order.slice(0, 2)).toEqual(spec.series_books.map((b: { title: string }) => b.title));
    for (const b of spec.series_books) expect(b.manuscript.startsWith("~/")).toBe(true);
  });
});
