import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops lib, no types
import { parseUnits, daysFromCapturedJson, daysFromPageText, mergeDays, parseReports, fromReports, withWindow, reportWindow, salesLine } from "../scripts/ops/lib/kdp-units.mjs";

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

describe("the reports read: units AND Kindle Unlimited pages per title (root cause confirmed live 8 Nov 2026)", () => {
  // The bodies are the live shapes kdpreports.amazon.com returned on 8 Nov 2026 (KENP: 41 + 17 pages).
  const meta = { reportsMetadata: { books: {
    "DIGITAL=B0HJKNMRGX:::": { titleName: "The Credit Dispute Letter", asins: { digital: "B0HJKNMRGX", print: null } },
    "DIGITAL=B0HHFK6W76:::": { titleName: "The Wedding Day Timeline", asins: { digital: "B0HHFK6W76", print: "B0PRINT001" } },
    "DIGITAL=B0HQVR4HD3:::": { titleName: "The Co-Parenting Log", asins: { digital: "B0HQVR4HD3" } },
  } } };
  const kenp = { histogram: { data: [{ bin: "B0HJKNMRGX", values: { TotalKENP: 41 } }, { bin: "B0HHFK6W76", values: { TotalKENP: 17 } }], props: {}, title: "KENPTableTitles" } };
  const kenpDays = { nestedHistogram: { histogramList: [{ data: [{ bin: "Amazon.com", values: { TotalKENP: 41 } }], title: "2026-09-26" }, { data: [{ bin: "Amazon.com", values: { TotalKENP: 17 } }], title: "2026-10-09" }] } };
  const orders = (data: unknown[]) => ({ histogram: { data, props: {}, title: "OrdersTableTitles" } });

  it("the capture keeps kdpreports.amazon.com, where every number lives — the old /kdp\\.amazon\\.com/ test dropped it", () => {
    expect(fromReports("https://kdpreports.amazon.com/reports/kenp/table/titles")).toBe(true);
    expect(fromReports("https://unagi.amazon.com/1/events")).toBe(false);
    expect(fromReports("not a url")).toBe(false);
    expect(/kdp\.amazon\.com/.test("https://kdpreports.amazon.com/x")).toBe(false); // the defect, pinned
    expect(read("scripts/ops/kdp-units.mjs")).toMatch(/fromReports\(res\.url\(\)\)/);
  });

  it("records units and KU pages per title, named from the reports' own metadata, with every catalogue title present", () => {
    const r = parseReports({ captured: [
      { path: "/metadata/reports/reportsMetadata", body: meta },
      { path: "/reports/orders/table/titles", body: orders([{ bin: "B0HHFK6W76", values: { TotalOrders: 3, TotalRoyalty: 2.04 } }]) },
      { path: "/reports/kenp/table/titles", body: kenp },
      { path: "/reports/kenp/marketplaceHistogramV2", body: kenpDays },
    ] });
    expect(r.titles.B0HJKNMRGX).toEqual({ title: "The Credit Dispute Letter", units: 0, free_units: 0, kenp: 41 });
    expect(r.titles.B0HHFK6W76).toEqual({ title: "The Wedding Day Timeline", units: 3, free_units: 0, kenp: 17 });
    expect(r.titles.B0HQVR4HD3).toEqual({ title: "The Co-Parenting Log", units: 0, free_units: 0, kenp: 0 });
    expect([r.units_total, r.kenp_total]).toEqual([3, 58]);
    expect(r.kenp_days).toEqual({ "2026-09-26": 41, "2026-10-09": 17 });
    expect(salesLine(r)).toBe("3 sold · 58 KU pages");
  });

  it("never counts money as units, and splits out free promo units when Amazon does", () => {
    const r = parseReports({ captured: [
      { path: "/reports/orders/table/titles", body: orders([{ bin: "B0X", values: { TotalRoyalty: 99, TotalPaidOrders: 0, TotalFreeOrders: 7, TotalOrders: 7 } }]) },
      { path: "/reports/kenp/table/titles", body: { histogram: { data: [] } } },
    ] });
    expect(r.titles.B0X).toMatchObject({ units: 7, free_units: 7, kenp: 0 });
  });

  it("two tables read and empty are a real zero; a missing table is an unread page, never a zero", () => {
    const empty = [{ path: "/reports/orders/table/titles", body: orders([]) }, { path: "/reports/kenp/table/titles", body: { histogram: { data: [] } } }];
    expect(parseReports({ captured: empty })).toMatchObject({ units_total: 0, kenp_total: 0 });
    expect(() => parseReports({ captured: [empty[0]] })).toThrow(/KENP/);
    expect(() => parseReports({ captured: [empty[1]] })).toThrow(/Orders/);
    expect(() => parseReports({ captured: [{ path: "/reports/dashboard/overview", body: { overviewWidget: {} } }] })).toThrow();
  });

  it("asks Amazon for the same window on every report call", () => {
    const win = reportWindow(Date.parse("2026-11-09T15:45:00Z"), 60);
    expect(win).toEqual({ startDate: "2026-09-10T00:00:00Z", endDate: "2026-11-09T23:59:59Z" });
    expect(JSON.parse(withWindow(JSON.stringify({ startDate: "2026-11-01T00:00:00Z", endDate: "x", filterBy: {} }), win))).toEqual({ ...win, filterBy: {} });
    expect(withWindow("not json", win)).toBe("not json");
  });
});

describe("the weekly Monday run reads units in code, before it publishes", () => {
  const wrapper = read("scripts/ops/kdp-publish.sh");

  it("invokes kdp-units.mjs exactly once, and the monthly triage no longer does", () => {
    expect((wrapper.match(/node scripts\/ops\/kdp-units\.mjs/g) ?? []).length).toBe(1);
    expect(read("scripts/ops/kdp-surface.sh")).not.toMatch(/node scripts\/ops\/kdp-units\.mjs/);
  });

  it("reads sales before the publisher, so a publish stop never costs the week's numbers", () => {
    expect(wrapper.indexOf("kdp-units.mjs")).toBeGreaterThan(-1);
    expect(wrapper.indexOf("kdp-units.mjs")).toBeLessThan(wrapper.indexOf("node scripts/ops/kdp-publish.mjs"));
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
    expect(readers).toMatch(/kdp-units\.mjs.*kdp-publish\.sh/s);
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
