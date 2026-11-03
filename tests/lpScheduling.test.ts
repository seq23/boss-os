/**
 * LP SCHEDULING, ONE TAP (owner, 31 Oct 2026) — THE PURE HALF AND THE HARD RULES.
 *
 * An LP who writes back warmly about meeting gets a reply held in their thread offering 2–3 open times
 * from BOTH her calendars, in the zone she is in that day, inside her working hours; a pick of one of
 * those times becomes a confirmation whose tap also sends the invite. Nothing sends here; no model
 * writes it. Invented names at example.com only: the repo is public.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mergeBusy, openSlots, pickedSlot, wantsToMeet, zoneResolver, inWorkingHours, wall, slotText, lpTimesBody, lpConfirmBody,
  WORK_DAY, MIN_SLOTS, MAX_SLOTS, instantIn, proposedTimes, proposedFit,
} from "../src/shared/boss/lp/schedule.mjs";
import { againReply, keepHeldDraft } from "../scripts/ops/lp-followups.mjs";
import { lpDecideItems } from "../src/shared/boss/lp/plan.mjs";

const NOW = Date.parse("2026-10-31T11:15:00Z"); // Saturday morning
const WHERE = { awayCity: "New York, NY", awayUntil: "2026-11-04", homeZone: "America/Chicago" };
const zoneOn = zoneResolver(WHERE);
const src = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const mins = (h: number, m: number) => h * 60 + m;

describe("the times offered: both calendars, her zone that day, her working hours", () => {
  it("a meeting on both calendars is one busy block, never two", () => {
    const a: [number, number][] = [[100, 200], [500, 600]];
    const b: [number, number][] = [[100, 200], [150, 300], [700, 800]];
    expect(mergeBusy([a, b])).toEqual([[100, 300], [500, 600], [700, 800]]);
  });

  it("offers 2–3 open times, one a day, none clashing with either calendar, each inside her working hours in her zone that day", () => {
    const tueNY = instantIn("America/New_York", "2026-11-03", 10, 0)!;
    const westpeek: [number, number][] = [[tueNY, tueNY + 3600_000]];             // Tue 10:00–11:00 Eastern
    const spry: [number, number][] = [[tueNY + 90 * 60_000, tueNY + 150 * 60_000]]; // Tue 11:30–12:30 Eastern
    const busy = mergeBusy([westpeek, spry]);
    const slots = openSlots(busy, { now: NOW, zoneOn });
    expect(slots.length).toBeGreaterThanOrEqual(MIN_SLOTS);
    expect(slots.length).toBeLessThanOrEqual(MAX_SLOTS);
    expect(new Set(slots.map((s) => wall(s.start, s.zone).ymd)).size).toBe(slots.length);
    for (const s of slots) {
      for (const [bs, be] of busy) expect(s.start + 30 * 60_000 <= bs || s.start >= be).toBe(true);
      expect(inWorkingHours(s.start, s.zone)).toBe(true);
      const w = wall(s.start, s.zone);
      expect(mins(w.hour, w.minute)).toBeGreaterThanOrEqual(mins(...WORK_DAY.start));
      expect(mins(w.hour, w.minute) + 30).toBeLessThanOrEqual(mins(...WORK_DAY.end));
      expect(["Sat", "Sun"]).not.toContain(w.weekday);
      // New York through Wed 4 Nov (the "where I am until" setting), Central after: never one zone hard-coded.
      expect(s.zone).toBe(w.ymd <= "2026-11-04" ? "America/New_York" : "America/Chicago");
    }
    // Tuesday's 10:00 and 11:30 are taken on one calendar or the other; 14:00 Eastern is offered.
    expect(slotText(slots[0]!)).toBe("Tuesday, November 3 at 2:00 PM Eastern");
    expect(slots.some((s) => /Central$/.test(slotText(s)))).toBe(true);
  });

  it("an away city whose zone is unknown offers no time on those days, and no calendar zone offers none at all (fail closed)", () => {
    const unknown = zoneResolver({ awayCity: "Atlantis", awayUntil: "2026-11-30", homeZone: "America/Chicago" });
    expect(openSlots([], { now: NOW, zoneOn: unknown })).toEqual([]);
    expect(openSlots([], { now: NOW, zoneOn: zoneResolver({}) })).toEqual([]);
    // A calendar too full for two open days offers none: the reply asks for their times instead.
    const allBusy: [number, number][] = [[NOW, NOW + 30 * 86_400_000]];
    expect(openSlots(allBusy, { now: NOW, zoneOn })).toEqual([]);
  });
});

describe("what they wrote", () => {
  it("knows a warm 'let's meet' from anything else", () => {
    for (const yes of ["Happy to chat, when works?", "Let's find a time next week.", "Sure — send me some times.", "What times work for you?", "Would love to connect. Your availability?"]) expect(wantsToMeet(yes)).toBe(true);
    for (const no of ["Not interested, thanks.", "Thanks, we'll pass on this.", "Got it.", "", "Please remove me. Happy to chat another year."]) expect(wantsToMeet(no)).toBe(false);
  });

  it("finds the ONE offered time they picked, and nothing when unsure", () => {
    const slots = openSlots([], { now: NOW, zoneOn });
    const [a, b] = slots;
    const day = (s: typeof a) => new Date(s!.start).toLocaleDateString("en-US", { timeZone: s!.zone, weekday: "long" });
    expect(pickedSlot(`${day(a)} works great for me.`, slots)).toEqual(a);
    expect(pickedSlot(`Let's do ${day(b)} at ${new Date(b!.start).toLocaleTimeString("en-US", { timeZone: b!.zone, hour: "numeric", minute: "2-digit" })}.`, slots)).toEqual(b);
    expect(pickedSlot(`${day(a)} or ${day(b)} both work`, slots)).toBeNull();         // two days: hers to choose
    expect(pickedSlot(`${day(a)} doesn't work, sorry`, slots)).toBeNull();             // a refusal is never a pick
    expect(pickedSlot(`${day(a)} at 4:45pm?`, slots)).toBeNull();                      // a different time is a counter
    expect(pickedSlot("Sounds good", slots)).toBeNull();
  });
});

describe("times THEY proposed (the shape of a live reply, 31 Oct 2026)", () => {
  const THEIRS = "Hello Sequoia, Here is Robin's earliest availability (PT): * 11/3 – 10 am * 11/17 – 8 am, 9 am, 11 am * 12/1 –11 am";

  it("reads each date's times on their stated clock, and nothing without a stated zone (fail closed)", () => {
    const got = proposedTimes(THEIRS, NOW).map((x) => slotText(x));
    expect(got).toEqual([
      "Tuesday, November 3 at 10:00 AM Pacific", "Tuesday, November 17 at 8:00 AM Pacific", "Tuesday, November 17 at 9:00 AM Pacific",
      "Tuesday, November 17 at 11:00 AM Pacific", "Tuesday, December 1 at 11:00 AM Pacific",
    ]);
    expect(proposedTimes("11/3 at 10 am works for me", NOW)).toEqual([]);
    expect(proposedTimes("11/3 at 10 am PT doesn't work", NOW)).toEqual([]);
  });

  it("confirms the earliest that is free on her calendars and inside her working hours where she is that day, said on their clock", () => {
    const fit = proposedFit(THEIRS, { busy: [], zoneOn, now: NOW })!;
    expect(slotText(fit)).toBe("Tuesday, November 3 at 1:00 PM Eastern"); // her card: New York that day
    const r = againReply({ name: "Robin Example", said: THEIRS, slots: [], busy: [], now: NOW, zoneOn });
    expect(r.kind).toBe("confirm");
    expect(r.body).toContain("Tuesday, November 3 at 10:00 AM Pacific (12:00 PM Central) is perfect");
    expect(r.picked).toEqual({ start: fit.start, zone: "America/New_York" });
    // 11/3 taken → the next one that fits; 8 am PT on 11/17 is 10 am Central (inside her day).
    const taken: [number, number][] = [[fit.start - 60_000, fit.start + 3600_000]];
    expect(slotText(proposedFit(THEIRS, { busy: taken, zoneOn, now: NOW })!)).toBe("Tuesday, November 17 at 10:00 AM Central");
    // A time outside her working day is never confirmed: 7 am PT is 9 am Central.
    expect(proposedFit("Could do 11/17 at 7 am PT", { busy: [], zoneOn, now: NOW })).toBeNull();
    // Calendars unreadable: no confirmation.
    expect(proposedFit(THEIRS, { busy: null, zoneOn, now: NOW })).toBeNull();
  });

  it("'November may work' is warm about meeting, so it gets her times", () => {
    expect(wantsToMeet("Hi Sequoia, November may work. I'm very tied up in October.")).toBe(true);
    expect(wantsToMeet("Would Tuesday work?")).toBe(true);
  });
});

describe("the reply held for someone who wrote back: a fixed template, never a model", () => {
  const slots = openSlots([], { now: NOW, zoneOn });

  it("a warm 'when works?' gets 2–3 times, first name only", () => {
    const r = againReply({ name: "Avery Q. Example", said: "Happy to chat, when works?", slots, busy: [], now: NOW });
    expect(r.kind).toBe("times");
    expect(r.body.startsWith("Hi Avery,")).toBe(true);
    expect(r.body).not.toContain("Example");
    expect(r.body.match(/^- /gm)?.length).toBe(slots.length);
    for (const s of slots) expect(r.body).toContain(slotText(s));
    expect(r.body.endsWith("Sequoia")).toBe(true);
  });

  it("a reply naming a day and time she offered (her offer quoted under it, no zone in their words) is a confirmation of that time (2 Nov 2026)", () => {
    const quoted = "No problem.  Nov 5 at 11am can work.\n\nOn Sun, Nov 1, 2026 at 10:09 AM Her <her@example.com> wrote:\n\n> Would any of these work?\n>\n> - Tuesday, November 3 at 10:00 AM Central\n> - Thursday, November 5 at 11:00 AM Central\n>\n> Best";
    const r = againReply({ name: "Avery Example", said: "No problem.  Nov 5 at 11am can work. On Sun, Nov 1, 2026 at 10:09 AM Her <her@example.com> wrote:", quoted, offered: [], slots: [], busy: [], now: NOW, zoneOn });
    expect(r.kind).toBe("confirm");
    expect(r.picked!.start).toBe(instantIn("America/Chicago", "2026-11-05", 11, 0));
    expect(r.body).toContain("Thursday, November 5 at 11:00 AM Central is perfect.");
    expect(r.body).not.toMatch(/most useful/);
    // Her offer in another zone: said on that clock, with Central in brackets.
    const east = againReply({ name: "A", said: "Nov 4 at 10am works", quoted: "> - Wednesday, November 4 at 10:00 AM Eastern", offered: [], slots: [], busy: [], now: NOW, zoneOn });
    expect(east.body).toContain("Wednesday, November 4 at 10:00 AM Eastern (9:00 AM Central) is perfect.");
    // No zone anywhere: yes to the time, and which zone? No invite rides on it.
    const ask = againReply({ name: "A", said: "Nov 5 at 11am can work", quoted: null, offered: [], slots: [], busy: [], now: NOW, zoneOn });
    expect(ask.kind).toBe("ask_zone");
    expect(ask.picked).toBeNull();
    expect(ask.body).toContain("Thursday, November 5 at 11:00 AM works on my side. Which time zone is that in?");
  });

  it("a pick of an offered time that is still free is a confirmation; a pick now busy is not", () => {
    const said = `${new Date(slots[1]!.start).toLocaleDateString("en-US", { timeZone: slots[1]!.zone, weekday: "long" })} is perfect`;
    const r = againReply({ name: "Avery Example", said, offered: slots, slots, busy: [], now: NOW });
    expect(r.kind).toBe("confirm");
    expect(r.picked).toEqual(slots[1]);
    expect(r.body).toBe(lpConfirmBody({ name: "Avery Example", slot: slots[1]! }));
    expect(r.body).toMatch(/calendar invite/);
    const taken = againReply({ name: "Avery Example", said, offered: slots, slots, busy: [[slots[1]!.start, slots[1]!.start + 3600_000]], now: NOW });
    expect(taken.kind).not.toBe("confirm");
    // Calendars unreadable (busy null): never a confirmation, never times.
    expect(againReply({ name: "A", said, offered: slots, slots: [], busy: null, now: NOW }).kind).toBe("plain");
  });

  it("anything else keeps the plain reply", () => {
    expect(againReply({ name: "A", said: "Thanks for the note.", slots, busy: [], now: NOW }).kind).toBe("plain");
  });

  it("the morning card says what Send as is sends, invite included", () => {
    const pick = slots[0]!;
    const base = { id: "lpr_x", address: "avery@example.com", name: "Avery Example", status: "replied_again", tap_token: "t".repeat(24),
      thread_id: "thr_x", draft_message_id: "m1", first_seen: "2026-10-01", reply_from: "sequoia@westpeek.ventures", last_reply_at: NOW };
    const [confirm] = lpDecideItems([{ ...base, draft_body: lpConfirmBody({ name: "Avery", slot: pick }), picked_start: pick.start, picked_zone: pick.zone, last_reply_text: "Tuesday works" }], NOW);
    expect(confirm!.title).toContain(`picked ${slotText(pick)}`);
    expect(confirm!.details.join("\n")).toMatch(/Send as is also sends the calendar invite/);
    expect(confirm!.buttons.map((b) => b.label)).toEqual(["Send as is", "Change it", "Open their email"]);
    const [times] = lpDecideItems([{ ...base, draft_body: lpTimesBody({ name: "Avery", slots }), offered_slots: JSON.stringify(slots), last_reply_text: "When works?" }], NOW);
    expect(times!.title).toContain(`your reply offers ${slots.length} times`);
    expect(times!.draft?.text).toContain(slotText(slots[0]!));
  });
});

describe("hard rules: nothing sends from the run, no model sees a name", () => {
  for (const f of [["src", "shared", "boss", "lp", "schedule.mjs"], ["scripts", "ops", "lp-calendar.mjs"], ["scripts", "ops", "lp-followups.mjs"], ["src", "worker", "boss", "lp", "schedule.ts"]]) {
    it(`${f.at(-1)} reaches no model host, router or CLI`, () => {
      const s = src(...f);
      expect(s).not.toMatch(/api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|openrouter\.ai|routeCompletion|\/router\//i);
      expect(s).not.toMatch(/spawn(Sync)?\(|child_process|codex/i);
    });
  }
  it("the Mac run holds drafts only, and reads free/busy only (never an event's title or guests)", () => {
    expect(src("scripts", "ops", "lp-followups.mjs")).not.toMatch(/drafts\/send|messages\/send|gmail\.send/);
    const cal = src("scripts", "ops", "lp-calendar.mjs");
    expect(cal).toContain("/freeBusy");
    expect(cal).not.toMatch(/\/events|summary|attendees/);
  });
  it("the invite is made only on her tap: the two send paths, after the gate, and nowhere else", () => {
    const callers = ["src/worker/boss/routes/lpTap.ts", "src/worker/boss/lp/heldReply.ts"];
    for (const f of callers) {
      const s = src(f);
      expect(s.indexOf("inviteGate(")).toBeGreaterThan(-1);
      expect(s.indexOf("await inviteGate(")).toBeGreaterThan(-1);
      expect(s.indexOf("await inviteGate(")).toBeLessThan(s.indexOf("await sendDraft("));
      expect(s.lastIndexOf("sendInvite(")).toBeGreaterThan(s.lastIndexOf("action: \"sent\""));
    }
    expect(src("scripts", "ops", "lp-followups.mjs")).not.toMatch(/sendInvite|createInvite|calendar\.events/);
  });
});

describe("a held reply answers their latest message (2 Nov 2026: a time they accepted got a generic draft)", () => {
  it("an untouched generic draft is redrafted when their words now call for a confirmation; an edited one stays hers", () => {
    const had = { id: "d1", message_id: "m1", for_at: 5, kind: "plain" };
    const plan = { kind: "ask_zone" };
    expect(keepHeldDraft({ had, exists: true, unedited: true, forAt: 5, plan })).toBe(false);
    expect(keepHeldDraft({ had: { ...had, kind: undefined }, exists: true, unedited: true, forAt: 5, plan })).toBe(false);
    expect(keepHeldDraft({ had, exists: true, unedited: false, forAt: 5, plan })).toBe(true);
    expect(keepHeldDraft({ had, exists: true, unedited: true, forAt: 5, plan: { kind: "plain" } })).toBe(true);
    expect(keepHeldDraft({ had, exists: true, unedited: true, forAt: 6, plan: { kind: "plain" } })).toBe(false);
  });
  it("a weekday and a time they accept is said back, never the generic line", () => {
    const now = Date.parse("2026-11-02T14:00:00Z"); // Monday
    const r = againReply({ name: "Jo Example", said: "No problem. Thursday at 11am can work.", busy: null, now });
    expect(r.kind).toBe("ask_zone");
    expect(r.body).toContain("Thursday, November 5 at 11:00 AM works on my side");
    expect(r.body).not.toContain("what would be most useful");
  });
});
