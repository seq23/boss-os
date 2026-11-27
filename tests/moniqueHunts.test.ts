import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readWorkerSource } from "../src/worker/boss/router/freeModel.ts";
import { allHolders, pressPodcastLeads } from "../scripts/ops/filing-hunt.mjs";
// @ts-expect-error — Mac ESM entry point
import { completeHunt } from "../scripts/ops/ledger-hunt.mjs";
// @ts-expect-error — Mac ESM module
import { resolveIssuers } from "../scripts/ops/lib/deal-reading.mjs";
// @ts-expect-error — Mac ESM entry point
import { readFirmCrossmatch } from "../scripts/ops/lp-buyer-crossmatch.mjs";
import { assignedSearch, standingMatches } from "../scripts/ops/interest-match.mjs";
import { allMatches, buildGrid } from "../scripts/ops/interest-grid.mjs";

const fixtures: string[] = [];
afterEach(() => {
  for (const file of fixtures.splice(0)) fs.rmSync(file, { force: true, recursive: true });
});
type Reader = (input: Parameters<typeof readWorkerSource>[0]) => ReturnType<typeof readWorkerSource>;
const ok = (answer: unknown) => ({ status: "ok" as const, provider: "gemini" as const, text: JSON.stringify(answer), inTokens: 1, outTokens: 1 });
const now = Date.parse("2026-11-26T12:00:00.000Z");

it("uses a model-resolved issuer alias in matching, grid matches and both sides of a hunt", async () => {
  const names = ["Juniper Robotics", "Juniper Series A SPV"];
  const read = vi.fn<Reader>(async ({ source }) => {
    expect(JSON.parse(source).inputs).toEqual(names);
    return ok({ issuers: [names[0], names[0]] });
  });
  const issuer = await resolveIssuers(names, { read });
  const orders = names.map((asset, index) => ({
    asset, issuer: issuer(asset), side: index ? "sell" : "buy", source_message: String(index),
    size_usd: 2e6, date: "2026-11-25", principal: index ? "Briar Capital" : "Azalea Investments",
    principal_email: `party${index}@example.com`, quote: "Order is current.", confidence: "high",
  }));
  expect(standingMatches(orders, new Set(), now).picked).toHaveLength(1);
  expect(assignedSearch(orders, issuer(names[0]), "sell", 2e6, new Set(), now)[0].row.asset).toBe(names[1]);
  expect(assignedSearch(orders, issuer(names[1]), "buy", 2e6, new Set(), now)[0].row.asset).toBe(names[0]);
  const grid = buildGrid(orders, { identity: { names: [], addresses: [] }, lists: {}, now })
    .map((row: any) => ({ ...row, issuer: issuer(row.company) }));
  expect(allMatches(grid, {}, { now })).toHaveLength(1);
});

it("marks a hunt after both reads and the save succeed, and leaves failures pending", async () => {
  const entry = { asset: "Juniper Robotics", side: "sell" };
  const research = vi.fn(async () => ({ holders: [], spvs: [] }));
  const pressResearch = vi.fn().mockRejectedValueOnce(new Error("reading unavailable")).mockResolvedValue({ leads: [] });
  const keep = vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(undefined);
  const mark = vi.fn();
  const actions = { research, pressResearch, keep, mark };
  await expect(completeHunt(entry, actions)).rejects.toThrow("reading unavailable");
  expect(keep).not.toHaveBeenCalled();
  expect(mark).not.toHaveBeenCalled();
  await expect(completeHunt(entry, actions)).rejects.toThrow("disk unavailable");
  expect(mark).not.toHaveBeenCalled();
  await expect(completeHunt(entry, actions)).resolves.toMatchObject({ huntSide: "buy" });
  expect(mark.mock.calls).toEqual([[entry]]);
  expect(keep.mock.invocationCallOrder.at(-1)!).toBeLessThan(mark.mock.invocationCallOrder[0]!);
});

it("restarts at the unread SEC filing when the model goes down", async () => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "test-filing-hunt-"));
  fixtures.push(cacheDirectory);
  const filings = ["a", "b"].map((id) => ({ cik: id, filer: id, accession: id, url: `https://www.sec.gov/${id}` }));
  const read = vi.fn(async () => ({ filings, total: filings.length }));
  const fetchXml = vi.fn(async (url: string) => `<edgarSubmission><seriesId>${url}</seriesId><invstOrSec><name>Juniper A</name><valUSD>10</valUSD></invstOrSec></edgarSubmission>`);
  const readModel = vi.fn<Reader>().mockResolvedValueOnce(ok({ indexes: [0] }))
    .mockResolvedValueOnce({ status: "unavailable" }).mockResolvedValue(ok({ indexes: [0] }));
  const options = { read, fetchXml, readModel, cacheDirectory };
  await expect(allHolders("Juniper Robotics", options)).rejects.toThrow("CAPITAL_READING_UNAVAILABLE");
  expect(await allHolders("Juniper Robotics", options)).toMatchObject({ scanned: 2, holders: [expect.anything(), expect.anything()] });
  expect(read).toHaveBeenCalledTimes(1);
  expect(fetchXml.mock.calls.map(([url]) => url)).toEqual([filings[0]!.url, filings[1]!.url, filings[1]!.url]);
});

it("finds a cross-list alias by identity evidence and refuses forged result indexes", async () => {
  const buyers = [{ id: "a", name: "Juniper Holdings", website: "juniper.example" }];
  const firms = [{ firm: "JRP", addresses: ["team@juniper.example"] }];
  const read = vi.fn<Reader>().mockImplementationOnce(async ({ source }) => {
    expect(JSON.parse(source)).toMatchObject({ buyers: [{ website: "juniper.example" }], lpFirms: firms });
    return ok({ matches: [{ buyer: 0, lp: 0, confidence: "confirmed" }] });
  }).mockResolvedValueOnce(ok({ matches: [{ buyer: 0, lp: 3, confidence: "confirmed" }] }));
  expect(await readFirmCrossmatch(buyers, firms, { read })).toMatchObject({ confirmed: [{ candidate: buyers[0], lp: firms[0] }], near: [] });
  await expect(readFirmCrossmatch(buyers, firms, { read })).rejects.toThrow("CAPITAL_READING_UNAVAILABLE");
});

it("reads the complete cited page before accepting a public research lead", async () => {
  const sourceUrl = "https://publication.example/item";
  const claim = { name: "Sample Capital", kind: "press", evidence_quote: "Sample Capital holds the position." };
  const page = "<h1>Public report</h1><p>Sample Capital holds the position.</p><p>End of source.</p>";
  const text = JSON.stringify({ leads: [claim] });
  const read = vi.fn<Reader>().mockResolvedValueOnce({
    ...ok({ leads: [claim] }), sources: [{ title: "Public report", url: sourceUrl }],
    supports: [{ start: 0, end: text.length, sources: [0] }],
  }).mockImplementationOnce(async ({ source }) => {
    expect(JSON.parse(source)).toMatchObject({ page: expect.stringContaining("End of source.") });
    return ok({ supported: true });
  });
  const readPage = vi.fn(async () => page);
  expect(await pressPodcastLeads("Juniper Robotics", "sell", { read, readPage }))
    .toMatchObject({ leads: [{ name: claim.name, source_url: sourceUrl }] });
  expect(readPage.mock.calls).toEqual([[sourceUrl]]);
});
