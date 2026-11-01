import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson, row } from "./helpers";
import { dailyCap, pauseReason, refusal, DAY_MS } from "../../src/worker/boss/outreach/brakes";
import { bouncedAddress, classifyReply } from "../../src/worker/boss/outreach/classify";
import { composeEmail, footerCompany, UMBRELLA_COMPANY, UMBRELLA_CONTACT } from "../../src/worker/boss/outreach/compose";
import { isSuppressed, suppress, isBusinessEmail } from "../../src/worker/boss/outreach/suppression";
import {
  GUIDES_SENDER, NEURO_QUALIFY, assertOutreachMailboxAllowed, assertOutreachSetupTarget, assertSenderAllowed, businessByKey, BUSINESSES, OUTREACH_MAILBOX,
} from "../../src/worker/boss/outreach/catalog";
import CATALOG_SOURCE from "../../src/worker/boss/outreach/catalog.ts?raw";
const OUTREACH_SOURCES = import.meta.glob("../../src/worker/boss/outreach/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
import REFERRALS_SOURCE from "../../src/worker/boss/outreach/referrals.ts?raw";
import GMAIL_SOURCE from "../../src/worker/boss/outreach/gmail.ts?raw";
import DOMAINS_SCRIPT from "../../scripts/outreach/domains.mjs?raw";
import CLAUDE_MD from "../../CLAUDE.md?raw";
import OPERATIONS_MD from "../../docs/boss/OPERATIONS.md?raw";
import { crawlCandidates, pickEmail, parseOverpass, parseDirectory, readDirectories } from "../../src/worker/boss/outreach/lists";
import { METROS, NATIONAL_METROS, PI_NO_OUTREACH_STATES, metrosFor, outreachStateBlock } from "../../src/worker/boss/outreach/catalog";
import { isSeatHolder, normaliseHolderDomain, parseSeat, pitchFor, readSeat, seatEndMonth, SEAT_OPEN } from "../../src/worker/boss/outreach/seat";
import { runOutreachTick } from "../../src/worker/boss/outreach/engine";
import { mailAuthGaps } from "../../src/worker/boss/outreach/mailauth";
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
const GOOD_DKIM = `v=DKIM1; k=rsa; p=${"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA".repeat(4)}`;
/** DNS that authenticates every domain, unless a test overrides a name (or says the lookup fails). */
function goodDns(name: string): string[] {
  if (name.startsWith("google._domainkey.")) return [GOOD_DKIM];
  if (name.startsWith("_dmarc.")) return ["v=DMARC1; p=none;"];
  return ["v=spf1 include:_spf.google.com ~all"];
}

function fakeGmail(opts: { sendAs?: string[]; inbound?: Inbound[]; dns?: Record<string, string[]>; dnsFails?: boolean } = {}) {
  const sends: { from: string; to: string; raw: string; threadId?: string }[] = [];
  let n = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "ya29.fake" });
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      if (opts.dnsFails) return new Response("upstream down", { status: 502 });
      const name = decodeURIComponent(/name=([^&]+)/.exec(url)?.[1] ?? "");
      const data = opts.dns?.[name] ?? goodDns(name);
      return Response.json({ Status: 0, Answer: data.map((d) => ({ name, type: 16, data: `"${d}"` })) });
    }
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
    `INSERT INTO outreach_domain_state (business_key, route_state, route_sender, postal_address, updated_at) VALUES (?, 'ready', ?, '100 Main St, Suite 1, Houston, TX 77002', ?)
     ON CONFLICT(business_key) DO UPDATE SET route_state = 'ready', route_sender = excluded.route_sender, postal_address = excluded.postal_address`,
  ).bind(key, businessByKey(key)!.sender, TUESDAY_10AM).run();
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

  it("pauses on a bounce rate OVER 3% once 20 sends are in the window, on 3 bounces before that, and on any single complaint", () => {
    expect(pauseReason({ sent: 100, bounced: 3, complaints: 0 })).toBeNull();
    expect(pauseReason({ sent: 100, bounced: 4, complaints: 0 })).toMatch(/bounce rate 4\.0%/);
    expect(pauseReason({ sent: 20, bounced: 1, complaints: 0 })).toMatch(/bounce rate 5\.0%/);
    // 13 Oct 2026: 1 of 5 and 1 of 2 had paused two guides; a rate on that sample is noise.
    expect(pauseReason({ sent: 5, bounced: 1, complaints: 0 })).toBeNull();
    expect(pauseReason({ sent: 2, bounced: 1, complaints: 0 })).toBeNull();
    expect(pauseReason({ sent: 19, bounced: 2, complaints: 0 })).toBeNull();
    expect(pauseReason({ sent: 4, bounced: 3, complaints: 0 })).toMatch(/3 bounces in 4 sends/);
    expect(pauseReason({ sent: 1000, bounced: 0, complaints: 1 })).toMatch(/complaint/);
    expect(pauseReason({ sent: 0, bounced: 0, complaints: 0 })).toBeNull();
  });

  it("refuses by the kill switch, the flag, the route, the postal address and the pause", () => {
    const go = { killSwitch: false, sending: "live" as const, routeReady: true, hasPostalAddress: true, pausedReason: null, mailAuthMissing: null, isTestRecipient: false };
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

  it("refuses a live send when the sender's domain lacks SPF, Google DKIM or DMARC (9 Oct 2026 DMARC blocks)", () => {
    const go = { killSwitch: false, sending: "live" as const, routeReady: true, hasPostalAddress: true, pausedReason: null, mailAuthMissing: null, isTestRecipient: false };
    expect(refusal({ ...go, mailAuthMissing: "x.com mail authentication is incomplete: no DMARC record." })).toMatch(/authentication/);
    // A test send still goes, so a fixed domain can be proven against the test inbox.
    expect(refusal({ ...go, mailAuthMissing: "x.com mail authentication is incomplete.", isTestRecipient: true })).toBeNull();
    const spf = ["v=spf1 include:_spf.google.com ~all"];
    expect(mailAuthGaps({ root: spf, dkim: [GOOD_DKIM], dmarc: ["v=DMARC1; p=reject;"] })).toEqual([]);
    // The exact shape Gmail rejected on aplayermode.com: a revoked (empty) DKIM key under DMARC p=reject.
    expect(mailAuthGaps({ root: spf, dkim: ["v=DKIM1; p="], dmarc: ["v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;"] })).toEqual(["the Google DKIM key at google._domainkey is empty or revoked"]);
    expect(mailAuthGaps({ root: spf, dkim: [], dmarc: [] })).toEqual(["no Google DKIM key at google._domainkey", "no DMARC record"]);
    expect(mailAuthGaps({ root: [], dkim: [GOOD_DKIM], dmarc: ["v=DMARC1; p=none;"] })).toEqual(["no SPF record"]);
    expect(mailAuthGaps({ root: ["v=spf1 include:mailgun.org ~all"], dkim: [GOOD_DKIM], dmarc: ["v=DMARC1; p=none;"] })).toEqual(["SPF does not include _spf.google.com"]);
    expect(mailAuthGaps({ root: [...spf, "v=spf1 -all"], dkim: [GOOD_DKIM], dmarc: ["v=DMARC1; p=none;"] })).toEqual(["more than one SPF record"]);
  });

  it("never sends from West Peek, spry.vc or her own domain, nor off the business's domain", () => {
    expect(() => assertSenderAllowed({ ...T2R, sender: "monique@spry.vc" })).toThrow(/never send/);
    expect(() => assertSenderAllowed({ ...T2R, sender: "x@westpeek.ventures" })).toThrow(/never send/);
    expect(() => assertSenderAllowed({ ...T2R, sender: "hello@uscisexam.com" })).toThrow(/own domain/);
    for (const b of BUSINESSES) expect(() => assertSenderAllowed(b)).not.toThrow();
    expect(BUSINESSES.some((b) => /how-?we-?know/.test(b.domain))).toBe(false);
  });

  it("every guide sends from the one umbrella address; the side businesses keep their own (owner, 13 Oct 2026)", () => {
    const guides = BUSINESSES.filter((b) => b.kind === "local_guide");
    expect(guides.length).toBe(6);
    expect(GUIDES_SENDER).toBe("hello@theindustryguides.com");
    expect([...new Set(guides.map((b) => b.sender))]).toEqual(["hello@theindustryguides.com"]);
    // The retired per-site aliases are never a sender again.
    for (const old of ["uscisexam.com", "dentistryguides.com", "hormonesivhair.com", "neuroevalguides.com", "theaccidentguides.com", "memphisseniorcarehomes.com"]) {
      expect(BUSINESSES.some((b) => b.sender === `hello@${old}`), old).toBe(false);
    }
    const uscis = businessByKey("uscisexam")!;
    expect(() => assertSenderAllowed({ ...uscis, sender: "hello@uscisexam.com" })).toThrow(/every guide sends from/);
    expect(Object.fromEntries(BUSINESSES.filter((b) => b.kind !== "local_guide").map((b) => [b.key, b.sender]))).toEqual({
      time2read: "st@time-2-read.com", time2read_groups: "st@time-2-read.com", aplayermode: "hello@aplayermode.com", approvalprep: "hello@approvalprep.com", weddingchecklist: "hello@weddingchecklistpdf.com",
    });
    // Every guide email answers to the umbrella address; a side business's does not.
    const m = composeEmail({ business: uscis, step: 0, to: "a@acme.example", org: "Acme", metro: "Houston", unsubToken: "t", postalAddress: "PO Box 1, Houston, TX 77002" });
    expect(m.raw).toMatch(/^From: USCIS Exam Guides <hello@theindustryguides\.com>\r$/m);
    expect(m.raw).toMatch(/^Reply-To: hello@theindustryguides\.com\r$/m);
    const t = composeEmail({ business: T2R, step: 0, to: "a@acme.example", org: "Acme", metro: "Houston", unsubToken: "t", postalAddress: "PO Box 1, Houston, TX 77002" });
    expect(t.raw).not.toMatch(/^Reply-To:/m);
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

  it("every Industry Guides email names The Industry Guides and the address in both footers (owner, 12 Oct 2026)", () => {
    const addr = "PO Box 1, Houston, TX 77002";
    const guides = BUSINESSES.filter((b) => b.kind === "local_guide");
    // Hard-fail on zero, and pin the six properties the owner named exactly (Memphis Senior Care
    // Homes joined 13 Oct 2026).
    expect(guides.length).toBe(6);
    expect(guides.map((b) => b.brand).sort()).toEqual(
      ["Hormone Optimization Guides", "Memphis Senior Care Homes", "Neuro Evaluation Guides", "The Accident Guides", "The Dentistry Guides", "USCIS Exam Guides"],
    );
    expect(UMBRELLA_COMPANY).toBe("The Industry Guides");
    expect(UMBRELLA_CONTACT).toBe("hello@theindustryguides.com");
    // The name and the address each live in ONE constant, in catalog.ts (the guides' sender uses the
    // address since 13 Oct 2026): no second copy anywhere in the outreach source.
    expect(Object.keys(OUTREACH_SOURCES).some((f) => f.endsWith("/catalog.ts"))).toBe(true);
    for (const [file, src] of Object.entries(OUTREACH_SOURCES)) {
      const copies = (src.match(/The Industry Guides/g) ?? []).length;
      expect(copies, file).toBe(file.endsWith("/catalog.ts") ? 1 : 0); // the constant
      expect((src.match(/hello@theindustryguides\.com/g) ?? []).length, file).toBe(file.endsWith("/catalog.ts") ? 1 : 0);
    }
    expect(BUSINESSES.length).toBeGreaterThan(0);
    for (const b of BUSINESSES) {
      // Every step a business HAS: three emails, or two for Time-2-Read groups (one follow-up, 31 Oct 2026).
      expect(b.steps.length, b.key).toBe(b.key === "time2read_groups" ? 2 : 3);
      for (const step of [...b.steps.keys()] as Array<0 | 1 | 2>) {
        const m = composeEmail({ business: b, step, to: "a@acme.example", org: "Acme", metro: "Houston", unsubToken: "tok123", postalAddress: addr, firstSubject: "Hello", groupCode: "ACME15K7Q" });
        const plainFooter = m.body.slice(m.body.lastIndexOf("\n--\n"));
        const htmlFooter = /<p style="([^"]*)"[^>]*>([\s\S]*?)<\/p>\s*<\/body>/.exec(m.html)![2]!;
        // The guides are signed by S.L. Taylor over the umbrella company and the guide's domain (owner,
        // 16 Oct 2026); every other business stays the brand's own team, exactly as before.
        const signature = b.kind === "local_guide" ? `\n\nS.L. Taylor\nThe Industry Guides\n${b.domain}\n\n--\n` : `\n\n— The ${b.brand} team\n${b.domain}\n\n--\n`;
        expect(m.body, b.key).toContain(signature);
        expect(m.body.indexOf(signature), b.key).toBe(m.body.lastIndexOf("\n\n--\n") - signature.length + "\n\n--\n".length);
        if (b.kind === "local_guide") expect(m.body, b.key).not.toContain(`The ${b.brand} team`);
        expect(m.raw).toMatch(new RegExp(`^From: ${b.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} <${b.sender}>`, "m"));
        expect(plainFooter).toContain("https://boss.sequoiataylor.com/api/boss/outreach/u/tok123");
        expect(htmlFooter).toContain('href="https://boss.sequoiataylor.com/api/boss/outreach/u/tok123"');
        if (b.kind === "local_guide") {
          expect(footerCompany(b), b.key).toBe("The Industry Guides");
          expect(plainFooter.split("\n"), b.key).toContain(`The Industry Guides, ${addr} · hello@theindustryguides.com`);
          expect(plainFooter.split("\n"), b.key).toContain(`${b.brand} is a property of The Industry Guides.`);
          expect(htmlFooter, b.key).toContain(`The Industry Guides, ${addr} · hello@theindustryguides.com`);
          expect(htmlFooter, b.key).toContain(`${b.brand} is a property of The Industry Guides.`);
          // Named once as a property, never as the company on the address line.
          expect(plainFooter, b.key).not.toContain(`${b.brand}, ${addr}`);
        } else {
          // Spry's other businesses are not Industry Guides properties.
          expect(m.body + m.html, b.key).not.toContain("The Industry Guides");
          expect(m.body + m.html, b.key).not.toContain("hello@theindustryguides.com");
          expect(plainFooter.split("\n"), b.key).toContain(`${b.brand}, ${addr}`);
        }
      }
    }
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
    const history = await env.DB.prepare(`SELECT object_key, employee_id FROM boss_sent_mail WHERE to_addr = ?`).bind(real[0]!.to).first<any>();
    expect(history.employee_id).toBe("emp_relationship");
    expect(JSON.parse(await (await env.VAULT.get(history.object_key))!.text()).raw).toBe(real[0]!.raw);
    // Run the rest of the day: the cap holds at 10.
    for (let h = 1; h <= 7; h++) await runOutreachTick(await tickEnv(), TUESDAY_10AM + h * 3_600_000, g.fetchImpl);
    expect(g.sends.filter((s) => !s.to.startsWith("cryptoclearr")).length).toBe(10);
  });

  it("a domain without SPF, Google DKIM and DMARC sends nothing live — and a failed DNS lookup fails closed", async () => {
    await readyWithAddress("time2read");
    await addProspect("time2read", "a@school.example");
    const noDkim = fakeGmail({ dns: { "google._domainkey.time-2-read.com": ["v=DKIM1; p="] } });
    const r = await runOutreachTick(await tickEnv(), TUESDAY_10AM, noDkim.fetchImpl);
    expect(noDkim.sends.filter((s) => !s.to.startsWith("cryptoclearr"))).toHaveLength(0);
    expect(r.refused.time2read).toMatch(/time-2-read\.com mail authentication is incomplete: the Google DKIM key/);
    const down = fakeGmail({ dnsFails: true });
    const r2 = await runOutreachTick(await tickEnv(), TUESDAY_10AM, down.fetchImpl);
    expect(down.sends.filter((s) => !s.to.startsWith("cryptoclearr"))).toHaveLength(0);
    expect(r2.refused.time2read).toMatch(/could not be checked/);
    const ok = fakeGmail();
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, ok.fetchImpl);
    expect(ok.sends.filter((s) => !s.to.startsWith("cryptoclearr")).length).toBe(1);
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

  /*
   * 16 Oct 2026: Memphis Senior Care Homes joined the catalog route-proven but with no postal address,
   * and the tick refused it every hour for two days with nobody told. A business added later inherits
   * the address the others share; when there is none to inherit, it is a NAMED STOP on Today.
   */
  async function withNewBusiness(run: (key: string) => Promise<void>) {
    const fresh = { ...T2R, key: "newbiz_test", brand: "New Biz Test" };
    BUSINESSES.push(fresh);
    try {
      await env.DB.prepare(
        `INSERT INTO outreach_domain_state (business_key, route_state, route_sender, updated_at) VALUES (?, 'ready', ?, ?)`,
      ).bind(fresh.key, fresh.sender, TUESDAY_10AM).run();
      await addProspect(fresh.key, "head@newschool.example");
      await run(fresh.key);
    } finally {
      BUSINESSES.splice(BUSINESSES.indexOf(fresh), 1);
    }
  }

  it("a business added with no postal address inherits the one the others share, and sends", async () => {
    await readyWithAddress("time2read");
    await withNewBusiness(async (key) => {
      const g = fakeGmail();
      const r = await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
      const mine = g.sends.filter((s) => s.to === "head@newschool.example");
      expect(mine, "the new business sent").toHaveLength(1);
      const parts = [...mine[0]!.raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([^-]+?)\r\n--/g)]
        .map((m) => decodeURIComponent(escape(atob(m[1]!.replace(/\s/g, "")))));
      expect(parts.length).toBeGreaterThan(0);
      for (const part of parts) expect(part).toContain("100 Main St, Suite 1, Houston, TX 77002");
      expect(r.refused[key]).toBeUndefined();
      expect(r.stops[key]).toBeUndefined();
      // Read at send time, never copied onto the row; the desk says it is inherited.
      expect(await row(`SELECT postal_address, stop_at FROM outreach_domain_state WHERE business_key = ?`, key))
        .toMatchObject({ postal_address: null, stop_at: null });
      const desk = await apiJson<any>("/api/outreach");
      expect(desk.body.data.businesses.find((b: any) => b.key === key)).toMatchObject({ postal_address_set: true, postal_address_inherited: true, stop: null });
    });
  });

  it("a route-ready business with no address to inherit is a NAMED STOP on Today, not a silent 0", async () => {
    await readyWithAddress("time2read");
    await env.DB.prepare(`UPDATE outreach_domain_state SET postal_address = NULL`).run();
    await withNewBusiness(async (key) => {
      const g = fakeGmail();
      const r = await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
      expect(g.sends.filter((s) => s.to === "head@newschool.example")).toHaveLength(0);
      const text = "NAMED STOP: New Biz Test outreach is route-ready but sent nothing in the sending window: "
        + "No postal address is set for this business, and CAN-SPAM requires one in every email. "
        + `Set the CAN-SPAM address on Team → Outreach (PUT /api/boss/outreach/business/${key}).`;
      expect(r.stops[key]).toBe(text);
      // The owner's surface: the stop is on Today's critical alerts until it clears.
      const today = await apiJson<any>(`/api/today?date=${new Date().toISOString().slice(0, 10)}`);
      const block = (today.body.data.blocks as any[]).find((b) => b.key === "critical_alerts");
      expect((block?.content?.alerts ?? []).map((a: any) => a.text)).toContain(text);
      // Setting the address clears it; the next tick sends.
      await apiJson(`/api/outreach/business/${key}`, { method: "PUT", body: { postal_address: "200 Elm St, Suite 2, Austin, TX 78701" } });
      expect(await row(`SELECT stop_at FROM outreach_domain_state WHERE business_key = ?`, key)).toMatchObject({ stop_at: null });
      const r2 = await runOutreachTick(await tickEnv(), TUESDAY_10AM + 3_600_000, g.fetchImpl);
      expect(r2.stops[key]).toBeUndefined();
      expect(g.sends.filter((s) => s.to === "head@newschool.example")).toHaveLength(1);
    });
  });

  it("an unproven route sends nothing to a business; the guides' one sender is proven ONCE and all six share it", async () => {
    await env.DB.prepare(`UPDATE outreach_settings SET value = 'live' WHERE key = 'sending'`).run();
    await addProspect("uscisexam", "doc@clinic.example");
    await env.DB.prepare(`INSERT INTO outreach_domain_state (business_key, postal_address, updated_at) VALUES ('uscisexam','100 Main St, Houston, TX 77002',0)`).run();
    // A row proven for the OLD per-site alias (route_sender NULL or the retired alias) is not ready.
    await env.DB.prepare(`INSERT INTO outreach_domain_state (business_key, route_state, route_sender, postal_address, updated_at) VALUES ('dentistryguides','ready','hello@dentistryguides.com','100 Main St, Houston, TX 77002',0)`).run();
    await addProspect("dentistryguides", "dds@smile.example");
    const none = fakeGmail({ sendAs: ["hello@uscisexam.com", "hello@dentistryguides.com"] });
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, none.fetchImpl);
    // Nothing From a guide, a retired alias, or to a business (time2read's own sender may prove itself).
    expect(none.sends.filter((s) => s.from !== "st@time-2-read.com")).toHaveLength(0);
    expect(none.sends.filter((s) => s.to !== "cryptoclearr@gmail.com")).toHaveLength(0);
    expect((await row<any>(`SELECT route_state FROM outreach_domain_state WHERE business_key = 'dentistryguides'`))?.route_state).toBe("awaiting_route");

    const alias = fakeGmail({ sendAs: ["hello@theindustryguides.com"] });
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, alias.fetchImpl);
    const proofs = alias.sends.filter((s) => s.to === "cryptoclearr@gmail.com");
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.from).toBe("hello@theindustryguides.com");
    const guides = BUSINESSES.filter((b) => b.kind === "local_guide").map((b) => b.key);
    const st = await env.DB.prepare(`SELECT business_key, route_state, route_sender FROM outreach_domain_state`).all<any>();
    for (const k of guides) {
      const r = (st.results ?? []).find((x: any) => x.business_key === k);
      expect(r?.route_state, k).toBe("ready");
      expect(r?.route_sender, k).toBe("hello@theindustryguides.com");
    }
    // The side businesses are not swept along: their own senders are not in the send-as list.
    expect((st.results ?? []).find((x: any) => x.business_key === "aplayermode")?.route_state).toBe("awaiting_route");
    // A later tick sends no second proof.
    const again = fakeGmail({ sendAs: ["hello@theindustryguides.com"] });
    await runOutreachTick(await tickEnv(), TUESDAY_10AM + 3_600_000, again.fetchImpl);
    expect(again.sends.filter((s) => s.to === "cryptoclearr@gmail.com")).toHaveLength(0);
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
    // One bounce in a two-send window is not a rate; the domain keeps sending.
    expect((await row<any>(`SELECT paused_at FROM outreach_domain_state WHERE business_key = 'time2read'`)).paused_at).toBeNull();
  });

  it("three bounces before the 20-send sample pause the domain, and the pause lifts itself when the window rolls", async () => {
    await readyWithAddress("time2read");
    for (const n of [1, 2, 3]) {
      await addProspect("time2read", `gone${n}@school.example`, { state: "in_sequence", step: 1, thread_id: `th-gone${n}` });
      await env.DB.prepare(`INSERT INTO outreach_sends (id, business_key, prospect_id, to_email, step, is_test, status, sent_at) VALUES (?,'time2read',?,?,0,0,'sent',?)`).bind(`sb${n}`, `opr_time2read_gone${n}@school.example`, `gone${n}@school.example`, TUESDAY_10AM - DAY_MS).run();
    }
    const g = fakeGmail({ inbound: [1, 2, 3].map((n) => ({ id: `bb${n}`, threadId: `th-gone${n}`, from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)", body: `Final-Recipient: rfc822; gone${n}@school.example` })) });
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
    const st = await row<any>(`SELECT paused_at, pause_reason FROM outreach_domain_state WHERE business_key = 'time2read'`);
    expect(st.paused_at).toBeTruthy();
    expect(st.pause_reason).toMatch(/3 bounces in 3 sends/);
    // 15 days later the bounces have left the window: the pause lifts without a human.
    await runOutreachTick(await tickEnv(), TUESDAY_10AM + 15 * DAY_MS, fakeGmail({ inbound: [] }).fetchImpl);
    expect((await row<any>(`SELECT paused_at FROM outreach_domain_state WHERE business_key = 'time2read'`)).paused_at).toBeNull();
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
    // A send-as that already exists (409, seen 9 Oct 2026 when the list lagged the insert) is present, not unfinished.
    expect(DOMAINS_SCRIPT).toMatch(/s\.status === 409 \? "present"/);
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

/**
 * MEMPHIS SENIOR CARE HOMES (13 Oct 2026): one exclusive routing seat, two pitches chosen at send
 * time from the site's public seat JSON, the seat holder never written to, the guides' footer on
 * every email, and a Memphis metro read only for this business.
 */
describe("Memphis Senior Care Homes: the seat decides the pitch", () => {
  beforeEach(reset);
  const MSCH = businessByKey("memphisseniorcarehomes")!;
  const SEAT_URL = "https://memphisseniorcarehomes.com/_seat.json";
  const ADDR = "PO Box 1, Houston, TX 77002";

  /** The fake Gmail, plus the site's seat JSON: a body, a status, or a network failure. */
  function withSeat(base: typeof fetch, seat: { body?: unknown; status?: number; fail?: boolean }, reads: string[] = []): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === SEAT_URL) {
        reads.push(String(input));
        if (seat.fail) throw new Error("network down");
        return Response.json(seat.body ?? {}, { status: seat.status ?? 200 });
      }
      return base(input, init);
    }) as typeof fetch;
  }

  const realSends = (g: { sends: { to: string; raw: string }[] }) => g.sends.filter((s) => !s.to.startsWith("cryptoclearr"));
  const subjectOf = (raw: string) => /^Subject: (.+)$/m.exec(raw)?.[1]?.trim() ?? "";
  const plainOf = (raw: string) => {
    const m = /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(raw);
    return decodeURIComponent(escape(atob((m?.[1] ?? "").replace(/\r\n/g, ""))));
  };

  it("is a local guide sending from the umbrella address, with a seat URL and both pitches", () => {
    expect(MSCH).toBeTruthy();
    expect(MSCH.kind).toBe("local_guide");
    expect(MSCH.sender).toBe("hello@theindustryguides.com");
    expect(MSCH.offerUrl).toBe("https://memphisseniorcarehomes.com/for-providers/");
    expect(MSCH.seat?.url).toBe(SEAT_URL);
    expect(() => assertSenderAllowed(MSCH)).not.toThrow();
    expect(MSCH.steps[0].subject).toBe("quick question for {org}");
    expect(MSCH.seat!.taken[0].subject).toBe("Memphis families looking for care");
    expect(MSCH.steps.map((s) => s.body).join(" ")).toContain("then $249 a month on a six-month term");
    // No business but this one has a seat, and no other business says the seat's words.
    expect(BUSINESSES.filter((b) => b.seat).map((b) => b.key)).toEqual(["memphisseniorcarehomes"]);
  });

  it("reads the seat JSON: inactive → A, active → B naming the end month, anything else is a failed read", async () => {
    expect(parseSeat({ active: false })).toEqual({ active: false, end: null });
    expect(parseSeat({ active: true, end: "2027-03-31" })).toEqual({ active: true, end: "2027-03-31" });
    for (const bad of [null, "x", {}, { active: true }, { active: true, end: "March" }, { active: "yes", end: "2027-03-31" }]) {
      expect(parseSeat(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(pitchFor(MSCH, { active: false, end: null })).toBe("A");
    expect(pitchFor(MSCH, { active: true, end: "2027-03-31" })).toBe("B");
    expect(pitchFor(T2R, { active: true, end: "2027-03-31" })).toBe("A");
    expect(seatEndMonth("2027-03-31")).toBe("March 2027");

    const notFound = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const throws = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const hangs = ((_: unknown, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const taken = { active: true, end: "2027-03-31" };
    // A failure with a last value keeps it; with none, the seat counts as open (pitch A).
    expect((await readSeat(SEAT_URL, taken, notFound)).seat).toEqual(taken);
    expect((await readSeat(SEAT_URL, taken, throws)).source).toBe("last");
    expect((await readSeat(SEAT_URL, null, throws))).toMatchObject({ seat: SEAT_OPEN, source: "default" });
    // A hung server never blocks the tick: the short timeout gives up and the last value stands.
    const t0 = Date.now();
    expect((await readSeat(SEAT_URL, taken, hangs, 50)).seat).toEqual(taken);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("the tick sends pitch A while the seat is open, B once it is taken, and keeps B when the read then fails", async () => {
    await readyWithAddress("memphisseniorcarehomes");
    await addProspect("memphisseniorcarehomes", "admissions@oakcourt.example");
    const g = fakeGmail();
    const reads: string[] = [];
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, withSeat(g.fetchImpl, { body: { active: false } }, reads));
    expect(reads.length).toBe(1);
    const a = realSends(g);
    expect(a.length).toBe(1);
    expect(subjectOf(a[0]!.raw)).toBe("quick question for Acme Reading");
    expect(plainOf(a[0]!.raw)).toContain("I'm looking for one community to work with closely on the families who fit.");
    expect(plainOf(a[0]!.raw)).not.toContain("$");

    await addProspect("memphisseniorcarehomes", "admissions@riverbend.example");
    await runOutreachTick(await tickEnv(), TUESDAY_10AM + 3_600_000, withSeat(g.fetchImpl, { body: { active: true, end: "2027-03-31" } }));
    const b = realSends(g).filter((s) => s.to === "admissions@riverbend.example");
    expect(b.length).toBe(1);
    expect(subjectOf(b[0]!.raw)).toBe("Memphis families looking for care");
    expect(plainOf(b[0]!.raw)).toContain("Meeting them is a flat $800, or one month's rent only if they move in.");
    expect(plainOf(b[0]!.raw)).not.toContain("One community at a time");
    const st = await row<any>(`SELECT * FROM outreach_domain_state WHERE business_key = 'memphisseniorcarehomes'`);
    expect(st.seat_active).toBe(1);
    expect(st.seat_end).toBe("2027-03-31");

    // The site is down: the last value read (taken) stands, so it is still pitch B, never A.
    await addProspect("memphisseniorcarehomes", "admissions@magnolia.example");
    await runOutreachTick(await tickEnv(), TUESDAY_10AM + 2 * 3_600_000, withSeat(g.fetchImpl, { fail: true }));
    const c = realSends(g).filter((s) => s.to === "admissions@magnolia.example");
    expect(c.length).toBe(1);
    expect(subjectOf(c[0]!.raw)).toBe("Memphis families looking for care");
    const sent = await env.DB.prepare(`SELECT to_email, detail FROM outreach_sends WHERE business_key = 'memphisseniorcarehomes' AND is_test = 0 ORDER BY sent_at`).all<any>();
    expect((sent.results ?? []).map((r: any) => r.detail)).toEqual(["pitch A", "pitch B", "pitch B"]);
  });

  it("a seat never read and a failed read sends pitch A (the default is open)", async () => {
    await readyWithAddress("memphisseniorcarehomes");
    await addProspect("memphisseniorcarehomes", "admissions@oakcourt.example");
    const g = fakeGmail();
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, withSeat(g.fetchImpl, { fail: true }));
    const a = realSends(g);
    expect(a.length).toBe(1);
    expect(subjectOf(a[0]!.raw)).toBe("quick question for Acme Reading");
  });

  it("never writes to the seat holder (pitch A least of all), set by domain on PUT /business/:key", async () => {
    expect(normaliseHolderDomain("https://www.Holder-Community.example/about")).toBe("holder-community.example");
    expect(normaliseHolderDomain("ed@holder-community.example")).toBe("holder-community.example");
    expect(normaliseHolderDomain("")).toBeNull();
    expect(isSeatHolder({ email: "ed@holder-community.example" }, "holder-community.example")).toBe(true);
    expect(isSeatHolder({ email: "x@other.example", website: "https://www.holder-community.example" }, "holder-community.example")).toBe(true);
    expect(isSeatHolder({ email: "x@other.example", website: "https://other.example" }, "holder-community.example")).toBe(false);
    expect(isSeatHolder({ email: "ed@holder-community.example" }, null)).toBe(false);

    // Empty by default; set through the desk; refused for a business with no seat.
    const fresh = await apiJson<any>("/api/outreach");
    expect(fresh.body.data.businesses.find((b: any) => b.key === "memphisseniorcarehomes").seat.holder_domain).toBeNull();
    const put = await apiJson<any>("/api/outreach/business/memphisseniorcarehomes", { method: "PUT", body: { seat_holder_domain: "www.holder-community.example" } });
    expect(put.status).toBe(200);
    expect(put.body.data.seat_holder_domain).toBe("holder-community.example");
    expect((await apiJson<any>("/api/outreach/business/time2read", { method: "PUT", body: { seat_holder_domain: "x.example" } })).status).toBe(400);
    expect((await apiJson<any>("/api/outreach/business/memphisseniorcarehomes", { method: "PUT", body: { seat_holder_domain: "not a domain" } })).status).toBe(400);

    await readyWithAddress("memphisseniorcarehomes");
    const holderId = await addProspect("memphisseniorcarehomes", "ed@holder-community.example");
    await addProspect("memphisseniorcarehomes", "admissions@oakcourt.example");
    const g = fakeGmail();
    // The read fails, so the seat counts as open and this is pitch A: the holder still gets nothing.
    await runOutreachTick(await tickEnv(), TUESDAY_10AM, withSeat(g.fetchImpl, { fail: true }));
    const sent = realSends(g);
    expect(sent.map((s) => s.to)).toEqual(["admissions@oakcourt.example"]);
    expect(subjectOf(sent[0]!.raw)).toBe("quick question for Acme Reading");
    const holder = await row<any>(`SELECT state, next_due_at FROM outreach_prospects WHERE id = ?`, holderId);
    expect(holder.state).toBe("done");
    expect(holder.next_due_at).toBeNull();
    // Cleared with "": back to empty.
    const cleared = await apiJson<any>("/api/outreach/business/memphisseniorcarehomes", { method: "PUT", body: { seat_holder_domain: "" } });
    expect(cleared.body.data.seat_holder_domain).toBeNull();
  });

  it("every email it composes, both pitches, carries the guides footer and the unsubscribe link — or is refused", () => {
    for (const pitch of ["A", "B"] as const) {
      for (const step of [0, 1, 2] as const) {
        const m = composeEmail({
          business: MSCH, step, to: "a@acme.example", org: "Oak Court", metro: "Memphis", unsubToken: "tok123",
          postalAddress: ADDR, firstSubject: "Hello", pitch, seatEnd: pitch === "B" ? "2027-03-31" : null,
        });
        const plainFooter = m.body.slice(m.body.lastIndexOf("\n--\n"));
        expect(plainFooter, `${pitch}${step}`).toContain("https://boss.sequoiataylor.com/api/boss/outreach/u/tok123");
        expect(m.html, `${pitch}${step}`).toContain('href="https://boss.sequoiataylor.com/api/boss/outreach/u/tok123"');
        expect(plainFooter.split("\n"), `${pitch}${step}`).toContain(`The Industry Guides, ${ADDR} · hello@theindustryguides.com`);
        expect(plainFooter.split("\n"), `${pitch}${step}`).toContain("Memphis Senior Care Homes is a property of The Industry Guides.");
        expect(m.raw).toMatch(/^List-Unsubscribe: <https:\/\/boss\.sequoiataylor\.com\/api\/boss\/outreach\/u\/tok123>/m);
        expect(m.body + m.subject, `${pitch}${step}`).not.toMatch(/\{\w+\}/);
        expect(m.body + m.html, `${pitch}${step}`).not.toMatch(/Spry/i);
        // Every step names the guide's domain; only day 4 links the offer page (owner, 16 Oct 2026).
        const links = m.body.slice(0, m.body.lastIndexOf("\n--\n")).match(/https:\/\/memphisseniorcarehomes\.com\/\S*?(?=\.?(\s|$))/g) ?? [];
        expect(links, `${pitch}${step}`).toEqual(step === 1 ? ["https://memphisseniorcarehomes.com/for-providers/"] : []);
        expect(m.body, `${pitch}${step}`).toContain("(memphisseniorcarehomes.com)");
      }
    }
    // Refusals: pitch B with no end month, pitch B for a business with no seat, an unfilled placeholder.
    const base = { business: MSCH, step: 0 as const, to: "a@acme.example", org: "Oak Court", metro: "Memphis", unsubToken: "tok123", postalAddress: ADDR };
    expect(() => composeEmail({ ...base, pitch: "B" })).toThrow(/end/);
    expect(() => composeEmail({ ...base, business: T2R, pitch: "B", seatEnd: "2027-03-31" })).toThrow(/no pitch B/);
    const broken = { ...MSCH, steps: [{ ...MSCH.steps[0], body: "Hi {org}, see {nope}." }, MSCH.steps[1], MSCH.steps[2]] as typeof MSCH.steps };
    expect(() => composeEmail({ ...base, business: broken })).toThrow(/\{nope\} was left unfilled/);
    expect(() => composeEmail({ ...base, unsubToken: "" })).toThrow(/unsubscribe/);
  });

  it("the Memphis metro is a valid box over Shelby, DeSoto and Crittenden, read only for this business", () => {
    expect(METROS.length).toBeGreaterThan(0);
    for (const m of METROS) {
      const [s, w, n, e] = m.bbox;
      expect(s, m.key).toBeLessThan(n);
      expect(w, m.key).toBeLessThan(e);
      expect(s >= -90 && n <= 90 && w >= -180 && e <= 180, m.key).toBe(true);
      // City-sized: under 1.5 degrees on a side, so a quadrant stays a query the public servers answer.
      expect(n - s, m.key).toBeLessThan(1.5);
      expect(e - w, m.key).toBeLessThan(1.5);
    }
    expect(new Set(METROS.map((m) => m.key)).size).toBe(METROS.length);
    const memphis = METROS.find((m) => m.key === "memphis")!;
    expect(memphis).toBeTruthy();
    const inside = ([lat, lon]: [number, number]) => lat > memphis.bbox[0] && lat < memphis.bbox[2] && lon > memphis.bbox[1] && lon < memphis.bbox[3];
    // Downtown Memphis (Shelby TN), Germantown (Shelby), Southaven (DeSoto MS), Olive Branch (DeSoto), West Memphis (Crittenden AR).
    for (const p of [[35.1495, -90.049], [35.0868, -89.81], [34.9889, -90.0126], [34.9618, -89.8295], [35.1465, -90.1845]] as [number, number][]) {
      expect(inside(p), JSON.stringify(p)).toBe(true);
    }
    // Nashville and Little Rock are not Memphis.
    expect(inside([36.1627, -86.7816])).toBe(false);
    expect(inside([34.7465, -92.2896])).toBe(false);
    expect(metrosFor(MSCH).map((m) => m.key)).toEqual(["memphis"]);
    for (const b of BUSINESSES.filter((x) => x.key !== "memphisseniorcarehomes" && !x.noOutreachStates)) {
      expect(metrosFor(b).map((m) => m.key), b.key).toEqual([...NATIONAL_METROS]);
    }
    // The Accident Guides read only the national metros in no state PI outreach is barred from.
    expect(metrosFor(businessByKey("theaccidentguides")!).map((m) => m.key)).toEqual(["nyc", "chicago"]);
  });

  it("writes to admissions and community relations first, on the community's own domain", () => {
    const seg = MSCH.segments[0]!;
    expect(seg.qualify.test("Assisted Living and Memory Care in Germantown")).toBe(true);
    expect(seg.qualify.test("Family dentistry")).toBe(false);
    expect(pickEmail(["info@oakcourt.example", "admissions@oakcourt.example"], "https://oakcourt.example", null, seg.preferRoles)).toBe("admissions@oakcourt.example");
    expect(pickEmail(["info@oakcourt.example", "admissions@vendor.example"], "https://oakcourt.example", null, seg.preferRoles)).toBe("info@oakcourt.example");
  });
});

/**
 * THE LICENSED DIRECTORY IS THE LIST (13 Oct 2026). memphisseniorcarehomes.com publishes every
 * licensed facility at /data/facilities.json; rows with a public business email become prospects,
 * rows with only a website go to the website read. Fixture rows keep the file's real shape.
 */
describe("Memphis Senior Care Homes: the licensed directory feeds prospects", () => {
  beforeEach(reset);
  const DIR_URL = "https://memphisseniorcarehomes.com/data/facilities.json";
  const facility = (over: Record<string, unknown>) => ({
    name: "American House Bartlett", address: "3345 Kirby Whitten Road", city: "Bartlett", state: "TN", zip: "38134",
    phone: "901-383-6901", phone_source: "HFC registry", license_type: "Assisted Care Living Facility", license_number: "62",
    license_status: "Licensed", total_beds: 116, secured_beds: 0, memory_care: false,
    website: "https://www.americanhouse.example/bartlett", email: "", lat: 35.187575, lng: -89.867415, ...over,
  });
  const FIXTURE = {
    source: "Tennessee HFC registry; Mississippi MSDH", fetched_at: "2026-10-13", county: "Shelby",
    facilities: [
      facility({ name: "Oak Court Assisted Living", license_number: "101", website: "https://oakcourt.example", email: "admissions@oakcourt.example" }),
      facility({ name: "Riverbend Memory Care", license_number: "102", website: "https://www.riverbend.example/", email: "" }),
      facility({ name: "Magnolia Home", license_number: "MS-7", state: "MS", city: "Southaven", website: "", email: "owner@gmail.com" }),
      facility({ name: "Cedar Place", license_number: "103", website: "https://cedar.example", email: "owner@gmail.com" }),
      facility({ name: "", license_number: "104" }),
      facility({ name: "No Contact Home", license_number: "105", website: "", email: "" }),
    ],
  };

  function dirFetch(body: unknown, opts: { status?: number; reads?: string[] } = {}): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === DIR_URL) { opts.reads?.push(url); return Response.json(body, { status: opts.status ?? 200 }); }
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        return Response.json({ Status: 0, Answer: [{ type: 15, data: "10 mx.oakcourt.example." }] });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  }

  it("is the business's directory, on its own site", () => {
    expect(businessByKey("memphisseniorcarehomes")!.directory).toBe(DIR_URL);
    expect(BUSINESSES.filter((b) => b.directory).map((b) => b.key)).toEqual(["memphisseniorcarehomes"]);
  });

  it("parses the file: named rows with a website or an email, normalised", () => {
    const rows = parseDirectory(FIXTURE);
    expect(rows.map((r) => r.name)).toEqual(["Oak Court Assisted Living", "Riverbend Memory Care", "Magnolia Home", "Cedar Place"]);
    expect(rows[0]).toMatchObject({ email: "admissions@oakcourt.example", website: "https://oakcourt.example", licence: "101" });
    expect(rows[1]).toMatchObject({ email: null, website: "https://www.riverbend.example" });
    expect(parseDirectory(FIXTURE.facilities).length).toBe(4);
    expect(parseDirectory({ nope: 1 })).toEqual([]);
  });

  it("yields prospects from emails and website reads from the rest, once a day", async () => {
    const reads: string[] = [];
    const r = await readDirectories(env.DB, dirFetch(FIXTURE, { reads }), TUESDAY_10AM);
    expect(r.read).toEqual(["memphisseniorcarehomes"]);
    expect(r.prospects).toBe(1);
    expect(r.candidates).toBe(2);
    const p = await row<any>(`SELECT * FROM outreach_prospects WHERE business_key = 'memphisseniorcarehomes' AND source = 'licensed_directory'`);
    expect(p).toMatchObject({ email: "admissions@oakcourt.example", org_name: "Oak Court Assisted Living", segment: "senior_living", metro: "Memphis", state: "new" });
    expect(p.source_url).toBe(`${DIR_URL}#licence-101`);
    expect(p.unsub_token).toBeTruthy();
    const cands = await env.DB.prepare(`SELECT website, metro FROM outreach_candidates WHERE business_key = 'memphisseniorcarehomes' ORDER BY website`).all<any>();
    // Free mail is never a prospect: Cedar Place goes to the website read instead; Magnolia (no site) is dropped.
    expect((cands.results ?? []).map((c: any) => c.website)).toEqual(["https://cedar.example", "https://www.riverbend.example"]);
    expect((cands.results ?? []).every((c: any) => c.metro === "memphis")).toBe(true);
    // Within the day: not read again.
    await readDirectories(env.DB, dirFetch(FIXTURE, { reads }), TUESDAY_10AM + 3_600_000);
    expect(reads.length).toBe(1);
    // Next day: read again, nothing duplicated.
    const again = await readDirectories(env.DB, dirFetch(FIXTURE, { reads }), TUESDAY_10AM + DAY_MS + 1);
    expect(reads.length).toBe(2);
    expect(again.prospects + again.candidates).toBe(0);
  });

  it("a failed read is recorded and retried within hours, and the tick reads the directory", async () => {
    const reads: string[] = [];
    const r = await readDirectories(env.DB, dirFetch({}, { status: 503, reads }), TUESDAY_10AM);
    expect(r.read).toEqual(["memphisseniorcarehomes"]);
    const slice = await row<any>(`SELECT found, detail FROM outreach_slices WHERE business_key = 'memphisseniorcarehomes' AND metro = 'directory'`);
    expect(slice.found).toBe(-1);
    expect(slice.detail).toMatch(/503/);
    await readDirectories(env.DB, dirFetch(FIXTURE, { reads }), TUESDAY_10AM + 3 * 3_600_000);
    expect(reads.length).toBe(2);
    await env.DB.prepare(`DELETE FROM outreach_slices`).run();
    const g = fakeGmail();
    const base = g.fetchImpl;
    const tick = await runOutreachTick(await tickEnv(), TUESDAY_10AM, (async (i: RequestInfo | URL, init?: RequestInit) =>
      String(i) === DIR_URL ? Response.json(FIXTURE) : base(i, init)) as typeof fetch);
    expect(tick.lists.directories?.read).toEqual(["memphisseniorcarehomes"]);
  });
});

describe("the Industry Guides read like a person, signed S.L. Taylor (owner, 16 Oct 2026)", () => {
  const addr = "PO Box 1, Houston, TX 77002";
  const GUIDE_KEYS = ["uscisexam", "dentistryguides", "hormonesivhair", "neuroevalguides", "theaccidentguides", "memphisseniorcarehomes"];
  const wordsBeforeSignature = (body: string, signature: string): number => {
    const at = body.indexOf(`\n\n${signature}`);
    expect(at).toBeGreaterThan(0);
    return body.slice(0, at).split(/\s+/).filter(Boolean).length;
  };

  it("every guide, every step and both seat pitches: 60-110 words, stands alone, no hard sell, honest first subject, no first-email price, S.L. Taylor signs", () => {
    const guides = BUSINESSES.filter((b) => b.kind === "local_guide");
    expect(guides.map((b) => b.key).sort()).toEqual([...GUIDE_KEYS].sort());
    let checked = 0;
    for (const b of guides) {
      const pitches: Array<"A" | "B"> = b.seat ? ["A", "B"] : ["A"];
      for (const pitch of pitches) {
        for (const step of [0, 1, 2] as const) {
          const m = composeEmail({
            business: b, step, to: "a@acme.example", org: "Acme Dental", metro: "Houston", unsubToken: "tok123",
            postalAddress: addr, firstSubject: "quick question for Acme Dental", pitch, seatEnd: pitch === "B" ? "2027-03-31" : null,
          });
          const at = `${b.key} pitch ${pitch} step ${step}`;
          const signature = `S.L. Taylor\nThe Industry Guides\n${b.domain}`;
          expect(m.body, at).toContain(`\n\n${signature}\n\n--\n`);
          const n = wordsBeforeSignature(m.body, signature);
          expect(n, `${at}: ${n} words`).toBeGreaterThanOrEqual(60);
          // The one longer step: the senior seat's day 4 carries the owner's approved price line verbatim
          // (16 Oct 2026: term and move-in fee included), which the 110-word template cannot hold.
          const ceiling = b.seat && pitch === "A" && step === 1 ? 125 : 110;
          expect(n, `${at}: ${n} words`).toBeLessThanOrEqual(ceiling);
          const message = m.body.slice(0, m.body.indexOf(`\n\n${signature}`));
          expect(message, at).not.toMatch(/Reply\s+"yes"/i);
          expect(message, at).not.toMatch(/featured listing/i);
          expect(`${m.subject}\n${message}`, at).not.toContain("!");
          // Every step stands alone: it says what the guide is and names its domain, because people
          // rarely read the first email (owner, 16 Oct 2026).
          expect(message, at).toContain(`(${b.domain})`);
          expect(message, at).toContain("ChatGPT, Google and other AI assistants");
          expect(message, at).toMatch(/digital guide[\s\S]{0,60}built to come up when/);
          expect(message, at).not.toMatch(/\{\w+\}/);
          if (step === 0) {
            expect(m.subject, at).not.toMatch(/^\s*re:/i);
            expect(m.subject, at).not.toMatch(/\$|\d+\s*\/\s*month|per month|month's rent|free/i);
            // Pitch B (seat taken) names its price in the first email by the owner's design, approved
            // 16 Oct 2026; it is the ONE exemption, and it is pinned to say exactly that price.
            if (pitch === "B") expect(message, at).toContain("Meeting them is a flat $800, or one month's rent only if they move in.");
            else expect(message, at).not.toContain("$");
          } else {
            expect(m.subject, at).toBe("Re: quick question for Acme Dental");
          }
          checked++;
        }
      }
    }
    expect(checked).toBe(GUIDE_KEYS.length * 3 + 3); // hard-fail on zero; pitch B counted
  });

  it("the other businesses keep their own team's signature, and never S.L. Taylor", () => {
    const others = BUSINESSES.filter((b) => b.kind !== "local_guide");
    expect(others.length).toBeGreaterThan(0);
    for (const b of others) {
      expect(b.steps.length, b.key).toBe(b.key === "time2read_groups" ? 2 : 3);
      for (const step of [...b.steps.keys()] as Array<0 | 1 | 2>) {
        const m = composeEmail({ business: b, step, to: "a@acme.example", org: "Acme", metro: "Houston", unsubToken: "tok123", postalAddress: addr, firstSubject: "Hello", groupCode: "ACME15K7Q" });
        expect(m.body, b.key).toContain(`\n\n— The ${b.brand} team\n${b.domain}\n\n--\n`);
        expect(m.body, b.key).not.toContain("S.L. Taylor");
      }
    }
  });
});

describe("Neuro Evaluation Guides writes to evaluators AND therapy practices (owner, 16 Oct 2026)", () => {
  // The regex this replaced: evaluators only. Kept here to prove the widening negatively.
  const OLD = /neuropsych|ADHD (evaluation|testing|assessment)|autism (evaluation|testing|assessment)|psychological testing/i;
  const THERAPY_ONLY = [
    "Bright Path Counseling offers ADHD therapy for children, teens and adults. Licensed therapists, in person and telehealth.",
    "We provide ABA therapy for autistic children in home and clinic. Our BCBAs design every plan.",
    "Applied Behavior Analysis services for kids on the spectrum.",
    "Individual counseling for adults with ADHD and anxiety.",
    "Autism therapy and parent coaching. Speech and occupational support.",
    "ADHD coaching with Jane Doe, LCSW, a licensed clinical social worker.",
    "Behavioral therapy and treatment for ADHD in Houston.",
  ];
  const BOTH = ["We do ADHD evaluations and ongoing ADHD therapy under one roof."];
  const EVALUATORS = ["Comprehensive neuropsychological evaluations.", "Autism assessment for toddlers.", "Psychological testing for school accommodations."];
  const NOT_CLINICAL = [
    "Bright Kids Toy Store: sensory toys, fidget spinners and planners. Free shipping.",
    "Smith & Jones LLP. Personal injury attorneys and proud ABA members since 1990.",
    "Join our autism awareness 5K fun run on Saturday. Register online.",
    "Add to cart. Massage therapy gift cards for the holidays.",
    "ADHD coaching for entrepreneurs: productivity hacks and planners.",
    "Dental cleanings, implants and veneers.",
  ];

  it("therapy-only and both-service practices qualify, the old regex dropped every therapy-only one", () => {
    for (const t of [...THERAPY_ONLY, ...BOTH, ...EVALUATORS]) expect(NEURO_QUALIFY.test(t), t).toBe(true);
    for (const t of THERAPY_ONLY) expect(OLD.test(t), `old regex: ${t}`).toBe(false);
    expect(THERAPY_ONLY.length).toBeGreaterThan(0);
  });

  it("non-clinical businesses do not qualify", () => {
    for (const t of NOT_CLINICAL) expect(NEURO_QUALIFY.test(t), t).toBe(false);
  });

  it("therapy is read first, and every segment qualifies with the one shared regex", () => {
    const b = businessByKey("neuroevalguides")!;
    expect(b.segments.map((s) => s.key)).toEqual(["therapy", "evaluators"]);
    for (const s of b.segments) expect(s.qualify).toBe(NEURO_QUALIFY);
    expect(b.offerUrl).toBe("https://neuroevalguides.com/for-providers/");
    expect(b.offer).toMatch(/evaluation and therapy/);
    expect(b.offer).toContain("2 months free, then $249/month per metro");
  });

  it("every step names both audiences and that a listing shows evaluation, therapy or both", () => {
    const b = businessByKey("neuroevalguides")!;
    let checked = 0;
    for (const step of [0, 1, 2] as const) {
      const m = composeEmail({
        business: b, step, to: "a@acme.example", org: "Acme Therapy", metro: "Houston", unsubToken: "tok123",
        postalAddress: "PO Box 1, Houston, TX 77002", firstSubject: "families looking for ADHD and autism care in Houston", pitch: "A", seatEnd: null,
      });
      expect(m.body, `step ${step}`).toMatch(/evaluat/i);
      expect(m.body, `step ${step}`).toMatch(/ongoing therapy/);
      expect(m.body, `step ${step}`).toContain("Listings show evaluation, therapy or both.");
      if (step === 1) {
        expect(m.body).toContain("https://neuroevalguides.com/for-providers/");
        expect(m.body).toContain("It's free for the first two months, then $249 a month.");
      }
      checked++;
    }
    expect(checked).toBe(3);
  });
});

describe("The Accident Guides never write to a PI firm in a barred state (owner, 1 Nov 2026)", () => {
  beforeEach(reset);
  const PI = () => businessByKey("theaccidentguides")!;

  it("the barred states come from one list and every metro touching one is refused", () => {
    expect(Object.keys(PI_NO_OUTREACH_STATES).sort()).toEqual(["CA", "CO", "FL", "KY", "MI", "RI", "TX"]);
    expect(PI().noOutreachStates).toBe(PI_NO_OUTREACH_STATES);
    for (const m of METROS) {
      const barred = m.states.some((s) => s in PI_NO_OUTREACH_STATES);
      expect(Boolean(outreachStateBlock(PI(), m.key)), m.key).toBe(barred);
      expect(Boolean(outreachStateBlock(PI(), m.label)), m.label).toBe(barred);
    }
    // An unknown metro cannot be placed in a state, so it is refused; other businesses are untouched.
    expect(outreachStateBlock(PI(), null)).toMatch(/cannot be checked/);
    expect(outreachStateBlock(T2R, "Houston")).toBeNull();
  });

  it("queued prospects in a barred state are dropped with a logged reason, and nothing is sent to them", async () => {
    await readyWithAddress("theaccidentguides");
    const houston = await addProspect("theaccidentguides", "pi@houstonlaw.example");
    const mid = await addProspect("theaccidentguides", "pi2@houstonlaw2.example", { state: "in_sequence", step: 1, next_due_at: TUESDAY_10AM + 3 * DAY_MS });
    const chicago = await addProspect("theaccidentguides", "pi@chicagolaw.example");
    await env.DB.prepare(`UPDATE outreach_prospects SET metro = 'Chicago' WHERE id = ?`).bind(chicago).run();
    const g = fakeGmail();
    const r = await runOutreachTick(await tickEnv(), TUESDAY_10AM, g.fetchImpl);
    expect(r.stateBlocked).toBe(2);
    expect(g.sends.map((s) => s.to)).not.toContain("pi@houstonlaw.example");
    for (const id of [houston, mid]) {
      expect((await row<any>(`SELECT state, next_due_at FROM outreach_prospects WHERE id = ?`, id))).toMatchObject({ state: "done", next_due_at: null });
    }
    const logged = await env.DB.prepare(`SELECT detail FROM system_events WHERE event = 'prospect_state_blocked' AND entity_id = ?`).bind(houston).first<any>();
    expect(JSON.parse(logged.detail).reason).toMatch(/Houston is in TX/);
    expect((await row<any>(`SELECT state FROM outreach_prospects WHERE id = ?`, chicago)).state).not.toBe("done");
  });

  it("a candidate listed in a barred metro is never admitted as a prospect", async () => {
    await env.DB.prepare(
      `INSERT INTO outreach_candidates (id, business_key, segment, metro, org_name, website, listed_email, source_url, state, created_at, updated_at)
       VALUES ('ocd_la', 'theaccidentguides', 'pi_firms', 'la:q1', 'LA Injury', 'https://lainjury.example', 'info@lainjury.example', 'https://osm.example', 'pending', ?, ?)`,
    ).bind(TUESDAY_10AM, TUESDAY_10AM).run();
    await crawlCandidates(env.DB, fakeGmail().fetchImpl, TUESDAY_10AM);
    expect((await row<any>(`SELECT state, detail FROM outreach_candidates WHERE id = 'ocd_la'`)).detail).toMatch(/Los Angeles is in CA/);
    expect(await row<any>(`SELECT id FROM outreach_prospects WHERE email = 'info@lainjury.example'`)).toBeFalsy();
  });
});
