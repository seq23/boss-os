/**
 * Simone's morning email, the owner's review of 18 Nov 2026 (~/simone-email-review-2026-11-18.md).
 * One behaviour per fix, each where the behaviour lives. Every name here is invented.
 */
import { describe, expect, it } from "vitest";
import { buildDay, calendarItems, cardButtons, onePerPerson, stillPreview, prospectSection, publicFromBriefing, neverMissTwice, gateLine, gratitudeLine, spiritSection } from "../scripts/ops/your-day.mjs";
import { realMatch } from "../scripts/ops/interest-grid.mjs";
import { isPublicCompany, publicList, publicFromHeadline, publicFromReply } from "../src/shared/boss/deals/publicCompanies.mjs";
import { morningCommands, dropTargets, coachPressure, gratitudeFromBrain, brainLine } from "../src/shared/boss/mail/morningReply.mjs";
import { layoutEmail } from "../src/shared/boss/mail/plain.mjs";
import { pruneDropped } from "../src/worker/boss/routes/morning";
import { lpDecideItems, closesThread } from "../src/shared/boss/lp/plan.mjs";

describe("a thanks closes the thread; an auto-reply is never a new message (item 14)", () => {
  const row = (said: string) => ({ id: "lpr_t1", address: "dana@lp.example", name: "Dana Field", status: "replied_again", thread_id: "t1", sent_at: NOW - 9 * 86_400_000, last_reply_at: NOW - 86_400_000, said });
  it("nothing is owed after a pure thanks or approval, or after an auto-reply", () => {
    expect(lpDecideItems([row("Yesssssssss much better!!!\n\nDana Field\n+1 555 0100")], NOW)).toEqual([]);
    expect(lpDecideItems([row("Thank you for contacting us. I am out of the office until Monday.")], NOW)).toEqual([]);
  });
  it("a thanks that asks for something is still hers to answer", () => {
    expect(lpDecideItems([row("Thanks, let's talk next week?")], NOW)).toHaveLength(1);
    expect(closesThread("Thanks, send the deck")).toBe(false);
  });
});

const NOW = Date.parse("2026-11-18T12:00:00Z");
const TODAY = "2026-11-18";
const ME = "me@example.com";
const at = (h: number) => Date.parse(`2026-11-18T${String(h).padStart(2, "0")}:00:00Z`);

describe("the calendar line (items 1-4)", () => {
  const ev = (title: string, h: number, me: string, guests: string[]) => ({
    title, scheduled_at: at(h), calendar_uid: `${title}-${h}`,
    attendees: [{ email: ME, self: true, response: me }, ...guests.map((g) => ({ email: g, name: g.split("@")[0], response: "accepted" }))],
  });
  it("lists every meeting she is attending, in time order, with who, and never one she answered maybe or no", () => {
    const items = calendarItems({
      events: [ev("Partner review", 16, "accepted", ["pat@example.org", "lee@example.org"]), ev("Weekly sync", 14, "declined", ["sam@example.org"]), ev("Project talk", 15, "tentative", ["jo@example.org"]), ev("Intro call", 13, "accepted", ["kim@example.net"])],
      diary: [], today: TODAY, her: [ME], tz: "America/Chicago",
    });
    const text = items.map((i: any) => i.text);
    expect(text).toHaveLength(2);
    expect(text[0]).toMatch(/Intro call with kim/);
    expect(text[1]).toMatch(/Partner review with pat, lee/);
    expect(text.join(" ")).not.toMatch(/Weekly sync|Project talk/);
  });
});

describe("Decide links (item 8)", () => {
  it("a held reply is Send as is + Change it, nothing else", () => {
    const b = cardButtons([{ label: "Send as is", url: "https://x.example/s" }, { label: "Open their email", url: "https://x.example/o" }, { label: "See everything", url: "https://x.example/e" }], "https://x.example/screen");
    expect(b.map((x: any) => x.label)).toEqual(["Send as is", "Change it"]);
    expect(b[1]?.url).toBe("https://x.example/screen");
  });
});

describe("Still yours to answer (items 12-16)", () => {
  it("never the same person twice; the true turn wins", () => {
    const rows = [
      { id: "a", key: "lp-again:p1", title: "Answer Dana Field: they wrote back" },
      { id: "b", key: "lpnudge:p1", title: "No answer in 7 days: nudge Dana Field?" },
      { id: "c", key: "lp-again:p2", title: "Answer Rory Vale" },
    ];
    expect(onePerPerson(rows).map((r: any) => r.id)).toEqual(["a", "c"]);
  });
  it("each row is a preview whose day count says which way the wait runs", () => {
    const mine = stillPreview({ title: "Answer Dana Field", thin: "Still yours to answer: Answer Dana Field · waiting 3 days", key: "lp-again:p1", details: ["What they wrote: “Happy to talk next week.”"] });
    expect(mine).toMatch(/Last said: “Happy to talk next week\.”/);
    expect(mine).toMatch(/Yours to answer: they've waited 3 days/);
    const theirs = stillPreview({ title: "Nudge Rory Vale", thin: "waiting 5 days", key: "lpnudge:p2" });
    expect(theirs).toMatch(/Waiting on them: you've waited 5 days/);
  });
});

describe("a public company is not a live deal (item 22)", () => {
  it("the seed holds Anthropic and SpaceX; her reply and a priced IPO add to it; plans never do", () => {
    expect(isPublicCompany("⭐ Anthropic (+3 more)", publicList(null))).toBe(true);
    expect(isPublicCompany("Space Exploration Technologies (SpaceX)", publicList(null))).toBe(true);
    expect(isPublicCompany("Example Robotics", publicList(null))).toBe(false);
    expect(publicFromReply("Example Robotics is public")).toBe("Example Robotics");
    expect(publicFromReply("it is public")).toBeNull();
    expect(publicFromHeadline("Example Robotics prices $400 million IPO on Nasdaq")).toBe("Example Robotics");
    expect(publicFromHeadline("Example Robotics files for IPO")).toBeNull();
    expect(publicFromBriefing({ sections: [{ items: ["Example Robotics began trading on the NYSE today."] }]}).map((r: any) => r.company)).toEqual(["Example Robotics"]);
  });
  it("rejects generic briefing subjects and preserves names the owner entered", () => {
    expect(publicFromHeadline("The stock began trading November 19 on Nasdaq.")).toBeNull();
    expect(publicFromHeadline("The AI company began trading on Nasdaq.")).toBeNull();
    expect(publicFromHeadline("Example Robotics began trading on the NYSE today.")).toBe("Example Robotics");
    const rows = [
      { company: "The stock", via: "briefing" },
      { company: "The AI company", via: "briefing" },
      { company: "Example Robotics", via: "briefing" },
      { company: "The stock", via: "owner" },
      { company: "The firm", via: "reply" },
    ];
    expect(publicList(rows).filter((row) => rows.some(({ company }) => row.company === company))
      .map(({ company, via }) => ({ company, via }))).toEqual(rows.slice(2));
  });
  it("only a named buyer and seller with fitting size and close price is a match for her email", () => {
    const m = { seller: { who: "Alder Partners" }, buyer: { who: "Birch Capital" }, fit: { size: "good", price: "good" } };
    expect(realMatch(m)).toBe(true);
    expect(realMatch({ ...m, buyer: { who: "Unnamed" } })).toBe(false);
    expect(realMatch({ ...m, fit: { size: "good", price: "far" } })).toBe(false);
  });
});

describe("prospects (item 25)", () => {
  it("opens with the totals and gives each replier firm, what they said and the next step", () => {
    const s = prospectSection({ sent: [{}, {}, {}], replies: [
      { status: "replied", name: "Ana Wren", firm: "Wren Family Office", email: "ana@wren.example", reply_note: "Interested, send the deck.\n\nAna Wren\n+1 555 0100\nwren.example", has_draft: true },
      { status: "bounced", email: "x@gone.example" },
      { status: "opted_out", name: "Bo Lark", email: "bo@lark.example" },
    ] }, NOW, [{ email: "ana@wren.example", name: "Ana Wren", kind: "family_office" }, { email: "cy@wren.example", name: "Cy Wren" }]);
    const texts = s!.items.map((i: any) => (typeof i === "string" ? i : i.runs.map((r: any) => r.text).join("")));
    expect(texts[0]).toBe("Yesterday: 3 sent · 1 reply · 1 bounce · 1 opt-out.");
    const ana = texts.find((t: string) => t.startsWith("Ana Wren"))!;
    expect(ana).toMatch(/Interested, send the deck/);
    expect(ana).not.toMatch(/555 0100/);
    expect(ana).toMatch(/Next: your reply is ready in Decide/);
    expect(ana).toMatch(/Cy Wren \(LinkedIn search\)/);
  });
});

describe("never miss twice and the gate (items 26-30)", () => {
  it("one missed day is a firm line; two is a call-out at the top naming the goal, the cost and one action with a deadline", () => {
    expect(neverMissTwice(0)).toEqual({ line: null, banner: null });
    const one = neverMissTwice(1, { action: "answer decision 1" });
    expect(one.banner).toBeNull();
    expect(one.line).toMatch(/Never miss twice/);
    const two = neverMissTwice(2, { waiting: 4, oldestWait: 6, action: "answer decision 1" });
    expect(two.banner!.tone).toBe("coach");
    const words = [two.banner!.title, ...two.banner!.lines].join(" ");
    expect(words).toMatch(/billionaire/);
    expect(words).toMatch(/4 decisions are waiting.*6 days/);
    expect(words).toMatch(/Non-negotiable, by 9 am/);
    expect(neverMissTwice(1, { pressure: "harder" }).banner).not.toBeNull();
  });
  it("the call-out is above Decide in the email", () => {
    const card = { key: "lp-again:x9", title: "Answer Dana Field", body: "They asked for a call.", buttons: [] };
    const mail = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], feed: { items: [] }, morning: { lp: { section: "lp", at: new Date(NOW).toISOString(), decide: [card] } }, missedDays: 3 }, NOW);
    const top = mail.text.toLowerCase().indexOf("3 days without a gate");
    const decide = mail.text.indexOf("They asked for a call.");
    expect(top).toBeGreaterThan(-1);
    expect(decide).toBeGreaterThan(-1);
    expect(top).toBeLessThan(decide);
    expect(mail.html.indexOf("3 days without a gate")).toBeLessThan(mail.html.indexOf("They asked for a call."));
  });
  it("the gate is 1-3 in-bed steps and a reply; gone once done", () => {
    const g = gateLine({ gratitude: "Grateful for my brother.", action: "answer decision 1" })!;
    expect(g).toMatch(/1\. .*2\. .*3\. /);
    expect(g).toMatch(/reply "gate done"/);
    expect(gateLine({ done: true })).toBeNull();
  });
  it("gratitude is a real win or her own words, never an invented detail, no repeat within the window", () => {
    const wins = [{ sentence: "Grateful Ana Wren wrote back to me.", theme: "win:reply" }];
    expect(gratitudeLine({ wins, herList: [], today: TODAY })!.sentence).toBe("Grateful Ana Wren wrote back to me.");
    const history = [{ day: "2026-11-17", sentence: "Grateful Ana Wren wrote back to me.", theme: "win:reply" }];
    expect(gratitudeLine({ wins, herList: ["my brother"], history, today: TODAY })!.sentence).toBe("Grateful for my brother.");
    expect(gratitudeLine({ wins: [], herList: [], fallback: "Grateful for the first coffee in my kitchen.", today: TODAY })).toBeNull();
  });
  it("Spirit is at most five lines and the ancestors hour shows only in the month's last two weeks", () => {
    const day = { sky: { active: [] }, contribution: { count: 2 }, ancestors: { minutes: 0 }, ancestral_hour: { days_left: 20 } };
    const s = spiritSection(day, null, NOW, null, { coach: "You missed yesterday's gate.", action: "answer decision 1" })!;
    expect(s.items.length).toBeLessThanOrEqual(5);
    const words = s.items.map((i: any) => i.runs[0].text).join(" | ");
    expect(words).toMatch(/^You missed yesterday's gate/);
    expect(words).toMatch(/Giving: 2 this month ✓/);
    expect(words).not.toMatch(/Ancestors/);
    expect(spiritSection({ ...day, ancestral_hour: { days_left: 9 } }, null, NOW)!.items.map((i: any) => i.runs[0].text).join(" ")).toMatch(/Ancestors hour/);
  });
});

describe("her replies in plain words (drop, gate, grateful, public, rules)", () => {
  it("reads exact whole lines only, and nothing in a reply can send or approve", () => {
    const { commands, rest } = morningCommands("drop 2\nDrop Dana Field\ngate done\ngrateful for my brother\nExample Robotics is public\ndon't prep maybes\ndrop it\nsend it\napprove 3");
    expect(commands.map((c: any) => c.kind)).toEqual(["drop", "drop", "gate", "grateful", "public", "rule"]);
    expect(rest).toMatch(/drop it/);
    expect(rest).toMatch(/send it/);
    expect(rest).toMatch(/approve 3/);
  });
  it("a drop by number or name reaches only that morning's items", () => {
    const digest = { decide: [{ id: "decide-aaaaaaaa", title: "Answer Dana Field" }, { id: "decide-bbbbbbbb", title: "Approve the plan" }], still_yours: [{ id: "decide-cccccccc", title: "Answer Dana Field again" }], done: [] };
    expect(dropTargets(digest, { kind: "drop", number: 2 }).map((x: any) => x.id)).toEqual(["decide-bbbbbbbb"]);
    expect(dropTargets(digest, { kind: "drop", name: "dana field" }).map((x: any) => x.id)).toEqual(["decide-aaaaaaaa", "decide-cccccccc"]);
    expect(dropTargets(digest, { kind: "drop", number: 9 })).toEqual([]);
  });
  it("her gratitude list and the coaching pressure come back out of the brain lines she added", () => {
    const md = ["## Settled decisions", brainLine.grateful("2026-11-18", "my brother"), brainLine.coach("2026-11-18", "harder", "be harder on me")].join("\n");
    expect(gratitudeFromBrain(md)).toEqual(["my brother"]);
    expect(coachPressure(md)).toBe("harder");
    expect(coachPressure("")).toBe("softer");
  });
});

describe("drop for good (every block)", () => {
  it("a dropped item leaves the email and the kept morning; it comes back only when they write again", () => {
    const data: any = { diary: [], tasks: [], approvals: [], repoChanges: [], feed: { items: [] }, morning: { lp: { section: "lp", at: new Date(NOW).toISOString(), decide: [{ key: "lp-again:x1", title: "Answer Dana Field", body: "b", buttons: [] }] } }, mintToken: () => `drop_${"a".repeat(24)}` };
    const first = buildDay(data, NOW);
    const card = first.digest.decide[0];
    expect(first.text).toMatch(/Drop for good/);
    expect(first.digest.drops.some((d: any) => d.item_id === card.id)).toBe(true);
    const gone = buildDay({ ...data, dropped: [{ item_id: card.id, dropped_at: NOW - 1000 }] }, NOW);
    expect(gone.digest.decide.map((d: any) => d.id)).not.toContain(card.id);
    expect(pruneDropped({ decide: [card, { id: "decide-keepme01" }] }, new Set([card.id]))).toEqual({ decide: [{ id: "decide-keepme01" }] });
  });
});

describe("the banner (top of the email)", () => {
  it("is the first thing after line 1, in text and in HTML", () => {
    const e = layoutEmail({ who: "Simone", subject: "S", happened: "Line one.", sections: [{ title: "Decide", items: [{ text: "One." }] }], banners: [{ tone: "red", title: "STOPPED: a job", lines: ["Why."] }] } as any);
    expect(e.text.indexOf("STOPPED: a job")).toBeLessThan(e.text.indexOf("Decide"));
    expect(e.html.indexOf("STOPPED: a job")).toBeLessThan(e.html.indexOf("Decide"));
  });
});
