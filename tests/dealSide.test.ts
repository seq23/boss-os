import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractCandidates } from "../scripts/ops/interest-extract.mjs";
import { buildGrid } from "../scripts/ops/interest-grid.mjs";
import type { readWorkerSource } from "../src/worker/boss/router/freeModel.ts";

type Read = (input: Parameters<typeof readWorkerSource>[0]) => ReturnType<typeof readWorkerSource>;
const directories: string[] = [];
const now = Date.parse("2026-11-26T12:00:00Z");
const date = "2026-11-25";
const identity = { names: ["Avery Example"], addresses: ["avery@example.com"] };

const message = (id: string, subject: string, body: string) => ({
  id, at: Date.parse(date), headers: { subject, from: "Broker <broker@example.com>" }, body,
});
const offer = message("offer", "Sell Order: Juniper Robotics | $ 2 M @ $ 12", "We can allocate Juniper Robotics at $12 a share.");
const reply = message("reply", "Re: allocation", "Yes, 50k at that price.\n\n> We can allocate Juniper Robotics at $12 a share.");
const relay = message("relay", "Fwd: allocation", "Can you find the seller's rep?\n\n> They are working a block of Juniper Robotics.");
const ask = message("question", "Potential connection", "Could you introduce me to someone who covers this?");
const thread = [offer, reply, relay, ask];

function candidate(target: (typeof thread)[number], savedThread = thread) {
  return { source_message: target.id, date, from: "broker@example.com", subject: target.headers.subject, to: [], thread: savedThread };
}
function deal(target: (typeof thread)[number], overrides: Record<string, unknown> = {}) {
  return { source_message: target.id, asset: "Juniper Robotics", side: "sell", side_note: null,
    principal: "Applegate Partners", principal_email: "broker@example.com", principal_named: true, hers: false, relayed: false,
    intermediated_by: null, size_usd: 2e6, size_shares: null, size_text: "$2M", price_text: "$12 per share",
    price_usd: 12, price_kind: "share", structure_text: null, durability: "wants_now", confidence: "high",
    quote: target.body.split("\n")[0], evidence: "The target confirms the order.", ...overrides };
}
const ok = (rows: unknown[]) => ({
  status: "ok" as const, provider: "gemini" as const, text: JSON.stringify({ status: "complete", rows }), inTokens: 1, outTokens: 1,
});
function fixture(batches: unknown[][]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "extract-fixture-"));
  directories.push(directory);
  const folder = path.join(directory, "candidates");
  fs.mkdirSync(folder);
  for (const [index, batch] of batches.entries()) fs.writeFileSync(path.join(folder, `${index}.json`), JSON.stringify(batch));
  const load = (filename: string) => JSON.parse(fs.readFileSync(path.join(directory, filename), "utf8"));
  return { directory, folder, load };
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("brokerage interest extraction through the full-thread reader", () => {
  it("reads machine orders, short replies, and relays before rendering the grid", async () => {
    const files = fixture([thread.map((target) => candidate(target))]);
    const rows = {
      offer: [deal(offer)],
      reply: [deal(reply, { side: "buy", size_usd: null, size_shares: 50_000, size_text: "50k shares", principal: "Briar Capital" })],
      relay: [deal(relay, { relayed: true, principal_named: false, principal: "unnamed seller", principal_email: null, size_usd: null })],
      question: [],
    };
    const read = vi.fn<Read>(async (input) => {
      const source = JSON.parse(input.source);
      expect(input.worker).toBe("monique");
      expect(source.thread).toEqual(thread);
      expect(source.identity).toEqual(identity);
      return ok(rows[source.targetMessageId as keyof typeof rows]);
    });
    expect(await extractCandidates({ directory: files.directory, identity, read })).toMatchObject({ status: "complete", checked: 4, added: 3 });
    expect(read.mock.calls.map(([input]) => JSON.parse(input.source).targetMessageId)).toEqual(thread.map(({ id }) => id));
    const ledger = files.load("ledger.json").interests;
    const grid = buildGrid(ledger, { identity, lists: {}, now });
    expect(grid).toHaveLength(3);
    expect(grid.find((row: any) => row.source_message === "reply")).toMatchObject({
      company: "Juniper Robotics", direction: "buy", size_text: "50,000 shares", price_text: "$12 a share",
    });
    const forwarded = grid.find((row: any) => row.source_message === "relay");
    expect(forwarded).toMatchObject({ direction: "sell", from_text: "From a note you passed on" });
    expect(ledger.find((row: any) => row.source_message === "relay")).toMatchObject({ hers: false, relayed: true });
    expect(fs.readdirSync(files.folder)).toEqual([]);
  });

  it("keeps a failed batch and retries its first unread candidate with the legacy message's full thread", async () => {
    const { thread: _thread, ...legacy } = candidate(reply);
    const files = fixture([[candidate(offer), legacy], [candidate(relay)]]);
    const loadThread = vi.fn(async (_id: string) => thread);
    const read = vi.fn<Read>().mockResolvedValueOnce(ok([deal(offer)]))
      .mockResolvedValueOnce({ status: "allowance-exhausted", provider: "gemini" })
      .mockResolvedValueOnce(ok([deal(reply, { side: "buy" })])).mockResolvedValueOnce(ok([]));
    const options = { directory: files.directory, identity, loadThread, read };
    expect(await extractCandidates(options)).toMatchObject({ status: "allowance-exhausted", checked: 1 });
    expect(fs.readdirSync(files.folder).sort()).toEqual(["0.json", "1.json"]);
    expect(files.load("extract-checkpoint.json").messages).toEqual(["offer"]);
    expect(await extractCandidates(options)).toMatchObject({ status: "complete", checked: 2, added: 1 });
    expect(loadThread.mock.calls).toEqual([["reply"], ["reply"]]);
    expect(files.load("ledger.json").interests.map((row: any) => row.source_message)).toEqual(["offer", "reply"]);
    expect(fs.readdirSync(files.folder)).toEqual([]);
  });

  it("rejects invented quotes and forged source ids before writing a receipt or deleting input", async () => {
    const files = fixture([[candidate(reply)]]);
    for (const row of [deal(reply, { quote: "We have a firm order for 1 million shares." }), deal(reply, { source_message: offer.id })]) {
      const read: Read = async () => ok([row]);
      expect(await extractCandidates({ directory: files.directory, identity, read })).toMatchObject({ status: "unavailable", checked: 0 });
      expect(fs.readdirSync(files.folder)).toEqual(["0.json"]);
      // No receipt: the message is not recorded as read, and nothing reached the ledger.
      expect(files.load("extract-checkpoint.json").messages ?? []).not.toContain(reply.id);
      expect(fs.existsSync(path.join(files.directory, "ledger.json"))).toBe(false);
    }
  });

  it("reads past a message the model keeps calling uncertain and holds it for her on the third run (review F4)", async () => {
    const files = fixture([[candidate(reply), candidate(offer)]]);
    const read = vi.fn<Read>(async (input) => JSON.parse(input.source).targetMessageId === reply.id
      ? { status: "uncertain" } : ok([deal(offer)]));
    const run = () => extractCandidates({ directory: files.directory, identity, read });
    // Runs 1 and 2: the next message is read and recorded; the batch stays for the uncertain one.
    expect(await run()).toMatchObject({ status: "unavailable", checked: 1, added: 1, held_now: [] });
    expect(await run()).toMatchObject({ status: "unavailable", checked: 0, held_now: [] });
    expect(fs.readdirSync(files.folder)).toEqual(["0.json"]);
    // Run 3: held for her, never recorded as read, and the batch is done.
    expect(await run()).toMatchObject({ status: "complete", held_now: [reply.id] });
    const checkpoint = files.load("extract-checkpoint.json");
    expect(checkpoint.messages).toEqual([offer.id]);
    expect(checkpoint.held).toMatchObject({ [reply.id]: { runs: 3 } });
    expect(fs.readdirSync(files.folder)).toEqual([]);
    expect(read.mock.calls.filter(([input]) => JSON.parse(input.source).targetMessageId === reply.id)).toHaveLength(3);
    // The held message is named in her morning email with its Gmail link.
    const { nameHeld } = await import("../scripts/ops/interest-extract.mjs");
    const add = vi.fn();
    await nameHeld(checkpoint.held ? Object.keys(checkpoint.held) : [], "deal emails", { add });
    expect(add.mock.calls[0]).toEqual(["notices", { lines: [expect.objectContaining({
      text: expect.stringMatching(/^Deal emails: 1 could not be read after 3 tries, so it is held for you/),
      links: [{ label: "Open the email", url: expect.stringContaining(`#all/${reply.id}`) }],
    })] }]);
  });
});

it("keeps an unread candidate after a Gmail source outage", async () => {
  const { thread: _thread, ...legacy } = candidate(reply);
  const files = fixture([[legacy]]);
  const read = vi.fn<Read>();
  await expect(extractCandidates({
    directory: files.directory, identity, read, loadThread: async () => { throw new Error("Gmail unavailable"); },
  })).rejects.toThrow("Gmail unavailable");
  expect(read).not.toHaveBeenCalled();
  expect(fs.readdirSync(files.folder)).toEqual(["0.json"]);
  expect(fs.existsSync(path.join(files.directory, "ledger.json"))).toBe(false);
});

it("renders every expected buy and sell from a month of synthetic brokerage threads", async () => {
  const cases = Array.from({ length: 30 }, (_, i) => {
    const day = `2026-10-${String(i + 1).padStart(2, "0")}`;
    const offer = i % 3 === 0 ? "We have room to allocate" : "Can we take an allocation of";
    const active = i % 5 !== 0;
    const target = { ...message(`day-${i}`, "Allocation desk", active ? `${offer} the shares we discussed.` : "Reporting for the monthly council has moved."), at: Date.parse(day) };
    const earlier = { ...message(`earlier-${i}`, "Allocation desk", "The company is Marigold Systems."), at: target.at - 3_600_000 };
    const rows = active ? [deal(target, { asset: "Marigold Systems", side: i % 3 === 0 ? "sell" : "buy" })] : [];
    if (active && i % 7 === 0) rows.push(deal(target, { asset: "Hemlock Systems", side: "buy" }));
    return { target, earlier, rows, candidate: { ...candidate(target, [earlier, target]), date: day } };
  });
  const files = fixture(cases.map(({ candidate }) => [candidate]));
  const read: Read = async ({ source }) => {
    const { targetMessageId, thread } = JSON.parse(source);
    const matched = cases.find(({ target }) => target.id === targetMessageId)!;
    expect(thread).toEqual([matched.earlier, matched.target]);
    return ok(matched.rows);
  };
  await extractCandidates({ directory: files.directory, identity, read });
  const expected = cases.flatMap(({ rows }) => rows.map((row) => `${row.source_message}|${row.asset}|${row.side}`));
  const grid = buildGrid(files.load("ledger.json").interests, { identity, lists: {}, now });
  expect(grid.map((row: any) => `${row.source_message}|${row.company}|${row.direction}`).sort()).toEqual(expected.sort());
});

it("checks the real source window against the pushed grid and carries a missing interest onto the next push", async () => {
  const { reviewBrokerage } = await import("../scripts/ops/interest-extract.mjs");
  const { countMissingGridInterests } = await import("../scripts/ops/interest-grid.mjs");
  const files = fixture([]);
  const crossing = Date.parse("2026-11-02T12:00:00Z");
  const start = Date.parse("2026-11-01T05:00:00Z");
  const end = Date.parse("2026-11-02T06:00:00Z");
  const before = { ...offer, id: "before", at: start - 1 };
  const target = { ...reply, at: start };
  const after = { ...offer, id: "after", at: end };
  const mail = [before, target, after];
  const list = vi.fn(async () => mail.map(({ id }) => ({ id, threadId: "thread" })));
  const load = vi.fn(async () => mail);
  const read = vi.fn<Read>().mockResolvedValue(ok([deal(target, { side: "buy" })]));
  const options = { directory: files.directory, kind: "daily" as const, now: crossing, identity, list, load, read };
  const visible = (rows: any[]) => buildGrid(rows, { identity, lists: {}, now: crossing });
  expect(await reviewBrokerage({ ...options, compare: async () => null })).toMatchObject({ status: "unavailable", checked: 1 });
  expect(files.load("extract-checkpoint.json").reviews.daily).not.toHaveProperty("complete");
  expect(await reviewBrokerage({
    ...options, compare: async (rows) => countMissingGridInterests(visible(rows), []),
  })).toMatchObject({ status: "missing", checked: 1, found: 1, missing: 1, added: 1 });
  expect(list.mock.calls).toEqual([[start, end]]);
  expect(load).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
  expect(countMissingGridInterests(visible(files.load("ledger.json").interests), visible(files.load("ledger.json").interests))).toBe(0);
});

it("reports an empty model result on a nonempty day while a confirmed empty source passes", async () => {
  const { reviewBrokerage } = await import("../scripts/ops/interest-extract.mjs");
  const read = vi.fn<Read>().mockResolvedValue(ok([]));
  const compare = vi.fn(async () => 0);
  const one = { ...offer, at: Date.parse("2026-11-25T12:00:00Z") };
  const input = { kind: "daily" as const, now, identity, read, compare, load: async () => [one] };
  expect(await reviewBrokerage({
    ...input, directory: fixture([]).directory, list: async () => [{ id: one.id, threadId: "thread" }],
  })).toMatchObject({ status: "unverified-empty", checked: 1 });
  expect(await reviewBrokerage({ ...input, directory: fixture([]).directory, list: async () => [] }))
    .toMatchObject({ status: "complete", checked: 0 });
  expect(read).toHaveBeenCalledOnce();
});

it("the daily check holds a message the model keeps calling uncertain, says so, and reads the next (review F4)", async () => {
  const { reviewBrokerage } = await import("../scripts/ops/interest-extract.mjs");
  const files = fixture([]);
  const poison = { ...reply, at: Date.parse("2026-11-25T12:00:00Z") };
  const next = { ...offer, at: Date.parse("2026-11-25T13:00:00Z") };
  const read = vi.fn<Read>(async (input) => JSON.parse(input.source).targetMessageId === poison.id
    ? { status: "uncertain" } : ok([deal(next)]));
  const input = {
    kind: "daily" as const, directory: files.directory, identity, read, compare: async () => 0,
    list: async () => [poison, next].map(({ id }) => ({ id, threadId: "thread" })), load: async () => [poison, next],
  };
  // Two runs stop at it, as an unread item; the third holds it and checks the rest of the day.
  expect(await reviewBrokerage({ ...input, now })).toMatchObject({ status: "unavailable" });
  expect(await reviewBrokerage({ ...input, now: now + 3_600_000 })).toMatchObject({ status: "unavailable" });
  const verdict = await reviewBrokerage({ ...input, now: now + 7_200_000 });
  expect(verdict).toMatchObject({ status: "held", held: 1, found: 1, missing: 0, held_now: [poison.id] });
  expect(files.load("extract-checkpoint.json").review_held).toMatchObject({ [poison.id]: { threadId: "thread", runs: 3, review: "daily" } });
  // A retry the same day returns the verdict without naming the held message twice.
  expect(await reviewBrokerage({ ...input, now: now + 7_300_000 })).toMatchObject({ status: "held", held_now: [] });
  expect(read.mock.calls.map(([call]) => JSON.parse(call.source).targetMessageId)).toEqual([poison.id, poison.id, poison.id, next.id]);
});

it("starts the October re-read at Central midnight, only appends missing issuers, and resumes an unread message", async () => {
  const { reviewBrokerage } = await import("../scripts/ops/interest-extract.mjs");
  const start = Date.parse("2026-10-01T05:00:00Z");
  const before = { ...offer, id: "before", at: start - 1 };
  const first = { ...offer, at: start };
  const second = { ...reply, at: start + 1000 };
  const files = fixture([]);
  const prior = { source_message: first.id, asset: " Juniper Robotics ", side: "sell", size_usd: 1, original: true };
  const ledger = path.join(files.directory, "ledger.json");
  fs.writeFileSync(ledger, JSON.stringify({ interests: [prior] }));
  const list = vi.fn(async () => [before, first, second].map(({ id }) => ({ id, threadId: "thread" })));
  const read = vi.fn<Read>()
    .mockResolvedValueOnce(ok([deal(first), deal(first, { asset: "Cedar Research" }), deal(first, { asset: "Alder Works", side: "buy" })]))
    .mockResolvedValueOnce({ status: "allowance-exhausted", provider: "gemini" })
    .mockResolvedValueOnce(ok([deal(second, { side: "buy" })]));
  const input = { kind: "history" as const, directory: files.directory, identity, read, list, load: async () => [before, first, second] };
  expect(await reviewBrokerage({ ...input, now })).toMatchObject({ status: "allowance-exhausted", added: 2, checked: 1 });
  expect(files.load("extract-checkpoint.json").reviews.history).toMatchObject({ start, next: 2, outside: 1 });
  expect(files.load("ledger.json").interests[0]).toEqual(prior);
  expect(await reviewBrokerage({ ...input, now })).toMatchObject({ status: "pending", added: 0 });
  expect(await reviewBrokerage({ ...input, now: now + 86_400_000 })).toMatchObject({ status: "complete", added: 1, checked: 2 });
  expect(list).toHaveBeenCalledOnce();
  expect(read.mock.calls.map(([call]) => JSON.parse(call.source).targetMessageId)).toEqual([first.id, second.id, second.id]);
  expect(files.load("ledger.json").interests).toMatchObject([prior, { asset: "Cedar Research" }, { asset: "Alder Works" }, { asset: "Juniper Robotics", side: "buy" }]);
});
