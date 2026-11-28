import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { realReplies, replyCards, replyKey, theirWords, replyUrl } from "../src/shared/boss/mail/agentReplies.mjs";
import { arrivalVerdict, mailboxArrival, replyArrivals, resendArrival, ARRIVAL_GRACE_MS } from "../src/shared/boss/mail/arrival.mjs";
import { syncAgentReplies } from "../scripts/ops/lib/agent-replies.mjs";
import { progressLine, senderClient } from "../scripts/ops/pnp-corporate-outreach.mjs";
import { readMorningSections, writeMorningSection } from "../src/shared/boss/mail/morning.mjs";
import { MORNING_SECTION_SPECS } from "../src/shared/boss/mail/morningSections.mjs";
import { buildDay } from "../scripts/ops/your-day.mjs";

// Fictional replies in the shape GET /api/outreach/replies returns (seq23/p-n-p functions/_lib/outreach-inbound.mjs).
const NOW = Date.parse("2026-11-28T12:00:00Z");
const reply = (extra: Record<string, unknown> = {}) => ({
  id: "in-1", email: "pat@fictionalhotel.example", kind: "reply", at: "2026-11-16T16:56:30Z", forward_handed_at: "2026-11-16T16:56:31Z",
  subject: "Re: Christmas decor for Fictional Hotel?", from_name: "Pat Example", message_id: "<abc@fictionalhotel.example>",
  text: "Hi Sequoia, we have our own decorating team this year, but could you quote our lobby for next spring?", auth: "pass", ...extra,
});
const tiktok = reply({ id: "in-2", email: "notification@service.tiktok.com", message_id: "<t@tiktok.com>", text: "Your video is live" });
const day = (feed: unknown[], told: unknown = undefined, at = NOW) => buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null,
  feed: { items: [] }, morning: { agent_replies: { decide: replyCards(feed) } }, ...(told ? { told } : {}) }, at);

describe("every real reply becomes a Decide card with their words and a Reply button", () => {
  it("shows the real reply in her morning email, and only people's replies", () => {
    const cards = replyCards([reply(), tiktok]);
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.key).toBe("reply:pnp:<abc@fictionalhotel.example>");
    expect(card.title).toBe("Pat Example at Fictionalhotel answered Camille's email");
    expect(card.body).toContain("could you quote our lobby for next spring?");
    expect(card.buttons).toEqual([{ label: "Reply", url: expect.stringMatching(/^https:\/\/mail\.google\.com\/mail\/\?view=cm/) }]);
    const url = new URL(card.buttons[0].url);
    expect(url.searchParams.get("to")).toBe("pat@fictionalhotel.example");
    expect(url.searchParams.get("su")).toBe("Re: Christmas decor for Fictional Hotel?");
    const mail = day([reply(), tiktok]);
    expect(mail.dropped).toEqual([]);
    expect(mail.text).toContain("could you quote our lobby for next spring?");
    expect(mail.text).toContain("Pat Example at Fictionalhotel answered Camille's email");
    expect(mail.html).toContain(card.buttons[0].url.replace(/&/g, "&amp;"));
    expect(mail.text).not.toMatch(/Your video is live/);
    expect(mail.digest.decide.map((d: { key: string }) => d.key)).toContain(card.key);
  });

  it("de-duplicates: the same reply read twice (backfill, a second read) is one card, shown once", () => {
    const twice = [reply(), reply({ id: "in-1-again" }), reply()];
    expect(realReplies(twice)).toHaveLength(1);
    const mail = day(twice);
    expect(mail.text.split("could you quote our lobby").length - 1).toBe(1);
    // A reply with no Message-ID is keyed by its stored id, so two different ones are never merged.
    expect(realReplies([reply({ message_id: null }), reply({ id: "in-9", message_id: null })])).toHaveLength(2);
  });

  it("is a full card once, then a thin 'still yours' line, never a second full card", () => {
    const first = day([reply()]);
    const second = day([reply()], first.memory, NOW + 86_400_000);
    expect(second.digest.decide.map((d: { key: string }) => d.key)).not.toContain(replyKey("pnp", reply()));
    expect(second.digest.still_yours.map((d: { key: string }) => d.key)).toContain(replyKey("pnp", reply()));
    expect(second.text.split("could you quote our lobby").length - 1).toBeLessThanOrEqual(1);
  });

  it("never shows a reply the receiving server could not tie to the company as if it were real", () => {
    const [forged] = replyCards([reply({ auth: "fail" })]);
    expect(forged.title).toBe("Check first: a reply that says it is from Fictionalhotel");
    expect(forged.body).toMatch(/^The mail server could not confirm it really came from Fictionalhotel/);
    expect(forged.priority).toBeLessThan(replyCards([reply()])[0].priority);
    for (const auth of ["unknown", undefined, "PASS "]) expect(replyCards([reply({ auth })])[0].title).toMatch(/^Check first/);
  });

  it("never loses a card to what someone typed, or to an unreadable copy", () => {
    const nasty = "See flyer_final.pdf #holiday **asap** at https://x.example/a?b=1 or call 901-555-0100, ref abc_def_ghi";
    const words = theirWords(nasty);
    expect(words).toContain("call 901-555-0100");
    const mail = day([reply({ text: nasty })]);
    expect(mail.dropped).toEqual([]);
    expect(mail.digest.decide.map((d: { key: string }) => d.key)).toContain(replyKey("pnp", reply()));
    const [unread] = replyCards([reply({ text: null, unread: "The stored copy is missing." })]);
    expect(unread.body).toMatch(/could not be read from the stored copy/);
    expect(day([reply({ text: null, unread: "x" })]).dropped).toEqual([]);
    expect(replyUrl({ email: "a@b.example", subject: "" })).toContain("su=Re%3A+your+note");
  });
});

describe("Simone writes the agent_replies section from the stored copies", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agent-replies-"));

  it("writes one card per real reply, read-only on the source, with the real API path", async () => {
    const dir = tmp();
    const fetchImpl = vi.fn(async () => Response.json({ replies: [reply(), tiktok], rows: 2 }));
    const client = senderClient({ origin: "https://campaign.example.test", token: "synthetic-token" }, fetchImpl);
    const result = await syncAgentReplies({ client, now: NOW, dir });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://campaign.example.test/api/outreach/replies?since=2026-10-29");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
    expect(result).toEqual({ read: 2, cards: 1, unread: 0 });
    const kept = readMorningSections({ dir, now: NOW }).sections.agent_replies;
    expect(kept.decide.map((d: { key: string }) => d.key)).toEqual([replyKey("pnp", reply())]);
  });

  it("an outage writes nothing and stops by name; it never says there are no replies", async () => {
    const dir = tmp();
    writeMorningSection("agent_replies", { decide: replyCards([reply()]) }, { dir, now: NOW - 3_600_000 });
    const write = vi.fn();
    for (const replies of [async () => { throw new Error("503"); }, async () => ({ nope: true }), async () => null]) {
      await expect(syncAgentReplies({ client: { replies }, now: NOW, dir, write })).rejects.toThrow("NAMED STOP [AGENT_REPLIES_UNREAD]");
    }
    expect(write).not.toHaveBeenCalled();
    // Yesterday's cards stand.
    expect(readMorningSections({ dir, now: NOW }).sections.agent_replies.decide).toHaveLength(1);
  });

  it("no replies is an empty section, so a missing section always means the job did not run", async () => {
    const dir = tmp();
    await syncAgentReplies({ client: { replies: async () => ({ replies: [] }) }, now: NOW, dir });
    expect(readMorningSections({ dir, now: NOW }).sections.agent_replies).toMatchObject({ decide: [] });
    expect(MORNING_SECTION_SPECS.find((s) => s.name === "agent_replies")).toMatchObject({ expect: expect.arrayContaining(["Sunday"]), catchUp: "agent-replies" });
  });

  it("the outreach progress line points at Decide, never at a forward that may not have arrived", () => {
    const line = progressLine({ sent_today: 0, followups_today: 0, taken_over: ["pat@fictionalhotel.example", "notification@service.tiktok.com"], replies: [], corporate_booked: 0 });
    expect(line).toMatch(/1 office wrote back; its reply is in Decide with their words \(Fictionalhotel\)/);
    expect(line).not.toMatch(/inbox|forward/i);
  });
});

describe("the arrival rule: only a receiving-end receipt is arrival", () => {
  it("maps provider events and mailbox searches", () => {
    for (const e of ["delivered", "opened", "clicked", "complained"]) expect(resendArrival(e, NOW, NOW)).toBe("arrived");
    for (const e of ["bounced", "failed", "suppressed", "canceled"]) expect(resendArrival(e, NOW, NOW)).toBe("not_arrived");
    expect(resendArrival("sent", NOW - ARRIVAL_GRACE_MS + 1, NOW)).toBe("pending");
    expect(resendArrival("sent", NOW - ARRIVAL_GRACE_MS, NOW)).toBe("not_arrived");
    expect(resendArrival("delivery_delayed", NOW - ARRIVAL_GRACE_MS, NOW)).toBe("not_arrived");
    for (const e of [undefined, null, "", "weird"]) expect(resendArrival(e, NOW, NOW)).toBe("unknown");
    expect(mailboxArrival(true, NOW, NOW)).toBe("arrived");
    expect(mailboxArrival(false, NOW - ARRIVAL_GRACE_MS, NOW)).toBe("not_arrived");
    expect(mailboxArrival(null, NOW - 1e9, NOW)).toBe("unknown");
  });

  it("one miss, one unread or zero rows can never read as a pass", () => {
    expect(arrivalVerdict([], "x").state).toBe("unknown");
    expect(arrivalVerdict([{ arrival: "arrived" }, { arrival: "unknown" }], "x").state).toBe("unknown");
    expect(arrivalVerdict([{ arrival: "arrived" }, { arrival: "not_arrived" }, { arrival: "unknown" }], "x")).toEqual({ state: "missing", evidence: "Not arrived: 1 of 3 x; 1 couldn't be checked." });
    expect(arrivalVerdict([{ arrival: "pending" }], "x").state).toBe("nothing_due");
    expect(arrivalVerdict([{ arrival: "arrived" }, { arrival: "pending" }], "x").state).toBe("verified");
    expect(arrivalVerdict([{ arrival: "bogus" }], "x").state).toBe("unknown");
  });

  it("a reply reached her only on a morning email that arrived; the forward never counts", () => {
    const key = (r: { message_id?: string; id: string }) => replyKey("pnp", r);
    const built = Date.parse("2026-11-17T12:40:00Z");
    const r = [reply({ forward_handed_at: "2026-11-16T16:57:00Z" })];
    expect(replyArrivals(r, [], key, NOW)[0].arrival).toBe("unknown");
    expect(replyArrivals(r, [{ day: "2026-11-17", built_at: built, keys: [], arrival: "arrived" }], key, NOW)[0].arrival).toBe("not_arrived");
    expect(replyArrivals(r, [{ day: "2026-11-17", built_at: built, keys: [key(r[0])], arrival: "arrived" }], key, NOW)[0].arrival).toBe("arrived");
    expect(replyArrivals(r, [{ day: "2026-11-17", built_at: built, keys: [key(r[0])], arrival: "unknown" }], key, NOW)[0].arrival).toBe("unknown");
    expect(replyArrivals(r, [{ day: "2026-11-17", built_at: built, keys: [], arrival: "arrived" }], key, built + 60_000)[0].arrival).toBe("pending");
  });
});
