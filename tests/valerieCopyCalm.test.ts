/**
 * SEQUOIA'S COPY OF VALERIE'S LIST, CALM (owner, 25 Oct 2026). Fake names; the feed's own shapes.
 */
import { describe, expect, it } from "vitest";
import { valerieItems } from "../scripts/ops/your-day.mjs";

const FEED = { items: [
  { kind: "other", title: "Jane D. · Rentals · asked for Fri 30 Oct", detail: "Not booked yet", due: null, link: "https://example.com/a" },
  { kind: "other", title: "Sam P. · Party & decor · Thu 10 Dec", detail: "Came in today", due: null, link: "https://example.com/b" },
  { kind: "money", title: "Jane D. · $180 due ($130 + $50 refundable deposit)", detail: "2 days late · ① All of it · now $180", due: "2026-10-23", link: "https://example.com/c" },
  { kind: "other", title: "Lee K. · Rentals · asked for Sun 1 Nov", detail: "Games reserved until today 10:45 AM", due: null, link: "https://example.com/d" },
  { kind: "money", title: "Ari M.", detail: "① All of it · now $95", due: null, link: "https://example.com/e" },
] };
// 25 Oct 2026, 09:30 and 11:00 Central.
const BEFORE = Date.parse("2026-10-25T14:30:00Z");
const AFTER = Date.parse("2026-10-25T16:00:00Z");

describe("Valerie's list in Sequoia's email", () => {
  it("one line per customer: the booking and the money merge, no feed codes, the P&P money words", () => {
    expect(valerieItems(FEED, BEFORE)).toEqual([
      "Jane D. · Fri 30 Oct rental · not booked yet · $180 due ($130 + $50 refundable deposit), 2 days late",
      "Sam P. · Thu 10 Dec party & decor · came in today",
      "Lee K. · Sun 1 Nov rental · hold ends 10:45 AM today",
      "Ari M. · owes all of it: $95",
    ]);
  });
  it("a hold that has passed is never shown as current", () => {
    const lee = valerieItems(FEED, AFTER)!.find((l: string) => l.startsWith("Lee K."));
    expect(lee).toBe("Lee K. · Sun 1 Nov rental · hold ended 10:45 AM: still no deposit");
  });
  it("read-only and short: plain strings, no codes, no links", () => {
    const out = valerieItems(FEED, BEFORE)!;
    for (const l of out) {
      expect(typeof l).toBe("string");
      expect(l).not.toMatch(/[①-⑩]|https?:|reserved until|· now \$/);
      expect(l.split(/\s+/).length).toBeLessThanOrEqual(25);
    }
    expect(out.filter((l: string) => l.startsWith("Jane D."))).toHaveLength(1);
  });
});
