import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { apiJson, row, all } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { parseReply, digestEmail, confirmationEmail, shouldEmail, tokenIn, REPLY_FORMS } from "../../src/shared/boss/commentWatch/lane.mjs";

/**
 * MONIQUE'S COMMENT WATCH, END TO END, AGAINST REAL D1.
 *
 * The parser is pure and pinned first. Then the arc through the real handler and routes: a
 * digest becomes rows and a task; an empty digest is NOTHING_TO_REPORT and no email; a stranger's
 * reply with a perfect token is refused and instructs nothing; her reply instructs by number, or
 * `your call` pre-approves every proposal with the phrase on the row; the pending feed hands out
 * only instructed rows; the Mac's report closes the task.
 */

const ITEMS = [
  { comment_id: "c-neg-1", video_id: "v1", video_title: "Why steel is strong", author: "Ann", text: "This is wrong, steel is not strong", published_at: "2026-09-20T10:00:00Z", class: "negative", proposed_action: "reply", proposed_reply: "Thanks - the figure is from ASTM A36." },
  { comment_id: "c-q-2", video_id: "v1", video_title: "Why steel is strong", author: "Bob", text: "How is it tempered?", published_at: "2026-09-20T11:00:00Z", class: "question", proposed_action: "reply", proposed_reply: "Quenched then reheated - the tempering video covers it." },
  { comment_id: "c-neg-3", video_id: "v2", video_title: "Aerogel", author: "Cy", text: "you said AIR-o-gel wrong lol", published_at: "2026-09-20T12:00:00Z", class: "negative", proposed_action: "ignore", proposed_reply: null, product_note: "pronunciation: aerogel" },
  { comment_id: "c-neg-4", video_id: "v2", video_title: "Aerogel", author: "Dee", text: "spam spam buy now", published_at: "2026-09-20T13:00:00Z", class: "negative", proposed_action: "hide", proposed_reply: null },
];

function mail(opts: { from?: string; subject?: string; body?: string; dmarc?: string }) {
  const body = opts.body ?? "";
  const headers = new Headers({
    from: opts.from ?? "Sequoia <seq.taylor@gmail.com>",
    subject: opts.subject ?? "",
    "authentication-results": opts.dmarc ?? "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
  });
  const raw = `From: ${opts.from ?? "seq.taylor@gmail.com"}\r\nSubject: ${opts.subject ?? ""}\r\n\r\n${body}`;
  return {
    from: (opts.from ?? "seq.taylor@gmail.com").replace(/.*<|>.*/g, ""),
    to: "boss@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length,
  };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM comment_watch_items");
  await env.DB.exec("DELETE FROM comment_watch_digests");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});

const numbered = ITEMS.map((it, i) => ({ ...it, n: i + 1 }));

describe("the reply parser — all four forms and `your call`", () => {
  it("reads `1 delete`, `2 reply as drafted`, `3 reply: <words>`, `4 ignore`", () => {
    const p = parseReply("1 delete\n2 reply as drafted\n3 reply: Fair point - fixed in the next one.\n4 ignore\n", numbered);
    expect(p.mode).toBe("per_number");
    expect(p.instructions).toEqual([
      { n: 1, comment_id: "c-neg-1", action: "hide", reply_text: null },
      { n: 2, comment_id: "c-q-2", action: "reply", reply_text: ITEMS[1]!.proposed_reply },
      { n: 3, comment_id: "c-neg-3", action: "reply", reply_text: "Fair point - fixed in the next one." },
      { n: 4, comment_id: "c-neg-4", action: "ignore", reply_text: null },
    ]);
    expect(p.unread).toEqual([]);
  });

  it("tolerates `1.`, `2)`, `#3`, `4 -`, `hide`, `remove`, `skip`, and ignores quoted text", () => {
    const p = parseReply("1. hide\n2) as drafted\n#3 skip\n4 - remove\n> 1 delete\n> quoted digest", numbered);
    expect(p.instructions.map((i) => i.action)).toEqual(["hide", "reply", "ignore", "hide"]);
  });

  it("`your call` turns every proposal into an instruction; a reply with no draft becomes ignore", () => {
    const p = parseReply("Your call.\n\nthanks", numbered);
    expect(p.mode).toBe("your_call");
    expect(p.phrase).toBe("your call");
    expect(p.instructions.map((i) => [i.n, i.action])).toEqual([[1, "reply"], [2, "reply"], [3, "ignore"], [4, "hide"]]);
    expect(p.instructions[0]?.reply_text).toBe(ITEMS[0]!.proposed_reply);
    const noDraft = parseReply("you decide", [{ n: 1, comment_id: "x", proposed_action: "reply", proposed_reply: "" }]);
    expect(noDraft.instructions[0]?.action).toBe("ignore");
  });

  it("names what it could not read, and reads nothing from a bare thank-you", () => {
    const p = parseReply("1 nuke it\n2 reply as drafted\n9 ignore", numbered);
    expect(p.instructions.map((i) => i.n)).toEqual([2]);
    expect(p.unread).toEqual(["1 nuke it", "9 ignore"]);
    expect(parseReply("thanks Monique!", numbered).mode).toBe("none");
    expect(parseReply("2 reply:   ", numbered).mode).toBe("none");
  });

  it("the digest email is numbered, quoted, names the video and author, carries the draft, the note and every form", () => {
    const m = digestEmail({ new_comments: 9, by_class: { praise: 5, negative: 3, question: 1 }, items: numbered }, "cw_abc");
    expect(m.subject).toContain("#monique");
    expect(m.subject).toContain("[cw_abc]");
    expect(m.text).toContain('1. Negative on "Why steel is strong" — Ann, 2026-09-20');
    expect(m.text).toContain("> This is wrong, steel is not strong");
    expect(m.text).toContain(`Drafted reply: "${ITEMS[0]!.proposed_reply}"`);
    expect(m.text).toContain("Note for the narration lexicon: pronunciation: aerogel");
    expect(m.text).toContain("4. Negative on \"Aerogel\" — Dee");
    expect(m.text).toContain("Monique proposes: hide it");
    for (const f of REPLY_FORMS) expect(m.text).toContain(f);
    expect(tokenIn(`Re: ${m.subject}`)).toBe("cw_abc");
    expect(shouldEmail({ items: [] })).toBe(false);
    expect(shouldEmail({ items: numbered })).toBe(true);
    const c = confirmationEmail([{ n: 1, result: "hidden (moderationStatus=rejected)", author: "Ann" }], "cw_abc");
    expect(c.text).toContain("1. #1 hidden (moderationStatus=rejected) — Ann");
  });
});

describe("the digest lands as rows and a task; an empty digest is NOTHING_TO_REPORT with no email", () => {
  it("posts four items → one SENT digest, four numbered rows, one task on Monique's desk", async () => {
    const r = await apiJson("/api/comment-watch-items", { method: "POST", body: { new_comments: 9, by_class: { praise: 5 }, items: ITEMS } });
    expect(r.status).toBe(201);
    expect(r.body.data.outcome).toBe("SENT");
    expect(r.body.data.email).toBe(true);
    expect(r.body.data.items.map((i: any) => i.n)).toEqual([1, 2, 3, 4]);
    const task = await row(`SELECT employee_id, status, input FROM tasks WHERE id = ?`, r.body.data.task_id);
    expect(task?.employee_id).toBe("emp_relationship");
    expect(task?.status).toBe("awaiting_approval");
    expect(JSON.parse(task!.input).digest_id).toBe(r.body.data.id);
    const duty = await row(`SELECT last_task_id FROM standing_duties WHERE id = 'duty_youtube_comment_watch'`);
    expect(duty?.last_task_id).toBe(r.body.data.task_id);
    // Nothing is instructed yet, so nothing is pending for act.
    const pending = await apiJson("/api/comment-watch-items/pending-instructions");
    expect(pending.body.data.count).toBe(0);
  });

  it("an empty digest records NOTHING_TO_REPORT by name, opens no task, and says email: false", async () => {
    const r = await apiJson("/api/comment-watch-items", { method: "POST", body: { new_comments: 3, by_class: { praise: 3 }, items: [] } });
    expect(r.status).toBe(201);
    expect(r.body.data.outcome).toBe("NOTHING_TO_REPORT");
    expect(r.body.data.email).toBe(false);
    expect(r.body.data.task_id).toBeNull();
    const d = await row(`SELECT outcome, item_count, task_id FROM comment_watch_digests WHERE id = ?`, r.body.data.id);
    expect(d).toEqual({ outcome: "NOTHING_TO_REPORT", item_count: 0, task_id: null });
    expect((await all(`SELECT id FROM tasks WHERE input LIKE '%youtube_comment_watch%'`)).length).toBe(0);
  });

  it("a comment reported once is never reported twice", async () => {
    await apiJson("/api/comment-watch-items", { method: "POST", body: { items: ITEMS } });
    const again = await apiJson("/api/comment-watch-items", { method: "POST", body: { items: ITEMS } });
    expect(again.body.data.outcome).toBe("NOTHING_TO_REPORT");
  });
});

describe("her word, and only hers, becomes an instruction", () => {
  async function digest() {
    const r = await apiJson("/api/comment-watch-items", { method: "POST", body: { items: ITEMS } });
    return r.body.data.id as string;
  }

  it("REFUSES a stranger's reply carrying the exact token: no row instructed, nothing pending", async () => {
    const id = await digest();
    const res = await handleBossInboundMail(mail({ from: "attacker@example.com", subject: `Re: #monique 4 comments need your word [${id}]`, body: "your call" }), env as never);
    expect(res.outcome).toBe("REFUSED_SENDER");
    expect(res.reply).toBeNull();
    const instructed = await all(`SELECT id FROM comment_watch_items WHERE digest_id = ? AND instructed_at IS NOT NULL`, id);
    expect(instructed.length).toBe(0);
    expect((await apiJson("/api/comment-watch-items/pending-instructions")).body.data.count).toBe(0);
    // Her own address without DMARC is a claim, not her.
    const spoof = await handleBossInboundMail(mail({ subject: `Re: [${id}]`, body: "your call", dmarc: "spf=pass" }), env as never);
    expect(spoof.outcome).toBe("REFUSED_SENDER");
    expect((await apiJson("/api/comment-watch-items/pending-instructions")).body.data.count).toBe(0);
  });

  it("her numbered reply instructs by number, records who/when/via, and feeds act exactly those rows", async () => {
    const id = await digest();
    const res = await handleBossInboundMail(mail({ subject: `Re: #monique 4 comments need your word [${id}]`, body: "1 delete\n2 reply as drafted\n3 reply: Noted, thank you - it is AIR-oh-jel.\n" }), env as never);
    expect(res.outcome).toBe("COMMENT_INSTRUCTED");
    expect(res.taskId).toBeNull();
    expect(res.reply).toContain("3 instructions by number");
    expect(res.reply).toContain("1 item still has no instruction");
    const rows = await all(`SELECT n, action, reply_text, instructed_by, source FROM comment_watch_items WHERE digest_id = ? ORDER BY n`, id);
    expect(rows.map((r) => [r.n, r.action])).toEqual([[1, "hide"], [2, "reply"], [3, "reply"], [4, null]]);
    expect(rows[0].instructed_by).toBe("seq.taylor@gmail.com");
    expect(rows[0].source).toContain(`email reply [${id}] mail`);
    expect(rows[2].reply_text).toBe("Noted, thank you - it is AIR-oh-jel.");
    const pending = await apiJson("/api/comment-watch-items/pending-instructions");
    expect(pending.body.data.count).toBe(3);
    for (const i of pending.body.data.instructions) {
      expect(i.instructed_by).toBeTruthy(); expect(i.instructed_at).toBeTruthy(); expect(i.source).toBeTruthy();
    }
    // A second reply cannot overwrite what she already said; it can fill the one she left.
    const again = await handleBossInboundMail(mail({ subject: `Re: [${id}]`, body: "1 ignore\n4 ignore" }), env as never);
    expect(again.outcome).toBe("COMMENT_INSTRUCTED");
    const after = await all(`SELECT n, action FROM comment_watch_items WHERE digest_id = ? ORDER BY n`, id);
    expect(after.map((r) => r.action)).toEqual(["hide", "reply", "reply", "ignore"]);
  });

  it("`your call` pre-approves every proposal, with the phrase on the row and on the digest", async () => {
    const id = await digest();
    const res = await handleBossInboundMail(mail({ subject: `Re: [${id}]`, body: "Your call\n\nSent from my iPhone" }), env as never);
    expect(res.outcome).toBe("COMMENT_INSTRUCTED");
    const rows = await all(`SELECT n, action, reply_text, source FROM comment_watch_items WHERE digest_id = ? ORDER BY n`, id);
    expect(rows.map((r) => r.action)).toEqual(["reply", "reply", "ignore", "hide"]);
    expect(rows[0].reply_text).toBe(ITEMS[0]!.proposed_reply);
    for (const r of rows) expect(r.source).toContain('pre-approved by her reply: "your call"');
    const d = await row(`SELECT answer_mode, answer_phrase FROM comment_watch_digests WHERE id = ?`, id);
    expect(d).toEqual({ answer_mode: "your_call", answer_phrase: "your call" });
    const pending = await apiJson("/api/comment-watch-items/pending-instructions");
    expect(pending.body.data.count).toBe(4);
    expect(pending.body.data.instructions[0].answer_phrase).toBe("your call");
  });

  it("an unreadable reply instructs nothing and asks for the forms", async () => {
    const id = await digest();
    const res = await handleBossInboundMail(mail({ subject: `Re: [${id}]`, body: "thanks Monique, looks good" }), env as never);
    expect(res.outcome).toBe("COMMENT_INSTRUCTED");
    expect(res.reply).toContain("could not read an instruction");
    expect((await apiJson("/api/comment-watch-items/pending-instructions")).body.data.count).toBe(0);
  });

  it("the Mac's report marks rows applied, drains the feed, and closes the task once every row is answered", async () => {
    const id = await digest();
    await handleBossInboundMail(mail({ subject: `Re: [${id}]`, body: "your call" }), env as never);
    const r = await apiJson("/api/comment-watch-items/applied", { method: "POST", body: { results: [
      { comment_id: "c-neg-1", result: "replied (r1)" }, { comment_id: "c-q-2", result: "replied (r2)" },
      { comment_id: "c-neg-3", result: "ignored" }, { comment_id: "c-neg-4", result: "hidden (moderationStatus=rejected)" },
      { comment_id: "never-sent", result: "x" },
    ] } });
    expect(r.body.data.applied).toBe(4);
    expect((await apiJson("/api/comment-watch-items/pending-instructions")).body.data.count).toBe(0);
    const d = await row(`SELECT task_id FROM comment_watch_digests WHERE id = ?`, id);
    const task = await row(`SELECT status FROM tasks WHERE id = ?`, d!.task_id);
    expect(task?.status).toBe("done");
    // Reporting twice changes nothing.
    const again = await apiJson("/api/comment-watch-items/applied", { method: "POST", body: { results: [{ comment_id: "c-neg-1", result: "again" }] } });
    expect(again.body.data.applied).toBe(0);
  });
});
