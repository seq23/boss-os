/**
 * HER "N: …" ON THE MORNING EMAIL REACHES CARD N, AND THE QUOTED MORNING IS NEVER HER WORDS
 * (incident 27 Oct 2026). She answered Decide card 2, an LP who wrote back, with "2: Hi …, Tuesday
 * at 9am PT works well. Please send the invite to …". The reply was handed to Monique "Matched on:
 * seller, shares" and a $200M seller hunt was queued, from words that were only in the QUOTED
 * morning email (its new-deals grid). Synthetic data only: every name, firm and address is fake.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { decideAnswerFromMail, DECIDE_ANSWER_RE } from "../../src/worker/boss/lp/decideReply";
import { upsertLpRows } from "../../src/worker/boss/lp/desk";
import { ownWords } from "../../src/shared/boss/intake/messageBody.mjs";
import { view } from "../../src/worker/boss/routes/morning";

const DAY = "2026-10-27";
const LP = "pat.example@lp-fund.example";

/** The morning email as her mail client quotes it under her answer: deals and Monique's finds included. */
const QUOTED_MORNING = [
  "On Tue, Oct 27, 2026 at 6:40 AM Simone <boss@sequoiataylor.com> wrote:",
  "",
  "> Decide (3)",
  "> 1. Start Danielle's plan for example-repo?",
  "> 2. Answer Pat Example at Example LP Fund: they wrote back after your reply",
  "> Reply \"2: …\" to this email to answer this one.",
  "> New deals since yesterday (6)",
  "> Stripe | seller | $200M @ $30 | Example Broker",
  "> Monique found",
  "> Stripe: seller → buyer, shares, size fits, prices close, fresh",
].join("\n");

const HER_ANSWER = "2: Hi Pat, Thank you. Tuesday, November 17 at 9am PT works well. Please send the invite to the address below.\n\nBest, S";

function mail(body: string, opts: { messageId?: string; inReplyTo?: string; subject?: string } = {}) {
  const from = "Sequoia <seq.taylor@gmail.com>";
  const subject = opts.subject ?? "Re: Tuesday: 3 decisions, 6 new deals, Valerie's list";
  const headers = new Headers({
    from, subject,
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": opts.messageId ?? `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
    ...(opts.inReplyTo ? { "in-reply-to": opts.inReplyTo, references: opts.inReplyTo } : {}),
  });
  const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return { from: "seq.taylor@gmail.com", to: "boss@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: raw.length };
}

async function morning(decide: any[]) {
  const now = Date.now();
  await env.DB.prepare(`INSERT OR REPLACE INTO morning_digests (day, payload, sent_at, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .bind(DAY, JSON.stringify({ day: DAY, decide }), now, now, now).run();
  // The morning email's own code, recorded against its Message-ID as your-day.mjs does.
  await env.DB.prepare(`INSERT OR REPLACE INTO boss_mail_refs (message_id, refs, context, created_at) VALUES (?,?,?,?)`)
    .bind("<yd-20261027@boss>", "yd_20261027", "Decide (3)", now).run();
}

const LP_CARD = (key: string | null) => ({
  id: "decide-abc1234567", ...(key ? { key } : {}), title: "Answer Pat Example at Example LP Fund: they wrote back after your reply",
  body: "Who: an LP.", details: [`Their email: ${LP}`, "No reply is drafted for this one: it needs your own words.", "Reply \"2: …\" to this email to answer this one."],
  screen: `https://boss.sequoiataylor.com/?morning=${DAY}&item=decide-abc1234567`,
});

async function seedLp() {
  await upsertLpRows(env.DB, [{
    address: LP, name: "Pat Example", firm: "Example LP Fund", bucket: "call", reply_from: "sequoia@westpeek.ventures",
    thread_id: "thr_fake_1", in_reply_to: "<their-msg@lp-fund.example>", subject: "Re: Example outreach", status: "replied_again",
    first_seen: "2026-10-01", sent_at: Date.parse("2026-10-10T15:00:00Z"), last_reply_at: Date.parse("2026-10-26T15:00:00Z"),
    last_reply_text: "Would Tuesday work?",
  }]);
  return env.DB.prepare(`SELECT * FROM lp_reply_drafts WHERE address = ?`).bind(LP).first<any>();
}

async function fakeServiceAccount(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey) as ArrayBuffer;
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der))).replace(/(.{64})/g, "$1\n");
  return JSON.stringify({ client_email: "bot@test.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` });
}

function fakeGmail() {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "ya29.fake", expires_in: 3600 }), { status: 200 });
    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/drafts")) return new Response(JSON.stringify({ id: "r-draft-1", message: { id: "m-draft-1" } }), { status: 200 });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const huntTasks = async () => ((await env.DB.prepare(`SELECT id, input FROM tasks WHERE input LIKE '%"hunt"%'`).all<any>()).results ?? []);
const handoffs = async (mailId: string) => ((await env.DB.prepare(`SELECT id FROM audit_log WHERE entity_id = ? AND action = 'handed_off'`).bind(mailId).all<any>().catch(() => ({ results: [] }))).results ?? []);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM morning_digests; DELETE FROM lp_reply_drafts; DELETE FROM boss_mail_refs; DELETE FROM boss_inbound_mail;");
  await env.DB.exec(`DELETE FROM tasks WHERE input LIKE '%"hunt"%'`);
});

describe("her own words, never the quoted email", () => {
  it("ownWords stops at the client's quote, wrapped or not, and keeps a forward", () => {
    expect(ownWords(`${HER_ANSWER}\n\n${QUOTED_MORNING}`)).toBe(HER_ANSWER);
    expect(ownWords("ok\n\nOn Tue, Oct 27, 2026 at 6:40 AM Simone <\nboss@sequoiataylor.com> wrote:\n> seller of shares")).toBe("ok");
    expect(ownWords("see below\n---------- Forwarded message ---------\nFrom: a@example.com\nseller of shares")).toContain("seller of shares");
    expect(DECIDE_ANSWER_RE.test("2 people called")).toBe(false);
  });

  it("THE INCIDENT, with no card to reach: the quoted seller/shares/$200M neither hands off nor opens a hunt", async () => {
    const res = await handleBossInboundMail(mail(`Thanks, see you then.\n\n${QUOTED_MORNING}`), env as never);
    expect(await huntTasks()).toEqual([]);
    expect(String(res.reply ?? "")).not.toMatch(/Matched on|seller|shares/i);
    expect(await handoffs(res.mailId)).toEqual([]);
  });
});

describe("\"2: …\" on an LP Decide card reaches that card", () => {
  it("THE INCIDENT: lands on card 2, opens no hunt and no job, and tells her plainly", async () => {
    await seedLp();
    await morning([{ id: "decide-1", key: "rc:rc_fake", title: "Start Danielle's plan?" }, LP_CARD(`lp-again:${LP}`), { id: "decide-3", key: "approval:apr_x", title: "Approve?" }]);
    const res = await handleBossInboundMail(mail(`${HER_ANSWER}\n\n${QUOTED_MORNING}`, { inReplyTo: "<yd-20261027@boss>" }), env as never);
    expect(res.outcome).toBe("DECIDE_ANSWERED");
    expect(res.taskId ?? null).toBeNull();
    expect(await huntTasks()).toEqual([]);
    expect(await handoffs(res.mailId)).toEqual([]);
    // No Google key in the test Worker: her words are kept on the card and she is told, nothing sent.
    expect(String(res.reply)).toContain("Nothing was sent");
    const p = JSON.parse((await env.DB.prepare(`SELECT payload FROM morning_digests WHERE day = ?`).bind(DAY).first<any>()).payload);
    expect(p.decide[1].answer.words).toBe(HER_ANSWER.replace(/^2:\s*/, ""));
    expect(p.decide[0].answer).toBeUndefined();
  });

  it("a morning kept before cards carried keys still finds the LP by the card's own address line", async () => {
    await seedLp();
    await morning([{ id: "decide-1", title: "x" }, LP_CARD(null)]);
    const res = await handleBossInboundMail(mail(`${HER_ANSWER}\n\n${QUOTED_MORNING}`, { inReplyTo: "<yd-20261027@boss>" }), env as never);
    expect(res.outcome).toBe("DECIDE_ANSWERED");
    expect(await huntTasks()).toEqual([]);
  });

  it("with Google reachable: her words, word for word, are the held reply in their thread, sent only by the existing Send-as-is tap", async () => {
    const row = await seedLp();
    await morning([{ id: "decide-1", key: "rc:rc_fake", title: "x" }, LP_CARD(`lp-again:${LP}`)]);
    const g = fakeGmail();
    const e = { ...env, GSC_SERVICE_ACCOUNT_JSON: await fakeServiceAccount() } as never;
    const r = await decideAnswerFromMail(e, { text: `${HER_ANSWER}\n\n${QUOTED_MORNING}`, refs: ["yd_20261027"], subject: "Re: Tuesday: 3 decisions", mailId: "iml_fake", now: Date.now() }, g.fetchImpl);
    const words = HER_ANSWER.replace(/^2:\s*/, "");
    expect(r?.outcome).toBe("DECIDE_ANSWERED");
    // Only a draft call: nothing is sent from here.
    expect(g.calls.filter((c) => c.url.includes("/send"))).toEqual([]);
    const draftCall = g.calls.find((c) => c.url.endsWith("/drafts"))!;
    const sent = JSON.parse(draftCall.body!);
    expect(sent.message.threadId).toBe("thr_fake_1");
    const mime = atob(sent.message.raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(mime).toContain(`To: ${LP}`);
    expect(mime).toContain("In-Reply-To: <their-msg@lp-fund.example>");
    const after = await env.DB.prepare(`SELECT * FROM lp_reply_drafts WHERE id = ?`).bind(row.id).first<any>();
    expect(after).toMatchObject({ status: "drafted", draft_id: "r-draft-1", draft_message_id: "m-draft-1", draft_body: words, decision: "edit" });
    expect(r!.note).toContain(`Tap to send it: https://boss.sequoiataylor.com/tap/${after.tap_token}?do=send`);
    for (const line of words.split("\n").filter(Boolean)) expect(r!.note).toContain(`> ${line}`);
    // The card leaves Decide on Today and its screen still opens.
    const v = view(await env.DB.prepare(`SELECT * FROM morning_digests WHERE day = ?`).bind(DAY).first<any>()) as any;
    expect(v.payload.decide.map((d: any) => d.id)).toEqual(["decide-1"]);
    expect(v.payload.answered.map((d: any) => d.id)).toEqual(["decide-abc1234567"]);
    // The next morning read still sees "they wrote again"; her held words stay, ready for the tap.
    await upsertLpRows(env.DB, [{ address: LP, name: "Pat Example", bucket: "call", reply_from: "sequoia@westpeek.ventures", thread_id: "thr_fake_1", status: "replied_again", first_seen: "2026-10-01" }]);
    expect(await env.DB.prepare(`SELECT status, draft_body, draft_message_id FROM lp_reply_drafts WHERE id = ?`).bind(row.id).first<any>())
      .toMatchObject({ status: "drafted", draft_body: words, draft_message_id: "m-draft-1" });
  });

  it("a numbered answer on another email's thread is not taken for a morning card", async () => {
    await seedLp();
    await morning([{ id: "d1", title: "x" }, LP_CARD(`lp-again:${LP}`)]);
    const r = await decideAnswerFromMail(env as never, { text: "2: hide", refs: ["cw_fake123"], subject: "Re: [Monique] comments", mailId: "iml_x", now: Date.now() });
    expect(r).toBeNull();
  });
});
