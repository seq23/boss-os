import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanBrokerage } from "../scripts/ops/interest-ledger.mjs";

const NOW = Date.UTC(2026, 10, 2, 6);
const PREVIOUS_MIDNIGHT = Date.UTC(2026, 10, 1, 5);
const MAILBOX = "broker@example.test";
const apiMessage = (id: string, body: string, at = NOW - 1000) => ({
  id,
  internalDate: String(at),
  payload: {
    mimeType: "text/plain",
    headers: [{ name: "From", value: "Trader <trader@example.test>" }, { name: "Precedence", value: "bulk" }],
    body: { data: Buffer.from(body).toString("base64url") },
  },
});
const hit = (decisions: Record<string, string>) => ({
  status: "ok" as const, provider: "gemini" as const, text: JSON.stringify(decisions), inTokens: 10, outTokens: 10,
});

let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "brokerage-fixture-")); });
afterEach(() => fs.rmSync(directory, { recursive: true }));
const state = () => JSON.parse(fs.readFileSync(path.join(directory, "scan-state.json"), "utf8"));

describe("capital:scan", () => {
  it("reads a bulk-marked reply with all 50 thread messages and quotes across the Central clock change", async () => {
    const earlier = apiMessage("prior", "I can place Cedar at seven per unit.", PREVIOUS_MIDNIGHT - 1000);
    const history = Array.from({ length: 48 }, (_, i) => apiMessage(`history${i}`, `Prior discussion ${i}`, PREVIOUS_MIDNIGHT - 1000));
    const latest = apiMessage("reply", "Yes, 50k at that price.\n> I can place Cedar at seven per unit.", PREVIOUS_MIDNIGHT);
    const api = vi.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      if (url.includes("/messages?") && query.get("pageToken") !== "next") return { messages: [], nextPageToken: "next" };
      if (url.includes("/messages?")) return { messages: [{ id: "reply", threadId: "deal" }] };
      return { messages: [earlier, ...history, latest] };
    });
    const read = vi.fn<Parameters<typeof scanBrokerage>[0]["read"]>(async (input) => {
      const source = JSON.parse(input.source);
      expect(source.targetMessageIds).toEqual(["reply"]);
      expect(source.thread).toHaveLength(50);
      expect(source.thread[0].body).toBe("I can place Cedar at seven per unit.");
      expect(source.thread[49].body).toContain("> I can place Cedar");
      expect(source.thread[49].headers.precedence).toBe("bulk");
      return hit({ reply: "candidate" });
    });

    const scan = await scanBrokerage({ directory, mailbox: MAILBOX, api, read, since: "2026/11/01", now: NOW });
    expect(scan).toMatchObject({ status: "complete", window: { start: PREVIOUS_MIDNIGHT, end: NOW }, census: 1, kept: 1, never_read: 0 });
    expect(read).toHaveBeenCalledOnce();
    const batches = fs.readdirSync(path.join(directory, "candidates"));
    const [candidate] = JSON.parse(fs.readFileSync(path.join(directory, "candidates", batches[0]!), "utf8"));
    expect(candidate.source_message).toBe("reply");
    expect(candidate.thread).toHaveLength(50);
  });

  it("preserves unextracted batches and retries the same unread work after an outage or quota stop", async () => {
    const folder = path.join(directory, "candidates");
    fs.mkdirSync(folder);
    const legacy = path.join(folder, "batch-00000.json");
    fs.writeFileSync(legacy, '[{"source_message":"legacy"}]');
    fs.writeFileSync(path.join(directory, "scan-state.json"), JSON.stringify({ last_scanned_at: NOW - 60_000 }));
    const api = vi.fn(async (url: string) => {
      if (url.includes("/messages?")) return { messages: [{ id: "later", threadId: "later" }, { id: "first", threadId: "first" }] };
      const id = new URL(url).pathname.split("/").at(-1)!;
      return { messages: [apiMessage(id, "Synthetic write-up.")] };
    });
    const read = vi.fn<Parameters<typeof scanBrokerage>[0]["read"]>()
      .mockResolvedValueOnce(hit({ first: "candidate" }))
      .mockResolvedValueOnce({ status: "allowance-exhausted", provider: "gemini" })
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce(hit({ later: "other" }));

    const run = (now: number) => scanBrokerage({ directory, mailbox: MAILBOX, api, read, now });
    const stopped = await run(NOW);
    expect(stopped).toMatchObject({ status: "allowance-exhausted", kept: 1, never_read: 1 });
    expect(state().last_scanned_at).toBe(NOW - 60_000);
    expect(state().active.completed).toEqual({ first: "candidate" });
    expect(await run(NOW + 86_400_000)).toMatchObject({ status: "unavailable", window: stopped.window, never_read: 1 });
    expect(await run(NOW + 172_800_000)).toMatchObject({ status: "complete", window: stopped.window, kept: 1, dropped: 1, never_read: 0 });
    expect(state()).toEqual({ last_scanned_at: NOW });
    expect(fs.readFileSync(legacy, "utf8")).toBe('[{"source_message":"legacy"}]');
    expect(fs.readdirSync(folder)).toHaveLength(2);
    expect(api.mock.calls.filter(([url]) => url.includes("/messages?"))).toHaveLength(1);
    expect(read.mock.calls.map(([input]) => JSON.parse(input.source).targetMessageIds)).toEqual([["first"], ["later"], ["later"], ["later"]]);
  });

  it("reads past a thread the model keeps calling uncertain, then holds it for her on the third run (review F4)", async () => {
    fs.writeFileSync(path.join(directory, "scan-state.json"), JSON.stringify({ last_scanned_at: NOW - 60_000 }));
    const api = vi.fn(async (url: string) => {
      if (url.includes("/messages?")) return { messages: [{ id: "next", threadId: "next" }, { id: "poison", threadId: "poison" }] };
      const id = new URL(url).pathname.split("/").at(-1)!;
      return { messages: [apiMessage(id, "Synthetic write-up.")] };
    });
    const read = vi.fn<Parameters<typeof scanBrokerage>[0]["read"]>(async (input) =>
      JSON.parse(input.source).targetMessageIds[0] === "poison" ? { status: "uncertain" as const } : hit({ next: "candidate" }));
    const run = (now: number) => scanBrokerage({ directory, mailbox: MAILBOX, api, read, now });
    // Runs 1 and 2: the thread after the uncertain one is read; the window stays open for the uncertain one.
    expect(await run(NOW)).toMatchObject({ status: "unavailable", kept: 1, held: 0, never_read: 1, held_now: [] });
    expect(state().active.completed).toEqual({ next: "candidate" });
    expect(await run(NOW + 3_600_000)).toMatchObject({ status: "unavailable", kept: 1, held: 0, never_read: 1 });
    // Run 3: held for her, never marked read or done, and the window closes so tomorrow's mail is read.
    expect(await run(NOW + 7_200_000)).toMatchObject({ status: "complete", kept: 1, held: 1, dropped: 0, never_read: 0, held_now: ["poison"] });
    expect(state()).toMatchObject({ last_scanned_at: NOW, held: { poison: { threadId: "poison", runs: 3 } } });
    expect(read.mock.calls.filter(([input]) => JSON.parse(input.source).targetMessageIds[0] === "poison")).toHaveLength(3);
    // An outage never counts toward the hold: it stops the run as before.
    read.mockResolvedValue({ status: "unavailable" });
    fs.writeFileSync(path.join(directory, "scan-state.json"), JSON.stringify({ last_scanned_at: NOW - 60_000 }));
    for (let i = 0; i < 4; i++) expect(await run(NOW + i)).toMatchObject({ status: "unavailable", held: 0 });
  });

  it("keeps an incomplete Gmail listing open and accepts a confirmed empty window", async () => {
    const api = vi.fn(async (url: string) => {
      return new URL(url).searchParams.has("pageToken") ? null : { nextPageToken: "missing-page" };
    });
    const read = vi.fn<Parameters<typeof scanBrokerage>[0]["read"]>();
    await expect(scanBrokerage({ directory, mailbox: MAILBOX, api, read, now: NOW })).rejects.toThrow(/listing was incomplete/);
    expect(state().active.end).toBe(NOW);
    expect(read).not.toHaveBeenCalled();

    api.mockImplementation(async () => ({ nextPageToken: "" }));
    expect(await scanBrokerage({ directory, mailbox: MAILBOX, api, read, now: NOW + 1000 }))
      .toMatchObject({ status: "complete", census: 0, kept: 0, never_read: 0, window: { end: NOW } });
    expect(state()).toEqual({ last_scanned_at: NOW });
  });
});
