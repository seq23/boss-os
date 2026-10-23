/**
 * BOSS FIX L — LP replies, prospects, the 8Raise budget, catch-ups (owner, 23 Oct 2026, rulings
 * 10, 11, 12, 14). Synthetic data only: invented people at example.com. The repo is public.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson } from "./helpers";
import {
  DEFAULT_PROSPECT_TEMPLATE, PROSPECT_BANNED, canSpend, dueTouch, eightRaiseFooter, excluded, lpDecideItems,
  lpReplyBody, lpStatusFrom, namesLine, nameRulesIn, pickCatchups, proposeFeatured, prospectProblems,
  renderProspect, sideFromReply, staleFeatured, templateHash, wordCount, INBOX_LOOKBACK_DAYS,
} from "../../src/shared/boss/lp/plan.mjs";
import { prospectPlan, proposeTemplate, approveTemplate, importProspects, recordProspectEvents } from "../../src/worker/boss/lp/desk";
import TAP_SOURCE from "../../src/worker/boss/routes/lpTap.ts?raw";

const DAY = 86_400_000;
const NAMES = [{ name: "Alpha", why: "2 buyer asks" }, { name: "Beta", why: "fresh" }, { name: "Gamma", why: "size" }];
// Wednesday 21 Oct 2026, 10:00 Central — inside the sending window.
const WED_10AM = Date.parse("2026-10-21T15:00:00Z");

async function tap(path: string, method = "GET") {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://boss.test${path}`, { method }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, text: await res.text(), location: res.headers.get("location") };
}

describe("the prospect email (her tone rules, 23 Oct 2026)", () => {
  it("is soft, side-neutral, short, a chat ask, with her names line and the opt-out", () => {
    for (const touch of [1, 2]) {
      const r = renderProspect(DEFAULT_PROSPECT_TEMPLATE, { first: "Alex Example", names: NAMES, touch });
      expect(prospectProblems(r)).toEqual([]);
      expect(r.body).toContain("Names coming across my desk at the moment are: Alpha, Beta, Gamma.");
      expect(r.body).toMatch(/15 minutes to compare notes/);
      expect(r.body).toMatch(/add or trim/);
      expect(wordCount(r.body)).toBeLessThanOrEqual(90);
      expect(r.body).toMatch(/more than \$100M in secondary transactions|floating this back up/);
    }
    expect(renderProspect(DEFAULT_PROSPECT_TEMPLATE, { first: "Alex", names: NAMES, touch: 2 }).body).toMatch(/^Hi Alex,\n\nJust floating this back up\./);
    expect(renderProspect(DEFAULT_PROSPECT_TEMPLATE, { first: "Alex", names: NAMES }).subject).toBe("Re: Up to $1B secondary inquiry: Alpha, Beta, Gamma");
  });

  it("refuses every banned sales phrase and any buyer-only wording", () => {
    for (const phrase of ["Do you want to buy Alpha?", "Are you a buyer of Alpha?", "Interested in buying Alpha?", "We think you are a buyer here.", "Our buy-side clients like Alpha.", "We have blocks on offer."]) {
      const body = DEFAULT_PROSPECT_TEMPLATE.body.replace("I hope you don't mind the direct note.", phrase);
      const r = renderProspect({ ...DEFAULT_PROSPECT_TEMPLATE, body }, { first: "Alex", names: NAMES });
      expect(prospectProblems(r).join(" "), phrase).toMatch(/sales phrase/);
    }
    expect(PROSPECT_BANNED.length).toBeGreaterThanOrEqual(10);
    const noAsk = renderProspect({ ...DEFAULT_PROSPECT_TEMPLATE, body: "Hi {first},\n\nWe've done more than $100M in secondary transactions. {names_line}\n\nSequoia Taylor\nWest Peek Ventures\n\n" + "If this isn't relevant, just reply \"no thanks\" and I won't write again." }, { first: "Alex", names: NAMES });
    expect(prospectProblems(noAsk).join(" ")).toMatch(/chat ask/);
    expect(prospectProblems(noAsk).join(" ")).toMatch(/either side/);
  });

  it("rotates lightly to the second phrasing, and a changed name list is a new template", () => {
    expect(namesLine(NAMES, 2)).toBe("We've been working on a few names, including Alpha and Beta.");
    expect(namesLine(NAMES, 0)).toMatch(/^Names coming across my desk/);
    expect(templateHash(DEFAULT_PROSPECT_TEMPLATE, NAMES)).not.toBe(templateHash(DEFAULT_PROSPECT_TEMPLATE, [...NAMES.slice(0, 2), { name: "Delta" }]));
  });
});

describe("featured names: a select few, never a never-feature, swaps proposed not made", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const supply = [
    { company: "Alpha", seen_at: now - 3 * DAY, demand: 4, size_usd: 50e6 },
    { company: "Beta", seen_at: now - 10 * DAY, demand: 1, size_usd: 200e6 },
    { company: "Gamma", seen_at: now - 20 * DAY, demand: 0, size_usd: 10e6 },
    { company: "Delta", seen_at: now - 5 * DAY, demand: 2, size_usd: 5e6 },
    { company: "Stale", seen_at: now - 60 * DAY, demand: 9, size_usd: 1e9 },
    { company: "Secret", seen_at: now - 1 * DAY, demand: 9, size_usd: 1e9 },
  ];
  it("ranks by demand then freshness, drops stale and never-feature, caps at five, gives a reason", () => {
    const f = proposeFeatured(supply, { never: ["secret"] }, now);
    expect(f.map((x) => x.name)).toEqual(["Alpha", "Delta", "Beta", "Gamma"]);
    expect(f[0]!.why).toMatch(/4 buyer asks in your inbox/);
  });
  it("names a stale featured name for a swap", () => {
    expect(staleFeatured([{ name: "Alpha" }, { name: "Stale" }, { name: "Gone" }], supply, now)).toEqual(["Stale", "Gone"]);
  });
  it("reads her plain-words edits", () => {
    expect(nameRulesIn("add Kappa Labs, drop Beta and never feature Secret please")).toEqual([
      { rule: "add", name: "Kappa Labs" }, { rule: "drop", name: "Beta" }, { rule: "never", name: "Secret" },
    ]);
  });
});

describe("the sequence: three touches, five days apart, replies end it", () => {
  const t0 = Date.parse("2026-10-11T20:00:00Z");
  it("is due on day 5 and day 12, never twice in a row, never a fourth", () => {
    expect(dueTouch({ status: "new", touches: 0 }, t0)).toBe(1);
    expect(dueTouch({ status: "active", touches: 1, first_sent_at: t0, last_touch_at: t0 }, t0 + 4 * DAY)).toBeNull();
    expect(dueTouch({ status: "active", touches: 1, first_sent_at: t0, last_touch_at: t0 }, t0 + 5 * DAY)).toBe(2);
    // Imported late: touch 2 on day 12 — touch 3 waits five more days, not one.
    expect(dueTouch({ status: "active", touches: 2, first_sent_at: t0, last_touch_at: t0 + 12 * DAY }, t0 + 13 * DAY)).toBeNull();
    expect(dueTouch({ status: "active", touches: 2, first_sent_at: t0, last_touch_at: t0 + 12 * DAY }, t0 + 17 * DAY)).toBe(3);
    expect(dueTouch({ status: "active", touches: 3, first_sent_at: t0 }, t0 + 90 * DAY)).toBeNull();
    for (const s of ["replied", "interested", "opted_out", "bounced", "done"]) expect(dueTouch({ status: s, touches: 1, first_sent_at: t0 }, t0 + 30 * DAY)).toBeNull();
  });
  it("reads the side from a reply", () => {
    expect(sideFromReply("We might be selling some of our position")).toBe("seller");
    expect(sideFromReply("Always looking for exposure there")).toBe("buyer");
    expect(sideFromReply("We could add to it, or trim some")).toBe("both");
    expect(sideFromReply("Thanks, let's talk")).toBe("unknown");
  });
});

describe("LP replies: her voice and the Decide item", () => {
  it("speaks as we, says more than $100M in secondary transactions, asks for a short call, no fund size", () => {
    const b = lpReplyBody({ name: "Blake Example", bucket: "call" });
    expect(b.startsWith("Hi Blake,")).toBe(true);
    expect(b).toMatch(/more than \$100M in secondary transactions/);
    expect(b).toMatch(/\bWe've\b/);
    expect(b).toMatch(/short call/);
    expect(b).not.toMatch(/fund size|\$\d+\s?(M|B)\s+fund/i);
    expect(b).not.toContain("Example");
  });
  it("puts Send as is / Edit, then send / Skip on each held reply, the oldest unsent first", () => {
    const now = Date.parse("2026-10-23T11:00:00Z");
    const items = lpDecideItems([
      { status: "drafted", tap_token: "a".repeat(24), name: "New Person", drafted_at: now - 1 * DAY, bucket: "warm", draft_message_id: "m1" },
      { status: "drafted", tap_token: "b".repeat(24), name: "Old Person", drafted_at: now - 3 * DAY, bucket: "call", draft_message_id: "m2" },
      { status: "sent", tap_token: "c".repeat(24), name: "Done Person" },
    ], now);
    expect(items.map((i) => i.title)).toEqual(["Waiting 3 days: Reply to Old Person", "Reply to New Person"]);
    expect(items[0]!.priority).toBeGreaterThanOrEqual(10); // unsent after 2 days → top of Decide
    expect(items[1]!.priority).toBeLessThan(10);
    expect(items[0]!.buttons.map((b) => b.label)).toEqual(["Send as is", "Edit, then send", "Skip"]);
    expect(items[0]!.buttons[0]!.url).toBe(`https://boss.sequoiataylor.com/tap/${"b".repeat(24)}?do=send`);
    expect(items[0]!.buttons[1]!.url).toMatch(/^https:\/\/mail\.google\.com\/mail\/u\/sequoia@westpeek\.ventures\/#drafts\?compose=m2$/);
  });
  it("tracker status: sent, they replied again, skipped, drafted, not answered", () => {
    expect(lpStatusFrom({ sentAfterReply: true, sentAt: 10, theirLatest: 20 })).toBe("replied_again");
    expect(lpStatusFrom({ sentAfterReply: true, sentAt: 20, theirLatest: 10 })).toBe("sent");
    expect(lpStatusFrom({ scheduled: true })).toBe("scheduled");
    expect(lpStatusFrom({ current: "skipped", hasDraft: true })).toBe("skipped");
    expect(lpStatusFrom({ hasDraft: true })).toBe("drafted");
    expect(lpStatusFrom({})).toBe("not_answered");
  });
});

describe("8Raise budget (ruling 12)", () => {
  const L = [{ month: "2026-10", purpose: "prospecting", credits: 55, company: "Acme" }, { month: "2026-10", purpose: "buyers_for_supply", credits: 14 }];
  it("holds every limit and names why", () => {
    expect(canSpend({ purpose: "prospecting", credits: 5, ledger: L, balance: 100, month: "2026-10" }).ok).toBe(true);
    expect(canSpend({ purpose: "prospecting", credits: 6, ledger: L, balance: 100, month: "2026-10" }).why).toMatch(/5 of 60 left/);
    expect(canSpend({ purpose: "buyers_for_supply", credits: 2, ledger: L, balance: 100, month: "2026-10" }).ok).toBe(false);
    expect(canSpend({ purpose: "prospecting", credits: 1, ledger: L, balance: 30.5, month: "2026-10" }).why).toMatch(/below 30/);
    expect(canSpend({ purpose: "prospecting", credits: 1, contacts: 6, ledger: [], balance: 100, month: "2026-10" }).why).toMatch(/cap is 5/);
    expect(canSpend({ purpose: "prospecting", credits: 1, company: "ACME", ledger: L, balance: 100, month: "2026-10" }).why).toMatch(/already searched/);
    expect(canSpend({ purpose: "prospecting", credits: 1, ledger: [], balance: null, month: "2026-10" }).ok).toBe(false);
    expect(canSpend({ purpose: "purchase", credits: 1, ledger: [], balance: 100 }).ok).toBe(false);
    expect(eightRaiseFooter(12)).toBe("8Raise: Monique used 12 of her 75 credits this month (30 always kept for you)");
  });
});

describe("catch-ups: opportunistic, never repetitive, never Rainmaker or ruled out", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const c = (email: string, type: string, extra: any = {}) => ({ email, name: "A Person", reason: "why", reason_type: type, reason_at: now - 20 * DAY, ...extra });
  it("caps at three, skips the lists, a week, twice ever, and anything older than six months", () => {
    const lists = { doNotSuggest: ["ruledout.example.com"], rainmaker: ["rm@example.org"] };
    const history = [
      { person_key: "week@example.com", reason_type: "holds_or_wants", suggested_at: now - 3 * DAY },
      { person_key: "twice@example.com", reason_type: "holds_or_wants", suggested_at: now - 40 * DAY },
      { person_key: "twice@example.com", reason_type: "holds_or_wants", suggested_at: now - 20 * DAY },
      { person_key: "wrote@example.com", reason_type: "holds_or_wants", suggested_at: now - 40 * DAY },
      { person_key: "wrote@example.com", reason_type: "holds_or_wants", suggested_at: now - 20 * DAY },
    ];
    const picked = pickCatchups([
      c("x@ruledout.example.com", "holds_or_wants"), c("rm@example.org", "holds_or_wants"),
      c("week@example.com", "holds_or_wants"), c("twice@example.com", "holds_or_wants"),
      c("old@example.com", "holds_or_wants", { reason_at: now - (INBOX_LOOKBACK_DAYS + 1) * DAY }),
      c("wrote@example.com", "unfilled_ask_matched", { last_wrote_at: now - 10 * DAY }),
      c("a@example.com", "holds_or_wants"), c("b@example.com", "unfilled_ask_matched"), c("d@example.com", "holds_or_wants"),
    ], history, lists, now);
    expect(picked.length).toBe(3);
    const got = picked.map((p: any) => p.email);
    for (const no of ["x@ruledout.example.com", "rm@example.org", "week@example.com", "twice@example.com", "old@example.com"]) expect(got).not.toContain(no);
    expect(got).toContain("wrote@example.com"); // wrote to her again: the count resets
    expect(excluded({ email: "steven@slm.example.com", name: "S" }, { doNotSuggest: ["steven@slm.example.com"] })).toBe("do_not_suggest");
  });
});

describe("routes and the one-tap links", () => {
  /*
   * Builder D's two lists (rules 6 and 15). Stood up here only when D's migration has not, and
   * dropped again afterwards so no other suite sees a table this file invented.
   */
  const made: string[] = [];
  afterAll(async () => {
    for (const t of made) await env.DB.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  });
  beforeEach(async () => {
    for (const t of ["do_not_suggest", "same_firm_list"]) {
      const has = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(t).first();
      if (!has) { await env.DB.prepare(`CREATE TABLE ${t} (value TEXT)`).run(); if (!made.includes(t)) made.push(t); }
    }
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM lp_reply_drafts`),
      env.DB.prepare(`DELETE FROM prospect_touches`),
      env.DB.prepare(`DELETE FROM prospects`),
      env.DB.prepare(`DELETE FROM prospect_templates`),
      env.DB.prepare(`UPDATE outreach_settings SET value = 'off' WHERE key = 'kill_switch'`),
      env.DB.prepare(`UPDATE outreach_settings SET value = 'live' WHERE key = 'sending'`),
    ]);
  });

  it("the morning read files LP rows with tap tokens; a skip she made is never undone by a read", async () => {
    const row = { address: "lp.one@example.com", name: "Lee One", bucket: "call", reply_from: "sequoia@westpeek.ventures", status: "drafted", first_seen: "2026-10-20", draft_id: "d1", draft_message_id: "m1" };
    const r = await apiJson("/api/lp/replies", { method: "POST", body: { rows: [row] } });
    expect(r.status).toBe(200);
    const token = r.body.data.rows[0].tap_token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    // A GET never acts (mail scanners fetch links).
    const page = await tap(`/api/auth/tap/${token}?do=skip`);
    expect(page.status).toBe(200);
    expect((await env.DB.prepare(`SELECT status FROM lp_reply_drafts`).first<any>()).status).toBe("drafted");
    const done = await tap(`/api/auth/tap/${token}?do=skip`, "POST");
    expect(done.text).toContain("Skipped");
    await apiJson("/api/lp/replies", { method: "POST", body: { rows: [row] } });
    const after = await apiJson("/api/lp/replies");
    expect(after.body.data.rows[0].status_label).toBe("Skipped");
    expect(after.body.data.rows[0].tap_token).toBeUndefined();
  });

  it("Send as is without the Google key does not pretend: it says not sent and keeps the draft", async () => {
    const r = await apiJson("/api/lp/replies", { method: "POST", body: { rows: [{ address: "lp.two@example.com", bucket: "warm", reply_from: "sequoia@westpeek.ventures", status: "drafted", first_seen: "2026-10-21", draft_id: "d2" }] } });
    const res = await tap(`/api/auth/tap/${r.body.data.rows[0].tap_token}?do=send`, "POST");
    expect(res.text).toContain("Not sent yet");
    expect((await env.DB.prepare(`SELECT status, send_error FROM lp_reply_drafts WHERE address = 'lp.two@example.com'`).first<any>())).toMatchObject({ status: "drafted" });
  });

  it("an unknown token does nothing and says so calmly", async () => {
    expect((await tap(`/api/auth/tap/${"z".repeat(24)}?do=send`, "POST")).text).toContain("This link has done its job");
  });

  it("nothing is sent before she approves; after Approve the plan sends the soft email under the cap", async () => {
    await importProspects(env.DB, [
      { email: "new.one@example.com", name: "Nia New", source: "inbox", kind: "inbox_buyer" },
      { email: "old.one@example.com", name: "Oli Old", source: "8raise_2026_10_11", touches: 1, first_sent_at: WED_10AM - 12 * DAY, last_touch_at: WED_10AM - 12 * DAY, status: "active", thread_id: "t1", last_message_id: "<x@example.com>", subject: "Re: Up to $1B secondary inquiry: Alpha" },
    ]);
    const before = await prospectPlan(env.DB, WED_10AM);
    expect(before.sends).toEqual([]);
    expect(before.stops.join(" ")).toMatch(/No approved prospect email/);
    const t = await proposeTemplate(env.DB, null, NAMES);
    expect(t.ok).toBe(true);
    const tok = (t as any).template.tap_token;
    expect((await tap(`/api/auth/tap/${tok}?do=approve`)).text).toContain("Approving");
    expect((await prospectPlan(env.DB, WED_10AM)).sends).toEqual([]); // the GET did not approve
    expect((await tap(`/api/auth/tap/${tok}?do=approve`, "POST")).text).toContain("Approved");
    const plan = await prospectPlan(env.DB, WED_10AM);
    expect(plan.stops).toEqual([]);
    expect(plan.dryRun).toBe(false);
    const byEmail = Object.fromEntries(plan.sends.map((s: any) => [s.email, s]));
    expect(byEmail["new.one@example.com"].touch).toBe(1);
    expect(byEmail["new.one@example.com"].body).toMatch(/^Hi Nia,/);
    expect(byEmail["old.one@example.com"].touch).toBe(2);
    expect(byEmail["old.one@example.com"].thread_id).toBe("t1");
    expect(byEmail["old.one@example.com"].subject).toBe("Re: Up to $1B secondary inquiry: Alpha");
  });

  it("refuses a template that breaks her tone rules, and one with too few names", async () => {
    const bad = await proposeTemplate(env.DB, { ...DEFAULT_PROSPECT_TEMPLATE, body: DEFAULT_PROSPECT_TEMPLATE.body.replace("I hope you don't mind the direct note.", "Do you want to buy?") }, NAMES);
    expect(bad.ok).toBe(false);
    expect((await proposeTemplate(env.DB, null, NAMES.slice(0, 2))).ok).toBe(false);
  });

  it("an opt-out or bounce is suppressed at once and never planned again; a do-not-suggest address is never sent", async () => {
    const t = await proposeTemplate(env.DB, null, NAMES);
    await approveTemplate(env.DB, (t as any).template.id);
    await importProspects(env.DB, [
      { email: "stop.me@example.com", name: "Sam Stop", source: "inbox" },
      { email: "ruled.out@example.com", name: "Rue Out", source: "inbox" },
    ]);
    await env.DB.prepare(`INSERT INTO do_not_suggest (value) VALUES ('ruled.out@example.com')`).run();
    await recordProspectEvents(env.DB, [{ email: "stop.me@example.com", kind: "opt_out", side: "unknown" }]);
    const plan = await prospectPlan(env.DB, WED_10AM);
    expect(plan.sends.map((s: any) => s.email)).toEqual([]);
    expect((await env.DB.prepare(`SELECT value FROM outreach_suppression WHERE value = 'stop.me@example.com'`).first())).toBeTruthy();
    await env.DB.prepare(`DELETE FROM do_not_suggest`).run();
  });

  it("an unreadable do-not-suggest list holds every send (fail closed)", async () => {
    await env.DB.prepare(`ALTER TABLE do_not_suggest RENAME TO do_not_suggest_away`).run();
    const t = await proposeTemplate(env.DB, null, NAMES);
    await approveTemplate(env.DB, (t as any).template.id);
    await importProspects(env.DB, [{ email: "anyone@example.com", source: "inbox" }]);
    const plan = await prospectPlan(env.DB, WED_10AM);
    expect(plan.sends).toEqual([]);
    expect(plan.stops.join(" ")).toMatch(/could not be read/);
    await env.DB.prepare(`ALTER TABLE do_not_suggest_away RENAME TO do_not_suggest`).run();
  });

  it("the 8Raise route refuses past the floor and logs a spend", async () => {
    const no = await apiJson("/api/lp/eightraise", { method: "POST", body: { purpose: "prospecting", credits: 5, balance: 32, dry: true } });
    expect(no.body.data).toMatchObject({ allowed: false });
    const yes = await apiJson("/api/lp/eightraise", { method: "POST", body: { purpose: "prospecting", credits: 1, balance: 100, company: "Example Firm", tool: "enrich_companies" } });
    expect(yes.body.data).toMatchObject({ allowed: true, logged: true });
    const again = await apiJson("/api/lp/eightraise", { method: "POST", body: { purpose: "prospecting", credits: 1, balance: 99, company: "example firm", dry: true } });
    expect(again.body.data.why).toMatch(/already searched/);
  });

  it("the tap module checks the mailbox before minting and sends only a held draft", () => {
    expect(TAP_SOURCE).toContain("drafts/send");
    expect(TAP_SOURCE).not.toMatch(/messages\/send/);
    expect(TAP_SOURCE.indexOf("WEST_PEEK.test(mailbox)")).toBeLessThan(TAP_SOURCE.indexOf("mintComposeToken(creds"));
  });
});
