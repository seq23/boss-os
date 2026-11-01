import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendToSection, newerSections, APPEND_FRESH_MS } from "../src/shared/boss/mail/morningSections.mjs";
import { readMorningSections, STALE_MS } from "../src/shared/boss/mail/morning.mjs";

/**
 * THE MORNING SECTIONS IN BOSS OS (Mac→cloud move, 1 Nov 2026): a section can sit in the Boss OS store
 * (a cloud writer), in a Mac file, or both; the morning email reads the newer copy WHOLE.
 */
const NOW = Date.parse("2026-11-02T11:40:00Z");
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("appendToSection", () => {
  it("adds new lines to a fresh copy, drops repeats, keeps decide titles unique", () => {
    const prev = { section: "notices", at: at(2), decide: [{ title: "A", buttons: [{ label: "Open", url: "https://x.test" }] }], rows: [], lines: ["one"] };
    const out = appendToSection(prev, "notices", { lines: ["one", "two"], decide: [{ title: "A", buttons: [{ label: "Open", url: "https://y.test" }] }] }, NOW);
    expect(out.lines).toEqual(["one", "two"]);
    expect(out.decide).toHaveLength(1);
    expect(out.at).toBe(new Date(NOW).toISOString());
  });
  it("a copy older than a day starts fresh", () => {
    const prev = { section: "notices", at: new Date(NOW - APPEND_FRESH_MS - 1).toISOString(), decide: [], rows: [], lines: ["old"] };
    expect(appendToSection(prev, "notices", { lines: ["new"] }, NOW).lines).toEqual(["new"]);
    expect(appendToSection(null, "notices", { lines: ["new"] }, NOW).lines).toEqual(["new"]);
  });
});

describe("newerSections: the cutover rule", () => {
  it("the newer copy wins whole, never a union", () => {
    const file = { lp: { section: "lp", at: at(20), lines: ["yesterday's"] } } as any;
    const store = { lp: { section: "lp", at: at(1), lines: ["today's"] }, notices: { section: "notices", at: at(3), lines: ["cloud"] } } as any;
    const out = newerSections(file, store);
    expect(out.lp!.lines).toEqual(["today's"]);
    expect(out.notices!.lines).toEqual(["cloud"]);
    expect(newerSections({ lp: { ...store.lp, at: at(0.5), lines: ["mac newer"] } } as any, store).lp!.lines).toEqual(["mac newer"]);
  });
});

describe("readMorningSections with the store", () => {
  it("reads store rows and Mac files together; a stale or invalid store row is skipped by name", () => {
    const dir = mkdtempSync(join(tmpdir(), "morning-"));
    writeFileSync(join(dir, "risk.json"), JSON.stringify({ section: "risk", at: at(3), lines: ["mac risk"] }));
    writeFileSync(join(dir, "lp.json"), JSON.stringify({ section: "lp", at: at(10), lines: ["mac lp"] }));
    const store = [
      { section: "lp", body: { section: "lp", at: at(1), lines: ["cloud lp"] } },
      { section: "notices", body: { section: "notices", at: at(2), lines: ["cloud notice"] } },
      { section: "prospects", body: { section: "prospects", at: new Date(NOW - STALE_MS - 1).toISOString(), lines: ["old"] } },
      { section: "catchups", body: { section: "catchups", at: at(1), decide: [{ title: "no button" }] } },
    ];
    const { sections, skipped } = readMorningSections({ dir, now: NOW, store });
    expect(Object.keys(sections).sort()).toEqual(["lp", "notices", "risk"]);
    expect(sections.lp!.lines).toEqual(["cloud lp"]);
    expect(skipped.some((s) => s.startsWith("prospects (store): stale"))).toBe(true);
    expect(skipped.some((s) => s.startsWith("catchups (store):"))).toBe(true);
    // No store (Boss OS unreadable): the Mac files alone.
    expect(readMorningSections({ dir, now: NOW }).sections.lp!.lines).toEqual(["mac lp"]);
  });
});
