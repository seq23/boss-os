/**
 * LP SCHEDULING, ONE TAP — THE WORKER HALF (owner, 31 Oct 2026).
 *
 * A positive LP reply leaves a held draft with 2–3 free times on the row, word for word; nothing goes
 * until she taps. Her tap on a confirmation sends the reply AND the calendar invite, once, and only if
 * the time is still free. The router refuses any cloud model for an LP scheduling draft. Synthetic
 * data only: every name and address is invented.
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { upsertLpRows } from "../../src/worker/boss/lp/desk";
import { sendHeldLp, lpRow } from "../../src/worker/boss/lp/heldReply";
import { setCommandFetch } from "../../src/worker/boss/commands/google";
import { whereSheIs } from "../../src/worker/boss/lp/schedule";
import { routeCompletion } from "../../src/worker/boss/router";
import { isConfidentialDraft, confidentialLadder } from "../../src/worker/boss/duties/seatOrder";
import { lpConfirmBody, lpTimesBody, openSlots, zoneResolver, slotText } from "../../src/shared/boss/lp/schedule.mjs";
import { lpDecideItems } from "../../src/shared/boss/lp/plan.mjs";

const NOW = Date.now();
const zoneOn = zoneResolver({ homeZone: "America/Chicago" });
const SLOTS = openSlots([], { now: NOW, zoneOn });

async function fakeServiceAccount(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey) as ArrayBuffer;
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der))).replace(/(.{64})/g, "$1\n");
  return JSON.stringify({ client_email: "bot@test.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` });
}

/** A fake Google: token, draft read/send (Gmail) and events list/insert (Calendar). */
function google(opts: { busy?: boolean } = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "ya29.fake" }), { status: 200 });
    if (/\/drafts\/send$/.test(url)) return new Response(JSON.stringify({ id: "sent_1" }), { status: 200 });
    if (/\/drafts\/[^/?]+\?format=minimal/.test(url)) return new Response(JSON.stringify({ message: { id: "msg_held" } }), { status: 200 });
    if (/calendar\/v3\/calendars\/primary\/events\?.*timeMin/.test(url)) {
      const items = opts.busy ? [{ status: "confirmed", summary: "Busy", start: { dateTime: new Date(SLOTS[0]!.start).toISOString() }, end: { dateTime: new Date(SLOTS[0]!.start + 3600_000).toISOString() } }] : [];
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    if (/calendar\/v3\/calendars\/primary\/events\?conferenceDataVersion=1&sendUpdates=all/.test(url)) return new Response(JSON.stringify({ id: "evt_1", hangoutLink: "https://meet.example/abc" }), { status: 200 });
    return new Response("unexpected", { status: 500 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function seed(address: string, extra: Record<string, unknown>) {
  await upsertLpRows(env.DB, [{
    address, name: "Avery Example", bucket: "call", reply_from: "sequoia@westpeek.ventures", thread_id: "thr_1",
    in_reply_to: "<x@example.com>", subject: "Re: hello", status: "replied_again", first_seen: "2026-10-01",
    sent_at: NOW - 5 * 86_400_000, last_reply_at: NOW - 86_400_000, draft_id: "dr_1", draft_message_id: "msg_held", ...extra,
  } as any], NOW);
  return (await env.DB.prepare(`SELECT * FROM lp_reply_drafts WHERE address = ?`).bind(address).first<any>())!;
}

afterEach(() => setCommandFetch(null));

describe("a positive LP reply → a held draft with 2–3 free times, nothing sent", () => {
  it("the row keeps the draft word for word with its offered times, and the card offers Send as is — no send happened", async () => {
    expect(SLOTS.length).toBeGreaterThanOrEqual(2);
    expect(SLOTS.length).toBeLessThanOrEqual(3);
    const body = lpTimesBody({ name: "Avery Example", slots: SLOTS });
    const row = await seed("avery.times@example.com", { draft_body: body, offered_slots: JSON.stringify(SLOTS), last_reply_text: "Happy to chat, when works?" });
    expect(row.draft_body).toBe(body);
    expect(JSON.parse(row.offered_slots)).toEqual(SLOTS);
    expect(row.status).toBe("replied_again");
    expect(row.sent_at).toBe(NOW - 5 * 86_400_000); // the earlier reply only; nothing new went
    const [card] = lpDecideItems([row], NOW);
    expect(card!.title).toContain(`offers ${SLOTS.length} times`);
    expect(card!.buttons[0]!.label).toBe("Send as is");
  });
});

describe("her tap on a confirmation sends the reply and the invite, once, only if still free", () => {
  it("free: drafts/send, then ONE invite from the mailbox they wrote to, the LP the only guest", async () => {
    const pick = SLOTS[0]!;
    const row = await seed("avery.pick@example.com", { draft_body: lpConfirmBody({ name: "Avery", slot: pick }), picked_start: pick.start, picked_zone: pick.zone, last_reply_text: "Works for me" });
    const g = google();
    setCommandFetch(g.f);
    const e = { ...env, GSC_SERVICE_ACCOUNT_JSON: await fakeServiceAccount() } as never;
    const r = await sendHeldLp(e, row, NOW, g.f);
    expect(r.ok).toBe(true);
    expect(r.line).toContain(`calendar invite for ${slotText(pick)} went too`);
    const sendAt = g.calls.findIndex((c) => /drafts\/send$/.test(c.url));
    const inviteAt = g.calls.findIndex((c) => /sendUpdates=all/.test(c.url));
    expect(sendAt).toBeGreaterThan(-1);
    expect(inviteAt).toBeGreaterThan(sendAt);
    const ev = JSON.parse(g.calls[inviteAt]!.body!);
    expect(ev.attendees).toEqual([{ email: "avery.pick@example.com" }]);
    expect(Date.parse(ev.start.dateTime)).toBe(pick.start);
    expect(JSON.stringify(ev)).not.toContain("Avery"); // the title carries no LP name
    const after = await lpRow(env as never, row.id);
    expect(after.status).toBe("scheduled");
    expect(after.invite_for_start).toBe(pick.start);
    // A second tap sends nothing more.
    const again = await sendHeldLp(e, after, NOW, g.f);
    expect(again.ok).toBe(false);
    expect(g.calls.filter((c) => /sendUpdates=all/.test(c.url))).toHaveLength(1);
  });

  it("taken since: NOTHING is sent (the reply promises an invite)", async () => {
    const pick = SLOTS[0]!;
    const row = await seed("avery.busy@example.com", { draft_body: lpConfirmBody({ name: "Avery", slot: pick }), picked_start: pick.start, picked_zone: pick.zone });
    const g = google({ busy: true });
    setCommandFetch(g.f);
    const e = { ...env, GSC_SERVICE_ACCOUNT_JSON: await fakeServiceAccount() } as never;
    const r = await sendHeldLp(e, row, NOW, g.f);
    expect(r.ok).toBe(false);
    expect(r.line).toMatch(/no longer free/);
    expect(g.calls.some((c) => /drafts\/send|sendUpdates/.test(c.url))).toBe(false);
  });

  it("where she is reaches the Mac run from Boss OS's own setting", async () => {
    await env.DB.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('food_away_city', 'New York, NY', 0), ('food_away_until', '2026-11-04', 0)`).run();
    expect(await whereSheIs(env.DB)).toEqual({ away_city: "New York, NY", away_until: "2026-11-04" });
  });
});

describe("the router refuses a non-Claude route for LP scheduling content (fail closed)", () => {
  it("a scheduling draft is a confidential kind: Claude's seat only, never moved to another", () => {
    expect(isConfidentialDraft({ draft_kind: "lp_scheduling" })).toBe(true);
    expect(confidentialLadder(["bk_codex", "bk_claude_code"])).toEqual(["bk_claude_code"]);
    expect(confidentialLadder(["bk_codex"])).toEqual([]);
  });
  it("the Worker's router refuses it before any model, free or paid", async () => {
    for (const freeOnly of [true, false]) {
      await expect(routeCompletion(env as any, {
        routeId: "rt_ops_default", lane: "ops", confidentialDraft: true, freeOnly,
        messages: [{ role: "user", content: "Offer Avery Example three times for a call about the fund" }],
      })).rejects.toThrow(/Claude seat only/);
    }
  });
});
