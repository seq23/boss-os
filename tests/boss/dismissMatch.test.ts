/**
 * DISMISSING A MATCH (owner, 25 Oct 2026): one table, three doors (the card's button by code, the
 * one-tap link, her reply "dismiss <code>"), read by the Matches screen and the kept morning alike.
 * A dismissed pair comes back only on a new order (a new sig). Synthetic data only.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";

async function tap(path: string, method = "GET") {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://boss.test${path}`, { method }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, text: await res.text() };
}

function mail(subject: string, body: string) {
  const from = "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({ from, subject, "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com", "message-id": `<${Math.random().toString(36).slice(2)}@mail.gmail.com>` });
  const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return { from: "seq.taylor@gmail.com", to: "boss@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: raw.length };
}

const match = (n: number, sig = `b${n}:$72|s${n}:$77`) => ({ key: `b${n}|s${n}`, company: "Company S", pair: `company s|buyer${n}@x.example|seller${n}@y.example`, sig, seller: { who: "Seller" }, buyer: { who: "Buyer" } });
const push = (matches: any[]) => apiJson<any>("/api/capital/matches", { method: "POST", body: { matches, replace: true } });
const listed = async () => ((await apiJson<any>("/api/capital/matches")).body.data.matches as any[]).map((m) => m.key);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM capital_matches; DELETE FROM capital_match_taps; DELETE FROM capital_dismissed;");
});

describe("a dismissed match stays dismissed until a new order", () => {
  it("each pushed match gets a five-letter code and a one-tap link, kept across pushes", async () => {
    const first = await push([match(1), match(2)]);
    expect(Object.keys(first.body.data.codes).sort()).toEqual(["b1|s1", "b2|s2"]);
    expect(first.body.data.codes["b1|s1"]).toMatch(/^[a-hj-km-np-z2-9]{5}$/);
    const again = await push([match(1), match(2)]);
    expect(again.body.data.codes).toEqual(first.body.data.codes);
    const m = (await apiJson<any>("/api/capital/matches")).body.data.matches[0];
    expect(m.code).toBe(first.body.data.codes[m.key]);
    expect(m.tap).toMatch(/^\/tap\/[A-Za-z0-9_-]{24}\?do=dismiss$/);
  });

  it("the card's Dismiss (by code) takes it off the screen; a new order brings it back", async () => {
    const { body } = await push([match(1), match(2)]);
    const r = await apiJson<any>("/api/capital/dismiss", { method: "POST", body: { code: body.data.codes["b1|s1"] } });
    expect(r.body.data).toEqual({ dismissed: true, company: "Company S" });
    expect(await listed()).toEqual(["b2|s2"]);
    await push([match(1), match(2)]);
    expect(await listed()).toEqual(["b2|s2"]);
    // The seller re-priced: a new order, a new match.
    await push([match(1, "b1:$72|s1:$75"), match(2)]);
    expect((await listed()).sort()).toEqual(["b1|s1", "b2|s2"]);
    expect((await apiJson<any>("/api/capital/dismiss", { method: "POST", body: { code: "zzzzz" } })).status).toBe(400);
  });

  it("the one-tap link: a GET never acts, the POST dismisses", async () => {
    await push([match(3)]);
    const tok = (await apiJson<any>("/api/capital/matches")).body.data.matches[0].tap.match(/\/tap\/([^?]+)/)[1];
    await tap(`/api/auth/tap/${tok}?do=dismiss`);
    expect(await listed()).toEqual(["b3|s3"]);
    const done = await tap(`/api/auth/tap/${tok}?do=dismiss`, "POST");
    expect(done.text).toContain("Dismissed");
    expect(await listed()).toEqual([]);
  });

  it("her reply \"dismiss <code>\" does the same, and opens no work", async () => {
    const { body } = await push([match(4)]);
    const code = body.data.codes["b4|s4"];
    const res = await handleBossInboundMail(mail("Re: Sunday: 5 decisions", `dismiss ${code}\n\nOn Sun, Simone wrote:\n> ...`), env as never);
    expect(res.outcome).toBe("MATCH_DISMISSED");
    expect(res.taskId ?? null).toBeNull();
    expect(await listed()).toEqual([]);
    const row = await env.DB.prepare(`SELECT via FROM capital_dismissed`).first<any>();
    expect(row.via).toBe("reply");
  });

  it("the kept morning drops a dismissed row at once, so Today agrees with the screen", async () => {
    await push([match(5), match(6)]);
    const m5 = match(5);
    await apiJson("/api/morning", { method: "POST", body: { day: "2026-10-25", payload: { day: "2026-10-25", decide: [], found_grid: [
      { company: "Company S", match_pair: m5.pair, match_sig: m5.sig }, { company: "Company S", match_pair: match(6).pair, match_sig: match(6).sig },
    ] } } });
    await apiJson("/api/capital/dismiss", { method: "POST", body: { pair: m5.pair, sig: m5.sig, company: "Company S" } });
    const kept = (await apiJson<any>("/api/morning/2026-10-25")).body.data.payload;
    expect(kept.found_grid.map((r: any) => r.match_pair)).toEqual([match(6).pair]);
  });
});
