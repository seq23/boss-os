/**
 * "FIND ALL BUYERS OF <COMPANY>" (5 Nov 2026). Her email asking for every buyer of a company in her
 * inbox went to a cloud model with no way into her inbox and failed. The answer is her deal grid
 * (`capital_deal_rows`, built from her inbox's deal emails), so Simone replies with it at once.
 * Driven through the real intake. Fixtures only: no real company order, person or address.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { partiesAskIn, partiesReply, companyMatches } from "../../src/shared/boss/capital/partiesAsk.mjs";

function mail(subject: string, body: string) {
  const from = "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({
    from, subject,
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": `<p-${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
  });
  const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return { from: "seq.taylor@gmail.com", to: "boss@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: raw.length };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
async function order(id: string, company: string, side: string, from: string, parties: string, ageDays: number, size = "$10M") {
  await env.DB.prepare(
    `INSERT INTO capital_deal_rows (id, company, side, direction, size_usd, size_text, price_text, structure_text, from_text, rainmaker, received_on, email_url, parties, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,0,?,NULL,?,?)`,
  ).bind(id, company, side, side === "yours" ? "buy" : side, 10_000_000, size, "—", "—", from, daysAgo(ageDays), parties, Date.now()).run();
}

describe("reading the ask", () => {
  it("finds the company and the side in her words", () => {
    expect(partiesAskIn("Monique needs to go into my inbox and find any buyers for moonshot \n\nGive me their emails")).toEqual({ company: "moonshot", side: "buy" });
    expect(partiesAskIn("Can you list the sellers of Example Robotics?")).toEqual({ company: "Example Robotics", side: "sell" });
    expect(partiesAskIn("I need to find all buyers of Example AI")).toEqual({ company: "Example AI", side: "buy" });
  });
  it("leaves sales questions and plain sentences alone", () => {
    expect(partiesAskIn("find buyers for my book")).toBeNull();
    expect(partiesAskIn("Draft a note to the buyers")).toBeNull();
    expect(partiesAskIn("Buy the domain for me")).toBeNull();
  });
  it("matches a company however the broker spelled it", () => {
    expect(companyMatches("ExampleAI", "Example AI")).toBe(true);
    expect(companyMatches("Example", "example ai")).toBe(true);
    expect(companyMatches("Exemplar Labs", "Example AI")).toBe(false);
  });
  it("counts one person once, newest first, with the stale words of the grid", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    const reply = partiesReply({ company: "Example AI", side: "buy" }, [
      { company: "Example", side: "buy", from_text: "Ana Broker, Firm A", parties: "client | ana@firm-a.example", received_on: "2026-10-30", size_text: "$10M", price_text: "—" },
      { company: "Example", side: "buy", from_text: "Ana Broker, Firm A", parties: "client | ana@firm-a.example", received_on: "2026-10-01", size_text: "$10M", price_text: "—" },
      { company: "Example AI", side: "buy", from_text: "Ben Broker, Firm B", parties: "client | ben@firm-b.example", received_on: "2026-07-01", size_text: "$15M", price_text: "$40B" },
      { company: "Example AI", side: "sell", from_text: "Cy Seller, Firm C", parties: "cy@firm-c.example", received_on: "2026-10-30", size_text: "$5M", price_text: "—" },
    ], now);
    expect(reply).toContain("2 buyers of Example AI");
    expect(reply.indexOf("ana@firm-a.example")).toBeLessThan(reply.indexOf("ben@firm-b.example"));
    expect(reply).toContain("sent 2 times");
    expect(reply).toContain("wants $15M at $40B");
    expect(reply).toContain("may be stale");
    expect(reply).not.toContain("cy@firm-c.example");
  });
});

describe("her email gets the answer, not a failed job", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM capital_deal_rows");
    await env.DB.exec("DELETE FROM capital_party_lists");
    await env.DB.exec("DELETE FROM boss_inbound_mail");
  });

  it("replies with every buyer and their addresses, leaving out her own orders and anyone ruled out", async () => {
    await order("a1b2c3d4e5", "Example", "buy", "Ana Broker, Firm A", "unnamed client | ana@firm-a.example | Ana Broker", 10);
    await order("a1b2c3d4e6", "Example AI", "buy", "Ben Broker, Firm B", "client | ben@firm-b.example", 40, "$15M");
    await order("a1b2c3d4e7", "ExampleAI", "yours", "You", "", 5);
    await order("a1b2c3d4e8", "Example", "buy", "Ruled Out, Firm X", "ruled.out@example.com", 3);
    await order("a1b2c3d4e9", "Example", "sell", "Cy Seller, Firm C", "cy@firm-c.example", 3);
    await env.DB.prepare(`INSERT INTO capital_party_lists (id, list, kind, value, source, created_at) VALUES ('pl_dns', 'do_not_suggest', 'email', 'ruled.out@example.com', 'seed', 0)`).run();

    const res = await handleBossInboundMail(mail("I need to find all buyers if example ai", "Monique needs to go into my inbox and find any buyers for example ai \n\n\nGive me their emails \n\n\nSent from my iPhone") as never, env as never);
    expect(res.outcome).toBe("COMMAND");
    expect(res.taskId ?? null).toBeNull();
    expect(res.reply).toContain("ana@firm-a.example");
    expect(res.reply).toContain("ben@firm-b.example");
    expect(res.reply).not.toContain("ruled.out@example.com");
    expect(res.reply).not.toContain("cy@firm-c.example");
    expect(res.reply).toContain("2 buyers");
    const row = await env.DB.prepare(`SELECT outcome, why FROM boss_inbound_mail WHERE id = ?`).bind(res.mailId).first<any>();
    expect(row.outcome).toBe("COMMAND");
    expect(row.why).toContain("deals grid");
  });

  it("sends an ask about a company the grid has never seen to the ordinary triage", async () => {
    await order("b1b2c3d4e5", "Other Co", "buy", "Ana Broker, Firm A", "ana@firm-a.example", 10);
    const res = await handleBossInboundMail(mail("buyers", "Find any buyers for Unseen Robotics") as never, env as never);
    expect(res.outcome).not.toBe("COMMAND");
  });
});
