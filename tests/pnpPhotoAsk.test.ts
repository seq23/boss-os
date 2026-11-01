/**
 * MARKETPLACE LISTINGS USE OUR REAL WORK (owner ruling, 1 Nov 2026): when nothing new has come in for
 * two weeks, ask the owner once in the morning email — at most once a week — and never otherwise.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { photoAskDue, photoAskItem } from "../src/shared/boss/pnp/photoAsk.mjs";
import { readMorningSections, writeMorningSection } from "../src/shared/boss/mail/morning.mjs";

const DAY = 86_400_000;
const now = Date.parse("2026-11-20T20:00:00Z");

describe("the Marketplace photo ask", () => {
  it("asks only after two weeks with nothing new, and at most once a week, and the item reaches the morning email", () => {
    expect(photoAskDue({ newest: now - 13 * DAY, lastAsked: null, now }).ask).toBe(false);
    expect(photoAskDue({ newest: now - 14 * DAY, lastAsked: null, now }).ask).toBe(true);
    expect(photoAskDue({ newest: null, lastAsked: null, now }).ask).toBe(true);
    expect(photoAskDue({ newest: now - 30 * DAY, lastAsked: now - 6 * DAY, now }).ask).toBe(false);
    expect(photoAskDue({ newest: now - 30 * DAY, lastAsked: now - 7 * DAY, now }).ask).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "photo-ask-"));
    writeMorningSection("pnp_marketplace", { decide: [photoAskItem({ days: 16 })] }, { dir, now });
    const { sections, skipped } = readMorningSections({ dir, now: now + 10 * 3_600_000 });
    expect(skipped).toEqual([]);
    expect(sections.pnp_marketplace!.decide![0]!.body).toContain("16 days");
    expect(sections.pnp_marketplace!.decide![0]!.body).not.toMatch(/Valerie/);
  });
});
