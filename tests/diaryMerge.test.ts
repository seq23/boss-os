/**
 * EVERY CALL OF THE DAY, ONCE (26 Oct 2026). Two calendar meetings with no counterpart 90 minutes
 * apart were merged into one at the second one's time, and the morning email missed a call.
 */
import { describe, expect, it } from "vitest";
import { mergeDiaryRows } from "../src/worker/boss/today/diary";

const row = (title: string, iso: string, source = "calendar", w: string | null = null) =>
  ({ id: `${title}${iso}${source}`, title, with: w, scheduled_at: Date.parse(iso), duration_min: 30, location: null, source, standing: false }) as any;

describe("the diary keeps two meetings two, and one meeting on two calendars one", () => {
  it("the 26 Oct shape: both calls stay, each at its own time; each copy on a second calendar collapses", () => {
    const out = mergeDiaryRows([
      row("Ann Eubank and Scooter Taylor", "2026-10-26T15:30:00Z"), row("Ann Eubank and Scooter Taylor", "2026-10-26T15:30:00Z"),
      row("Call- Terri Burns", "2026-10-26T17:00:00Z"), row("Call- Terri Burns", "2026-10-26T17:00:00Z"),
    ]);
    expect(out.map((r) => [r.title, new Date(r.scheduled_at).toISOString()])).toEqual([
      ["Ann Eubank and Scooter Taylor", "2026-10-26T15:30:00.000Z"], ["Call- Terri Burns", "2026-10-26T17:00:00.000Z"],
    ]);
  });
  it("the meeting she typed still folds into the calendar's copy of it", () => {
    const out = mergeDiaryRows([row("Coffee", "2026-10-26T15:00:00Z", "manual"), row("Coffee with A", "2026-10-26T15:30:00Z")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("manual");
  });
});

describe("a filed prep opens from its meeting on Today (13 Nov 2026)", () => {
  it("the meeting's row carries its prep the moment the prep exists; other meetings carry none", async () => {
    const { attachPreps } = await import("../src/worker/boss/today/diary");
    const at = Date.parse("2026-11-16T16:00:00Z");
    const rows = attachPreps(
      [{ title: "Call with Pat Example", scheduled_at: at }, { title: "Team sync", scheduled_at: at + 3_600_000 }] as any[],
      [{ id: "cmd_filed1", title: "Call with Pat Example", scheduled_at: at }],
    );
    expect(rows.map((r: any) => r.prep_id ?? null)).toEqual(["cmd_filed1", null]);
  });
});
