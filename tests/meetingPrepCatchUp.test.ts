import { describe, expect, it } from "vitest";
import { buildCatchUp, isScooterCatchUp, roundupFrom, buildPrep } from "../src/shared/boss/meetingPrep/prep.mjs";
import { catchUpSince } from "../scripts/ops/meeting-prep.mjs";

const ME = ["me@example.com"];
const THU_3PM = Date.parse("2026-11-05T21:00:00Z");
const sync = { calendar_uid: "s1", ical_uid: "s1@google.com", title: "Scooter // Sync", scheduled_at: THU_3PM, duration_min: 60, attendees: [{ email: "me@example.com" }, { email: "partner@fund.example" }] };
const byGuest = { calendar_uid: "s2", ical_uid: "s2@google.com", title: "Weekly", scheduled_at: THU_3PM, attendees: [{ email: "scooter@fund.example" }] };
const other = { calendar_uid: "o1", ical_uid: "o1@google.com", title: "Kate Example <> Sequoia", scheduled_at: THU_3PM, attendees: [{ email: "kate@gemfirm.example", name: "Kate Example" }] };
const since = Date.parse("2026-10-29T12:00:00Z");

const brain = `# Spry\n## Settled decisions\n- 2026-11-05 — **KET launches with all 6 series** (owner) — why\n- 2026-10-01 — Old call — why\n<!-- confidential -->\n- 2026-11-04 — Secret LP term — why\n<!-- /confidential -->\n## Open questions\n- 2026-11-05 — not a decision — x\n`;
const loops = [
  { title: "Brand research done", status: "closed", closed_at: Date.parse("2026-11-04T12:00:00Z"), closed_reason: "done" },
  { title: "Old closed", status: "closed", closed_at: Date.parse("2026-10-01T12:00:00Z") },
  { title: "Same row twice", status: "closed", closed_at: Date.parse("2026-11-04T12:00:00Z"), closed_reason: "duplicate of x" },
  { title: "KET app", status: "open", created_at: Date.parse("2026-11-05T12:00:00Z"), next_date: "2026-11-06", section: "not_finished" },
  { title: "Parked idea", status: "open", created_at: Date.parse("2026-11-05T12:00:00Z"), next_date: "2026-11-06", section: "parked" },
];

describe("a meeting with Scooter is a catch-up", () => {
  it("knows Scooter by the title or by a guest, and nobody else", () => {
    expect(isScooterCatchUp(sync, ME)).toBe(true);
    expect(isScooterCatchUp(byGuest, ME)).toBe(true);
    expect(isScooterCatchUp(other, ME)).toBe(false);
  });

  it("never asks what it is for, on any weekday, and leads with her roundup", () => {
    const r = roundupFrom({ loops, brains: [{ slug: "spry", body_md: brain }], since, now: THU_3PM - 3_600_000 });
    const p = buildCatchUp(sync, r, { herAddresses: ME, since });
    expect(p.needsPurpose).toBe(false);
    expect(p.decide).toEqual([]);
    expect(p.subject).toMatch(/^Prep: Catch-up with Scooter/);
    expect(p.sections[0].items[0]).toMatch(/catch-up with Scooter/);
    // the plain prep for the same event would have asked: the catch-up path is what removes the question
    expect(buildPrep(sync, {}, { herAddresses: ME }).needsPurpose).toBe(true);
  });

  it("rounds up only what happened since, and never reads a confidential part", () => {
    const r = roundupFrom({ loops, brains: [{ slug: "spry", body_md: brain }], since, now: THU_3PM - 3_600_000 });
    expect(r.done).toEqual(["Brand research done"]);
    expect(r.started).toEqual(["KET app", "Parked idea"]);
    expect(r.coming.join(" ")).toContain("KET app");
    expect(r.coming.join(" ")).not.toContain("Parked idea");
    expect(r.decided).toEqual(["Spry Labs: KET launches with all 6 series"]);
    expect(JSON.stringify(r)).not.toContain("Secret LP term");
  });

  it("starts the roundup at the last catch-up, else a week back", () => {
    expect(catchUpSince(sync, null)).toBe(THU_3PM - 7 * 86_400_000);
    const last = Date.parse("2026-10-28T20:00:00Z");
    expect(catchUpSince(sync, last)).toBe(last);
    expect(catchUpSince(sync, THU_3PM)).toBe(THU_3PM - 7 * 86_400_000);
  });
});

describe("the catch-up roundup leaves out housekeeping", () => {
  it("drops the team's unsaved-edits rows and brain lines that were only moved", () => {
    const r = roundupFrom({
      loops: [{ title: "Unsaved edits in a file on your Mac (3 files)", status: "open", created_at: Date.parse("2026-11-05T12:00:00Z") }],
      brains: [{ slug: "spry", body_md: "## Settled decisions\n- 2026-11-01 — Old rule — moved from the old HANDOFF before its cut, 1 Nov.\n" }],
      since, now: THU_3PM,
    });
    expect(r.started).toEqual([]);
    expect(r.decided).toEqual([]);
  });
});
