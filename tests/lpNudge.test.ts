/** One gentle LP nudge for her yes after 7 days without an answer (owner, 26 Oct 2026). Fake names. */
import { describe, expect, it } from "vitest";
import { lpNudgeItems, LP_NUDGE_DAYS } from "../src/shared/boss/lp/plan.mjs";
import { lpMorning } from "../scripts/ops/lp-daily.mjs";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-26T12:00:00Z");
const row = (over: any) => ({ id: "l1", name: "Pat Example", address: "pat@lp.example", status: "sent", sent_at: NOW - 8 * DAY, thread_id: "t1", ...over });

describe("the LP nudge", () => {
  it("is offered once, from day 7 for one week, only after her reply went and nothing came back", () => {
    expect(LP_NUDGE_DAYS).toBe(7);
    const [n] = lpNudgeItems([row({})], NOW);
    expect(n.title).toMatch(/^No answer in 8 days: nudge Pat Example\?/);
    expect(n.draft.text).toMatch(/^Hi Pat,\n\nJust floating this back up/);
    expect(n.buttons.map((b: any) => b.label)).toEqual(["Open their thread to send it"]);
    expect(lpNudgeItems([row({ sent_at: NOW - 6 * DAY })], NOW)).toEqual([]);
    expect(lpNudgeItems([row({ sent_at: NOW - 15 * DAY })], NOW)).toEqual([]);
    expect(lpNudgeItems([row({ status: "replied_again" }), row({ status: "drafted" })], NOW)).toEqual([]);
  });
  it("rides in Monique's morning section as a Decide item", () => {
    expect(lpMorning([row({})], NOW).decide.map((d: any) => d.key)).toEqual(["lpnudge:l1"]);
  });
});
