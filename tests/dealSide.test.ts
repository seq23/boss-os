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
      expect(fs.existsSync(path.join(files.directory, "extract-checkpoint.json"))).toBe(false);
    }
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
