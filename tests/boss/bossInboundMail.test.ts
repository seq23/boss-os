import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { handleBossInboundMail, isBossMailbox, activeRoster, looksLikeBook, MAX_BODY_BYTES } from "../../src/worker/boss/intake/inboundMail";
import { routeToSeat, seatTag, replyBody } from "../../src/shared/boss/intake/mail.mjs";
import { parseLiveBook, describeLot } from "../../src/shared/boss/intake/liveBook.mjs";
import { storeLiveBook, currentBook, currentBookLines } from "../../src/worker/boss/capital/book";
import { bookNagAlerts } from "../../src/worker/boss/capital/bookNag";
import { unansweredQuestionAlerts } from "../../src/worker/boss/intake/questions";

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

function mail(opts: {
  from?: string; to?: string; subject?: string; body?: string; dmarc?: string;
  messageId?: string; inReplyTo?: string; references?: string;
}) {
  const body = opts.body ?? "";
  const headers = new Headers({
    from: opts.from ?? "Sequoia <seq.taylor@gmail.com>",
    subject: opts.subject ?? "",
    "authentication-results": opts.dmarc ?? "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    ...(opts.messageId ? { "message-id": opts.messageId } : {}),
    ...(opts.inReplyTo ? { "in-reply-to": opts.inReplyTo } : {}),
    ...(opts.references ? { references: opts.references } : {}),
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
    const res = await handleBossInboundMail(
      mail({ subject: "#gertrude", body: "please have a look at the Q3 numbers today" }), env as never);
    expect(res.outcome).toBe("DEFAULTED");
    expect(res.employeeId).toBe(chief.id);
    expect(res.taskId).toBeTruthy();
    expect(res.reply).toContain("#gertrude");
    // The reply advertises the real roster, so a typo is self-correcting.
    for (const s of roster) expect(res.reply).toContain(seatTag(s.name));
  });

  it("does the same for no tag at all", async () => {
    const res = await handleBossInboundMail(
      mail({ subject: "a thought", body: "have a look at the Q3 numbers" }), env as never);
    expect(res.outcome).toBe("DEFAULTED");
    expect(res.taskId).toBeTruthy();
  });

  it("still names the whole roster when it ALSO has to ask a question", async () => {
    const roster = await activeRoster(env as never);
    const res = await handleBossInboundMail(mail({ subject: "#gertrude please" }), env as never);
    // Nothing to act on, so it asks — and the unrecognised tag is still explained in the same reply.
    expect(res.outcome).toBe("NEEDS_CLARITY");
    expect(res.taskId).toBeNull();
    expect(res.reply).toContain("#gertrude");
    for (const s of roster) expect(res.reply).toContain(seatTag(s.name));
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

/**
 * THE VERB, END TO END. The unit rules are asserted by `validate:book-verbs`; what can only be
 * proven here is that the verb actually reaches D1 — that `add` leaves the rest of the book alone,
 * that a sizeless lot survives the round trip, and that a verb nobody could read opens NO TASK.
 */
describe("she says what she means", () => {
  const DATABRICKS = "Databricks — size TBD, looking for buyers this week";

  it("`book` replaces, and carries a lot she has not sized yet", async () => {
    const res = await handleBossInboundMail(
      mail({ subject: "#monique book", body: `${HER_BOOK}\n${DATABRICKS}` }), env as never);
    expect(res.outcome).toBe("ROUTED");
    const lines = await currentBookLines(env as never);
    expect(lines.length).toBe(7);
    const dbx = lines.find((l) => l.asset === "Databricks")!;
    expect(dbx).toBeTruthy();
    // NOT a zero, and not dropped. "I do not know yet" is a state her book has to be able to hold.
    expect(dbx.size_usd).toBeNull();
    expect(String(dbx.size_text)).toMatch(/tbd/i);
  });

  it("A FILED BOOK IS THE WHOLE JOB — no model task, nothing to approve", async () => {
    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks`).first<{ n: number }>();
    const res = await handleBossInboundMail(mail({ subject: "#monique book", body: HER_BOOK }), env as never);
    expect(res.outcome).toBe("ROUTED");
    expect(res.taskId).toBeNull();
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks`).first<{ n: number }>())?.n).toBe(before?.n);
    // She is still told exactly what was filed.
    expect(res.reply).toContain("Kalshi");
    expect((await currentBookLines(env as never)).length).toBe(6);
  });

  it("a book with NO verb still opens work, exactly as it always did", async () => {
    const res = await handleBossInboundMail(
      mail({ subject: "#monique this week's book", body: HER_BOOK }), env as never);
    expect(res.outcome).toBe("ROUTED");
    expect(res.taskId).toBeTruthy();
    expect((await currentBook(env as never))?.version).toBe(1);
  });

  it("`add` amends and leaves everything else standing", async () => {
    await handleBossInboundMail(mail({ subject: "#monique book", body: HER_BOOK }), env as never);
    const before = await currentBookLines(env as never);
    const res = await handleBossInboundMail(
      mail({ subject: "#monique", body: `#monique add\n${DATABRICKS}` }), env as never);
    expect(res.outcome).toBe("ROUTED");
    const after = await currentBookLines(env as never);
    expect(after.length).toBe(before.length + 1);
    expect((await currentBook(env as never))?.version).toBe(2);
    expect(after.some((l) => l.asset === "Databricks" && l.size_usd === null)).toBe(true);
    // The history survives: v1 is superseded, not overwritten.
    expect((await env.DB.prepare(`SELECT superseded_at FROM capital_book WHERE version = 1`).first())?.superseded_at)
      .toBeTruthy();
  });

  it("`add` of something already there at that size does not duplicate it", async () => {
    await handleBossInboundMail(mail({ subject: "#monique book", body: HER_BOOK }), env as never);
    const res = await handleBossInboundMail(mail({ subject: "#monique add Kalshi $20M" }), env as never);
    expect((await currentBookLines(env as never)).filter((l) => l.asset === "Kalshi").length).toBe(1);
    expect(res.reply).toMatch(/already/i);
  });

  it("`remove` drops the named lot and only that one", async () => {
    await handleBossInboundMail(mail({ subject: "#monique book", body: HER_BOOK }), env as never);
    await handleBossInboundMail(mail({ subject: "#monique remove Kalshi" }), env as never);
    const lines = await currentBookLines(env as never);
    expect(lines.some((l) => l.asset === "Kalshi")).toBe(false);
    expect(lines.length).toBe(5);
    // Two Anthropic lots, and a size names one of them.
    await handleBossInboundMail(mail({ subject: "#monique remove Anthropic $500M" }), env as never);
    const anthropic = (await currentBookLines(env as never)).filter((l) => l.asset === "Anthropic");
    expect(anthropic.length).toBe(1);
    expect(anthropic[0]!.size_usd).toBe(2e9);
  });

  it("A VERB IT CANNOT READ REPLIES, AND OPENS NO WORK", async () => {
    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks`).first<{ n: number }>();
    const res = await handleBossInboundMail(
      mail({ subject: "#monique", body: "#monique add whatever you think is best" }), env as never);
    expect(res.outcome).toBe("BOOK_NOT_READ");
    // The whole point: no model task, therefore nothing to hallucinate into her approval queue.
    expect(res.taskId).toBeNull();
    const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks`).first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
    expect(res.reply).toMatch(/could not read a single lot/i);
    expect(res.reply).toContain("size TBD");
    expect((await currentBook(env as never))).toBeNull();
  });

  it("THE ARRIVAL ROW CARRIES THE WHOLE REFUSAL, NOT ITS FIRST LINE", async () => {
    /*
     * On 2026-09-11 three rows recorded "... so your book is" and stopped, because `why` took
     * `bookFailure.split("\n")[0]` and the refusal is wrapped prose. The dropped line was the one
     * carrying UNCHANGED. The reply was fine; the audit trail was the thing that lied by omission.
     */
    const res = await handleBossInboundMail(
      mail({ subject: "#monique", body: "#monique add whatever you think is best" }), env as never);
    expect(res.outcome).toBe("BOOK_NOT_READ");
    const row = await env.DB
      .prepare(`SELECT why FROM boss_inbound_mail WHERE id = ?`).bind(res.mailId).first<{ why: string }>();
    const why = String(row?.why ?? "");
    expect(why).not.toBe("");
    // The sentence completes, and the word that says what happened to her book survives.
    expect(why).toContain("so your book is UNCHANGED");
    expect(why).not.toMatch(/so your book is\s*(No task|The message|Typed|$)/);
    // Still a HEADLINE: the six quoted lines and the worked example stay out of the audit column.
    expect(why).not.toContain("size TBD");
  });

  it("`remove` of a name that is not on the book changes nothing and says what is", async () => {
    await handleBossInboundMail(mail({ subject: "#monique book", body: HER_BOOK }), env as never);
    const res = await handleBossInboundMail(mail({ subject: "#monique remove Polymarket" }), env as never);
    expect(res.outcome).toBe("BOOK_NOT_READ");
    expect(res.taskId).toBeNull();
    expect((await currentBookLines(env as never)).length).toBe(6);
    expect(res.reply).toContain("Kalshi");
  });

  it("a message that merely CONTAINS a verb is an ordinary instruction", async () => {
    // Her real message, 11 Sep 2026. "add" is in it, and it is not the word after the tag.
    const res = await handleBossInboundMail(mail({
      subject: "#Monique",
      body: "#Monique - Please add searching for buyers of Databricks to the weekly list",
    }), env as never);
    expect(res.outcome).not.toBe("ROUTED");
    expect((await currentBook(env as never))).toBeNull();
  });
});

/**
 * SHE IS ASKED, AND NOTHING IS INVENTED. The failure this is built from is `apr_m26zq5praheyw251`:
 * a routed message, a model, and a confident paragraph about an imaginary meeting checklist.
 */
describe("an employee who does not understand asks", () => {
  const DATABRICKS_MESSAGE = "#Monique - Please add searching for buyers of Databricks to the weekly list";

  it("asks about HER message rather than generating from it, and opens no task", async () => {
    const res = await handleBossInboundMail(
      mail({ subject: "#Monique", body: DATABRICKS_MESSAGE }), env as never);
    expect(res.outcome).toBe("NEEDS_CLARITY");
    expect(res.taskId).toBeNull();
    // SPECIFIC: it says what it understood, what it could not, and what to send back.
    expect(res.reply).toContain("Databricks");
    expect(res.reply).toContain(DATABRICKS_MESSAGE);
    expect(res.reply).toMatch(/size TBD/);
    const row = await env.DB.prepare(`SELECT outcome, answered_at FROM boss_inbound_mail WHERE id = ?`)
      .bind(res.mailId).first<{ outcome: string; answered_at: number | null }>();
    expect(row?.outcome).toBe("NEEDS_CLARITY");
    expect(row?.answered_at).toBeNull();
  });

  it("an ordinary instruction is worked, and is never questioned", async () => {
    const res = await handleBossInboundMail(
      mail({ subject: "#monique", body: "can you follow up with the $50M guy tomorrow" }), env as never);
    expect(res.outcome).toBe("ROUTED");
    expect(res.taskId).toBeTruthy();
  });

  it("A REPLY NEVER TRIGGERS A SECOND QUESTION, and closes the first", async () => {
    const asked = await handleBossInboundMail(mail({
      subject: "#Monique", body: DATABRICKS_MESSAGE, messageId: "<q1@mail.gmail.com>",
    }), env as never);
    expect(asked.outcome).toBe("NEEDS_CLARITY");

    // Her answer: short, and short is exactly what rule 2 would otherwise ask about again.
    const answer = await handleBossInboundMail(mail({
      subject: "Re: #Monique", body: "no size", inReplyTo: "<boss-reply@sequoiataylor.com>",
      references: "<q1@mail.gmail.com> <boss-reply@sequoiataylor.com>",
    }), env as never);
    expect(answer.outcome).not.toBe("NEEDS_CLARITY");
    expect(answer.taskId).toBeTruthy();

    const row = await env.DB.prepare(`SELECT answered_at FROM boss_inbound_mail WHERE id = ?`)
      .bind(asked.mailId).first<{ answered_at: number | null }>();
    expect(row?.answered_at).toBeTruthy();

    // And the alert stops nagging about a question she has answered.
    expect(await unansweredQuestionAlerts(env as never, Date.now() + 5 * 86_400_000)).toEqual([]);
  });

  it("an unanswered question becomes visible on Today, and not before it is stale", async () => {
    const asked = await handleBossInboundMail(
      mail({ subject: "#Monique", body: DATABRICKS_MESSAGE }), env as never);
    expect(asked.outcome).toBe("NEEDS_CLARITY");
    expect(await unansweredQuestionAlerts(env as never, Date.now())).toEqual([]);
    const stale = await unansweredQuestionAlerts(env as never, Date.now() + 4 * 86_400_000);
    expect(stale.length).toBe(1);
    expect(stale[0]!.severity).toBe("high");
    expect(stale[0]!.text).toMatch(/waiting on you/i);
  });
});

describe("a message too big for the old cap", () => {
  /**
   * 12 September 2026, 08:59. Her iPhone sent 538,189 bytes — a 32 KB instruction wrapped in a
   * 472 KB `text/html` alternative — against a 512 KB cap measured on the ENVELOPE. The parse was
   * skipped, the body became "", the clarification rules read that as "a tag and nothing in it",
   * and the `!question` guard then gated out the whole `admitTask` block including the oversize
   * branch that exists to open a card anyway. Stored perfectly in R2. No work. No employee.
   */
  const HER_INSTRUCTION = "Please make sure the spirit page of my boss OS system displays astrology";

  it("HER SIZE now parses, and the card holds the instruction and not the envelope", async () => {
    // Her real shape: a small instruction, then the bulk that pushed it over the old cap.
    const bulk = "The report continues. ".repeat(30_000);   // ~630 KB, over 512 KB, under 4 MB
    const m = mail({ subject: "#simone", body: `${HER_INSTRUCTION} in the way it is below.\n\n${bulk}` });
    expect(m.rawSize).toBeGreaterThan(512 * 1024);
    expect(m.rawSize).toBeLessThan(MAX_BODY_BYTES);

    const res = await handleBossInboundMail(m, env as never);
    expect(res.outcome).toBe("ROUTED");
    expect(res.taskId).toBeTruthy();

    const task = await env.DB.prepare(`SELECT input FROM tasks WHERE id = ?`).bind(res.taskId)
      .first<{ input: string }>();
    const body = String(JSON.parse(task!.input).body ?? "");
    expect(body).toContain(HER_INSTRUCTION);
    expect(body).not.toMatch(/was not read here/);
  });

  it("AND A GENUINELY OVERSIZE MESSAGE STILL OPENS A CARD — unread is not empty", async () => {
    // Above the envelope cap, so it is streamed to R2 and never decoded. The body is therefore ""
    // and that must not be mistaken for "she wrote nothing".
    const m = mail({ subject: "#simone", body: "x".repeat(MAX_BODY_BYTES + 1024) });
    expect(m.rawSize).toBeGreaterThan(MAX_BODY_BYTES);

    const res = await handleBossInboundMail(m, env as never);
    expect(res.outcome).not.toBe("NEEDS_CLARITY");
    // THE ASSERTION THAT WOULD HAVE CAUGHT IT: a task_id, always.
    expect(res.taskId).toBeTruthy();

    const task = await env.DB.prepare(`SELECT input, employee_id FROM tasks WHERE id = ?`)
      .bind(res.taskId).first<{ input: string; employee_id: string }>();
    const input = JSON.parse(task!.input);
    // The card says what happened and where the whole of it is, rather than asking her a question.
    expect(String(input.body)).toMatch(/was not read here/);
    expect(String(input.raw_message ?? "")).toMatch(/^boss-inbound-mail\//);
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
