// Her deadlines land on the clock she meant, even when the clocks change in between (22 Nov 2026:
// the offset was read on the day the email arrived, so "by Monday 5pm" sent before 1 Nov became 4 pm).
import { describe, expect, it } from "vitest";
import { dueTimeIn, heldDue, notBeforeIn } from "../src/shared/boss/service/dueTime.mjs";

const beforeFallBack = new Date("2026-10-30T15:00:00Z"); // Fri 30 Oct, 10:00 CDT; clocks go back Sun 1 Nov
const beforeSpringOn = new Date("2027-03-12T16:00:00Z"); // Fri 12 Mar 2027, 10:00 CST; clocks go forward Sun 14 Mar

describe("dueTimeIn across a clock change", () => {
  it("'by Monday 5pm' sent in summer time is 5 pm standard time on Monday", () => {
    expect(dueTimeIn("live by Monday 5pm", beforeFallBack)?.due_at).toBe("2026-11-02T23:00:00.000Z");
  });
  it("a named date after the change is 5 pm on that date's own clock", () => {
    expect(dueTimeIn("can you have it by Nov 3", beforeFallBack)?.due_at).toBe("2026-11-03T23:00:00.000Z");
  });
  it("spring forward: 'by Monday 5pm' is 5 pm daylight time", () => {
    expect(dueTimeIn("by Monday 5pm", beforeSpringOn)?.due_at).toBe("2027-03-15T22:00:00.000Z");
  });
  it("no change in between: unchanged", () => {
    expect(dueTimeIn("by tomorrow 9am", new Date("2026-11-20T15:00:00Z"))?.due_at).toBe("2026-11-21T15:00:00.000Z");
  });
  it("a month's end rolls into the next month", () => {
    expect(dueTimeIn("by tomorrow 9am", new Date("2026-11-30T15:00:00Z"))?.due_at).toBe("2026-12-01T15:00:00.000Z");
  });
});

describe("notBeforeIn and heldDue across a clock change", () => {
  it("'not before 9am on Monday' is 9 am standard time", () => {
    expect(notBeforeIn("Run this not before 9am on Monday.", beforeFallBack)?.at).toBe("2026-11-02T15:00:00.000Z");
  });
  it("the held deadline is 5 pm on the start day's own clock", () => {
    const start = notBeforeIn("Run this not before 9am on Monday.", beforeFallBack);
    expect(heldDue(null, start)?.due_at).toBe("2026-11-02T23:00:00.000Z");
  });
});
