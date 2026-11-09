import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { checkDnsWaits } from "../scripts/ops/service-tick.mjs";

/**
 * 9 Nov 2026: `checkDnsWaits` defaulted `notify = emailHer`, a name defined nowhere, so every
 * five-minute pass since 6 Oct threw "emailHer is not defined" before the DNS and Drive passes ran.
 * The pass must run with no arguments' help, close a live record, and send nothing of its own.
 */
describe("service tick: the DNS-record pass", () => {
  const row = { id: "dw_1", host: "example.com", record_name: "@", record_type: "TXT", record_target: "v=spf1 -all" };
  const calls: { path: string; body?: unknown }[] = [];
  const apiImpl = async (path: string, body?: unknown) => {
    calls.push({ path, body });
    if (path === "/dns-waits/pending") return { ok: true, status: 200, data: { items: [row] }, error: null };
    return { ok: true, status: 200, data: { checked: true }, error: null };
  };
  const fetchImpl = (async () => ({ ok: true, json: async () => ({ Answer: [{ data: '"v=spf1 -all"' }] }) })) as unknown as typeof fetch;

  it("closes a live record without throwing and without any email", async () => {
    const r = await checkDnsWaits({ fetchImpl, apiImpl });
    expect(r).toEqual({ live: 1, failed: 0 });
    expect(calls).toContainEqual({ path: "/dns-waits/dw_1/checked", body: { live: 1, told: 0 } });
  });

  it("leaves a record that does not resolve yet open", async () => {
    calls.length = 0;
    const empty = (async () => ({ ok: true, json: async () => ({ Answer: [] }) })) as unknown as typeof fetch;
    expect(await checkDnsWaits({ fetchImpl: empty, apiImpl })).toEqual({ live: 0, failed: 0 });
    expect(calls).toContainEqual({ path: "/dns-waits/dw_1/checked", body: {} });
  });
});
