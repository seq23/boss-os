import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson, row } from "./helpers";
import { dailyCap, pauseReason, refusal, DAY_MS } from "../../src/worker/boss/outreach/brakes";
import { bouncedAddress, classifyReply } from "../../src/worker/boss/outreach/classify";
import { composeEmail } from "../../src/worker/boss/outreach/compose";
import { isSuppressed, suppress, isBusinessEmail } from "../../src/worker/boss/outreach/suppression";
import {
  assertOutreachMailboxAllowed, assertOutreachSetupTarget, assertSenderAllowed, businessByKey, BUSINESSES, OUTREACH_MAILBOX,
} from "../../src/worker/boss/outreach/catalog";
import CATALOG_SOURCE from "../../src/worker/boss/outreach/catalog.ts?raw";
import REFERRALS_SOURCE from "../../src/worker/boss/outreach/referrals.ts?raw";
import GMAIL_SOURCE from "../../src/worker/boss/outreach/gmail.ts?raw";
import DOMAINS_SCRIPT from "../../scripts/outreach/domains.mjs?raw";
import CLAUDE_MD from "../../CLAUDE.md?raw";
import OPERATIONS_MD from "../../docs/boss/OPERATIONS.md?raw";
import { pickEmail, parseOverpass } from "../../src/worker/boss/outreach/lists";
import { runOutreachTick } from "../../src/worker/boss/outreach/engine";
import { computePeriod, recordConversion, ensurePartner, makeCode } from "../../src/worker/boss/outreach/referrals";

/**
 * MONIQUE'S OUTREACH: THE BRAKES ARE THE REVIEW (owner, 9 Oct 2026: "u do it all").
 *
 * There is no human reading each email, so every brake is pinned here, and breaking any one of
 * them — the cap, the 3% pause, the complaint pause, the kill switch, the test-only flag, the
 * postal-address refusal, suppression, the unsubscribe door, stop-on-reply, the classifier's
 * precedence — fails a named test.
 */

// A Tuesday, 10:00 America/Chicago (15:00 UTC in October): inside the sending window.
const TUESDAY_10AM = Date.UTC(2026, 9, 13, 15, 0, 0);

async function fakeServiceAccount(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der))).replace(/(.{64})/g, "$1\n");
  return JSON.stringify({ client_email: "gsc-bot@test.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` });
}

interface Inbound { id: string; threadId: string; from: string; subject: string; body: string; headers?: Record<string, string> }

/** A Gmail that sends, lists inbound mail we give it, and records every send. */
function fakeGmail(opts: { sendAs?: string[]; inbound?: Inbound[] } = {}) {
  const sends: { from: string; to: string; raw: string; threadId?: string }[] = [];
  let n = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "ya29.fake" });
    if (url.endsWith("/messages/send")) {
      const body = JSON.parse(String(init?.body));
      const raw = atob(body.raw.replace(/-/g, "+").replace(/_/g, "/"));
      const from = /^From: .*<([^>]+)>/m.exec(raw)?.[1] ?? "";
      const to = /^To: (.+)$/m.exec(raw)?.[1]?.trim() ?? "";
      sends.push({ from, to, raw, threadId: body.threadId });
      n += 1;
      return Response.json({ id: `m${n}`, threadId: body.threadId ?? `t${n}` });
    }
    if (url.includes("/settings/sendAs")) {
      return Response.json({ sendAs: [{ sendAsEmail: OUTREACH_MAILBOX, isPrimary: true }, ...(opts.sendAs ?? []).map((e) => ({ sendAsEmail: e, verificationStatus: "accepted" }))] });
    }
    if (url.includes("format=metadata")) {
      const id = /messages\/([^?]+)/.exec(url)?.[1] ?? "";
      const sent = sends[Number(id.slice(1)) - 1];
      const name = /metadataHeaders=([^&]+)/.exec(url)?.[1];
      return Response.json({ id, payload: { headers: name === "From" ? [{ name: "From", value: `X <${sent?.from}>` }] : [{ name: "Message-ID", value: `<${id}@mail.gmail.com>` }] } });
    }
    if (url.includes("/messages?")) {
      const q = decodeURIComponent(/q=([^&]+)/.exec(url)?.[1] ?? "");
      const list = (opts.inbound ?? []).filter((m) => (q.includes("mailer-daemon") ? /mailer-daemon/i.test(m.from) : !/mailer-daemon/i.test(m.from)));
      return Response.json({ messages: list.map((m) => ({ id: m.id, threadId: m.threadId })) });
    }
    if (url.includes("format=full")) {
      const id = /messages\/([^?]+)/.exec(url)?.[1] ?? "";
      const m = (opts.inbound ?? []).find((x) => x.id === id)!;
      const headers = [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }, ...Object.entries(m.headers ?? {}).map(([name, value]) => ({ name, value }))];
      const data = btoa(unescape(encodeURIComponent(m.body))).replace(/\+/g, "-").replace(/\//g, "_");
      return Response.json({ id: m.id, threadId: m.threadId, internalDate: String(TUESDAY_10AM), payload: { mimeType: "text/plain", headers, body: { data } } });
    }
    // Lists: no public listing and no website in these tests.
    if (url.includes("overpass") || url.includes("interpreter")) return Response.json({ elements: [] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, sends };
}

const T2R = businessByKey("time2read")!;

async function reset() {
  for (const t of ["outreach_prospects", "outreach_suppression", "outreach_sends", "outreach_replies", "outreach_domain_state",
    "outreach_candidates", "outreach_slices", "referral_partners", "referral_conversions", "referral_payouts"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare(`UPDATE outreach_settings SET value = 'off' WHERE key = 'kill_switch'`).run();
  await env.DB.prepare(`UPDATE outreach_settings SET value = 'live' WHERE key = 'sending'`).run();
  // Every business has a full week of prospects queued, so the tick does no list building here.
  for (const b of BUSINESSES) {
    for (let i = 0; i < 50; i++) await addProspect(b.key, `filler${i}@${b.key}-filler.example.org`, { state: "done" });
  }
}

async function addProspect(key: string, email: string, over: Record<string, unknown> = {}) {
  const id = `opr_${key}_${email}`;
  await env.DB.prepare(
    `INSERT INTO outreach_prospects (id, business_key, email, email_domain, org_name, segment, metro, website, source, source_url,
       mx_verified_at, state, step, next_due_at, thread_id, unsub_token, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, key, email, email.split("@")[1], "Acme Reading", "reading_tutors", "Houston", "https://acme.example",
    "openstreetmap+website", "https://www.openstreetmap.org/node/1", TUESDAY_10AM,
    over.state ?? "new", over.step ?? 0, over.next_due_at ?? TUESDAY_10AM, over.thread_id ?? null,
    over.unsub_token ?? `tok_${key}_${email}`, TUESDAY_10AM - DAY_MS, TUESDAY_10AM - DAY_MS).run();
  return id;
}

async function readyWithAddress(key: string) {
  await env.DB.prepare(
    `INSERT INTO outreach_domain_state (business_key, route_state, postal_address, updated_at) VALUES (?, 'ready', '100 Main St, Suite 1, Houston, TX 77002', ?)
     ON CONFLICT(business_key) DO UPDATE SET route_state = 'ready', postal_address = excluded.postal_address`,
  ).bind(key, TUESDAY_10AM).run();
}

async function tickEnv() {
  return { ...env, GSC_SERVICE_ACCOUNT_JSON: await fakeServiceAccount() } as any;
}

describe("the brakes, as pure functions", () => {
  it("starts every domain at 10 a day and ramps slowly to a hard 40", () => {
    expect(dailyCap(null, TUESDAY_10AM)).toBe(10);
    expect(dailyCap(TUESDAY_10AM, TUESDAY_10AM + 6 * DAY_MS)).toBe(10);
    expect(dailyCap(TUESDAY_10AM, TUESDAY_10AM + 7 * DAY_MS)).toBe(15);
    expect(dailyCap(TUESDAY_10AM, TUESDAY_10AM + 21 * DAY_MS)).toBe(30);
    expect(dailyCap(TUESDAY_10AM, TUESDAY_10AM + 400 * DAY_MS)).toBe(40);
  });

  it("pauses on a bounce rate OVER 3% and on any single complaint", () => {
    expect(pauseReason({ sent: 100, bounced: 3, complaints: 0 })).toBeNull();
    expect(pauseReason({ sent: 100, bounced: 4, complaints: 0 })).toMatch(/bounce rate 4\.0%/);
    expect(pauseReason({ sent: 1000, bounced: 0, complaints: 1 })).toMatch(/complaint/);
    expect(pauseReason({ sent: 0, bounced: 0, complaints: 0 })).toBeNull();
  });

  it("refuses by the kill switch, the flag, the route, the postal address and the pause", () => {
    const go = { killSwitch: false, sending: "live" as const, routeReady: true, hasPostalAddress: true, pausedReason: null, isTestRecipient: false };
    expect(refusal(go)).toBeNull();
    expect(refusal({ ...go, killSwitch: true })).toMatch(/kill switch/);
    expect(refusal({ ...go, killSwitch: true, isTestRecipient: true })).toMatch(/kill switch/);
    expect(refusal({ ...go, sending: "off" })).toMatch(/off/);
    expect(refusal({ ...go, sending: "test_only" })).toMatch(/test-only/);
    expect(refusal({ ...go, sending: "test_only", isTestRecipient: true })).toBeNull();
    expect(refusal({ ...go, routeReady: false })).toMatch(/not proven/);
    expect(refusal({ ...go, hasPostalAddress: false })).toMatch(/postal address/);
    expect(refusal({ ...go, pausedReason: "Paused automatically" })).toMatch(/Paused/);
  });

  it("never sends from West Peek, spry.vc or her own domain, nor off the business's domain", () => {
    expect(() => assertSenderAllowed({ ...T2R, sender: "monique@spry.vc" })).toThrow(/never send/);
    expect(() => assertSenderAllowed({ ...T2R, sender: "x@westpeek.ventures" })).toThrow(/never send/);
    expect(() => assertSenderAllowed({ ...T2R, sender: "hello@uscisexam.com" })).toThrow(/own domain/);
    for (const b of BUSINESSES) expect(() => assertSenderAllowed(b)).not.toThrow();
    expect(BUSINESSES.some((b) => /how-?we-?know/.test(b.domain))).toBe(false);
  });
});

describe("what a reply means", () => {
  const c = (body: string, subject = "Re: A reading partnership", from = "a@acme.example", headers?: Record<string, string>) =>
    classifyReply({ from, subject, body, headers });

  it("reads each class", () => {
    expect(c("Yes, tell me more about the code")).toBe("interested");
    expect(c("Please remove me from your list")).toBe("unsubscribe");
    expect(c("Unsubscribe")).toBe("unsubscribe");
    expect(c("This is spam. How did you get my email?")).toBe("complaint");
    expect(c("I'm not the right person for this, try our director")).toBe("wrong_person");
    expect(c("Not right now, maybe next quarter")).toBe("not_now");
    expect(c("I am out of the office until Monday")).toBe("auto_reply");
    expect(c("anything", "Re: x", "a@acme.example", { "auto-submitted": "auto-replied" })).toBe("auto_reply");
    expect(c("The email wasn't delivered", "Delivery Status Notification (Failure)", "mailer-daemon@googlemail.com")).toBe("bounce");
  });

  it("never reads 'not interested' as interest, and puts stopping before everything", () => {
    expect(c("Not interested, thanks")).toBe("not_now");
    expect(c("Yes — please stop emailing us")).toBe("unsubscribe");
    expect(c("Interested? No. This is spam.")).toBe("complaint");
  });

  it("reads only the person's own words, not the quoted original", () => {
    expect(c("Sounds great!\n\nOn Tue, Oct 13, 2026 at 10:00 AM Time2Read wrote:\n> Unsubscribe with one click")).toBe("interested");
  });

  it("finds the failed address in a bounce", () => {
    expect(bouncedAddress("Final-Recipient: rfc822; gone@acme.example\nAction: failed")).toBe("gone@acme.example");
    expect(bouncedAddress("", { "x-failed-recipients": "Gone@Acme.example" })).toBe("gone@acme.example");
  });
});

describe("every email carries the unsubscribe link and the postal address", () => {
  it("builds both into the body and the one-click header", () => {
    const m = composeEmail({ business: T2R, step: 0, to: "a@acme.example", org: "Acme", metro: "Houston", unsubToken: "tok123", postalAddress: "PO Box 1, Houston, TX 77002" });
    expect(m.body).toContain("https://boss.sequoiataylor.com/api/boss/outreach/u/tok123");
    expect(m.body).toContain("PO Box 1, Houston, TX 77002");
    expect(m.raw).toMatch(/^List-Unsubscribe: <https:\/\/boss\.sequoiataylor\.com\/api\/boss\/outreach\/u\/tok123>/m);
    expect(m.raw).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click/m);
    expect(m.raw).toMatch(/^From: Time2Read <st@time-2-read\.com>/m);
  });

  it("the HTML footer keeps the address and the unsubscribe link, in 10px muted type (CAN-SPAM)", () => {
    const addr = "PO Box 1, Houston, TX 77002";
    const m = composeEmail({ business: T2R, step: 0, to: "a@acme.example", org: "Acme", metro: "Houston", unsubToken: "tok123", postalAddress: addr });
    expect(m.raw).toMatch(/^Content-Type: multipart\/alternative; boundary="/m);
    const parts = [...m.raw.matchAll(/Content-Type: (text\/(?:plain|html)); charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)]
      .map((x) => [x[1], decodeURIComponent(escape(atob(x[2]!.replace(/\r\n/g, ""))))] as const);
    expect(parts.map((p) => p[0])).toEqual(["text/plain", "text/html"]);
    const [plain, html] = [parts[0]![1], parts[1]![1]];
    // Plain text: the address on one short line, and the unsubscribe link.
    expect(plain.split("\n")).toContain(`Time2Read, ${addr}`);
    expect(plain).toContain("https://boss.sequoiataylor.com/api/boss/outreach/u/tok123");
    // HTML: the footer paragraph carries both, at 10px muted grey.
    const footer = /<p style="([^"]*)"[^>]*>([\s\S]*?)<\/p>\s*<\/body>/.exec(html);
    expect(footer, "the HTML part has a footer paragraph").not.toBeNull();
    expect(footer![1]).toContain("font-size:10px");
    expect(footer![1]).toMatch(/color:#8a8a8a/);
    expect(footer![2]).toContain(addr);
    expect(footer![2]).toContain('href="https://boss.sequoiataylor.com/api/boss/outreach/u/tok123"');
    expect(m.html).toBe(html);
  });

  it("refuses to compose without a postal address or an unsubscribe token", () => {
    const base = { business: T2R, step: 0 as const, to: "a@acme.example", org: "Acme", metro: "Houston", unsubToken: "t", postalAddress: "PO Box 1, Houston, TX 77002" };
    expect(() => composeEmail({ ...base, postalAddress: "" })).toThrow(/postal address/);
    expect(() => composeEmail({ ...base, unsubToken: "" })).toThrow(/unsubscribe/);
  });
});

describe("lists: business addresses only", () => {
  it("prefers the site's own role address and rejects free mail and junk", () => {
    expect(pickEmail(["owner@gmail.com", "info@acme.example", "jane@acme.example"], "https://www.acme.example")).toBe("info@acme.example");
    expect(pickEmail(["owner@gmail.com", "logo@2x.png"], "https://acme.example")).toBeNull();
    expect(isBusinessEmail("owner@yahoo.com")).toBe(false);
    expect(isBusinessEmail("hello@acme.example")).toBe(true);
  });

  it("never takes a scraped address on another domain — only one the public listing names", () => {
    expect(pickEmail(["justin@dds.cloud"], "https://www.rifkinraanan.com")).toBeNull();
    expect(pickEmail(["justin@dds.cloud", "office@rifkinraanan.com"], "https://www.rifkinraanan.com")).toBe("office@rifkinraanan.com");
    expect(pickEmail(["front@practicemail.example"], "https://clinic.example", "front@practicemail.example")).toBe("front@practicemail.example");
    expect(pickEmail(["owner@gmail.com"], "https://clinic.example", "owner@gmail.com")).toBeNull();
  });

  it("reads each metro as four quadrants that cover it exactly", async () => {
    const { quadrants } = await import("../../src/worker/boss/outreach/lists");
    const q = quadrants([29.52, -95.79, 30.11, -95.01]);
    expect(q).toHaveLength(4);
    expect(Math.min(...q.map((b) => b[0]))).toBe(29.52);
    expect(Math.max(...q.map((b) => b[2]))).toBe(30.11);
    expect(Math.min(...q.map((b) => b[1]))).toBe(-95.79);
    expect(Math.max(...q.map((b) => b[3]))).toBe(-95.01);
  });

  it("takes the real name from a multi-valued listing", () => {
    expect(parseOverpass({ elements: [{ type: "node", id: 1, tags: { name: "Guess;Rifkin Raanan Cosmetic Dentistry", website: "https://r.example" } }] })[0]!.name).toBe("Rifkin Raanan Cosmetic Dentistry");
  });

  it("reads a public listing into websites, deduped, without social pages", () => {
    const listed = parseOverpass({ elements: [
      { type: "node", id: 1, tags: { name: "A", website: "https://a.example/path" } },
      { type: "node", id: 2, tags: { name: "A again", website: "http://a.example" } },
      { type: "node", id: 3, tags: { name: "B", website: "https://facebook.com/b" } },
    ] });
    expect(listed.map((l) => l.website)).toEqual(["https://a.example"]);
  });
});

describe("list building survives busy public servers", () => {
  beforeEach(reset);

  it("a failed listing read is retried within hours, never parked for the 30-day refresh", async () => {
    await env.DB.prepare(`DELETE FROM outreach_prospects`).run();
    const { readNextSlice, SLICE_RETRY_MS } = await import("../../src/worker/boss/outreach/lists");
    let calls = 0;
    const busy = (async () => { calls += 1; return new Response("busy", { status: 504 }); }) as typeof fetch;
    const first = await readNextSlice(env.DB, busy, TUESDAY_10AM, ["uscisexam"]);
    expect(first?.found).toBe(0);
    const row1 = await row<any>(`SELECT found FROM outreach_slices WHERE metro = 'nyc:q1' AND business_key = 'uscisexam'`);
    expect(row1.found).toBe(-1);
    const ok = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("accept")).toBeNull();
      return Response.json({ elements: [{ type: "node", id: 9, tags: { name: "Clinic", website: "https://clinic.example" } }] });
    }) as typeof fetch;
    const later = await readNextSlice(env.DB, ok, TUESDAY_10AM + SLICE_RETRY_MS + 1, ["uscisexam"]);
    expect(later?.slice).toBe("uscisexam|civil_surgeons|nyc:q1");
    expect(later?.found).toBe(1);
  });
});

describe("suppression and the unsubscribe door", () => {
  beforeEach(reset);

  it("suppressing an address stops its sequences in every business at once", async () => {
    await addProspect("time2read", "x@acme.example", { state: "in_sequence", step: 1 });
    await addProspect("approvalprep", "x@acme.example", { state: "new" });
    await suppress(env.DB, "X@Acme.example", "asked to stop", "test");
    expect(await isSuppressed(env.DB, "x@acme.example")).toBe(true);
    const states = await env.DB.prepare(`SELECT state FROM outreach_prospects WHERE email = 'x@acme.example'`).all<any>();
    expect(states.results.map((r) => r.state)).toEqual(["suppressed", "suppressed"]);
  });

  it("a domain on the list suppresses every address at it", async () => {
    await env.DB.prepare(`INSERT INTO outreach_suppression (value, kind, reason, source, created_at) VALUES ('acme.example','domain','test','test',0)`).run();
    expect(await isSuppressed(env.DB, "anyone@acme.example")).toBe(true);
  });

  it("the link works WITHOUT a session and suppresses at once", async () => {
    await addProspect("time2read", "y@acme.example", { unsub_token: "pubtoken123" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://boss.test/api/outreach/u/pubtoken123"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("unsubscribed");
    expect(await isSuppressed(env.DB, "y@acme.example")).toBe(true);
  });

  it("one-click POST works too, and nothing else under /api/outreach is public", async () => {
    await addProspect("time2read", "z@acme.example", { unsub_token: "pubtoken456" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://boss.test/api/outreach/u/pubtoken456", { method: "POST" }), env, ctx);
    const desk = await worker.fetch(new Request("https://boss.test/api/outreach"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(await isSuppressed(env.DB, "z@acme.example")).toBe(true);
    expect(desk.status).toBe(401);
  });
});

describe("the tick", () => {
  beforeEach(reset);

  it("sends to a business prospect only when live, proven and addressed — and never past the cap", async () => {
    await readyWithAddress("time2read");
    for (let i = 0; i < 15; i++) await addProspect("time2read", `p${i}@school${i}.example`);
    const g = fakeGmail();
    const r = await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
    const real = g.sends.filter((s) => !s.to.startsWith("cryptoclearr"));
    expect(real.length).toBeGreaterThan(0);
    expect(real.length).toBeLessThanOrEqual(10);
    expect(real.every((s) => s.from === "st@time-2-read.com")).toBe(true);
    expect(real[0]!.raw).toMatch(/List-Unsubscribe/);
    expect(r.sent).toBe(real.length);
    // Run the rest of the day: the cap holds at 10.
    for (let h = 1; h <= 7; h++) await runOutreachTick(await tickEnv(), TUESDAY_10AM + h * 3_600_000, g.fetchImpl);
    expect(g.sends.filter((s) => !s.to.startsWith("cryptoclearr")).length).toBe(10);
  });

  it("the kill switch stops every send", async () => {
    await readyWithAddress("time2read");
    await addProspect("time2read", "k@school.example");
    await env.DB.prepare(`UPDATE outreach_settings SET value = 'on' WHERE key = 'kill_switch'`).run();
    const g = fakeGmail();
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
    expect(g.sends).toHaveLength(0);
  });

  it("test-only writes to no business, and no postal address means no business email", async () => {
    await readyWithAddress("time2read");
    await addProspect("time2read", "t@school.example");
    await env.DB.prepare(`UPDATE outreach_settings SET value = 'test_only' WHERE key = 'sending'`).run();
    const g = fakeGmail();
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
    expect(g.sends).toHaveLength(0);

    await env.DB.prepare(`UPDATE outreach_settings SET value = 'live' WHERE key = 'sending'`).run();
    await env.DB.prepare(`UPDATE outreach_domain_state SET postal_address = NULL WHERE business_key = 'time2read'`).run();
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
    expect(g.sends).toHaveLength(0);
  });

  it("an unproven route sends nothing to a business; a send-as alias is proven to the test inbox first", async () => {
    await env.DB.prepare(`UPDATE outreach_settings SET value = 'live' WHERE key = 'sending'`).run();
    await addProspect("uscisexam", "doc@clinic.example");
    await env.DB.prepare(`INSERT INTO outreach_domain_state (business_key, postal_address, updated_at) VALUES ('uscisexam','100 Main St, Houston, TX 77002',0)`).run();
    const none = fakeGmail();
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, none.fetchImpl);
    expect(none.sends.filter((s) => s.from === "hello@uscisexam.com")).toHaveLength(0);

    const alias = fakeGmail({ sendAs: ["hello@uscisexam.com"] });
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, alias.fetchImpl);
    const proof = alias.sends.find((s) => s.from === "hello@uscisexam.com");
    expect(proof?.to).toBe("cryptoclearr@gmail.com");
    expect((await row<any>(`SELECT route_state FROM outreach_domain_state WHERE business_key = 'uscisexam'`))?.route_state).toBe("ready");
  });

  it("stops on any reply, suppresses an unsubscribe even with the kill switch on, and cards an interested one", async () => {
    await readyWithAddress("time2read");
    await addProspect("time2read", "stop@school.example", { state: "in_sequence", step: 1, thread_id: "th-stop", next_due_at: TUESDAY_10AM });
    await addProspect("time2read", "yes@school.example", { state: "in_sequence", step: 1, thread_id: "th-yes", next_due_at: TUESDAY_10AM });
    await env.DB.prepare(`UPDATE outreach_settings SET value = 'on' WHERE key = 'kill_switch'`).run();
    const g = fakeGmail({ inbound: [
      { id: "r1", threadId: "th-stop", from: "Stop <stop@school.example>", subject: "Re: x", body: "Please take us off your list." },
      { id: "r2", threadId: "th-yes", from: "Yes <yes@school.example>", subject: "Re: x", body: "Yes, send us the code!" },
    ] });
    const r = await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
    expect(r.replies).toBe(2);
    expect(await isSuppressed(env.DB, "stop@school.example")).toBe(true);
    const yes = await row<any>(`SELECT state, next_due_at FROM outreach_prospects WHERE email = 'yes@school.example'`);
    expect(yes.state).toBe("replied");
    expect(yes.next_due_at).toBeNull();
    const reply = await row<any>(`SELECT classification, approval_id FROM outreach_replies WHERE gmail_message_id = 'r2'`);
    expect(reply.classification).toBe("interested");
    expect(reply.approval_id).toBeTruthy();
    expect(await row<any>(`SELECT code FROM referral_partners WHERE email = 'yes@school.example'`)).toBeTruthy();
    expect(g.sends).toHaveLength(0);
  });

  it("a complaint pauses the domain on the same tick, shown with its reason", async () => {
    await readyWithAddress("time2read");
    await addProspect("time2read", "angry@school.example", { state: "in_sequence", step: 1, thread_id: "th-angry" });
    await env.DB.prepare(`INSERT INTO outreach_sends (id, business_key, prospect_id, to_email, step, is_test, status, sent_at) VALUES ('s1','time2read','opr_time2read_angry@school.example','angry@school.example',0,0,'sent',?)`).bind(TUESDAY_10AM - DAY_MS).run();
    const g = fakeGmail({ inbound: [{ id: "c1", threadId: "th-angry", from: "angry@school.example", subject: "Re: x", body: "Stop spamming me, reported." }] });
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
    const st = await row<any>(`SELECT paused_at, pause_reason FROM outreach_domain_state WHERE business_key = 'time2read'`);
    expect(st.paused_at).toBeTruthy();
    expect(st.pause_reason).toMatch(/complaint/);
    const desk = await apiJson("/api/outreach");
    expect(desk.body.data.businesses.find((b: any) => b.key === "time2read").pause_reason).toMatch(/complaint/);
  });

  it("a hard bounce suppresses the address and counts toward the 3% pause", async () => {
    await readyWithAddress("time2read");
    await addProspect("time2read", "gone@school.example", { state: "in_sequence", step: 1, thread_id: "th-gone" });
    await env.DB.prepare(`INSERT INTO outreach_sends (id, business_key, prospect_id, to_email, step, is_test, status, sent_at) VALUES ('s2','time2read','opr_time2read_gone@school.example','gone@school.example',0,0,'sent',?)`).bind(TUESDAY_10AM - DAY_MS).run();
    const g = fakeGmail({ inbound: [{ id: "b1", threadId: "th-gone", from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)", body: "Final-Recipient: rfc822; gone@school.example" }] });
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
    expect(await isSuppressed(env.DB, "gone@school.example")).toBe(true);
    expect((await row<any>(`SELECT status FROM outreach_sends WHERE id = 's2'`)).status).toBe("bounced");
    expect((await row<any>(`SELECT pause_reason FROM outreach_domain_state WHERE business_key = 'time2read'`)).pause_reason).toMatch(/bounce rate/);
  });
});

describe("the desk is read-only", () => {
  beforeEach(reset);

  it("GET /outreach writes nothing — the roster calls it on every load", async () => {
    const before = await row<any>(`SELECT COUNT(*) AS n FROM outreach_domain_state`);
    const res = await apiJson("/api/outreach");
    expect(res.status).toBe(200);
    expect(res.body.data.businesses).toHaveLength(BUSINESSES.length);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM outreach_domain_state`)).n).toBe(before.n);
  });
});

describe("referral ledger", () => {
  beforeEach(reset);

  it("pays 30% of the first year only, and records each order once", async () => {
    const p = await ensurePartner(env.DB, T2R, { id: "opr_x", email: "partner@school.example", org_name: "School" }, TUESDAY_10AM);
    expect(p.code).toMatch(/^T2R-/);
    const sept = Date.UTC(2026, 8, 10);
    expect((await recordConversion(env.DB, { code: p.code, order_ref: "o1", customer_ref: "c1", amount_cents: 1000, occurred_at: sept })).recorded).toBe(true);
    expect((await recordConversion(env.DB, { code: p.code, order_ref: "o1", customer_ref: "c1", amount_cents: 1000, occurred_at: sept })).recorded).toBe(false);
    // The same customer more than a year later earns nothing.
    await recordConversion(env.DB, { code: p.code, order_ref: "o2", customer_ref: "c1", amount_cents: 1000, occurred_at: Date.UTC(2027, 8, 20) });
    await computePeriod(env.DB, "2026-09", TUESDAY_10AM);
    await computePeriod(env.DB, "2027-09", TUESDAY_10AM);
    const rows = await env.DB.prepare(`SELECT period, amount_cents FROM referral_payouts ORDER BY period`).all<any>();
    expect(rows.results).toEqual([{ period: "2026-09", amount_cents: 300 }]);
  });
});

describe("outreach rules (owner, 9 Oct 2026)", () => {
  const HGO = "RULE (owner, 9 Oct 2026): heygetonmylevel.com is NEVER an outreach target. It is a free bonus for Time2Read subscribers, not a product sold on its own — no business, no sender, no domain setup, no referral code.";
  const WP = "RULE (owner, 9 Oct 2026): outreach never sends through, or needs a permission in, West Peek's Google Workspace (westpeek.ventures). The side businesses are Spry's.";

  it("heygetonmylevel is never an outreach business, sender or domain", () => {
    const hit = (s: string) => /heygetonmylevel/i.test(s);
    for (const b of BUSINESSES) {
      expect(hit(b.key) || hit(b.domain) || hit(b.sender) || hit(b.brand) || hit(b.offerUrl), `${HGO} Found: ${b.key}`).toBe(false);
      for (const step of b.steps) expect(hit(step.body) || hit(step.subject), `${HGO} Found in ${b.key}'s email.`).toBe(false);
    }
    expect(businessByKey("heygetonmylevel"), HGO).toBeUndefined();
    expect(makeCode("heygetonmylevel").startsWith("HGO-"), `${HGO} referrals.ts still carries its code prefix.`).toBe(false);
    expect(/heygetonmylevel/i.test(REFERRALS_SOURCE), `${HGO} referrals.ts names it.`).toBe(false);
    // The only place the catalog may name it is the never-list itself.
    const mentions = CATALOG_SOURCE.split("\n").filter((l) => /heygetonmylevel/i.test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l));
    expect(mentions, HGO).toEqual(['export const NEVER_OUTREACH_DOMAINS = ["heygetonmylevel.com"] as const;']);
    // Put it back and the send-time guard and the setup guard both refuse it.
    const smuggled = { ...BUSINESSES[0]!, key: "heygetonmylevel", domain: "heygetonmylevel.com", sender: "hello@heygetonmylevel.com" };
    expect(() => assertSenderAllowed(smuggled), HGO).toThrow(/never an outreach business/);
    expect(() => assertOutreachSetupTarget({ admin: OUTREACH_MAILBOX, mailbox: OUTREACH_MAILBOX, domains: ["heygetonmylevel.com"] }), HGO).toThrow(/never an outreach domain/);
  });

  it("the outreach sender never impersonates or sends from West Peek's Workspace", () => {
    expect(assertOutreachMailboxAllowed(OUTREACH_MAILBOX), WP).toBe(OUTREACH_MAILBOX);
    for (const sub of ["sequoia@westpeek.ventures", "ST@WestPeek.Ventures", "x@mail.westpeek.ventures"]) {
      expect(() => assertOutreachMailboxAllowed(sub), WP).toThrow(/West Peek's Google Workspace/);
    }
    for (const b of BUSINESSES) {
      expect(/westpeek\.ventures/i.test(b.sender) || /westpeek\.ventures/i.test(b.domain), `${WP} ${b.key}`).toBe(false);
      expect(() => assertSenderAllowed({ ...b, sender: "hello@westpeek.ventures" }), WP).toThrow(/Refused/);
    }
    // The token mint checks the subject before any key is used, and impersonates only the pinned mailbox.
    const mint = GMAIL_SOURCE.slice(GMAIL_SOURCE.indexOf("async function mintToken"));
    expect(mint.indexOf("assertOutreachMailboxAllowed(OUTREACH_MAILBOX)"), WP).toBeGreaterThan(-1);
    expect(mint.indexOf("assertOutreachMailboxAllowed(OUTREACH_MAILBOX)") < mint.indexOf("importKey"), WP).toBe(true);
  });

  it("the domain setup script refuses to run against westpeek.ventures", () => {
    expect(() => assertOutreachSetupTarget({ admin: "admin@westpeek.ventures", mailbox: OUTREACH_MAILBOX, domains: [] }), WP).toThrow(/West Peek/);
    expect(() => assertOutreachSetupTarget({ admin: OUTREACH_MAILBOX, mailbox: "st@westpeek.ventures", domains: [] }), WP).toThrow(/West Peek/);
    expect(() => assertOutreachSetupTarget({ admin: OUTREACH_MAILBOX, mailbox: OUTREACH_MAILBOX, domains: ["westpeek.ventures"] }), WP).toThrow(/West Peek/);
    expect(() => assertOutreachSetupTarget({ admin: OUTREACH_MAILBOX, mailbox: OUTREACH_MAILBOX, domains: [], workspaceDomains: ["time-2-read.com", "westpeek.ventures"] }), WP).toThrow(/West Peek/);
    expect(() => assertOutreachSetupTarget({ admin: OUTREACH_MAILBOX, mailbox: OUTREACH_MAILBOX, domains: BUSINESSES.flatMap((b) => [b.domain, b.sender]) }), WP).not.toThrow();
    // Wired: the guard runs before the service account is read, and again on the Workspace reached.
    const guard = DOMAINS_SCRIPT.indexOf("assertOutreachSetupTarget({ admin: ADMIN");
    expect(guard, WP).toBeGreaterThan(-1);
    expect(guard < DOMAINS_SCRIPT.indexOf("process.env.GSC_SERVICE_ACCOUNT_JSON"), WP).toBe(true);
    expect(/workspaceDomains:/.test(DOMAINS_SCRIPT), WP).toBe(true);
  });

  it("both rules are written where everyone reads them", () => {
    for (const [name, doc] of [["CLAUDE.md", CLAUDE_MD], ["docs/boss/OPERATIONS.md", OPERATIONS_MD]] as const) {
      expect(/heygetonmylevel\.com is NEVER an outreach target/i.test(doc), `${HGO} Missing from ${name}.`).toBe(true);
      expect(/never sends? through, or needs? (a )?permissions? in, West Peek's Google Workspace/i.test(doc), `${WP} Missing from ${name}.`).toBe(true);
    }
    expect(/^## Outreach rules$/m.test(CLAUDE_MD), "CLAUDE.md carries an \"Outreach rules\" section.").toBe(true);
  });
});

describe("the owner's private postal address never enters the repo (owner, 9 Oct 2026)", () => {
  // Runtime data only (Team → Outreach, outreach_domain_state.postal_address). The repo is public.
  const sources = import.meta.glob(
    ["../../**/*.{ts,tsx,mjs,js,cjs,json,md,sql,toml,yml,yaml,html,css,txt,sh}", "!../../node_modules/**", "!../../dist/**", "!../../.claude/**", "!../../test-results/**", "!../../.wrangler/**", "!../../backups/**"],
    { query: "?raw", import: "default", eager: true },
  ) as Record<string, string>;
  it("no file carries the street name or the ZIP", () => {
    const files = Object.keys(sources);
    expect(files.length, "the scan reached the repo").toBeGreaterThan(200);
    const needles = [["Fox", "Hunt"].join(" "), ["381", "15"].join("")];
    const hits = files.filter((f) => needles.some((n) => sources[f]!.includes(n)));
    expect(hits, "RULE (owner, 9 Oct 2026): the outreach postal address is private runtime data, never a git file.").toEqual([]);
  });
});
