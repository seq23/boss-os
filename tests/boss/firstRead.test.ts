import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { layReply, questionsAskedIn } from "../../src/worker/boss/intake/mailRefs";
import { firstRead, freeRungs, parseBrief, setFirstReadRungs, unclearLines, FIRST_READ_DAILY_CAP, FIRST_READ_SERVICE, type Rung } from "../../src/worker/boss/intake/firstRead";
import { freeDailyCap } from "../../src/worker/boss/backends/guard";
import { centralDay } from "../../src/worker/boss/research/searchQuota";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { apiJson, row, all } from "./helpers";

/**
 * EVERY EMAIL OF HERS GETS A FIRST READ (15 Nov 2026). A free model writes a brief onto the job: her
 * asks, holds, questions and unclear items, each in her own words, and each file's purpose. Pinned:
 *   · only lines that quote her survive; the model never picks the seat;
 *   · the ladder is the free rungs in turn, then Workers AI under its daily cap (a named stop at the
 *     cap, never paid), then the rules; never a Claude or OpenAI route;
 *   · a prospect's name in her email reaches the free reader (her ruling: Boss OS ignores the
 *     private-email rules);
 *   · every unclear item is asked, numbered, in the ONE Got it of the email that raised it; a new
 *     email asks again; a redelivery asks nothing; more than five become best readings, all listed;
 *   · a reply on a job she took over in a session is added to it and answered "being handled".
 */

const AUTH = "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com";
function mail(o: { subject: string; body: string; messageId: string; inReplyTo?: string }) {
  const raw = `From: seq.taylor@gmail.com\r\nSubject: ${o.subject}\r\n\r\n${o.body}`;
  return {
    from: "seq.taylor@gmail.com", to: "boss@sequoiataylor.com",
    headers: new Headers({ from: "Sequoia <seq.taylor@gmail.com>", subject: o.subject, "authentication-results": AUTH, "message-id": o.messageId, ...(o.inReplyTo ? { "in-reply-to": o.inReplyTo, references: o.inReplyTo } : {}) }),
    raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length,
  };
}
const rung = (id: string, answer: string | (() => string), seen?: string[]): Rung => ({
  id, call: async (prompt) => { seen?.push(prompt); return typeof answer === "function" ? answer() : answer; },
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM boss_inbound_mail");
  await env.DB.exec("DELETE FROM free_search_quota_days");
});
afterEach(() => setFirstReadRungs(null));

describe("the brief only quotes her", () => {
  it("keeps asks, holds, questions and unclear items she wrote; drops what she did not", () => {
    const words = "Find three venues in Memphis for forty people. Don't book anything until I say so. What does each cost? Use the usual budget.";
    const b = parseBrief([
      "ASK: Find three venues in Memphis for forty people.",
      "ASK: Book the cheapest one today.",
      "HOLD: Don't book anything until I say so.",
      "QUESTION: What does each cost?",
      "UNCLEAR: Use the usual budget. :: which budget figure she means :: the $5,000 from last time",
      "UNCLEAR: Pick a Saturday :: which Saturday",
    ].join("\n"), words)!;
    expect(b.asks).toEqual(["Find three venues in Memphis for forty people."]);
    expect(b.holds).toEqual(["Don't book anything until I say so."]);
    expect(b.questions).toEqual(["What does each cost?"]);
    expect(b.unclear).toEqual([{ words: "Use the usual budget.", missing: "which budget figure she means", best: "the $5,000 from last time" }]);
    expect(parseBrief("ASK: Something she never wrote at all.", words), "a brief with nothing of hers is no brief").toBeNull();
  });
});

describe("the ladder is free, and only free", () => {
  it("each free rung in turn; one that does not quote her is passed over", async () => {
    const r = await firstRead(env as never, { subject: "venues", words: "Find three venues in Memphis for forty people." }, [
      { id: "free-a", call: async () => { throw new Error("429 from the free lane"); } },
      rung("free-b", "ASK: Plan a wedding in Paris."),
      rung("free-c", "ASK: Find three venues in Memphis for forty people."),
    ]);
    expect(r.reader).toBe("free-c");
    expect(r.tried).toEqual(["free-a: 429 from the free lane", "free-b: no line quoted her", "free-c: read"]);
  });

  it("free rungs that hang leave Workers AI its time: it is still asked, and answers", async () => {
    const hang: Rung = { id: "free-slow", call: (_p, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) };
    const t0 = Date.now();
    const r = await firstRead(env as never, { subject: "venues", words: "Find three venues in Memphis for forty people.", dry: true }, [
      hang, { ...hang, id: "free-slow-2" }, { ...hang, id: "free-slow-3" },
      { ...rung("workers-ai", "ASK: Find three venues in Memphis for forty people."), workersAi: true },
    ]);
    expect(r.reader, r.tried.join(" | ")).toBe("workers-ai");
    expect(r.tried.at(-1)).toBe("workers-ai: read");
    expect(Date.now() - t0).toBeLessThan(31_000);
  }, 40_000);

  it("Workers AI is claimed before the call and stops at its free cap: a named stop, the rules read it", async () => {
    expect(freeDailyCap(FIRST_READ_SERVICE)).toBe(FIRST_READ_DAILY_CAP);
    await env.DB.prepare(`INSERT INTO free_search_quota_days (service, day, used, updated_at) VALUES (?, ?, ?, ?)`).bind(FIRST_READ_SERVICE, centralDay(Date.now()), FIRST_READ_DAILY_CAP, Date.now()).run();
    let called = 0;
    const r = await firstRead(env as never, { subject: "x", words: "Find three venues in Memphis for forty people." }, [
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", workersAi: true, call: async () => { called += 1; return "ASK: Find three venues in Memphis for forty people."; } },
    ]);
    expect(called, "nothing is called past the free cap").toBe(0);
    expect(r.brief).toBeNull();
    expect(r.stop).toMatch(/^NAMED STOP \[FIRST_READ_FREE_CAP\]/);
  });

  it("the real ladder holds no Claude, no OpenAI and nothing billed", async () => {
    const e = Object.create(env);
    e.OPENROUTER_API_KEY = "test"; e.GEMINI_API_KEY = "test"; e.AI = { run: async () => ({ response: "" }) };
    const ids = (await freeRungs(e as never)).map((x) => x.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.filter((id) => /anthropic|claude|openai\/|gpt/i.test(id))).toEqual([]);
    expect(ids.filter((id) => !/:free$|^gemini-|^@cf\//.test(id)), "every rung is a free slug or Workers AI").toEqual([]);
    expect(ids[ids.length - 1]).toMatch(/^@cf\//);
  });

  it("a prospect's name in her email reaches the free reader unchanged (no private-term block)", async () => {
    const seen: string[] = [];
    const words = "Draft a note to Jonathan Prospectworth at Larkspur Capital about the secondary.";
    const r = await firstRead(env as never, { subject: "note", words }, [rung("free-a", `ASK: ${words}`, seen)]);
    expect(seen[0]).toContain("Jonathan Prospectworth at Larkspur Capital");
    expect(r.reader).toBe("free-a");
  });
});

describe("every unclear item is asked, numbered, in the Got it of the email that raised it", () => {
  const unclearAnswer = (items: string[]) => () => ["ASK: Plan the dinner.", ...items.map((w) => `UNCLEAR: ${w} :: what exactly do you mean :: the obvious one`)].join("\n");

  it("3 items: one reply, 3 numbered questions quoting her; the brief is on the job; build goes on", async () => {
    const items = ["Use the usual place.", "Invite the regulars.", "Keep it to the normal budget."];
    setFirstReadRungs([rung("free-a", unclearAnswer(items))]);
    const res = await handleBossInboundMail(mail({ subject: "#simone dinner", body: `Plan the dinner. ${items.join(" ")}`, messageId: "<fr-3@mail.gmail.com>" }), env as never);
    expect(res.taskId, "the work is filed meanwhile, not held for the answers").toBeTruthy();
    const reply = res.reply!;
    expect(reply).toContain("3 things I need from you (reply by number");
    items.forEach((w, i) => expect(reply).toContain(`  ${i + 1}. You wrote "${w}": what exactly do you mean?`));
    const input = JSON.parse((await row<any>(`SELECT input FROM tasks WHERE id = ?`, res.taskId))!.input);
    expect(input.first_read.unclear.map((u: any) => u.words)).toEqual(items);
    expect(input.first_read.reader).toBe("free-a");
    expect(input.body).toContain("ask every unclear item, numbered, in one email; never merge, drop or guess");

    // Line 1 says she has something to answer, never "Nothing to do" above her questions.
    expect(questionsAskedIn(reply)).toBe(3);
    const first = layReply({ text: reply, subject: "Re: dinner", signer: "Simone" }).text.split("\n").find((l) => l.trim())!;
    expect(first).toContain("3 things for you to answer below");
    expect(first).not.toContain("Nothing to do");

    // The same email delivered again: no second email.
    const again = await handleBossInboundMail(mail({ subject: "#simone dinner", body: `Plan the dinner. ${items.join(" ")}`, messageId: "<fr-3@mail.gmail.com>" }), env as never);
    expect(again.outcome).toBe("DUPLICATE");
    expect(again.reply).toBeNull();

    // A new email of hers with new items: its own Got it asks them.
    setFirstReadRungs([rung("free-a", unclearAnswer(["Bring the usual wine."]))]);
    const next = await handleBossInboundMail(mail({ subject: "#simone wine", body: "Plan the dinner. Bring the usual wine.", messageId: "<fr-4@mail.gmail.com>" }), env as never);
    expect(next.reply).toContain('One thing I need from you');
    expect(next.reply).toContain('1. You wrote "Bring the usual wine."');
  });

  it("6 items: said plainly that it reads several ways, a best reading for each, all 6 listed", async () => {
    const items = ["Use the usual place.", "Invite the regulars.", "Keep it to the normal budget.", "Book the usual time.", "Order the usual menu.", "Send the usual invite."];
    setFirstReadRungs([rung("free-a", unclearAnswer(items))]);
    const res = await handleBossInboundMail(mail({ subject: "#simone dinner six", body: `Plan the dinner. ${items.join(" ")}`, messageId: "<fr-6@mail.gmail.com>" }), env as never);
    expect(res.reply).toContain("Your email reads several ways in 6 places");
    items.forEach((w, i) => expect(res.reply).toContain(`  ${i + 1}. "${w}": I read it as the obvious one.`));
    expect(unclearLines(items.map((w) => ({ words: w, missing: "m", best: null }))).length).toBe(7);
  });

  it("no free model answers: no first read, the rules read it, and the Got it still lists her asks", async () => {
    setFirstReadRungs([]);
    const res = await handleBossInboundMail(mail({ subject: "#simone venues", body: "Find three venues in Memphis for forty people.", messageId: "<fr-none@mail.gmail.com>" }), env as never);
    expect(res.taskId).toBeTruthy();
    expect(res.reply).toContain('"Find three venues in Memphis for forty people."');
  });
});

describe("a reply on a job she took over in a session", () => {
  it("is added to that job word for word, opens nothing, and the Got it says it is being handled", async () => {
    setFirstReadRungs([]);
    const opened = await handleBossInboundMail(mail({ subject: "#simone landing page", body: "Build the landing page for the dinner club.", messageId: "<to-1@mail.gmail.com>" }), env as never);
    const take = await apiJson<any>(`/api/tasks/${opened.taskId}/take-over`, { method: "POST", body: { note: "doing it in Claude Code" } });
    expect(take.status).toBe(200);
    const before = (await all<any>(`SELECT id FROM tasks`)).length;
    const reply = await handleBossInboundMail(mail({ subject: "Re: #simone landing page", body: "Use the green logo.", messageId: "<to-2@mail.gmail.com>", inReplyTo: "<to-1@mail.gmail.com>" }), env as never);
    expect(reply.outcome).toBe("TAKEN_OVER_NOTED");
    expect(reply.reply).toMatch(/is being handled in a session right now.*nothing is lost/);
    expect((await all<any>(`SELECT id FROM tasks`)).length, "no new job").toBe(before);
    const input = JSON.parse((await row<any>(`SELECT input FROM tasks WHERE id = ?`, opened.taskId))!.input);
    expect(input.body).toContain("Use the green logo.");
    // And the queue leaves it alone.
    await handleTask(env as never, { taskId: opened.taskId!, lane: "ops" } as never);
    expect((await all<any>(`SELECT event FROM task_events WHERE task_id = ? AND event = 'skipped_taken_over'`, opened.taskId)).length).toBe(1);
  });
});
