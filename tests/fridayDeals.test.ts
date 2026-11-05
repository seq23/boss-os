import { readFileSync } from "node:fs";
import { rainmakerHeaderOnly } from "../scripts/lib/rainmaker-mail-privacy.mjs";
import { expect, it } from "vitest";
import { repliersInThread } from "../scripts/ops/rainmaker-repliers.mjs";
import { rankMatches } from "../src/shared/boss/deals/match.mjs";
const message = (id: string, from: string, refs: string, sent = false) => ({ id, labelIds: sent ? ["SENT"] : [], payload: { headers: [
  { name: "From", value: from }, { name: "Message-ID", value: `<${id}@example.com>` }, { name: "In-Reply-To", value: refs },
] } });
it("imports only referenced RR-list replies, never an unrelated inbound or a sent message", () => {
  expect(repliersInThread([
    message("rr", "owner@example.com", "", true),
    message("yes", "Example Replier <reply@example.com>", "<rr@example.com>"),
    message("other", "other@example.com", "<elsewhere@example.com>"),
    message("sent", "owner@example.com", "<rr@example.com>", true),
  ], new Set(["rr"]))).toEqual([{ address: "reply@example.com", name: "Example Replier" }]);
  expect(repliersInThread([message("other", "other@example.com", "<rr@example.com>")], new Set())).toEqual([]);
});
it("30 is fresh, 31 is stale, 90 stays and 91 is hidden, including when it is the base order", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const order = (days: number) => ({ id: String(days), received_on: new Date(now - days * 86400000).toISOString().slice(0, 10), direction: "sell", size_usd: 10e6 });
  const base = { ...order(0), direction: "buy" };
  const result = rankMatches(base, [30,31,90,91].map(order), { now });
  expect(result.matches.map((m: any) => [m.other.id, m.stale])).toEqual([["30", false], ["31", true], ["90", true]]);
  expect(rankMatches({ ...order(91), direction: "buy" }, [order(0)], { now }).matches).toEqual([]);
});

it("RR metadata exception rejects body reads, extra headers, sending and model egress", () => {
  const src = readFileSync(new URL("../scripts/ops/rainmaker-repliers.mjs", import.meta.url), "utf8");
  expect(rainmakerHeaderOnly(src)).toBe(true);
  for (const bad of [src.replace("format=metadata", "format=full"), src.replace("metadataHeaders=References", "metadataHeaders=References&metadataHeaders=Subject"), src + "\nfetch('/send')", src + "\nfetch('https://api.openai.com')", src.replace('import { contentToken }', 'import { unsafeToken }')]) expect(rainmakerHeaderOnly(bad)).toBe(false);
});
