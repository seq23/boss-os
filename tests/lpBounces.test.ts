/**
 * Owner, 24 Oct 2026: "a lot of 2nd emails went out to emails that were already bounced or blocked"
 * and "u need to use my neverbounce when u can". Synthetic notices and fake addresses only: the
 * repository is public.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hardBouncedAddresses, twinReplyQueueRows, twinReplyQueueFromReplies, sendsAfterBounce, neverBounceVerdict, verifyFirstSends, NEVERBOUNCE_MAX_PER_RUN,
} from "../src/shared/boss/lp/bounces.mjs";

const GMAIL_DSN = [
  "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
  "X-Failed-Recipients: gone.person@pension.example.org",
  "Subject: Delivery Status Notification (Failure)",
  "Address not found. 550 5.1.1 The email account that you tried to reach does not exist.",
  "Reporting-MTA: dns; googlemail.com",
  "Final-Recipient: rfc822; gone.person@pension.example.org",
  "Action: failed",
  "Status: 5.1.1",
].join("\n");
const EXCHANGE_DSN = "Final-Recipient: rfc822;Blocked.One@Fund.example.com\nAction: failed\nStatus: 5.4.1\nDiagnostic-Code: smtp; 550 5.4.1 Recipient address rejected: Access denied";
const DELAYED = "Final-Recipient: rfc822; slow@example.com\nAction: delayed\nStatus: 4.4.7\nDiagnostic-Code: smtp; 451 4.4.7 retrying";
const OUR_DMARC = "Final-Recipient: rfc822; lp@example.com\nAction: failed\nStatus: 5.7.26\n550 5.7.26 unauthenticated email is not accepted";

const sentRow = (email: string, stage = "1", first = "Pat", last = "Example") => ["2026-10-20T12:30:00Z", first, last, "Example Pension", "Pension", email, "2", stage, "Pat — Example's program", "sent"];

describe("hard bounces are read from the notice, soft ones and our own DMARC are not", () => {
  it("takes Final-Recipient / X-Failed-Recipients on a 5.x.x, lower-cased, once", () => {
    expect(hardBouncedAddresses(GMAIL_DSN)).toEqual(["gone.person@pension.example.org"]);
    expect(hardBouncedAddresses(EXCHANGE_DSN)).toEqual(["blocked.one@fund.example.com"]);
  });
  it("a delayed (4.x.x) notice and a 5.7.26 sender-auth failure suppress nobody", () => {
    expect(hardBouncedAddresses(DELAYED)).toEqual([]);
    expect(hardBouncedAddresses(OUR_DMARC)).toEqual([]);
    expect(hardBouncedAddresses("")).toEqual([]);
  });
});

describe("a bounced address Twin wrote to goes on Twin's Reply Queue, so no step 2 goes", () => {
  const hard = new Map([["gone.person@pension.example.org", Date.parse("2026-10-21T10:00:00Z")], ["someone.else@other.example", 1]]);
  const sentRows = [sentRow("gone.person@pension.example.org"), sentRow("gone.person@pension.example.org", "2"), sentRow("fine@pension.example.org")];

  it("one row per bounced Sent Log address, in the tab's own columns, Status new", () => {
    const rows = twinReplyQueueRows({ sentRows, hard });
    expect(rows).toEqual([["gone.person@pension.example.org", "Pat Example", "Example Pension", "2026-10-21", expect.stringMatching(/Hard bounce.*never email it again/), "new"]]);
  });
  it("an address Twin never wrote to (other mail in the mailbox) is not queued", () => {
    expect(twinReplyQueueRows({ sentRows: [sentRow("fine@pension.example.org")], hard })).toEqual([]);
  });
  it("never queued twice; queued even when already on Do-Not-Contact, which did not stop the drip", () => {
    expect(twinReplyQueueRows({ sentRows, hard, queued: new Set(["gone.person@pension.example.org"]) })).toEqual([]);
    expect(twinReplyQueueRows({ sentRows, hard, blocked: new Set(["gone.person@pension.example.org"]) } as any)).toHaveLength(1);
  });
  it("counts sends that went after the bounce, and only those", () => {
    const at = Date.parse("2026-10-21T10:00:00Z");
    expect(sendsAfterBounce([{ to: ["gone.person@pension.example.org"], at: at - 1 }, { to: ["Gone.Person@pension.example.org"], at: at + 1 }, { to: ["fine@pension.example.org"], at: at + 1 }], hard)).toHaveLength(1);
  });
});

describe("NeverBounce before EVERY touch: the Mac checks what Boss OS says is due and keeps the verdicts (24 Oct 2026)", () => {
  it("asks for the due addresses within the cap, checks them, posts only real verdicts", async () => {
    const { verifyDue } = await import("../scripts/ops/lp-prospects.mjs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-"));
    const posted: any[] = [];
    let asked = "";
    const api = {
      get: async (u: string) => { asked = u; return { emails: ["ok@example.com", "bad@example.com", "flaky@example.com"] }; },
      post: async (_u: string, b: any) => { posted.push(b); return { recorded: b.verdicts.length }; },
    };
    const fetchImpl = (async (u: URL) => {
      const e = u.searchParams.get("email");
      return { json: async () => (e === "flaky@example.com" ? { status: "general_failure" } : { status: "success", result: e === "bad@example.com" ? "invalid" : "valid" }) };
    }) as any;
    const r = await verifyDue(api, { key: "k", fetchImpl, cacheFile: path.join(dir, "c.json") });
    expect(asked).toMatch(/^\/lp\/prospects\/to-verify\?cap=\d+$/);
    expect(posted).toEqual([{ verdicts: [{ email: "ok@example.com", result: "valid" }, { email: "bad@example.com", result: "invalid" }] }]);
    expect(r.marks).toEqual({ valid: 1, invalid: 1, unverified: 1 });
    // Cached: a second run spends no credits.
    let calls = 0;
    await verifyDue(api, { key: "k", fetchImpl: (async (u: URL) => { calls++; return fetchImpl(u); }) as any, cacheFile: path.join(dir, "c.json") });
    expect(calls).toBe(1); // only the one with no answer is asked again
    // The run no longer filters sends itself: the plan (one list, in D1) decides.
    expect(fs.readFileSync("scripts/ops/lp-prospects.mjs", "utf8")).not.toMatch(/verdicts\.get\(s\.email/);
  });
});

describe("NeverBounce before a first email (her account, credits capped, cached)", () => {
  it("invalid / disposable never send; catchall / unknown send marked; no answer sends unverified", () => {
    expect(neverBounceVerdict("valid")).toEqual({ send: true, mark: "valid" });
    expect(neverBounceVerdict("catchall")).toEqual({ send: true, mark: "catchall" });
    expect(neverBounceVerdict("unknown")).toEqual({ send: true, mark: "unknown" });
    expect(neverBounceVerdict("invalid").send).toBe(false);
    expect(neverBounceVerdict("disposable").send).toBe(false);
    expect(neverBounceVerdict(null)).toEqual({ send: true, mark: "unverified" });
  });
  it("uses the cache, stops at the cap, and re-checks after 90 days", async () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    const calls: string[] = [];
    const check = async (e: string) => { calls.push(e); return e.startsWith("bad") ? "invalid" : "valid"; };
    const cache = { "cached@example.com": { result: "invalid", at: now - 10 * 86_400_000 }, "old@example.com": { result: "valid", at: now - 100 * 86_400_000 } };
    const r = await verifyFirstSends(["cached@example.com", "old@example.com", "bad@example.com", "x@example.com"], { check, cache, cap: 2, now });
    expect(calls).toEqual(["old@example.com", "bad@example.com"]);
    expect(r.verdicts.get("cached@example.com")!.send).toBe(false);
    expect(r.verdicts.get("bad@example.com")!.send).toBe(false);
    expect(r.verdicts.get("x@example.com")).toEqual({ send: true, mark: "unverified" }); // past the cap
    expect(r.cache["bad@example.com"]?.result).toBe("invalid");
    expect(NEVERBOUNCE_MAX_PER_RUN).toBeLessThanOrEqual(25);
  });
  it("with no key nothing is checked and every address is unverified (named stop in the run)", async () => {
    const r = await verifyFirstSends(["a@example.com"], { check: null });
    expect(r.checked).toBe(0);
    expect(r.verdicts.get("a@example.com")!.mark).toBe("unverified");
    const src = fs.readFileSync("scripts/ops/lp-prospects.mjs", "utf8");
    expect(src).toMatch(/NAMED STOP \[NO_NEVERBOUNCE_KEY\]/);
    expect(src).toMatch(/v4\.2\/single\/check/);
  });
});

describe("the bounce read runs before every sender in the mailbox", () => {
  it("lp-daily (06:15, before Twin's ~07:30 run) and lp-prospects (before its plan) both call syncBounces", () => {
    const daily = fs.readFileSync("scripts/ops/lp-daily.mjs", "utf8");
    const prospects = fs.readFileSync("scripts/ops/lp-prospects.mjs", "utf8");
    expect(daily.indexOf("syncBounces")).toBeGreaterThan(-1);
    expect(daily.indexOf("syncBounces")).toBeLessThan(daily.indexOf('api.get("/lp/replies")'));
    expect(prospects.indexOf("syncBounces")).toBeLessThan(prospects.indexOf('api.get("/lp/prospects/plan")'));
    const bounces = fs.readFileSync("scripts/ops/lp-bounces.mjs", "utf8");
    expect(bounces).toMatch(/Reply Queue/);
    expect(bounces).toMatch(/\/lp\/prospects\/suppress/);
  });
});

describe("every reply, opt-out and call-ask goes on Reply Queue before the drip runs (1 Nov 2026)", () => {
  it("queues people who wrote back, once each, in the tab's own columns with status new; skips autoresponders and screened-out mail", () => {
    const sentRows = [sentRow("call.me@fo.example.com", "2"), sentRow("stop.it@endow.example.org", "1"), sentRow("ooo@pension.example.org")];
    const replies = new Map<string, { bucket: string; when?: string; name?: string }>([
      ["call.me@fo.example.com", { bucket: "call", when: "2026-10-30" }],
      ["stop.it@endow.example.org", { bucket: "negative", when: "2026-10-31" }],
      ["never.emailed@fo.example.com", { bucket: "warm", when: "2026-10-01", name: "Sam Sample" }],
      ["ooo@pension.example.org", { bucket: "auto", when: "2026-10-31" }],
      ["list@news.example.com", { bucket: "bulk_list_unsubscribe", when: "2026-10-31" }],
      ["done.before@fo.example.com", { bucket: "other", when: "2026-09-01" }],
    ]);
    const rows = twinReplyQueueFromReplies({ sentRows, replies, queued: new Set(["done.before@fo.example.com"]) });
    expect(rows.map((r) => r[0]).sort()).toEqual(["call.me@fo.example.com", "never.emailed@fo.example.com", "stop.it@endow.example.org"]);
    for (const r of rows) { expect(r).toHaveLength(6); expect(r[5]).toBe("new"); }
    const call = rows.find((r) => r[0] === "call.me@fo.example.com")!;
    expect(call.slice(1, 4)).toEqual(["Pat Example", "Example Pension", "2026-10-30"]);
    expect(rows.find((r) => r[0] === "never.emailed@fo.example.com")![1]).toBe("Sam Sample");
    // Idempotent: a second run over the same mailbox, with today's rows now on the tab, adds nothing.
    expect(twinReplyQueueFromReplies({ sentRows, replies, queued: new Set<string>([...rows.map((r) => String(r[0])), "done.before@fo.example.com"]) })).toEqual([]);
  });

  it("zero replies handed over is a named stop, never an empty success", () => {
    expect(() => twinReplyQueueFromReplies({ sentRows: [], replies: new Map() })).toThrow(/NAMED STOP \[NO_REPLIES_READ\]/);
    expect(() => twinReplyQueueFromReplies({ sentRows: [], replies: new Map([["a@b.example.com", { bucket: "auto" }]]) })).toThrow(/NO_REPLIES_READ/);
  });
});
