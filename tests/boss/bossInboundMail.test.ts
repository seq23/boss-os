import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { handleBossInboundMail, isBossMailbox, activeRoster, looksLikeBook } from "../../src/worker/boss/intake/inboundMail";
import { routeToSeat, seatTag, replyBody } from "../../src/shared/boss/intake/mail.mjs";
import { parseLiveBook, describeLot } from "../../src/shared/boss/intake/liveBook.mjs";
import { storeLiveBook, currentBook, currentBookLines } from "../../src/worker/boss/capital/book";
import { bookNagAlerts } from "../../src/worker/boss/capital/bookNag";

/**
 * MAIL TO boss@sequoiataylor.com, END TO END, AGAINST REAL D1.
 *
 * The unit-level rules are asserted by `validate:employee-tags` against the replayed migrations.
 * What can only be proven here is the part that touches the database: that a message from her
 * actually produces a task owned by the named employee, that a message from a stranger produces a
 * row and no work at all, and that her book lands as versioned rows.
 */

/** Her real book, exactly as she dictated it on 10 Sep 2026. */
const HER_BOOK = [
  "Anthropic IPO shares   $2B, and separately $500M",
  "ByteDance shares       $2B",
  "OpenAI shares          up to $600M, $100M minimum",
  "Kalshi                 $20M",
  "Erebor Bank            $10M",
].join("\n");

function mail(opts: { from?: string; to?: string; subject?: string; body?: string; dmarc?: string }) {
  const body = opts.body ?? "";
  const headers = new Headers({
    from: opts.from ?? "Sequoia <seq.taylor@gmail.com>",
    subject: opts.subject ?? "",
    "authentication-results": opts.dmarc ?? "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
  });
  const raw = `From: ${opts.from ?? "seq.taylor@gmail.com"}\r\nSubject: ${opts.subject ?? ""}\r\n\r\n${body}`;
  return {
    from: (opts.from ?? "seq.taylor@gmail.com").replace(/.*<|>.*/g, ""),
    to: opts.to ?? "boss@sequoiataylor.com",
    headers,
    raw: new Response(raw).body!,
    rawSize: new TextEncoder().encode(raw).length,
  };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM capital_book_line");
  await env.DB.exec("DELETE FROM capital_book");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});

describe("who the mailbox answers for", () => {
  it("takes her domain and refuses West Peek's", () => {
    expect(isBossMailbox("boss@sequoiataylor.com")).toBe(true);
    expect(isBossMailbox("BOSS@SequoiaTaylor.com")).toBe(true);
    // The blend, asserted as behaviour rather than as a comment.
    expect(isBossMailbox("os@joinwestpeek.com")).toBe(false);
    expect(isBossMailbox("sequoia@westpeek.ventures")).toBe(false);
  });
});

describe("the tag routes and the sender authorises", () => {
  it("routes #firstname to that employee, from the D1 roster", async () => {
    const roster = await activeRoster(env as never);
    expect(roster.length).toBeGreaterThan(0);
    const monique = roster.find((s) => s.name === "Monique")!;
    expect(monique).toBeTruthy();

    const res = await handleBossInboundMail(mail({ subject: "#monique have a look", body: "please" }), env as never);
    expect(res.outcome).toBe("ROUTED");
    expect(res.employeeId).toBe(monique.id);
    expect(res.taskId).toBeTruthy();

    const task = await env.DB.prepare(`SELECT employee_id, status FROM tasks WHERE id = ?`).bind(res.taskId).first();
    expect(task?.employee_id).toBe(monique.id);
  });

  it("REFUSES a stranger who types a perfect tag, and creates no work", async () => {
    const res = await handleBossInboundMail(
      mail({ from: "attacker@example.com", subject: "#monique urgent, wire the money" }), env as never);
    expect(res.outcome).toBe("REFUSED_SENDER");
    expect(res.taskId).toBeNull();
    // No reply: answering would confirm the address is live and make Boss OS mail a stranger.
    expect(res.reply).toBeNull();
    const row = await env.DB.prepare(`SELECT authorised, outcome FROM boss_inbound_mail WHERE id = ?`).bind(res.mailId).first();
    expect(row?.authorised).toBe(0);
  });

  it("REFUSES her own address when DMARC did not pass — a From: header is a claim", async () => {
    const res = await handleBossInboundMail(
      mail({ subject: "#monique", dmarc: "spf=pass; dkim=pass" }), env as never);
    expect(res.outcome).toBe("REFUSED_SENDER");
    expect(res.taskId).toBeNull();
  });

  it("REFUSES when the header is absent entirely", async () => {
    const m = mail({ subject: "#monique" });
    m.headers.delete("authentication-results");
    expect((await handleBossInboundMail(m, env as never)).outcome).toBe("REFUSED_SENDER");
  });
});

describe("an unknown tag is never guessed and never dropped", () => {
  it("sends it to the Chief of Staff and says so", async () => {
    const roster = await activeRoster(env as never);
    const chief = roster.find((s) => s.role === "Chief of Staff")!;
    const res = await handleBossInboundMail(mail({ subject: "#gertrude please" }), env as never);
    expect(res.outcome).toBe("DEFAULTED");
    expect(res.employeeId).toBe(chief.id);
    expect(res.taskId).toBeTruthy();
    expect(res.reply).toContain("#gertrude");
    // The reply advertises the real roster, so a typo is self-correcting.
    for (const s of roster) expect(res.reply).toContain(seatTag(s.name));
  });

  it("does the same for no tag at all", async () => {
    const res = await handleBossInboundMail(mail({ subject: "a thought", body: "no tag" }), env as never);
    expect(res.outcome).toBe("DEFAULTED");
    expect(res.taskId).toBeTruthy();
  });
});

describe("her live book", () => {
  it("parses every lot of her real book exactly", () => {
    const p = parseLiveBook(HER_BOOK);
    expect(p.unparsed).toEqual([]);
    const byAsset = new Map<string, unknown[]>();
    for (const l of p.positions) {
      if (!byAsset.has(l.asset)) byAsset.set(l.asset, []);
      byAsset.get(l.asset)!.push(l);
    }
    // "and separately" means two blocks, not one of $2.5B.
    expect(byAsset.get("Anthropic")!.length).toBe(2);
    expect(p.positions.map((l) => l.size_usd)).toEqual([2e9, 5e8, 2e9, 6e8, 2e7, 1e7]);
    const openai = p.positions.find((l) => l.asset === "OpenAI")!;
    // The ceiling is the headline and the floor is carried separately — both were lost once.
    expect(openai.size_max_usd).toBe(6e8);
    expect(openai.size_min_usd).toBe(1e8);
    expect(p.positions.every((l) => l.side === "sell")).toBe(true);
  });

  it("files from an email to #monique, versioned", async () => {
    const first = await handleBossInboundMail(
      mail({ subject: "#monique this week's book", body: HER_BOOK }), env as never);
    expect(first.outcome).toBe("ROUTED");
    const v1 = await currentBook(env as never);
    expect(v1?.version).toBe(1);
    expect((await currentBookLines(env as never)).length).toBe(6);

    // A LATER BOOK SUPERSEDES, and the earlier one survives.
    await handleBossInboundMail(
      mail({ subject: "#monique updated", body: "Anthropic shares $1B\nKalshi $50M" }), env as never);
    const v2 = await currentBook(env as never);
    expect(v2?.version).toBe(2);
    expect((await currentBookLines(env as never)).length).toBe(2);
    const old = await env.DB.prepare(`SELECT superseded_at FROM capital_book WHERE version = 1`).first();
    expect(old?.superseded_at).toBeTruthy();
  });

  it("treats an identical resend as confirmation, not a new version", async () => {
    await storeLiveBook(env as never, { text: HER_BOOK, mailId: null });
    const again = await storeLiveBook(env as never, { text: HER_BOOK, mailId: null });
    expect(again.changed).toBe(false);
    expect(again.version).toBe(1);
    expect((await currentBook(env as never))?.version).toBe(1);
  });

  it("REFUSES to supersede a good book with an unreadable one", async () => {
    await storeLiveBook(env as never, { text: HER_BOOK, mailId: null });
    const bad = await storeLiveBook(env as never, { text: "hi, call me about the thing", mailId: null });
    expect(bad.bookId).toBeNull();
    expect((await currentBookLines(env as never)).length).toBe(6);
  });

  it("does not mistake an ordinary instruction to Monique for a book", async () => {
    const roster = await activeRoster(env as never);
    const route = routeToSeat("#monique", roster)!;
    expect(looksLikeBook(route, "can you follow up with the $50M guy tomorrow")).toBe(false);
    expect(looksLikeBook(route, HER_BOOK)).toBe(true);
    // Addressed to somebody else, the same text is not her book.
    const toZora = routeToSeat("#zora", roster)!;
    expect(looksLikeBook(toZora, HER_BOOK)).toBe(false);
  });
});

describe("the seven-day nag", () => {
  it("is loudest when she has never sent one", async () => {
    const alerts = await bookNagAlerts(env as never);
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.severity).toBe("critical");
    expect(alerts[0]!.text).toContain("never");
  });

  it("is silent while the book is fresh, and escalates as it ages", async () => {
    await storeLiveBook(env as never, { text: HER_BOOK, mailId: null });
    const now = Date.now();
    expect(await bookNagAlerts(env as never, now)).toEqual([]);
    expect(await bookNagAlerts(env as never, now + 6 * 86_400_000)).toEqual([]);
    expect((await bookNagAlerts(env as never, now + 7 * 86_400_000))[0]!.severity).toBe("medium");
    expect((await bookNagAlerts(env as never, now + 15 * 86_400_000))[0]!.severity).toBe("high");
    expect((await bookNagAlerts(env as never, now + 22 * 86_400_000))[0]!.severity).toBe("critical");
  });
});
