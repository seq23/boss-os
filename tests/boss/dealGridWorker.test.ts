/**
 * Boss fix D (23 Oct 2026) — the Deals page grid, her two lists and the holders, in D1, and her
 * plain-words reply that edits the lists. Synthetic names only: the repo is public.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, api } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { LOOKBACK_DAYS } from "../../src/shared/boss/capital/partyLists.mjs";

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const deal = (o: Record<string, unknown> = {}) => ({
  id: "a1b2c3d4e5f6a1b2c3d4e5f6", company: "Acme Robotics", side: "buy", direction: "buy", size_usd: 50e6,
  size_text: "$50M", price_text: "—", structure_text: "—", from_text: "Pat Example, Example Fund", rainmaker: 0,
  received_on: today, email_url: "https://mail.google.com/mail/u/box%40example.com/#all/abc", parties: "pat example | pm@examplefund.com", ...o,
});

function mail(body: string, subject = "Re: New deals since yesterday") {
  const raw = `From: seq.taylor@gmail.com\r\nSubject: ${subject}\r\n\r\n${body}`;
  return {
    from: "seq.taylor@gmail.com",
    to: "monique@sequoiataylor.com",
    headers: new Headers({
      from: "Sequoia <seq.taylor@gmail.com>", subject,
      "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    }),
    raw: new Response(raw).body!,
    rawSize: raw.length,
  };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM capital_deal_rows");
  await env.DB.exec("DELETE FROM capital_party_lists");
  await env.DB.exec("DELETE FROM capital_holders");
});

describe("the grid (rule 5)", () => {
  it("stores a push and shows it newest first, and drops rows older than the ~6-month window", async () => {
    const res = await api("/api/capital/deals", { method: "POST", body: { replace: true, rows: [
      deal(), deal({ id: "b1b2c3d4e5f6a1b2c3d4e5f6", side: "yours", received_on: daysAgo(3), from_text: "You", parties: "" }),
      deal({ id: "c1b2c3d4e5f6a1b2c3d4e5f6", received_on: daysAgo(LOOKBACK_DAYS + 5) }),
    ] } });
    expect(res.status).toBe(200);
    const grid = await apiJson("/api/capital/deals");
    expect(grid.body.data.rows.map((r: any) => r.side)).toEqual(["buy", "yours"]);
    expect(grid.body.data.rows[0]).not.toHaveProperty("parties");
    expect(grid.body.data.lookback_days).toBe(183);
  });

  it("refuses a row that is not a deal, or a link that is not Gmail", async () => {
    expect((await api("/api/capital/deals", { method: "POST", body: { rows: [deal({ side: "maybe" })] } })).status).toBe(400);
    expect((await api("/api/capital/deals", { method: "POST", body: { rows: [deal({ email_url: "https://evil.example/x" })] } })).status).toBe(400);
  });

  it("hides anyone on her do-not-suggest list at read time", async () => {
    await api("/api/capital/deals", { method: "POST", body: { replace: true, rows: [deal()] } });
    await api("/api/capital/lists", { method: "POST", body: { list: "do_not_suggest", action: "add", who: "pm@examplefund.com" } });
    expect((await apiJson("/api/capital/deals")).body.data.rows).toHaveLength(0);
  });
});

describe("her lists, edited by a plain-words reply (rules 6, 15)", () => {
  it("adds and removes, and Monique confirms in one line", async () => {
    const r1 = await handleBossInboundMail(mail("Alex Example (alex@exampleventures.com) is Rainmaker.\nStop suggesting Robin Sample"), env as never);
    expect(r1.outcome).toBe("LIST_EDITED");
    expect(r1.signer).toBe("Monique");
    expect(r1.reply).toMatch(/^Done: .*Rainmaker/);
    let lists = (await apiJson("/api/capital/lists")).body.data;
    expect(lists.same_firm.map((e: any) => e.value)).toEqual(["alex@exampleventures.com"]);
    expect(lists.do_not_suggest.map((e: any) => e.value)).toEqual(["robin sample"]);

    // Builder L reads the same lists by these names, a `value` column each.
    expect((await env.DB.prepare("SELECT value FROM same_firm_list").all()).results).toEqual([{ value: "alex@exampleventures.com" }]);
    expect((await env.DB.prepare("SELECT value FROM do_not_suggest").all()).results).toEqual([{ value: "robin sample" }]);

    const r2 = await handleBossInboundMail(mail("Take Alex Example off the Rainmaker list"), env as never);
    expect(r2.outcome).toBe("LIST_EDITED");
    lists = (await apiJson("/api/capital/lists")).body.data;
    expect(lists.same_firm).toHaveLength(0);
  });

  it("a reply with no list edit goes on as ordinary mail", async () => {
    const r = await handleBossInboundMail(mail("move the intro to Monday"), env as never);
    expect(r.outcome).not.toBe("LIST_EDITED");
  });
});

describe("holders Monique found (rule 7)", () => {
  it("stores every holder for a company and lists them by size", async () => {
    await api("/api/capital/holders", { method: "POST", body: { company: "Acme Robotics", holders: [
      { kind: "nport", fund: "Fund B", value_usd: 64e6, filing_url: "https://www.sec.gov/b" },
      { kind: "nport", fund: "Fund A", value_usd: 120e6, filing_url: "https://www.sec.gov/a", contact: "555-0100" },
      { kind: "nport", fund: "No link", value_usd: 1, filing_url: "https://elsewhere.example" },
    ] } });
    const h = (await apiJson("/api/capital/holders")).body.data.holders;
    expect(h.map((x: any) => x.fund)).toEqual(["Fund A", "Fund B"]);
  });
});
