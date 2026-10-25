/**
 * SIMONE DOES IT BY EMAIL (owner, 25 Oct 2026) — each ability driven end to end through the real
 * intake: her email → `handleBossInboundMail` → the command → what happened, against a fake Google
 * that records every call. Each is proven negatively too: a stranger's identical mail does nothing,
 * a clash sends nothing, and NOTHING reaches Gmail's send until her Send.
 *
 * Fixtures only: no real person, address or code appears here.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { recordMailRefs } from "../../src/worker/boss/intake/mailRefs";
import { setCommandFetch } from "../../src/worker/boss/commands/google";

const NOW = Date.parse("2026-10-25T17:00:00Z"); // a Sunday, noon Central

function mail(o: { from?: string; subject?: string; body?: string; dmarc?: string; messageId?: string; inReplyTo?: string; references?: string; to?: string }) {
  const from = o.from ?? "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({
    from, subject: o.subject ?? "",
    "authentication-results": o.dmarc ?? "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": o.messageId ?? `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
    ...(o.inReplyTo ? { "in-reply-to": o.inReplyTo } : {}),
    ...(o.references ? { references: o.references } : {}),
  });
  const raw = `From: ${from}\r\nSubject: ${o.subject ?? ""}\r\n\r\n${o.body ?? ""}`;
  return { from: from.replace(/.*<|>.*/g, ""), to: o.to ?? "boss@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length };
}

async function fakeKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der))).replace(/(.{64})/g, "$1\n");
  return JSON.stringify({ client_email: "bot@test.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` });
}

/** A fake Google: token, calendar list/insert/get/patch/delete, Gmail send. Remembers every call. */
let calls: Array<{ url: string; method: string; body: string | null }> = [];
let busy: Array<Record<string, unknown>> = [];
function fakeGoogle(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : null });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "ya29.fake" });
    if (url.includes("/calendar/v3/calendars/primary/events") && method === "GET" && url.includes("timeMin")) return Response.json({ items: busy });
    if (url.includes("/calendar/v3/calendars/primary/events?conferenceDataVersion=1") && method === "POST") return Response.json({ id: "evt_fake1", hangoutLink: "https://meet.google.com/abc-defg-hij", htmlLink: "https://calendar.google.com/event?eid=x" });
    if (url.includes("/events/evt_fake1") && method === "GET") return Response.json({ id: "evt_fake1", attendees: [{ email: "guest@example.com" }] });
    if (url.includes("/events/evt_fake1") && (method === "PATCH" || method === "DELETE")) return method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ id: "evt_fake1" });
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") return Response.json({ id: "msg_fake1" });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
}
const sends = () => calls.filter((c) => c.url.includes("/messages/send"));
const inserts = () => calls.filter((c) => c.method === "POST" && c.url.includes("/events?conferenceDataVersion"));

async function say(body: string, o: { from?: string; dmarc?: string; to?: string; subject?: string } = {}) {
  const messageId = `<m-${Math.random().toString(36).slice(2)}@mail.gmail.com>`;
  const res = await handleBossInboundMail(mail({ ...o, body, messageId }) as never, env as never);
  return { res, messageId };
}
/** Her reply on the thread of an email that carried `cmdId` (the refs record the reply path writes). */
async function replyTo(prev: { messageId: string }, cmdId: string, body: string) {
  await recordMailRefs(env.DB, { messageId: prev.messageId, refs: [cmdId] });
  const messageId = `<r-${Math.random().toString(36).slice(2)}@mail.gmail.com>`;
  const res = await handleBossInboundMail(mail({ subject: "Re: x", body, messageId, inReplyTo: prev.messageId, references: prev.messageId }) as never, env as never);
  return { res, messageId };
}
const cmdIn = (reply: string | null) => /\[(cmd_[a-z0-9]+)\]/.exec(reply ?? "")?.[1] ?? null;
const command = async (id: string) => env.DB.prepare(`SELECT * FROM boss_commands WHERE id = ?`).bind(id).first<any>();
const commandsOfKind = async (kind: string) => ((await env.DB.prepare(`SELECT * FROM boss_commands WHERE kind = ? ORDER BY created_at`).bind(kind).all<any>()).results ?? []);

let KEY = "";
beforeAll(async () => { KEY = await fakeKey(); });
beforeEach(async () => {
  calls = []; busy = [];
  (env as any).GSC_SERVICE_ACCOUNT_JSON = KEY;
  setCommandFetch(fakeGoogle());
  Date.now = (() => { let t = NOW; return () => (t += 1000); })();
  await env.DB.exec("DELETE FROM boss_commands");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});
afterEach(() => { setCommandFetch(null); delete (env as any).GSC_SERVICE_ACCOUNT_JSON; Date.now = REAL_NOW; });
const REAL_NOW = Date.now;

describe("1. a calendar invite by email", () => {
  const ASK = "Send a calendar invite to Avery at Example Law for Tuesday this week 10am ET, guest@example.com.";

  it("creates the event with a Meet link, invites the guest, and confirms in one plain line in both zones", async () => {
    const { res } = await say(ASK);
    expect(res.outcome).toBe("COMMAND");
    expect(res.reply).toContain("Invite sent to Avery (guest@example.com) for Tue 27 Oct, 9:00–9:30 am Central");
    expect(res.reply).toContain("10:00–10:30 am Eastern for them");
    expect(res.reply).toContain("Meet: https://meet.google.com/abc-defg-hij");
    const ins = inserts();
    expect(ins).toHaveLength(1);
    expect(ins[0]!.url).toContain("sendUpdates=all");
    const body = JSON.parse(ins[0]!.body!);
    expect(body.attendees).toEqual([{ email: "guest@example.com" }]);
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
    expect(body.start.dateTime).toBe("2026-10-27T14:00:00.000Z");
    expect(body.end.dateTime).toBe("2026-10-27T14:30:00.000Z");
    // The clash check ran first, on the same slot.
    expect(calls.findIndex((c) => c.url.includes("timeMin"))).toBeLessThan(calls.indexOf(ins[0]!));
  });

  it("NEGATIVE: the same words from a stranger reach no calendar and create no command", async () => {
    const { res } = await say(ASK, { from: "Someone <someone@example.org>", dmarc: "dmarc=pass" });
    expect(res.outcome).toBe("REFUSED_SENDER");
    expect(calls).toHaveLength(0);
    expect(await commandsOfKind("invite")).toHaveLength(0);
  });

  it("a clash sends nothing and says so; 'book it anyway' on the thread books the same command", async () => {
    busy = [{ summary: "Board prep", start: { dateTime: "2026-10-27T13:30:00Z" }, end: { dateTime: "2026-10-27T14:30:00Z" } }];
    const first = await say(ASK);
    expect(first.res.reply).toMatch(/clashes with "Board prep"/);
    expect(inserts()).toHaveLength(0);
    const id = cmdIn(first.res.reply)!;
    expect((await command(id)).state).toBe("clash");
    const again = await replyTo(first, id, "book it anyway");
    expect(again.res.outcome).toBe("COMMAND_REPLY");
    expect(inserts()).toHaveLength(1);
    expect((await command(id)).state).toBe("created");
  });

  it("her personal Gmail calendar gets a one-tap Add link with the guest on it, and no Google call", async () => {
    const { res } = await say("Put a call with Avery on my personal calendar tomorrow at 3pm for an hour, guest@example.com");
    expect(res.reply).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(res.reply).toContain("add=guest%40example.com");
    expect(res.reply).toContain("dates=20261026T200000Z%2F20261026T210000Z");
    expect(calls).toHaveLength(0);
  });

  it("a bounce asks for the new address, and the reply updates THE SAME event (no second invite)", async () => {
    const first = await say(ASK);
    const id = cmdIn(first.res.reply)!;
    const b = await api(`/api/commands/${id}/bounced`, { method: "POST", body: { address: "guest@example.com" } });
    expect(b.status).toBe(200);
    const row = await command(id);
    expect(row.state).toBe("bounced");
    expect(row.notice_state).toBe("due");
    expect(JSON.parse(row.notice).happened).toMatch(/bounced.*What's the right address/);
    const fixed = await replyTo(first, id, "Sorry, it's right@example.com");
    expect(fixed.res.reply).toMatch(/Updated the same invite: right@example.com/);
    expect(inserts()).toHaveLength(1);
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("/events/evt_fake1?sendUpdates=all");
    expect(JSON.parse(patch.body!).attendees).toEqual([{ email: "right@example.com" }]);
  });

  it("cancel removes the same event without emailing the guest", async () => {
    const first = await say(ASK);
    const id = cmdIn(first.res.reply)!;
    const r = await (await api(`/api/commands/${id}/cancel`, { method: "POST" })).json<any>();
    expect(r.data.line).toMatch(/Cancelled the invite to Avery/);
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.url).toContain("/events/evt_fake1?sendUpdates=none");
    expect((await command(id)).state).toBe("cancelled");
  });

  it("no time → she is asked for one and nothing is booked", async () => {
    const { res } = await say("Send a calendar invite to Avery, guest@example.com");
    expect(res.reply).toMatch(/couldn't tell the time/);
    expect(calls).toHaveLength(0);
  });
});

describe("2. find a person, make a code, email them — never to a guessed address, never without her Send", () => {
  const ASK = "Find my cousin Rowan's email; it's one of the addresses shared on the Smith family reunion Drive files. "
    + "Create a time-2-read code TESTCODE15 for a 15-day trial, and email her the code with a short explainer of what time-2-read is, its features and how it compares with others.";

  it("the whole arc", async () => {
    const first = await say(ASK);
    expect(first.res.outcome).toBe("COMMAND");
    expect(first.res.reply).toMatch(/Finding Rowan's email/);
    expect(first.res.reply).toMatch(/Making the time-2-read code TESTCODE15: a 15-day trial/);
    expect(first.res.reply).toMatch(/Nothing goes until you tap Send/);
    const [lookup] = await commandsOfKind("lookup");
    const [code] = await commandsOfKind("access_code");
    const [email] = await commandsOfKind("email");
    expect(lookup.state).toBe("queued");
    expect(email.state).toBe("waiting");
    expect(email.waits_on.split(",").sort()).toEqual([lookup.id, code.id].sort());

    // The Mac's tick sees the lookup and the code.
    const tick = await (await api("/api/commands/tick", { method: "POST" })).json<any>();
    expect(tick.data.lookups.map((l: any) => l.id)).toEqual([lookup.id]);
    expect(tick.data.lookups[0].spec.hints).toEqual(["Smith family reunion"]);
    expect(tick.data.codes.map((c: any) => c.id)).toEqual([code.id]);

    // Two plausible addresses → she picks. An address with no evidence is dropped, never offered.
    await api(`/api/commands/${lookup.id}/lookup`, { method: "POST", body: { candidates: [
      { email: "rowan.a@example.com", name: "Rowan A", evidence: ['shared on "Smith Family Reunion 2025"'] },
      { email: "rowan.b@example.com", name: "Rowan B", evidence: ["emailed you on 2026-06-01"] },
      { email: "guess@example.com", name: "Rowan", evidence: [] },
    ] } });
    const picking = await command(lookup.id);
    expect(picking.state).toBe("picking");
    const n = JSON.parse(picking.notice);
    expect(n.details).toHaveLength(2);
    expect(n.details.join(" ")).not.toContain("guess@example.com");
    expect((await command(email.id)).state).toBe("waiting");

    const picked = await replyTo(first, lookup.id, "2");
    expect(picked.res.reply).toMatch(/Using rowan.b@example.com for Rowan/);
    expect((await command(email.id)).state).toBe("drafting");

    // The draft comes back from her Mac: shown word for word, with the three taps.
    await api(`/api/commands/${email.id}/draft`, { method: "POST", body: { subject: "A code for you", text: "Hi Rowan,\n\nHere is your code: TESTCODE15.\n\nSequoia" } });
    const shown = await command(email.id);
    expect(shown.state).toBe("shown");
    const card = JSON.parse(shown.notice).decide[0];
    expect(card.draft.text).toBe("Hi Rowan,\n\nHere is your code: TESTCODE15.\n\nSequoia");
    expect(card.buttons.map((b: any) => b.label)).toEqual(["Send", "Change", "Try again"]);
    expect(card.buttons[0].url).toMatch(/^https:\/\/boss\.sequoiataylor\.com\/tap\/cmd[A-Za-z0-9]+\?do=send$/);
    expect(card.body).toContain("From st@time-2-read.com");

    // NEGATIVE: nothing has been sent to anyone, and a GET of the Send link does not send.
    expect(sends()).toHaveLength(0);
    const token = shown.tap_token as string;
    const get = await api(`/api/auth/tap/${token}?do=send`);
    expect(await get.text()).toContain("Tap to confirm");
    expect(sends()).toHaveLength(0);

    // Her Send before the code exists: held, not sent.
    const held = await api(`/api/auth/tap/${token}?do=send`, { method: "POST" });
    expect(await held.text()).toMatch(/Held until/);
    expect(sends()).toHaveLength(0);
    expect((await command(email.id)).state).toBe("held");

    // The code is made (the Mac's answer) → the held email goes, EXACTLY as she saw it.
    await api(`/api/commands/${code.id}/code`, { method: "POST", body: { done: true, codes: [{ code: "TESTCODE15", trial_days: 15, label: null, active: true, checkouts_started: 0, signups: 0 }] } });
    expect(sends()).toHaveLength(1);
    const raw = JSON.parse(sends()[0]!.body!).raw as string;
    const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded).toContain("To: rowan.b@example.com");
    expect(decoded).toContain("From: Sequoia Taylor <st@time-2-read.com>");
    expect(decodeURIComponent(escape(atob(decoded.split("\r\n\r\n")[1]!)))).toBe("Hi Rowan,\n\nHere is your code: TESTCODE15.\n\nSequoia");
    expect((await command(email.id)).state).toBe("sent");
    const codeNotice = JSON.parse((await command(code.id)).notice);
    expect(codeNotice.happened).toMatch(/Made the time-2-read code TESTCODE15: a 15-day trial/);
    expect(codeNotice.details.join("\n")).toMatch(/TESTCODE15: 15-day trial\. Used 0 times, 0 signed up\./);
  });

  it("Change and Try again redraft; 'send' by reply is the same Send; a used link has done its job", async () => {
    const first = await say("Email them@example.com a short thank-you note for the intro.");
    const [email] = await commandsOfKind("email");
    expect(email.state).toBe("drafting");
    await api(`/api/commands/${email.id}/draft`, { method: "POST", body: { subject: "Thank you", text: "Thank you!\n\nSequoia" } });
    const ch = await replyTo(first, email.id, "change: warmer, and mention the dinner");
    expect(ch.res.reply).toMatch(/Changing it: "warmer, and mention the dinner"/);
    const tick = await (await api("/api/commands/tick", { method: "POST" })).json<any>();
    expect(tick.data.drafts[0]).toMatchObject({ id: email.id, change_note: "warmer, and mention the dinner", previous: "Thank you!\n\nSequoia" });
    await api(`/api/commands/${email.id}/draft`, { method: "POST", body: { subject: "Thank you", text: "Thank you so much, and for dinner.\n\nSequoia" } });
    expect(sends()).toHaveLength(0);
    const sent = await replyTo(first, email.id, "send");
    expect(sent.res.reply).toMatch(/Sent to them@example.com from sequoia@westpeek.ventures/);
    expect(sends()).toHaveLength(1);
    const token = (await command(email.id)).tap_token;
    expect(await (await api(`/api/auth/tap/${token}?do=send`, { method: "POST" })).text()).toContain("done its job");
    expect(sends()).toHaveLength(1);
  });

  it("repo work that is more than a row goes to Danielle's repo-change lane, never inline", async () => {
    const { res } = await say("Fix the time-2-read signup page footer so the links work.");
    expect(res.reply).toMatch(/Danielle has the time-2-read change/);
    const [repo] = await commandsOfKind("repo");
    expect(repo.task_id).toBeTruthy();
    const task = await env.DB.prepare(`SELECT employee_id, input FROM tasks WHERE id = ?`).bind(repo.task_id).first<any>();
    expect(task.employee_id).toBe("emp_repo");
    expect(JSON.parse(task.input).repo_change.github_repo).toBe("seq23/dailystory");
  });
});

describe("3. time-2-read codes with no rebuild", () => {
  it("make / count / turn off each become one queued code command and a plain line", async () => {
    const make = await say("make a time-2-read code TEACHERS30 for 30 days for the teachers group");
    expect(make.res.reply).toMatch(/Making the time-2-read code TEACHERS30: a 30-day trial for teachers group\. No rebuild/);
    const count = await say("How many used FIXTURE15?");
    expect(count.res.reply).toMatch(/Counting who has used FIXTURE15/);
    const off = await say("Turn off code OLDCODE9");
    expect(off.res.reply).toMatch(/Turning off the time-2-read code OLDCODE9/);
    const specs = (await commandsOfKind("access_code")).map((r) => JSON.parse(r.spec));
    expect(specs.map((s) => [s.op, s.code])).toEqual([["create", "TEACHERS30"], ["count", "FIXTURE15"], ["off", "OLDCODE9"]]);
    expect(specs[0]).toMatchObject({ trial_days: 30, label: "teachers group" });
  });

  it("no key on the Mac → the code still gets made, by Danielle, as a one-line migration", async () => {
    await say("make a time-2-read code TEACHERS30 for 30 days for the teachers group");
    const [row] = await commandsOfKind("access_code");
    await api(`/api/commands/${row.id}/failed`, { method: "POST", body: { why: "time-2-read's Supabase service key is not in the vault" } });
    const after = await command(row.id);
    expect(after.state).toBe("handed");
    const task = await env.DB.prepare(`SELECT employee_id, input FROM tasks WHERE id = ?`).bind(after.task_id).first<any>();
    expect(task.employee_id).toBe("emp_repo");
    expect(JSON.parse(task.input).body).toContain("insert into public.access_codes (code, trial_days, label) values ('TEACHERS30', 30, 'teachers group')");
  });
});

describe("4. what Simone cannot do yet, and what is not hers", () => {
  it("a can't-yet is one line and a Danielle job, never silence", async () => {
    const { res } = await say("Text Jordan that I'm running ten minutes late.");
    expect(res.reply).toMatch(/I can't send a text message yet\. Danielle has a job to add it/);
    const [row] = await commandsOfKind("cant_yet");
    const task = await env.DB.prepare(`SELECT employee_id FROM tasks WHERE id = ?`).bind(row.task_id).first<any>();
    expect(task.employee_id).toBe("emp_repo");
  });

  it("NEGATIVE: mail tagged for another desk, or to another employee's address, is that desk's", async () => {
    const tagged = await say("#monique email them@example.com the list");
    expect(tagged.res.outcome).not.toMatch(/^COMMAND/);
    const direct = await say("email them@example.com the list", { to: "monique@sequoiataylor.com" });
    expect(direct.res.outcome).not.toMatch(/^COMMAND/);
    expect(await commandsOfKind("email")).toHaveLength(0);
  });

  it("NEGATIVE: an ordinary request is not a command and goes to the triage as before", async () => {
    const { res } = await say("What are the three cheapest ways to host a static website?");
    expect(res.outcome).not.toMatch(/^COMMAND/);
  });
});
