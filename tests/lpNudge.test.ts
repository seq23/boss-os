/** One gentle LP nudge for her yes after 7 days without an answer (owner, 26 Oct 2026). Fake names. */
import { describe, expect, it } from "vitest";
import { lpNudgeItems, lpNudgeBody, LP_NUDGE_DAYS } from "../src/shared/boss/lp/plan.mjs";
import { lpMorning } from "../scripts/ops/lp-daily.mjs";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-26T12:00:00Z");
const row = (over: any) => ({ id: "l1", name: "Pat Example", address: "pat@lp.example", status: "sent", sent_at: NOW - 8 * DAY, thread_id: "t1", ...over });

describe("the LP nudge", () => {
  it("is offered once, from day 7 for one week, only after her reply went and nothing came back", () => {
    expect(LP_NUDGE_DAYS).toBe(7);
    const [n] = lpNudgeItems([row({})], NOW);
    expect(n.title).toMatch(/^No answer in 8 days: nudge Pat Example\?/);
    // It names the last exchange and asks one concrete thing; never "patience" in a chase (18 Nov 2026).
    expect(lpNudgeItems([row({ said: "We are reviewing managers this month. Pat, Example LP, 555-555-0100" })], NOW)[0].draft.text).toMatch(/^Hi Pat,\n\nPicking up from your note \("We are reviewing managers this month\."\)/);
    expect(n.draft.text).not.toMatch(/patience/i);
    expect(lpNudgeItems([row({ subject: "Re: Memphis senior housing fit?" })], NOW)).toEqual([]);
    expect(n.buttons.map((b: any) => b.label)).toEqual(["Open their thread"]);
    expect(lpNudgeItems([row({ tap_token: "tok_abcdefghijklmnopqrstu" })], NOW)[0].buttons.map((b: any) => b.label)).toEqual(["Send the nudge", "No nudge", "Open their thread"]);
    expect(lpNudgeItems([row({ nudged_at: NOW - DAY })], NOW)).toEqual([]);
    expect(lpNudgeItems([row({ sent_at: NOW - 6 * DAY })], NOW)).toEqual([]);
    expect(lpNudgeItems([row({ sent_at: NOW - 15 * DAY })], NOW)).toEqual([]);
    expect(lpNudgeItems([row({ status: "replied_again" }), row({ status: "drafted" })], NOW)).toEqual([]);
  });
  it("quotes a whole sentence of theirs, never their greeting and never cut mid-thought (23 Nov 2026 live read)", () => {
    const said = "Hi Pat, Glad to hear that. Short version below. The idea is to keep one template and one set of protective terms across every fund we look at, so each new round is a fill-in rather than a fresh negotiation. We review managers each quarter and would like to hear more.";
    const body = lpNudgeBody({ name: "Pat Example", bucket: "call", said });
    expect(body).toMatch(/Picking up from your note \("We review managers each quarter and would like to hear more\."\)/);
    expect(body).not.toMatch(/Hi Pat, Glad|…/);
    // Their question wins; nothing whole that fits names the thread instead.
    expect(lpNudgeBody({ name: "Pat", bucket: "call", said: "Hi, I'm happy to connect. What did you have in mind?" })).toMatch(/\("What did you have in mind\?"\)/);
    expect(lpNudgeBody({ name: "Pat", bucket: "call", said: "Hello Sequoia, Sure. Ok.", subject: "Re: SAFE rounds" })).toMatch(/Picking up our thread on SAFE rounds:/);
  });
  it("a call is a Done line when booked and the day after it is held, never a week later (23 Nov 2026 live read)", () => {
    const call = (start: number) => row({ status: "scheduled", picked_start: start });
    expect(lpMorning([call(NOW + 2 * DAY)], NOW).lines.map((l: any) => l.text)).toEqual([expect.stringMatching(/^Pat Example — Call booked: /)]);
    expect(lpMorning([call(NOW - 12 * 3_600_000)], NOW).lines.map((l: any) => l.text)).toEqual([expect.stringMatching(/^Pat Example — Call held: /)]);
    expect(lpMorning([call(NOW - 7 * DAY)], NOW).lines.filter((l: any) => /Call held/.test(l.text))).toEqual([]);
  });
  it("rides in Monique's morning section as a Decide item", () => {
    expect(lpMorning([row({})], NOW).decide.map((d: any) => d.key)).toEqual(["lpnudge:l1"]);
  });
});
