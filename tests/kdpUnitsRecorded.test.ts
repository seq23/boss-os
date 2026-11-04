import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops lib, no types
import { parseUnits, daysFromCapturedJson, daysFromPageText, mergeDays } from "../scripts/ops/lib/kdp-units.mjs";

/**
 * UNITS SOLD IS READ BY CODE, NOT BY A PARAGRAPH IN A PROMPT (owner ruling, 1 Nov 2026: "nothing
 * runs unmeasured"). Until 2 Nov 2026 the only instruction to write ~/.boss-os/kdp/units.json was
 * English inside kdp-surface-prompt.md; nothing checked it happened, and the 1 Nov run printed
 * "KDP-SURFACE-COMPLETE: quiet" in 39 seconds having never opened a browser. This pins the fix,
 * reading the real files:
 *
 *   1. THE PARSERS, over fixtures of the dashboard's own JSON and its rendered text. Nothing
 *      recognisable from either source is a hard failure; a recognised widget whose own array is
 *      empty is a real zero (confirmed live against this account, 2 Nov 2026) and is not one.
 *   2. THE WRAPPER runs the units read in code, after sign-in and before the model — the same place
 *      kdp-open.mjs and kdp-signin.mjs already sit — and treats its failure as a named stop line.
 *   3. THE PROMPT no longer tells the model to read the reports page or write units.json itself.
 *   4. THE SCORECARD READER refuses to turn an `unread` page into a number.
 *   5. BROWSER.MJS's `read` command has no path that reports BROWSER_OK on an empty body.
 */

const ROOT = new URL("..", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");

describe("the units parsers hard-fail on an unread page, but a recognised widget's real zero is not one", () => {
  it("reads units sold per day out of the dashboard's own captured JSON", () => {
    const rows = daysFromCapturedJson({ dataPoints: [{ date: "2026-10-30", units: 3 }, { date: "2026-10-31", unitsSold: 1 }] });
    expect(rows).toEqual([{ day: "2026-10-30", units: 3 }, { day: "2026-10-31", units: 1 }]);
  });

  it("reads the real dashboard shape — the series nested one level under a named widget key (confirmed live against kdpreports.amazon.com, 2 Nov 2026)", () => {
    const rows = daysFromCapturedJson({ histogram: { data: [{ date: "2026-10-30", value: 3 }, { date: "2026-10-31", value: 1 }], props: {}, title: "OrdersForLast30Days" } });
    expect(rows).toEqual([{ day: "2026-10-30", units: 3 }, { day: "2026-10-31", units: 1 }]);
  });

  it("falls back to the rendered page text when nothing was captured", () => {
    const rows = daysFromPageText("Totals\nOct 30, 2026   KENP   0   12\nOct 31, 2026   KENP   0   4\nsome other line\n");
    expect(rows).toEqual([{ day: "2026-10-30", units: 12 }, { day: "2026-10-31", units: 4 }]);
  });

  it("merges same-day rows into one count per day", () => {
    expect(mergeDays([{ day: "2026-10-30", units: 2 }, { day: "2026-10-30", units: 5 }])).toEqual({ "2026-10-30": 7 });
  });

  it("parses from the capture first, and only reads text when the capture is empty", () => {
    const r = parseUnits({ captured: [{ dataPoints: [{ date: "2026-11-01", units: 9 }] }], text: "Oct 1, 2026   1" });
    expect(r).toEqual({ days: { "2026-11-01": 9 }, source: "capture" });
  });

  it("throws when nothing recognisable came back from either source", () => {
    expect(() => parseUnits({ captured: [{ somethingElse: true }], text: "nothing parseable here" })).toThrow();
  });

  it("does NOT throw when a known widget was recognised but its own array was empty — confirmed live, 2 Nov 2026: two brand-new titles genuinely sold nothing in the dashboard's last-30-days histogram, and that is a real zero from a page that was read, not an unread page", () => {
    const r = parseUnits({ captured: [{ histogram: { data: [], props: {}, title: "OrdersForLast30Days" } }], text: "" });
    expect(r).toEqual({ days: {}, source: "capture" });
  });
});

describe("the wrapper reads units in code, after sign-in and before the model", () => {
  const wrapper = read("scripts/ops/kdp-surface.sh");

  it("invokes kdp-units.mjs exactly once", () => {
    expect((wrapper.match(/node scripts\/ops\/kdp-units\.mjs/g) ?? []).length).toBe(1);
  });

  it("runs it after kdp-signin.mjs and before the model (ai-run) invocation", () => {
    const signinAt = wrapper.indexOf("kdp-signin.mjs");
    const unitsAt = wrapper.indexOf("kdp-units.mjs");
    const claudeAt = wrapper.indexOf('"$AI_RUN" --role');
    expect(signinAt).toBeGreaterThan(-1);
    expect(unitsAt).toBeGreaterThan(signinAt);
    expect(claudeAt).toBeGreaterThan(unitsAt);
  });

  it("names a reason rather than letting the run crash on a failed read", () => {
    expect(wrapper).toMatch(/NAMED STOP \[UNITS_NOT_READ\]/);
  });
});

describe("the prompt no longer tells the model to read units sold or write units.json", () => {
  const prompt = read("scripts/ops/kdp-surface-prompt.md");

  it("never asks the model to write units.json", () => {
    expect(prompt).not.toMatch(/write\s*\n?`?~\/\.boss-os\/kdp\/units\.json`? as/i);
  });

  it("says the wrapper is the one writer, and names kdp-units.mjs", () => {
    expect(prompt).toMatch(/kdp-units\.mjs/);
    expect(prompt).toMatch(/one writer/i);
  });
});

describe("the scorecard reader refuses to turn an unread page into a number", () => {
  const readers = read("scripts/ops/lib/scorecard-readers.mjs");

  it("checks o.unread before trusting the file's days", () => {
    const fnStart = readers.indexOf("function kdpUnits(");
    const fnBody = readers.slice(fnStart, readers.indexOf("\n}\n", fnStart));
    expect(fnBody).toMatch(/if \(o\.unread\)/);
    expect(fnBody).toMatch(/KDP_UNITS_UNREAD/);
  });

  it("the missing-file sentence names the daily read, not a monthly check that never had the job", () => {
    expect(readers).toMatch(/kdp-units\.mjs.*kdp-surface\.sh/s);
    expect(readers).not.toMatch(/Simone's monthly KDP check/);
  });
});

describe("browser.mjs's read command has no path that reports OK on an empty body", () => {
  const src = read("scripts/ops/browser.mjs");

  it("has a PAGE_EMPTY outcome guarding the read command", () => {
    expect(src).toMatch(/PAGE_EMPTY/);
  });

  it("the BROWSER_OK read call is reached only after the empty-body check", () => {
    const readBlock = src.slice(src.indexOf('if (COMMAND === "read")'), src.indexOf('await context.close();\n  if (late)'));
    const emptyCheckAt = readBlock.indexOf("PAGE_EMPTY");
    const okSayAt = readBlock.lastIndexOf('say("BROWSER_OK"');
    expect(emptyCheckAt).toBeGreaterThan(-1);
    expect(okSayAt).toBeGreaterThan(emptyCheckAt);
  });
});
