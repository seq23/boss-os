import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson } from "./helpers";
import { dayIdInZone } from "../../src/shared/boss/timezone";
import { waitingOnYou, foldMornings } from "../../src/worker/boss/today/waiting";
import { GATE_DEFAULTS, cleanGateItems, normaliseGate, BP_TEA_MORNING_SINCE, gateLine, type GateItem } from "../../src/worker/boss/today/list";
import { chooseQuestion, problems, coachSituation, runBack, type CoachSignals } from "../../src/worker/boss/today/coachQuestion";
import { buildCoachingPrompt } from "../../src/worker/boss/coaching/session";
import { CHAINS, LOCAL, choosePlace, foodToday, placeKey, whereToday, usablePlace, NO_REPEAT_DAYS } from "../../src/worker/boss/today/food";
import { pickSide, SIDE_BUSINESSES, brokenLine } from "../../src/worker/boss/today/sideBusiness";
import { confidentialLadder, isConfidentialDraft, orderSeats, CLAUDE_SEAT, OPENAI_SEAT } from "../../src/worker/boss/duties/seatOrder";
import { routeCompletion } from "../../src/worker/boss/router";
import { LINES, BANNED_WORDS } from "../../src/worker/boss/practice/lines";
import { lpReplyClosed } from "../../src/worker/boss/routes/lpTap";

/**
 * TODAY v4 (owner approved the mock-up, 31 Oct 2026). Pinned here:
 *   - carry-over: an unanswered Decide item survives a newer morning; an answered one does not; "Not
 *     now" is today only; handled items (sent, scheduled, match cards, errands taken over) never carry;
 *   - ONE 💰 Wealth block, no "Brokerage block" row;
 *   - the coaching question's priority, and that the coach is handed counts, never names;
 *   - the food row: no repeat inside 60 days, never a recipe, NYC until 4 Nov; and no food words in
 *     coaching questions or the lapse lines;
 *   - the Morning gate: coaching always last, the blood pressure tea in the morning and never at night;
 *   - LP / deal-terms drafts: Claude's seat only, and the router fails closed.
 */

const TODAY = dayIdInZone(Date.now());
const back = (n: number, from = TODAY) => new Date(Date.parse(`${from}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const NAME = "Zebediah Quillfeather";

async function morning(day: string, decide: any[], still: any[] = []) {
  await env.DB.prepare(`INSERT INTO morning_digests (day, payload, sent_at, created_at, updated_at) VALUES (?,?,NULL,1,1)
                        ON CONFLICT(day) DO UPDATE SET payload = excluded.payload`).bind(day, JSON.stringify({ day, decide, still_yours: still })).run();
}
async function lp(id: string, status: string, extra: Record<string, unknown> = {}) {
  const row = { draft_id: null, draft_message_id: null, draft_body: null, tap_token: null, ...extra };
  await env.DB.prepare(
    `INSERT INTO lp_reply_drafts (id, address, name, bucket, reply_from, thread_id, status, first_seen, draft_id, draft_message_id, draft_body, tap_token, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,1)`,
  ).bind(id, `${id}@example.org`, extra.name ?? NAME, "call", "sequoia@westpeek.ventures", "thr1", status, back(20), row.draft_id, row.draft_message_id, row.draft_body, row.tap_token).run();
}
async function clean() {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM morning_digests`),
    env.DB.prepare(`DELETE FROM lp_reply_drafts`),
    env.DB.prepare(`DELETE FROM decide_dismissed`),
    env.DB.prepare(`DELETE FROM today_ticks`),
    env.DB.prepare(`DELETE FROM food_orders`),
    env.DB.prepare(`DELETE FROM side_business_days`),
    env.DB.prepare(`DELETE FROM settings WHERE key LIKE 'food_%'`),
  ]);
}

describe("Still waiting on you: carried across mornings", () => {
  beforeEach(clean);

  it("an old unanswered item survives a newer morning; an answered one does not", async () => {
    await morning(back(7), [
      { id: "decide-oldunanswered", title: "Approve the example contract", body: "It waits on you.", from: "boss" },
      { id: "decide-oldanswered", title: "Choose the venue", body: "Two options.", from: "boss" },
    ]);
    // A newer morning that no longer carries the first, and carries the second answered.
    await morning(back(1), [
      { id: "decide-oldanswered", title: "Choose the venue", body: "Two options.", from: "boss", answered_at: 123 },
      { id: "decide-newthing", title: "Sign the example form", body: "", from: "boss" },
    ]);
    const { items } = await waitingOnYou(env as any, TODAY);
    const ids = items.map((i) => i.id);
    expect(ids).toContain("decide-oldunanswered");
    expect(ids).not.toContain("decide-oldanswered");
    const old = items.find((i) => i.id === "decide-oldunanswered")!;
    expect(old.first_day).toBe(back(7));
    expect(old.days).toBe(7);

    // On Today it is under "Still waiting on you", counted, with its days.
    const list = (await apiJson("/api/practice/list")).body.data;
    expect(list.waiting.map((w: any) => w.id)).toContain("decide-oldunanswered");
    expect(list.waiting.find((w: any) => w.id === "decide-oldunanswered").days).toBe(7);
    expect(list.needs_you).toBeGreaterThanOrEqual(list.waiting.length);
  });

  it("keeps the newest copy, dedupes by id, and counts from the first appearance", () => {
    const m = foldMornings([
      { day: "2026-10-24", decide: [{ id: "decide-x", title: "Waiting 3 days: Reply to A", body: "old" }], still: [] },
      { day: "2026-10-30", decide: [], still: [{ id: "decide-x", title: "Waiting 9 days: Reply to A", line: "Still yours to answer: A · 9 days" }] },
      { day: "2026-10-26", decide: [{ id: "decide-x", title: "Waiting 5 days: Reply to A", body: "newer" }], still: [] },
    ]);
    expect(m.size).toBe(1);
    const x = m.get("decide-x")!;
    expect(x.first).toBe("2026-10-24");
    expect(x.newest).toBe("2026-10-30");
    expect(x.body).toBe("newer");
    expect(x.title).toBe("Reply to A");
  });

  it("\"Not now\" hides it for today only; it is back tomorrow. Dismiss is for good", async () => {
    await morning(back(3), [{ id: "decide-snoozeme", title: "Approve the example letter", body: "", from: "boss" }]);
    await apiJson("/api/practice/tick", { method: "POST", body: { key: "notnow:decide-snoozeme" } });
    expect((await waitingOnYou(env as any, TODAY)).items.map((i) => i.id)).not.toContain("decide-snoozeme");
    expect((await waitingOnYou(env as any, back(-1))).items.map((i) => i.id)).toContain("decide-snoozeme");
    await apiJson("/api/practice/waiting/decide-snoozeme/dismiss", { method: "POST", body: {} });
    expect((await waitingOnYou(env as any, back(-1))).items.map((i) => i.id)).not.toContain("decide-snoozeme");
  });

  it("never carries what is handled: a reply sent or scheduled, a match card, an errand she took over", async () => {
    await lp("lpr_sent", "sent", { name: "Sent Person" });
    await lp("lpr_sched", "scheduled", { name: "Scheduled Person" });
    await lp("lpr_live", "replied_again", { name: "Live Person", draft_id: "d1", draft_message_id: "m1", draft_body: "Hi Live,\n\nThank you.", tap_token: "tok_live_abcdefghijklmnopqrst" });
    await morning(back(6), [
      { id: "decide-sent1", key: "lp:lpr_sent", title: "Reply to Sent Person", from: "lp" },
      { id: "decide-sched1", key: "lp-again:lpr_sched", title: "Answer Scheduled Person: they wrote back after your reply", from: "lp" },
      { id: "decide-live1", key: "lp-again:lpr_live", title: "Answer Live Person: they wrote back after your reply", from: "lp" },
      { id: "decide-match1", title: "Stripe: a buyer and a seller who could trade", from: "monique_found" },
      { id: "decide-errand1", title: "reservations@club.example wants a card or deposit", from: "notices" },
    ]);
    const { items } = await waitingOnYou(env as any, TODAY);
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(["decide-live1"]);
    const live = items[0]!;
    expect(live.reply).toMatchObject({ lp_id: "lpr_live", can_send: true, text: "Hi Live,\n\nThank you." });
    // The Today view never carries the one-tap token.
    const list = (await apiJson("/api/practice/list")).body.data;
    expect(JSON.stringify(list)).not.toContain("tok_live_");
  });

  it("an LP who wrote back again with a held reply can be sent; with nothing held, the reply is closed", () => {
    expect(lpReplyClosed({ status: "replied_again", draft_body: "Hi" })).toBe(false);
    expect(lpReplyClosed({ status: "replied_again", draft_body: null })).toBe(true);
    for (const s of ["sent", "skipped", "scheduled"]) expect(lpReplyClosed({ status: s, draft_body: "Hi" })).toBe(true);
    expect(lpReplyClosed({ status: "drafted", draft_body: "Hi" })).toBe(false);
  });
});

describe("One 💰 Wealth block", () => {
  beforeEach(clean);

  it("has Core business and Side business, and no Brokerage block or vehicle block row", async () => {
    const rows = (await apiJson("/api/practice/list")).body.data.rows as any[];
    const wealth = rows.filter((r) => r.kind === "wealth");
    expect(wealth).toHaveLength(1);
    expect(wealth[0].title).toBe("💰 Wealth block");
    expect(wealth[0].parts.map((p: any) => [p.key, p.ros])).toEqual([["core", "first_wealth_block"], ["side", "afternoon_wealth_admin"]]);
    expect(rows.some((r) => /Brokerage block/.test(r.title))).toBe(false);
    expect(rows.some((r) => /^(West Peek Ventures|Industry Guides|A Player Mode|SaaS apps) block$/.test(r.title))).toBe(false);
    expect(rows.some((r) => r.key === "ros:first_wealth_block" || r.key === "ros:afternoon_wealth_admin")).toBe(false);
    // The side pick is kept for the day: a second read returns the same one.
    const again = (await apiJson("/api/practice/list")).body.data.rows.find((r: any) => r.kind === "wealth").parts[1].pick;
    expect(again).toEqual(wealth[0].parts[1].pick);
  });

  it("picks the side business from real signals, says why, and leans side on weekends", () => {
    const none = { leads: {}, broken: {}, revenue: {}, lastPicked: {} };
    expect(pickSide({ ...none, leads: { industry_guides: 2 } }, "2026-11-02", 1)).toMatchObject({ key: "industry_guides", signal: "leads", why: expect.stringContaining("leads waiting") });
    const broken = pickSide({ ...none, broken: { approvalprep: "red" } }, "2026-11-02", 1);
    expect(broken).toMatchObject({ key: "approvalprep", signal: "broken" });
    // Plain words on her screen: never a file, a path or a repo name.
    for (const b of SIDE_BUSINESSES) expect(brokenLine(b.name)).not.toMatch(/[/\\]|\.ya?ml|\.github|seq23|workflow/i);
    expect(broken.line).toBe(brokenLine("ApprovalPrep"));
    expect(pickSide({ ...none, revenue: { a_player_mode: 3 } }, "2026-11-02", 1)).toMatchObject({ key: "a_player_mode", signal: "revenue" });
    // A quiet weekday: Core business has the day. A quiet Saturday: the one left alone longest.
    expect(pickSide(none, "2026-11-02", 1)).toMatchObject({ key: null, signal: "none" });
    const lastPicked = Object.fromEntries(SIDE_BUSINESSES.map((b, i) => [b.key, back(i + 1, "2026-11-07")]));
    const sat = pickSide({ ...none, lastPicked }, "2026-11-07", 6);
    expect(sat.signal).toBe("untouched");
    expect(sat.key).toBe(SIDE_BUSINESSES[SIDE_BUSINESSES.length - 1]!.key);
  });
});

describe("Coaching: the question fits her life, and the coach sees counts only", () => {
  const calm: CoachSignals = { appAwayDays: 0, morningGateMissed: 0, nightGateMissed: 0, talksMissed: 0, waitingDays: 0, waitingWho: null, noMoneyMoveDays: 0, ancestralDaysLeft: null, meetingsToday: 0, streakDays: 0 };

  it("the longest-running and costliest problem wins", () => {
    const q = chooseQuestion({ ...calm, waitingDays: 17, waitingWho: "an LP", morningGateMissed: 2, appAwayDays: 2 });
    expect(q.kind).toBe("waiting");
    expect(q.question).toMatch(/^An LP has waited 17 days for one reply, and .+\. What's the real reason, and what do you send before noon\?$/);
    // Longer beats cheaper: nine days away from the app outranks a three-day wait.
    expect(chooseQuestion({ ...calm, waitingDays: 3, waitingWho: "someone", appAwayDays: 9 }).kind).toBe("app");
    expect(problems({ ...calm, ancestralDaysLeft: 0, meetingsToday: 5 })[0]!.kind).toBe("ancestral");
  });

  it("praises a streak only when nothing is slipping, and changes when the signals change", () => {
    expect(chooseQuestion({ ...calm, streakDays: 5 }).kind).toBe("streak");
    expect(chooseQuestion({ ...calm, streakDays: 5, noMoneyMoveDays: 4 }).kind).toBe("money");
    const a = chooseQuestion({ ...calm, morningGateMissed: 3 });
    const b = chooseQuestion({ ...calm, morningGateMissed: 4 });
    expect(a.signature).not.toBe(b.signature);
    expect(a.question).not.toBe(b.question);
    expect(chooseQuestion({ ...calm, morningGateMissed: 3 }).question).toBe(a.question);
  });

  it("never counts a day before the record began as a day skipped (the first live read said 30)", () => {
    const none = new Map<string, Record<string, unknown>>();
    expect(runBack("2026-10-31", none, (r) => !r, "2026-10-31")).toBe(0);
    expect(runBack("2026-10-31", none, (r) => !r, "2026-10-28")).toBe(3);
    expect(runBack("2026-10-31", none, (r) => !r, null)).toBe(0);
    expect(runBack("2026-12-31", none, (r) => !r, "2026-01-01")).toBe(30);
  });

  it("never mentions body, weight or food, in any question it can ask", () => {
    const every: CoachSignals[] = [
      { ...calm, appAwayDays: 3 }, { ...calm, morningGateMissed: 3 }, { ...calm, nightGateMissed: 3 }, { ...calm, talksMissed: 5 },
      { ...calm, waitingDays: 9, waitingWho: "an LP" }, { ...calm, noMoneyMoveDays: 4 }, { ...calm, ancestralDaysLeft: 1 },
      { ...calm, meetingsToday: 6 }, { ...calm, streakDays: 6 }, calm,
    ];
    for (const s of every) {
      const q = chooseQuestion(s);
      for (const text of [q.question, q.situation]) {
        for (const w of BANNED_WORDS) expect(new RegExp(`\\b${w.replace(/\s+/g, "\\s+")}\\b`, "i").test(text), `"${w}" in "${text}"`).toBe(false);
      }
    }
    // The lapse emails' lines carry no food either (food lives on its own row only).
    for (const line of Object.values(LINES).flat()) expect(/\b(keto|food|eat|meal|restaurant|carbs?)\b/i.test(line), line).toBe(false);
  });

  it("the coach's payload carries counts, never a name", async () => {
    await clean();
    await lp("lpr_named", "replied_again", { name: NAME });
    await morning(back(12), [{ id: "decide-named", key: "lp-again:lpr_named", title: `Answer ${NAME}: they wrote back after your reply`, from: "lp" }]);
    const situation = await coachSituation(env as any, TODAY);
    expect(situation).toMatch(/An LP has waited 12 days/);
    expect(situation).not.toContain("Zebediah");
    expect(situation).not.toContain("Quillfeather");
    expect(situation).not.toContain("@");
    const prompt = buildCoachingPrompt({ anchor: null, openLoops: 0, approvalsWaiting: 0, turn: 1, dayMode: null, situation });
    expect(prompt).toContain(situation);
    expect(prompt).not.toContain("Quillfeather");
    expect(prompt).toMatch(/Never bring up her body, weight or food/);
    const list = (await apiJson("/api/practice/list")).body.data;
    expect(list.coach_question.question).not.toContain("Quillfeather");
  });
});

describe("🥑 the food row: a restaurant order, new every day", () => {
  beforeEach(clean);

  it("never repeats a place inside 60 days", async () => {
    await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('food_home_city', 'New York, NY', 1)`).run();
    const start = "2026-12-01";
    const seen = new Map<string, string>();
    const total = CHAINS.length + LOCAL["new york"]!.length;
    for (let i = 0; i < total; i++) {
      const day = back(-i, start);
      const f = await foodToday(env as any, day);
      const k = `${f.place}|${f.local}`;
      expect(seen.has(k), `${f.place} again on ${day} (first ${seen.get(k)})`).toBe(false);
      seen.set(k, day);
      // Kept for the day: a second read is the same place.
      expect((await foodToday(env as any, day)).place).toBe(f.place);
    }
    expect([...seen.keys()].some((k) => k.endsWith("|true"))).toBe(true);
    expect([...seen.keys()].some((k) => k.endsWith("|false"))).toBe(true);
  });

  it("\"Another place\" swaps it for one not shown inside 60 days", () => {
    const today = "2026-12-10";
    const lastUsed = Object.fromEntries(CHAINS.slice(0, CHAINS.length - 1).map((p) => [placeKey(p), back(10, today)]));
    const p = choosePlace({ today, local: [], chains: CHAINS, lastUsed, shownToday: [], preferLocal: false });
    expect(p.place).toBe(CHAINS[CHAINS.length - 1]!.place);
    const after = choosePlace({ today, local: [], chains: CHAINS, lastUsed: { ...lastUsed, [placeKey(p)]: back(NO_REPEAT_DAYS - 1, today) }, shownToday: [placeKey(p)], preferLocal: false });
    expect(after.place).not.toBe(p.place);
  });

  it("is an order, never a recipe, keto-sized, and every hand-written place says what to leave off or swap", () => {
    for (const p of [...CHAINS, ...Object.values(LOCAL).flat()]) {
      expect(usablePlace({ place: p.place, order: p.order, net_carbs: p.carbs, why: p.why }), p.place).not.toBeNull();
      expect(p.order, p.place).toMatch(/\b(no|instead|swap|without|skip|leave|only|send|in a tub|lettuce|dry)\b/i);
    }
    expect(usablePlace({ place: "Home", order: "Preheat the oven and bake the chicken", net_carbs: 3 })).toBeNull();
    expect(usablePlace({ place: "Diner", order: "Pancakes", net_carbs: 80 })).toBeNull();
  });

  it("uses New York until the afternoon of Wed 4 Nov, then the calendar or home city; chains only with no city", () => {
    const s = { home: "Memphis, TN", away: "New York, NY", awayUntil: "2026-11-04" };
    expect(whereToday("2026-11-01", s, null)).toMatchObject({ city: "New York, NY", source: "away" });
    expect(whereToday("2026-11-04", s, null)).toMatchObject({ city: "New York, NY", source: "away" });
    expect(whereToday("2026-11-05", s, null)).toMatchObject({ city: "Memphis, TN", source: "home" });
    expect(whereToday("2026-11-05", s, "Chicago")).toMatchObject({ city: "Chicago", source: "calendar" });
    expect(whereToday("2026-11-05", {}, null)).toMatchObject({ city: null, source: "none" });
  });

  it("the food row is on Today at 15:00, and the city is set through the app", async () => {
    const r = await apiJson("/api/practice/food/where", { method: "PUT", body: { away: "New York, NY", until: "2099-01-01" } });
    expect(r.status).toBe(200);
    const food = r.body.data.rows.find((x: any) => x.kind === "food");
    expect(food.at).toBe(15 * 60);
    expect(food.food.where).toMatchObject({ city: "New York, NY", source: "away" });
    expect((await apiJson("/api/practice/food/where", { method: "PUT", body: { away: "New York, NY", until: "soon" } })).status).toBe(400);
  });
});

describe("The Morning gate: coaching last, the blood pressure tea in the morning", () => {
  const custom = (label: string): GateItem => ({ key: "custom:abcd1234", kind: "custom", label });

  it("defaults: gratitude, meditation, movement, medicine, tea, then coaching last; the row says so", () => {
    expect(GATE_DEFAULTS.morning.map((i) => i.key)).toEqual(["gratitude", "practice", "move", "water", "bp_tea", "agree", "coach"]);
    expect(gateLine("morning", [...GATE_DEFAULTS.morning])).toBe("1 Gratitude sentence aloud · 2 Meditation · 3 Movement · 4 Medicine · 5 Blood pressure tea · 6 Morning coaching (last)");
    expect(GATE_DEFAULTS.night.some((i) => /tea/i.test(i.label))).toBe(false);
  });

  it("coaching stays last when she moves it or adds her own steps", () => {
    const moved = cleanGateItems("morning", [{ key: "coach" }, { key: "gratitude" }, { key: "custom:abcd1234", label: "Light the candle" }]);
    expect(Array.isArray(moved) && moved.map((i) => i.key)).toEqual(["gratitude", "custom:abcd1234", "agree", "coach"]);
    const saved = normaliseGate("morning", [GATE_DEFAULTS.morning[6]!, ...GATE_DEFAULTS.morning.slice(0, 6)], Date.now());
    expect(saved[saved.length - 1]!.key).toBe("coach");
  });

  it("the tea is never in the Night gate, joins a Morning gate saved before it moved, and a removal after sticks", () => {
    const night = normaliseGate("night", [...GATE_DEFAULTS.night, custom("Blood pressure tea"), { ...custom("BP tea before bed"), key: "custom:efgh5678" }]);
    expect(night.some((i) => /tea/i.test(i.label))).toBe(false);
    const oldSaved = normaliseGate("morning", GATE_DEFAULTS.morning.filter((i) => i.key !== "bp_tea"), BP_TEA_MORNING_SINCE - 86_400_000);
    expect(oldSaved.map((i) => i.key)).toEqual(["gratitude", "practice", "move", "water", "bp_tea", "agree", "coach"]);
    const removedSince = normaliseGate("morning", GATE_DEFAULTS.morning.filter((i) => i.key !== "bp_tea"), BP_TEA_MORNING_SINCE + 1);
    expect(removedSince.some((i) => i.key === "bp_tea")).toBe(false);
    // Her own tea line becomes the morning's own item, once.
    const own = normaliseGate("morning", [...GATE_DEFAULTS.morning.filter((i) => i.key !== "bp_tea"), custom("blood pressure tea")], BP_TEA_MORNING_SINCE + 1);
    expect(own.filter((i) => /tea/i.test(i.label)).map((i) => i.key)).toEqual(["bp_tea"]);
  });
});

describe("LP and deal-terms drafts: the Claude seat only, failing closed", () => {
  it("the seat ladder keeps only Claude's seat, and 'OpenAI first' cannot reorder it", () => {
    expect(isConfidentialDraft({ draft_kind: "lp_reply" })).toBe(true);
    expect(isConfidentialDraft({ confidential_draft: true })).toBe(true);
    expect(isConfidentialDraft({ draft_kind: "briefing" })).toBe(false);
    expect(confidentialLadder([OPENAI_SEAT, CLAUDE_SEAT])).toEqual([CLAUDE_SEAT]);
    expect(confidentialLadder([OPENAI_SEAT])).toEqual([]);
    expect(orderSeats([CLAUDE_SEAT], true)).toEqual([OPENAI_SEAT, CLAUDE_SEAT]); // the switch, for ordinary work
  });

  it("the Worker's router refuses one outright, before any model is considered", async () => {
    await expect(routeCompletion(env as any, {
      routeId: "rt_ops_default", lane: "ops", confidentialDraft: true, freeOnly: true,
      messages: [{ role: "user", content: "Draft a reply to an LP" }],
    })).rejects.toThrow(/Claude seat only/);
  });
});
