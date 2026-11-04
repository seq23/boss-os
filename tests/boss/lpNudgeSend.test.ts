/**
 * THE ONE LP NUDGE IS SENT ON HER YES AND REMEMBERED (4 Nov 2026 repair). The card offered it word
 * for word with no send button and nothing wrote `nudged_at`; her typed ask became a research job.
 * Synthetic data only: every name and address is invented.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { upsertLpRows } from "../../src/worker/boss/lp/desk";
import { sendLpNudge, skipLpNudge, nudgeFromWords, nudgeAddressesIn } from "../../src/worker/boss/lp/nudge";
import { lpNudgeBody, lpNudgeItems } from "../../src/shared/boss/lp/plan.mjs";

const DAY = 86_400_000;
const NOW = Date.now();

async function fakeServiceAccount(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey) as ArrayBuffer;
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der))).replace(/(.{64})/g, "$1\n");
  return JSON.stringify({ client_email: "bot@test.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` });
}

function gmail(opts: { failSend?: boolean } = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "ya29.fake" }), { status: 200 });
    if (/\/drafts\/send$/.test(url)) return opts.failSend ? new Response("no", { status: 500 }) : new Response(JSON.stringify({ id: "sent_1" }), { status: 200 });
    if (/\/drafts\/[^/?]+\?format=minimal/.test(url)) return new Response(JSON.stringify({ message: { id: "msg_nudge" } }), { status: 200 });
    if (/\/drafts$/.test(url) && init?.method === "POST") return new Response(JSON.stringify({ id: "dr_nudge", message: { id: "msg_nudge" } }), { status: 200 });
    return new Response("unexpected", { status: 500 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function seed(address: string, extra: Record<string, unknown> = {}) {
  await upsertLpRows(env.DB, [{
    address, name: "Robin Example", bucket: "call", reply_from: "sequoia@westpeek.ventures", thread_id: "thr_n",
    in_reply_to: "<n@example.com>", subject: "Re: hello", status: "sent", first_seen: "2026-10-01",
    sent_at: NOW - 8 * DAY, last_reply_at: NOW - 9 * DAY, ...extra,
  } as any], NOW);
  return (await env.DB.prepare(`SELECT * FROM lp_reply_drafts WHERE address = ?`).bind(address).first<any>())!;
}
const reread = (address: string) => env.DB.prepare(`SELECT * FROM lp_reply_drafts WHERE address = ?`).bind(address).first<any>();

describe("the LP nudge card can be acted on", () => {
  it("offers Send the nudge and No nudge as one-tap pages, and drops the row once nudged", async () => {
    const row = await seed("robin.card@example.com");
    const [card] = lpNudgeItems([row], NOW);
    expect(card.buttons.map((b: any) => b.label)).toEqual(["Send the nudge", "No nudge", "Open their thread"]);
    expect(card.buttons[0].url).toBe(`https://boss.sequoiataylor.com/tap/${row.tap_token}?do=nudge`);
    expect(card.buttons[1].url).toMatch(/\?do=nonudge$/);
    expect(lpNudgeItems([{ ...row, nudged_at: NOW }], NOW)).toEqual([]);
  });
});

describe("sending the nudge", () => {
  it("sends the card's exact words in their thread, once, and marks them nudged", async () => {
    const row = await seed("robin.send@example.com");
    const g = gmail();
    const e = { ...env, GSC_SERVICE_ACCOUNT_JSON: await fakeServiceAccount() } as never;
    const r = await sendLpNudge(e, row, "one_tap", NOW, g.f);
    expect(r.ok).toBe(true);
    const draft = g.calls.find((c) => /\/drafts$/.test(c.url) && c.method === "POST")!;
    const sent = JSON.parse(draft.body!);
    expect(sent.message.threadId).toBe("thr_n");
    const mime = atob(sent.message.raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(mime).toContain("To: robin.send@example.com");
    expect(mime).toContain("In-Reply-To: <n@example.com>");
    const body = decodeURIComponent(escape(atob(mime.split("\r\n\r\n")[1]!)));
    expect(body).toBe(lpNudgeBody(row));
    expect(g.calls.filter((c) => /\/drafts\/send$/.test(c.url))).toHaveLength(1);
    const after = await reread("robin.send@example.com");
    expect(after.nudged_at).toBe(NOW);
    expect(after.nudge_sent).toBe(1);
    expect(lpNudgeItems([after], NOW)).toEqual([]);
    // A second tap sends nothing.
    const g2 = gmail();
    const again = await sendLpNudge(e, after, "one_tap", NOW, g2.f);
    expect(again.ok).toBe(false);
    expect(g2.calls).toHaveLength(0);
  });

  it("a failed send releases the claim, says why, and keeps the card", async () => {
    const row = await seed("robin.fail@example.com");
    const e = { ...env, GSC_SERVICE_ACCOUNT_JSON: await fakeServiceAccount() } as never;
    const r = await sendLpNudge(e, row, "one_tap", NOW, gmail({ failSend: true }).f);
    expect(r.ok).toBe(false);
    expect(r.line).toMatch(/Nothing went/);
    const after = await reread("robin.fail@example.com");
    expect(after.nudged_at).toBeNull();
    expect(lpNudgeItems([after], NOW)).toHaveLength(1);
  });

  it("never nudges someone who wrote back, or whose reply has not gone", async () => {
    const e = { ...env, GSC_SERVICE_ACCOUNT_JSON: await fakeServiceAccount() } as never;
    const wrote = await seed("robin.wrote@example.com", { last_reply_at: NOW - DAY });
    const g = gmail();
    expect((await sendLpNudge(e, wrote, "one_tap", NOW, g.f)).ok).toBe(false);
    const held = await seed("robin.held@example.com", { status: "drafted", sent_at: null, draft_id: "d", draft_message_id: "m", draft_body: "x" });
    expect((await sendLpNudge(e, held, "one_tap", NOW, g.f)).ok).toBe(false);
    expect(g.calls).toHaveLength(0);
  });

  it("No nudge marks them with nothing sent", async () => {
    const row = await seed("robin.skip@example.com");
    expect((await skipLpNudge(env as never, row, NOW)).ok).toBe(true);
    const after = await reread("robin.skip@example.com");
    expect(after.nudged_at).toBe(NOW);
    expect(after.nudge_sent).toBe(0);
  });
});

describe("her own words reach the nudge, never a research job", () => {
  it("reads the address only when she says nudge", () => {
    expect(nudgeAddressesIn("Send one gentle nudge to Robin (Robin.Words@Example.com), word for word")).toEqual(["robin.words@example.com"]);
    expect(nudgeAddressesIn("email robin.words@example.com about Friday")).toEqual([]);
  });
  it("her typed ask sends the nudge to a tracker row and answers in plain words; an unknown address is left alone", async () => {
    await seed("robin.words@example.com");
    const e = { ...env, GSC_SERVICE_ACCOUNT_JSON: await fakeServiceAccount() } as never;
    const g = gmail();
    const text = "Send one gentle nudge to Robin Example (robin.words@example.com), in our existing thread from sequoia@westpeek.ventures, word for word. This is the one follow-up; mark her nudged so it is never offered again.";
    const r = await nudgeFromWords(e, text, NOW, g.f);
    expect(r?.sent).toBe(1);
    expect(r?.note).toMatch(/nudge went to Robin Example/);
    expect((await reread("robin.words@example.com")).nudged_at).toBe(NOW);
    expect(await nudgeFromWords(e, "nudge nobody@example.com please", NOW, gmail().f)).toBeNull();
  });
});
