/** An empty calendar feed is a named alert, never a quiet "no calls" (26 Oct 2026). */
import { describe, expect, it } from "vitest";
import { feedState } from "../scripts/ops/credential-check.mjs";

describe("an empty calendar feed", () => {
  it("is dead with a named reason; a feed with events is live; a non-calendar is dead", () => {
    expect(feedState("BEGIN:VCALENDAR\nEND:VCALENDAR")).toMatchObject({ state: "dead", detail: expect.stringMatching(/^EMPTY CALENDAR FEED:/) });
    expect(feedState("BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VEVENT\nEND:VCALENDAR")).toMatchObject({ state: "live" });
    expect(feedState("<html>").state).toBe("dead");
  });
});
