import { describe, expect, it } from "vitest";
import { carriedLines, oneLine } from "../scripts/ops/your-day.mjs";
import { lpDecideItems, lpAgainBody } from "../src/shared/boss/lp/plan.mjs";

/**
 * TODAY v4 IN THE MORNING EMAIL (owner, 31 Oct 2026): every Decide item still unanswered in Boss OS
 * comes back as a "Still yours to answer" line, waiting N days, even when no producer re-sent it; and
 * an LP who wrote back again has a reply held in their thread with one-tap Send as is.
 */
describe("the morning email carries what is still unanswered", () => {
  const carried = [
    { id: "decide-old", key: null, title: "Reply to Example Person", days: 7, first_day: "2026-10-24", reply: { text: "Hi,\n\nThanks.", can_send: true }, send_url: "https://boss.example/tap/x?do=send", change_url: "https://boss.example/?waiting=decide-old" },
    { id: "decide-shown", key: null, title: "Already in Decide", days: 2, first_day: "2026-10-29" },
    { id: "decide-keyed", key: "lp:lpr_1", title: "Keyed elsewhere", days: 3, first_day: "2026-10-28" },
  ];

  it("adds one thin line for each carried item not already in this email, with its days", () => {
    const lines = carriedLines(carried, { shown: new Set(["decide-shown"]), keys: new Set(["lp:lpr_1"]), today: "2026-10-31" });
    expect(lines.map((l: any) => l.id)).toEqual(["decide-old"]);
    expect(lines[0].thin).toBe("Still yours to answer: Reply to Example Person · waiting 7 days");
    expect(lines[0].screen).toContain("?waiting=decide-old");
  });

  it("keeps every word of a held reply on one line", () => {
    expect(oneLine("Hi Ann,\n\nThank you.\n\nBest,\nSequoia")).toBe("Hi Ann, Thank you. Best, Sequoia");
  });

  it("an LP who wrote back again: the held reply is shown word for word and one tap sends it", () => {
    const body = lpAgainBody({ name: "Ann Example" });
    expect(body).toMatch(/^Hi Ann,/);
    const item: any = lpDecideItems([{ id: "lpr_a", address: "ann@example.org", name: "Ann Example", status: "replied_again", thread_id: "t1", reply_from: "sequoia@westpeek.ventures", draft_body: body, draft_message_id: "m1", tap_token: "tok_abcdefghijklmnopqrstuv", first_seen: "2026-10-01", last_reply_at: Date.now() - 3 * 86_400_000 }])[0];
    expect(item.draft.text).toBe(body);
    expect(item.buttons[0]).toMatchObject({ label: "Send as is" });
    const none: any = lpDecideItems([{ id: "lpr_b", address: "b@example.org", name: "B", status: "replied_again", thread_id: "t2", first_seen: "2026-10-01", last_reply_at: Date.now() }])[0];
    expect(none.draft).toBeNull();
    expect(none.buttons.map((b: any) => b.label)).toEqual(["Open the thread and reply"]);
  });
});
