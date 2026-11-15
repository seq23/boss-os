/**
 * A call on her calendar is the answer (owner, 15 Nov 2026: "the call is set she should be doing
 * things right and make sure he never gets another outreach email ever"). Made-up people only.
 */
import { describe, expect, it } from "vitest";
import { callFor, sameContact } from "../src/shared/boss/lp/callBooked.mjs";
import { bookedCalls, doNotContact, lpMorning } from "../scripts/ops/lp-daily.mjs";
import { lpStatusLabel } from "../src/shared/boss/lp/plan.mjs";

const NOW = Date.parse("2026-11-15T15:00:00Z");
const CALL = Date.parse("2026-11-16T18:00:00Z"); // Mon 16 Nov, 12:00 PM Central
const people = [
  { address: "pat@examplefound.org", name: "Pat Example", bucket: "warm", first_seen: "2026-08-20" },
  { address: "lee@other.example", name: "Lee Other", bucket: "call", first_seen: "2026-08-21" },
];
// A Calendly booking: her own entry, and the invitee at the organisation's longer sibling domain.
const events = [
  { scheduled_at: CALL, attendees: [{ email: "sequoia@westpeek.example", self: true }, { email: "pat@examplefoundation.org", responseStatus: "accepted" }] },
  { scheduled_at: CALL, status: "cancelled", attendees: [{ email: "lee@other.example" }] },
  { scheduled_at: CALL, attendees: [{ email: "someone.else@other.example" }] },
];

describe("Monique knows about booked calls", () => {
  it("moves a person with a call on her calendar out of keep warm into a Call booked line, and out of Decide", () => {
    expect(sameContact("pat@examplefoundation.org", "pat@examplefound.org")).toBe(true);
    expect(sameContact("pat2@examplefoundation.org", "pat@examplefound.org")).toBe(false);
    const calls = bookedCalls(people, events, NOW);
    expect([...calls.keys()]).toEqual(["pat@examplefound.org"]); // cancelled and a colleague never count
    const rows = [
      { id: "a", ...people[0], status: "scheduled", picked_start: calls.get("pat@examplefound.org")!.start },
      { id: "b", ...people[1], status: "drafted", tap_token: "tok_abcdefghijklmnopqrstu", draft_body: "Hi", draft_message_id: "m1" },
    ];
    const m = lpMorning(rows, NOW);
    expect(m.lines[0].text).toBe("Pat Example — Call booked: Mon 16 Nov, 12:00 PM CT.");
    expect(m.lines.map((l: any) => l.text).join(" ")).not.toMatch(/Pat Example[^—]*(keep warm|not drafted|waiting for your reply)/);
    expect(m.decide.map((d: any) => d.key)).toEqual(["lp:b"]);
    expect(lpStatusLabel(rows[0], NOW)).toBe("Call booked: Mon 16 Nov, 12:00 PM CT");
    // Once it is past: held.
    const later = CALL + 86_400_000;
    expect(callFor("pat@examplefound.org", events, later)).toEqual({ start: CALL, held: true });
    expect(lpMorning(rows, later).lines[0].text).toBe("Pat Example — Call held: Mon 16 Nov, 12:00 PM CT.");
  });

  it("says so in a NAMED STOP when the calendar could not be read, never a silent old list", () => {
    const m = lpMorning([], NOW, { stops: ["NAMED STOP [LP_CALENDAR_UNREAD] x"] });
    expect(m.lines[0].text).toMatch(/^NAMED STOP \[LP_CALENDAR_UNREAD\]/);
  });

  it("puts everyone with a call, and everyone who replied at all, on the do-not-contact list", () => {
    const seen = new Map<string, any>([
      ["no.thanks@x.example", { bucket: "negative" }], ["ooo@x.example", { bucket: "auto" }], ["drip@x.example", { bucket: "bulk_header" }],
    ]);
    const d = doNotContact({ seenAddresses: seen, people, calls: bookedCalls(people, events, NOW) });
    expect(d.call_booked).toEqual(["pat@examplefound.org"]);
    expect(d.replied.sort()).toEqual(["lee@other.example", "no.thanks@x.example"]);
  });
});
