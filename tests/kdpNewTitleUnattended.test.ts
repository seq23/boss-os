import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
// @ts-expect-error — plain .mjs ops script, no types
import { planTitle, titleMatches, shelfRowsIn, parseShelfRow, waitForHer, aiAnswers, toolNames, profileBusy, toldBefore, stopMail, headsUpMail, doneMail, stillWaitingMail, reviewUpdate, waitingLoop, routeMessage, liveMail, withLive, asUpdate } from "../scripts/ops/kdp-new-title.mjs";
// @ts-expect-error — plain .mjs ops script, no types
import { withPublished, lineCounts } from "../scripts/ops/kdp-line-counts.mjs";

/**
 * SIMONE PUBLISHES APPROVED KINDLE TITLES ON HER OWN, AND NEVER TWICE (owner, 8 Nov 2026).
 *
 * "The Co-Parenting Log" was Live from 7 Nov; every run on 7–8 Nov still pressed Create, leaving two
 * duplicate drafts, and she was told three times to re-run it. The run never read the bookshelf
 * before creating, matched the bare title against "Title: Subtitle" rows by the first hit (a draft),
 * and read "Live" case-sensitively. These pin: read the shelf first and skip Live / In review; resume
 * a draft, never create a second; an unattended sign-in tells her before it waits and the wait has a
 * ceiling; the AI answers say what the draft record says; the live count reaches the brain.
 */
const T = "The Co-Parenting Log";
const SUB = "A Custody Documentation Workbook for Divorce Prep, With Printable Checklists and Official Court Links by State";

/** A bookshelf row as KDP draws it (text lines from the live page, 6 Oct 2026 copy, state per row). */
const row = (id: string, title: string, state: string, extra = "") => `
  <div class="bookshelf-row"><div class="title-col"><span>${title}</span><div>by S. L. Taylor</div></div>
    <div class="fmt"><div>Kindle eBook</div><div class="status">${state}</div><div>Last modified on November 7, 2026</div>
      <div>$4.99 USD</div>${extra}<a href="/en_US/title-setup/kindle/${id}/details?ref_=kdp_BS_D_p_ed_tl">Continue setup</a></div>
    <div><div>Paperback</div><div>+ Create paperback</div></div></div>`;
const shelf = (html: string) => {
  const w = new Window();
  w.document.body.innerHTML = `<div id="filters">Filter by: All Draft In review Publishing Live Blocked</div><div id="list">${html}</div>`;
  return shelfRowsIn(w.document as unknown as Document);
};

describe("the bookshelf is read before anything is created", () => {
  it("a Live row titled with its subtitle (and shown in capitals) is done: never created again", () => {
    const rows = shelf(row("A2NEWDRAFT01", `${T}: ${SUB}`, "Draft") + row("A1LIVEBOOK01", `${T}: ${SUB}`, "LIVE", "<div>ASIN: B0HQVR4HD3</div>") + row("A3OLDDRAFT01", `${T}: ${SUB}`, "Draft"));
    expect(rows.map((r: any) => r.id)).toEqual(["A2NEWDRAFT01", "A1LIVEBOOK01", "A3OLDDRAFT01"]);
    const plan = planTitle(T, rows);
    expect(plan.action).toBe("done");
    expect(plan.row).toMatchObject({ id: "A1LIVEBOOK01", state: "LIVE", asin: "B0HQVR4HD3", price_usd: 4.99 });
    expect(plan.extra.map((r: any) => r.id)).toEqual(["A2NEWDRAFT01", "A3OLDDRAFT01"]);
  });
  it("In review or Publishing is followed, never re-created", () => {
    expect(planTitle(T, shelf(row("A1REVIEW0001", `${T}: ${SUB}`, "In review"))).action).toBe("watch");
    expect(planTitle(T, shelf(row("A1REVIEW0001", `${T}: ${SUB}`, "Publishing"))).action).toBe("watch");
  });
  it("an existing Draft is resumed (Continue setup), never a second one; the newest of two, the other named", () => {
    const one = planTitle(T, shelf(row("A2DRAFTONE01", `${T}: ${SUB}`, "Draft")));
    expect(one).toMatchObject({ action: "resume", row: { id: "A2DRAFTONE01" }, extra: [] });
    const two = planTitle(T, shelf(row("A2NEWDRAFT01", `${T}: ${SUB}`, "Draft") + row("A3OLDDRAFT01", `${T}: ${SUB}`, "Draft")));
    expect(two.action).toBe("resume");
    expect(two.row.id).toBe("A2NEWDRAFT01");
    expect(two.extra.map((r: any) => r.id)).toEqual(["A3OLDDRAFT01"]);
  });
  it("only a shelf with no row of this title creates; another book with a longer name is not this one", () => {
    expect(titleMatches(T, `${T} Two: Another Book`)).toBe(false);
    expect(titleMatches(T, `The Co‑Parenting Log: ${SUB}`)).toBe(true);
    expect(planTitle(T, shelf(row("A9OTHERBOOK1", `${T} Two: Another Book`, "Live"))).action).toBe("create");
    expect(planTitle(T, []).action).toBe("create");
  });
  it("a row of this title whose state cannot be read is never treated as absent", () => {
    expect(planTitle(T, [{ id: "A1", lines: [`${T}: ${SUB}`, "by S. L. Taylor", "Kindle eBook", "Last modified"] }]).action).toBe("unknown");
  });
  it("a page showing Kindle books the reader could not read is never \"absent\" (no Create)", () => {
    expect(planTitle(T, [], { kindleOnPage: 3 }).action).toBe("unknown");
    expect(planTitle(T, [], { kindleOnPage: 0 }).action).toBe("create");
  });
  it("the state is the Kindle eBook's, not a paperback's below it", () => {
    expect(parseShelfRow([`${T}: ${SUB}`, "by S. L. Taylor", "Kindle eBook", "In review", "Paperback", "Live"]).state).toBe("IN_REVIEW");
  });
});

describe("unattended sign-in: she is told at once, the window stays, the wait has a ceiling", () => {
  const signinPage = () => {
    const waits: number[] = [];
    return { waits, url: () => "https://www.amazon.com/ap/signin?max_auth_age=0", waitForTimeout: async (ms: number) => { waits.push(ms); }, waitForLoadState: async () => {} };
  };
  it("emails her before the first wait, waits at most the hand-off window, then stops by name", async () => {
    const page = signinPage();
    const order: string[] = [];
    const tellSignin = vi.fn(async () => { order.push(`told after ${page.waits.length} waits`); });
    await expect(waitForHer(page, { unattended: true, handoffMs: 60_000, signinMs: 600_000, tellSignin })).rejects.toMatchObject({ stop: "SIGNIN_NOT_DONE", code: 3 });
    expect(tellSignin).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["told after 0 waits"]);
    expect(page.waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60_000);
  });
  it("carries on by itself once she has signed in", async () => {
    let n = 0;
    const page = { url: () => (n++ < 3 ? "https://www.amazon.com/ap/mfa" : "https://kdp.amazon.com/en_US/bookshelf"), waitForTimeout: async () => {}, waitForLoadState: async () => {} };
    await expect(waitForHer(page, { unattended: true, handoffMs: 60_000, signinMs: 1, tellSignin: async () => {} })).resolves.toBeUndefined();
  });
  it("Simone signs in herself first: signed in → carries on and no email to her", async () => {
    let url = "https://www.amazon.com/ap/signin?max_auth_age=0";
    const page = { url: () => url, waitForTimeout: async () => {}, waitForLoadState: async () => {} };
    const tellSignin = vi.fn(async () => {});
    const autoSignin = vi.fn(async (_p: any, target: string) => { url = target; return { code: 0, state: "ok", detail: "signed in" }; });
    await expect(waitForHer(page, { unattended: true, handoffMs: 60_000, signinMs: 1, tellSignin, autoSignin, lastUrl: "https://kdp.amazon.com/en_US/title-setup/kindle/new/details" })).resolves.toBeUndefined();
    expect(autoSignin).toHaveBeenCalledTimes(1);
    expect(tellSignin).not.toHaveBeenCalled();
  });
  it("her sign-in fails, or Amazon shows a picture check → the existing stop email, once, and the bounded wait", async () => {
    for (const r of [{ code: 7, state: "wrong_password", detail: "refused" }, { code: 6, state: "challenge_needs_her", detail: "CAPTCHA" }]) {
      const page = signinPage();
      const tellSignin = vi.fn(async () => {});
      await expect(waitForHer(page, { unattended: true, handoffMs: 10_000, signinMs: 1, tellSignin, autoSignin: async () => r, lastUrl: null })).rejects.toMatchObject({ stop: "SIGNIN_NOT_DONE" });
      expect(tellSignin).toHaveBeenCalledTimes(1);
    }
  });
  it("a person at the terminal is not emailed", async () => {
    const tellSignin = vi.fn(async () => {});
    await expect(waitForHer(signinPage(), { unattended: false, handoffMs: 1, signinMs: 4000, tellSignin })).rejects.toMatchObject({ stop: "SIGNIN_NOT_DONE" });
    expect(tellSignin).not.toHaveBeenCalled();
  });
});

describe("the AI answers say what the draft record says", () => {
  it("the whole guide by the models the draft used, with minimal editing; the code-drawn cover is not AI art", () => {
    const a = aiAnswers({ ai_disclosure: { text: "ai_generated", images: "ai_generated" } }, { models: ["gemini:gemini-3.5-flash-lite", "openrouter:meta-llama/llama-3.3-70b-instruct:free"] });
    expect(a).toMatchObject({ used: true, texts: "Entire work, with minimal or no editing", images: "None", translations: "None", tools: "Google Gemini; Meta Llama" });
    expect(toolNames(["brain:claude-opus", "codex"])).toBe("Anthropic Claude; OpenAI");
  });
  it("a record that says the cover is AI art, or the text was edited, is answered as such", () => {
    expect(aiAnswers({}, { ai_disclosure: { text: "ai_generated", images: "ai_generated", cover_is_ai: true, text_detail: "Some sections, with extensive editing" }, models: [] })).toMatchObject({ texts: "Some sections, with extensive editing", images: "One or a few AI-generated images, with minimal or no editing" });
  });
});

describe("messages to her: told once, plain, the one thing to do", () => {
  it("a whole run sends ONE email, whatever happens in it", () => {
    // A run's messages in the order it raises them, for the three shapes a run can take.
    const runs = [
      ["headsup", "live"],                              // every title went live
      ["headsup", "stop", "waiting", "live", "live"],   // a stop she must act on, then the rest
      ["headsup", "waiting"],                           // nothing finished
    ];
    for (const kinds of runs) {
      const state = { emailed: false };
      let emails = 0;
      for (const k of kinds) if (routeMessage(state, k) === "email") { emails += 1; state.emailed = true; }
      expect(emails).toBe(1);
    }
    // The heads-up is never the email: there is nothing for her to do in it.
    expect(routeMessage({ emailed: false }, "headsup")).toBe("update");
    // Three titles live in one run are one message that links all three.
    const three = [1, 2, 3].map((n) => ({ title: `Book ${n}`, asin: `B0SYNTH000${n}`, price_usd: 4.99 }));
    const one = liveMail(three);
    for (const b of three) expect(one.layout.details.join("\n")).toContain(`https://www.amazon.com/dp/${b.asin}`);
    // A stop carries what went live before it, so that news is not a second email.
    expect(withLive(stopMail({ title: T, code: "SIGNIN" }), three.slice(0, 1)).layout.details.join("\n")).toContain("https://www.amazon.com/dp/B0SYNTH0001");
    // What is not emailed still reaches her Updates page with its words.
    expect(asUpdate("waiting:x", stillWaitingMail({ title: T, code: "SIGNIN" })).body).toContain(T);
  });
  it("a key already told is not told again", () => {
    expect(toldBefore({ "live:jc1": "2026-11-08T15:00:00Z" }, "live:jc1")).toBe(true);
    expect(toldBefore({}, "live:jc1")).toBe(false);
  });
  it("each message names the book and, where she must act, the one thing", () => {
    const at = Date.parse("2026-11-09T16:15:00Z");
    expect(headsUpMail({ titles: [T], startAt: at, zone: "America/Chicago" }).layout.happened).toContain("10:15 am");
    expect(headsUpMail({ titles: [T], startAt: at, zone: "America/New_York" }).layout.happened).toContain("11:15 am (10:15 am Central)");
    expect(stopMail({ title: T, code: "SIGNIN" }).layout.details[0]).toMatch(/^The one thing to do: Sign in to Amazon in that Chrome window/);
    expect(doneMail({ title: T, asin: "B0HQVR4HD3", price_usd: 4.99 }).layout.details).toEqual(["Amazon page: https://www.amazon.com/dp/B0HQVR4HD3", "ASIN: B0HQVR4HD3"]);
    expect(stillWaitingMail({ title: T, code: "SIGNIN" }).layout.details.join(" ")).toMatch(/try again by myself/);
    expect(reviewUpdate({ id: "JC_1", title: T }).key).toBe("kdp-review:jc_1");
    expect(waitingLoop({ title: T, folder: "divorce", day: "2026-11-09" })).toMatchObject({ stop: "KDP_NEW_TITLE_DIVORCE", owner: "sequoia" });
  });
});

describe("the KDP profile in use is never opened over", () => {
  it("a SingletonLock naming a live process is busy; none, or a dead one, is free", () => {
    const lock = { lstat: () => ({}), readlink: () => "Mac.local-4242" };
    expect(profileBusy("/p", { ...lock, alive: () => true })).toBe(true);
    expect(profileBusy("/p", { ...lock, alive: () => false })).toBe(false);
    expect(profileBusy("/p", { lstat: () => { throw new Error("ENOENT"); }, readlink: () => "", alive: () => true })).toBe(false);
  });
});

describe("a book Live on the bookshelf counts as live in the brain", () => {
  it("publish.json LIVE overrides a register row still saying DRAFT_LOCAL", () => {
    const reg = { lines: { keepmyproof: { label: "KeepMyProof" } }, titles: [{ title: T, line: "keepmyproof", status: "DRAFT_LOCAL", kmp_folder: "divorce" }] };
    const read = (f: string) => { if (f.endsWith("divorce/publish.json")) return JSON.stringify({ resulting_state: "LIVE" }); throw new Error("ENOENT"); };
    expect(lineCounts(withPublished(reg, { drafts: "/d", read }))["Kindle books: KeepMyProof"]).toBe("1 (1 live)");
    expect(lineCounts(withPublished(reg, { drafts: "/d", read: () => { throw new Error("ENOENT"); } }))["Kindle books: KeepMyProof"]).toBe("1 (0 live)");
  });
});
