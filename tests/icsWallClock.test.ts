// The ICS reader turns a zone's clock into an instant with the one shared rule (ownerTime instantAt).
import { describe, expect, it } from "vitest";
import { parseIcs } from "../scripts/ops/ics.mjs";

const feed = (dtstart: string, rrule = "") =>
  `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nSUMMARY:Standing sync\n${dtstart}\n${rrule}END:VEVENT\nEND:VCALENDAR\n`;
const at = (f: string) => parseIcs(f, Date.parse("2026-10-01T00:00:00Z"), 60, 1).events.map((e: any) => new Date(e.scheduled_at).toISOString());

describe("ICS times keep their wall clock", () => {
  it("a weekly 8 am Central repeat stays 8 am across the clocks going back", () => {
    expect(at(feed("DTSTART;TZID=America/Chicago:20261028T080000", "RRULE:FREQ=WEEKLY;COUNT=2\n")))
      .toEqual(["2026-10-28T13:00:00.000Z", "2026-11-04T14:00:00.000Z"]);
  });
  it("seconds are kept and an Eastern TZID is read in Eastern", () => {
    expect(at(feed("DTSTART;TZID=America/New_York:20261111T110030"))).toEqual(["2026-11-11T16:00:30.000Z"]);
  });
  it("an unknown zone is read as UTC, never dropped", () => {
    expect(at(feed("DTSTART;TZID=Mars/Olympus:20261111T110000"))).toEqual(["2026-11-11T11:00:00.000Z"]);
  });
});
