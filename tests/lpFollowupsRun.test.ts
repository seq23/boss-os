/**
 * The morning LP run completes over a mixed list (16 Nov 2026: the booked-calls rule declared a
 * loop-local `call` that shadowed the Gmail helper, so the first person WITHOUT a booked call threw
 * "call is not a function", the run died before writing the "lp" morning section, and Simone's email
 * went out without LP updates). This runs `followUps` itself behind a stubbed fetch: one person with a
 * booked call, one without whose reply she already answered. Made-up people and a throwaway key only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const NOW = Date.parse("2026-11-16T15:00:00Z");
const SENT_AT = Date.parse("2026-11-10T15:00:00Z");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lp-followups-run-"));
const env = { ...process.env };
const currentWords = "We'd like to see the deck.";
let modelFails = false;
let draftWrites = 0;
let seenThread: unknown = null;

beforeAll(() => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.BOSS_OS_LP_DIR = dir;
  process.env.LP_MAILBOX = "owner@fund.example";
  process.env.BOSS_WORKER_GEMINI_FREE_KEY = "fixture";
  process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "robot@project.example", private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "tok" });
    if (url.includes("generativelanguage.googleapis.com")) {
      const request = JSON.parse(String(init?.body));
      seenThread = JSON.parse(request.contents[0].parts[0].text);
      if (modelFails) return json({}, 503);
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        classification: "interested", replyNeed: "asks", excerpt: currentWords, asksPrice: false, groupSize: null,
      }) }] } }] });
    }
    if (url.includes("/gmail/v1/users/me/threads/t-new")) {
      const message = (id: string, body: string) => ({ id, internalDate: String(NOW),
        payload: { mimeType: "text/plain", body: { data: Buffer.from(body).toString("base64url") } } });
      return json({ messages: [message("m-original", "May I send you a deck?"),
        message("m-new", currentWords + "\n> May I send you a deck?")] });
    }
    if (url.includes("/gmail/v1/users/me/messages/m-new")) return json({ id: "m-new", internalDate: String(NOW) });
    if (url.endsWith("/gmail/v1/users/me/drafts") && init?.method === "POST") {
      draftWrites += 1;
      return json({ id: "draft-fixture", message: { id: "draft-message-fixture" } });
    }
    if (url.includes("/gmail/v1/users/me/messages?")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      // Her sent reply to Lee exists; nothing else is found (no thread, no pass label).
      if (q.startsWith("in:sent") && q.includes("lee@other.example")) return json({ messages: [{ id: "m-lee", threadId: "t-lee" }] });
      if (q.startsWith("from:new@other.example to:")) return json({ messages: [{ id: "m-new", threadId: "t-new" }] });
      return json({});
    }
    if (url.includes("/gmail/v1/users/me/messages/m-lee")) return json({ id: "m-lee", internalDate: String(SENT_AT) });
    // Calendars and anything else: unreadable (the run must carry on without open times).
    return json({ error: { message: "not in this test" } }, 500);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.env = env;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("followUps over a booked call and an answered reply", () => {
  it("returns both rows instead of throwing on the person without a call", async () => {
    const { followUps } = await import("../scripts/ops/lp-followups.mjs");
    const people = [
      { address: "pat@examplefound.org", name: "Pat Example", bucket: "warm", first_seen: "2026-11-01" },
      { address: "lee@other.example", name: "Lee Other", bucket: "call", first_seen: "2026-11-02" },
    ];
    const calls = new Map([["pat@examplefound.org", { start: Date.parse("2026-11-17T18:00:00Z"), held: false }]]);
    const out = await followUps(people, { now: NOW, calls });
    const by = Object.fromEntries(out.rows.map((r) => [r.address, r]));
    expect(out.rows).toHaveLength(2);
    expect(by["pat@examplefound.org"]).toMatchObject({ status: "scheduled", picked_start: Date.parse("2026-11-17T18:00:00Z") });
    expect(by["lee@other.example"]).toMatchObject({ status: "sent", sent_at: SENT_AT });
    expect(out.counts).toMatchObject({ scheduled: 1, sent: 1 });
  });
});

it("uses the full reply thread to decide whether to draft, and holds the thread on model outage", async () => {
  const { followUps } = await import("../scripts/ops/lp-followups.mjs");
  const replies = [{ address: "new@other.example", name: "Casey", bucket: "warm", first_seen: "2026-11-16" }];
  modelFails = true;
  const held = await followUps(replies, { now: NOW });
  expect(held.rows[0]).toMatchObject({ status: "not_answered", waiting_why: "unavailable" });
  expect(draftWrites).toBe(0);

  modelFails = false;
  const ready = await followUps(replies, { now: NOW });
  expect(seenThread).toMatchObject({ targetMessageId: "m-new", thread: [
    { id: "m-original", body: "May I send you a deck?" },
    { id: "m-new", body: currentWords + "\n> May I send you a deck?" },
  ] });
  expect(ready.rows[0]).toMatchObject({ status: "drafted", draft_id: "draft-fixture" });
  expect(draftWrites).toBe(1);
});
