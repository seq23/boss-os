/**
 * SIMONE'S "GO?" CARD FOR EVERY INVITATION (owner-approved plan, 8 Nov 2026). The three guards the plan
 * names, each proven to fail without its code (see the PR), plus the lifecycle around them:
 *   1. a Yes never sends without her tap (the duty and a GET send nothing; one POST sends once);
 *   2. an outside RSVP link is never clicked by the system;
 *   3. a Not sure comes back exactly once.
 * Synthetic people and addresses only (example.com); the repo is public.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { setCommandFetch } from "../../src/worker/boss/commands/google";
import { runInvitations, setInviteModel } from "../../src/worker/boss/invitations/run";
import { addDays, centralDay, wallToUtc, INVITE_INBOXES } from "../../src/shared/boss/invitations/invitations.mjs";

// Her own inbox is read from the module, never written in a test (the repo is public).
const HER = INVITE_INBOXES[0]!.address;

const DAY = 86_400_000;
// Mon 9 Nov 2026, 06:00 Central.
const NOW = Date.parse("2026-11-09T12:00:00Z");
const EVENT = wallToUtc(2026, 11, 19, 18, 30); // Thu 19 Nov, 6:30 pm Central
const REAL_NOW = Date.now;

async function pem(): Promise<string> {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
  let bin = ""; for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----`;
}
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ics = [
  "BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT",
  "DTSTART:20261120T000000Z", "DTEND:20261120T010000Z",
  "ORGANIZER;CN=Avery Host:mailto:avery@example.com", "UID:abc-123@google.com",
  `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Her:mailto:${HER}`,
  "SUMMARY:Board dinner", "LOCATION:The Peabody\\, Memphis", "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR",
].join("\r\n");
const msg = (id: string, headers: Record<string, string>, parts: any[]) => ({
  id, threadId: `t-${id}`,
  payload: { mimeType: "multipart/mixed", headers: Object.entries(headers).map(([name, value]) => ({ name, value })), parts },
});
const text = (s: string) => ({ mimeType: "text/plain", body: { data: b64(s), size: s.length } });
const MESSAGES: Record<string, any> = {
  m1: msg("m1", { From: "Avery Host <avery@example.com>", Subject: "Invitation: Board dinner @ Thu Nov 19", "Message-ID": "<m1@example.com>" },
    [text("Board dinner"), { mimeType: "text/calendar", filename: "invite.ics", body: { data: b64(ics), size: ics.length } }]),
  m2: msg("m2", { From: "Luma <calendar@lu.ma>", Subject: "Founders Supper", "List-Unsubscribe": "<https://lu.ma/unsub>", "Message-ID": "<m2@lu.ma>" },
    [text("You're invited to Founders Supper on Thursday, November 19, 2026 at 6:30 PM CST. RSVP: https://lu.ma/founders-supper  Unsubscribe https://lu.ma/unsubscribe")]),
  m3: msg("m3", { From: "Dana Example <dana@example.com>", Subject: "Dinner at ours?", "Message-ID": "<m3@example.com>" },
    [text("Would you join us for dinner on November 21 at 7pm? Let me know!")]),
  m4: msg("m4", { From: "Big Bank <events@bank.example.com>", Subject: "Join us for our markets webinar", "List-Unsubscribe": "<mailto:u@bank.example.com>" },
    [text("Join us on November 20 at 11am.")]),
  m5: msg("m5", { From: "Tickets <orders@tickets.example.com>", Subject: "Your tickets for the gala", "Message-ID": "<m5@example.com>" },
    [text("See you on November 22 at 8pm.")]),
};

/** A fake Google. Every request is recorded, method and URL, with its body. */
function fakeGoogle(opts: { failGmail?: boolean } = {}) {
  const calls: { method: string; url: string; body: string }[] = [];
  const f = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    const method = String(init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : "" });
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "t" });
    if (url.includes("/calendar/v3/") && method === "GET" && url.includes("iCalUID")) {
      return Response.json({ items: [{ id: "ev1", attendees: [{ email: HER, self: true, responseStatus: "needsAction" }] }] });
    }
    if (url.includes("/calendar/v3/") && method === "GET") {
      return Response.json({ items: [{ id: "ev1", iCalUID: "abc-123@google.com", summary: "Board dinner", start: { dateTime: "2026-11-20T00:00:00Z" }, end: { dateTime: "2026-11-20T01:00:00Z" }, organizer: { email: "avery@example.com", displayName: "Avery Host" }, attendees: [{ self: true, responseStatus: "needsAction" }] }] });
    }
    if (url.includes("/calendar/v3/")) return Response.json({ id: "new-ev" });
    if (url.includes("gmail.googleapis.com")) {
      if (opts.failGmail) return new Response("no", { status: 403 });
      if (url.includes("/messages/send")) return Response.json({ id: "sent-1" });
      if (/\/messages\?/.test(url)) return Response.json({ messages: Object.keys(MESSAGES).map((id) => ({ id })) });
      const id = /\/messages\/([^/?]+)/.exec(url)?.[1] ?? "";
      if (MESSAGES[id]) return Response.json(MESSAGES[id]);
    }
    return new Response("unexpected", { status: 599 });
  }) as typeof fetch;
  return { f, calls };
}

const sends = (calls: { method: string; url: string }[]) => calls.filter((c) => /messages\/send|drafts\/send/.test(c.url) || (c.url.includes("/calendar/v3/") && c.method !== "GET"));

async function tap(path: string, method = "GET") {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://boss.test${path}`, { method, redirect: "manual" }), env as any, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, text: await res.text() };
}
async function section() {
  const row = await env.DB.prepare(`SELECT body FROM morning_sections WHERE section = 'invitations'`).first<{ body: string }>();
  return row ? JSON.parse(row.body) : null;
}
const rowBy = (kind: string) => env.DB.prepare(`SELECT * FROM owner_invitations WHERE kind = ?`).bind(kind).first<any>();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM owner_invitations; DELETE FROM morning_sections WHERE section = 'invitations'; DELETE FROM settings WHERE key LIKE 'invitations_%';");
  (env as any).GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "bot@example.iam.gserviceaccount.com", private_key: await pem() });
  setInviteModel(async () => ({ invitation: true, title: "Dinner at Dana's", date: "2026-11-21", time: "19:00", where: "Dana's house", asks_answer: true }));
  Date.now = () => NOW;
});
afterEach(() => { setCommandFetch(null); setInviteModel(null); Date.now = REAL_NOW; });

describe("the morning pass", () => {
  it("one card per invitation, each kind, deduped across inboxes and the calendar; not-invitations are left out", async () => {
    const g = fakeGoogle(); setCommandFetch(g.f);
    const r = await runInvitations(env as any, NOW, g.f);
    expect(r.output).toBe("OUTPUT 3 invitations");
    const kinds = ((await env.DB.prepare(`SELECT kind FROM owner_invitations ORDER BY kind`).all<any>()).results ?? []).map((x) => x.kind);
    expect(kinds).toEqual(["calendar", "personal", "platform"]);
    const s = await section();
    expect(s.decide).toHaveLength(3);
    for (const d of s.decide) {
      expect(d.title).toMatch(/^Go\? /);
      expect(d.buttons.slice(0, 3).map((b: any) => b.label)).toEqual(["✓ Yes, go", "No", "Not sure"]);
      expect(d.body).toMatch(/ Central$/);
      expect(d.details.some((x: string) => /^From: /.test(x))).toBe(true);
      expect(d.details.some((x: string) => /^Where: /.test(x))).toBe(true);
      expect(d.details.some((x: string) => /^How it came in: /.test(x))).toBe(true);
    }
    const personal = s.decide.find((d: any) => /Dana/.test(d.title));
    expect(personal.draft.text).toMatch(/I'd love to come/);
    expect(r.skipped["a newsletter or list webinar"]).toBeGreaterThan(0);
    expect(r.skipped["a ticket receipt or a yes already given"]).toBeGreaterThan(0);
  });

  it("an inbox it cannot read is NAMED STOP [INVITES_MAILBOX_UNREAD], and her email says so", async () => {
    const g = fakeGoogle({ failGmail: true }); setCommandFetch(g.f);
    await expect(runInvitations(env as any, NOW, g.f)).rejects.toThrow(/NAMED STOP \[INVITES_MAILBOX_UNREAD\].*OUTPUT \d+ invitations/);
    const s = await section();
    expect(s.lines.join(" ")).toMatch(/could not read 3 places for invitations/);
  });
});

describe("guard 1: a Yes never sends without her tap", () => {
  it("the duty sends nothing; a GET sends nothing; one POST sends her shown words once; a second tap sends nothing", async () => {
    const g = fakeGoogle(); setCommandFetch(g.f);
    await runInvitations(env as any, NOW, g.f);
    expect(sends(g.calls)).toEqual([]);
    const p = await rowBy("personal");
    const shown = p.reply_text;
    await tap(`/api/auth/tap/${p.tap_token}?do=yes`);
    expect(sends(g.calls)).toEqual([]);
    expect((await rowBy("personal")).status).toBe("open");
    const t = await tap(`/api/auth/tap/${p.tap_token}?do=yes`, "POST");
    expect(t.text).toMatch(/Your yes is sent/);
    const mail = g.calls.filter((c) => c.url.includes("messages/send"));
    expect(mail).toHaveLength(1);
    const raw = JSON.parse(mail[0]!.body).raw as string;
    const decoded = decodeURIComponent(escape(atob(atob(raw.replace(/-/g, "+").replace(/_/g, "/")).split("\r\n\r\n")[1]!)));
    expect(decoded).toBe(shown);
    await tap(`/api/auth/tap/${p.tap_token}?do=yes`, "POST");
    expect(g.calls.filter((c) => c.url.includes("messages/send"))).toHaveLength(1);
  });
});

describe("guard 2: an outside RSVP link is never clicked by the system", () => {
  it("the RSVP page is a button for her; the duty and her Yes never fetch it", async () => {
    const g = fakeGoogle(); setCommandFetch(g.f);
    await runInvitations(env as any, NOW, g.f);
    const card = (await section()).decide.find((d: any) => /Founders/.test(d.title));
    expect(card.buttons.find((b: any) => /RSVP/.test(b.label)).url).toBe("https://lu.ma/founders-supper");
    const row = await rowBy("platform");
    const t = await tap(`/api/auth/tap/${row.tap_token}?do=yes`, "POST");
    expect(t.text).toContain("https://lu.ma/founders-supper");
    expect(g.calls.filter((c) => /lu\.ma|luma\.com/.test(new URL(c.url).host))).toEqual([]);
    expect(g.calls.filter((c) => c.url.includes("messages/send"))).toEqual([]);
  });
});

describe("guard 3: a Not sure comes back exactly once", () => {
  it("held, asked again 3 days before, then never again; an untapped card is asked twice and dropped on the day", async () => {
    const g = fakeGoogle(); setCommandFetch(g.f);
    const shownOn: Record<string, string[]> = { calendar: [], platform: [] };
    const eventDay = centralDay(EVENT);
    for (let k = 0; centralDay(NOW + k * DAY) <= addDays(eventDay, 1); k++) {
      const now = NOW + k * DAY;
      Date.now = () => now;
      await runInvitations(env as any, now, g.f).catch(() => null);
      const s = await section();
      for (const d of s?.decide ?? []) {
        if (/Board dinner/.test(d.title)) shownOn.calendar!.push(centralDay(now));
        if (/Founders/.test(d.title)) shownOn.platform!.push(centralDay(now));
      }
      if (k === 0) {
        const cal = await rowBy("calendar");
        const t = await tap(`/api/auth/tap/${cal.tap_token}?do=unsure`, "POST");
        expect(t.text).toMatch(/Simone will ask again on Mon 16 Nov/);
        expect((await rowBy("calendar")).status).toBe("unsure");
      }
    }
    // The Board dinner is Thu 19 Nov at 6 pm Central: Not sure on the 9th, back on the 16th, once.
    expect(shownOn.calendar).toEqual(["2026-11-09", "2026-11-16"]);
    // The untapped Luma card: the first morning, once more 3 days before, never a third time.
    expect(shownOn.platform).toEqual(["2026-11-09", "2026-11-16"]);
    expect((await rowBy("platform")).status).toBe("dropped");
    expect(sends(g.calls)).toEqual([]);
  });
});
