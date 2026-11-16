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

beforeAll(() => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.BOSS_OS_LP_DIR = dir;
  process.env.LP_MAILBOX = "owner@fund.example";
  process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "robot@project.example", private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "tok" });
    if (url.includes("/gmail/v1/users/me/messages?")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      // Her sent reply to Lee exists; nothing else is found (no thread, no pass label).
      if (q.startsWith("in:sent") && q.includes("lee@other.example")) return json({ messages: [{ id: "m-lee", threadId: "t-lee" }] });
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
