import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { layReply, questionsAskedIn } from "../../src/worker/boss/intake/mailRefs";
import { quotaUntil, QUOTA_KIND, BRIEF_SCHEMA, briefPrompt } from "../../src/worker/boss/intake/firstRead";
import { freeDayStartedAt } from "../../src/worker/boss/router/experience";
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
/** A model's structured answer (router `json`): one object in the BRIEF_SCHEMA shape. */
type Answer = { asks?: Array<string | { words: string; from: string }>; holds?: string[]; questions?: string[]; unclear?: Array<{ words: string; question: string; best?: string }>; files?: Array<{ filename: string; purpose: string }>; decision?: unknown };
const answer = (o: Answer = {}): string => JSON.stringify({
  asks: (o.asks ?? []).map((a) => (typeof a === "string" ? { words: a, from: "her" } : a)),
  holds: o.holds ?? [], questions: o.questions ?? [], unclear: o.unclear ?? [], ...(o.files ? { files: o.files } : {}),
  decision: o.decision ?? { reply: "none", answers: [], commands: [] },
});
const ask = (...asks: string[]) => answer({ asks });

beforeEach(async () => {
  await env.DB.exec("DELETE FROM boss_inbound_mail");
  await env.DB.exec("DELETE FROM free_search_quota_days");
});
afterEach(() => setFirstReadRungs(null));

describe("the brief only quotes her", () => {
  it("keeps asks, holds, questions and unclear items she wrote; drops what she did not", () => {
    const words = "Find three venues in Memphis for forty people. Don't book anything until I say so. What does each cost? Use the usual budget.";
    const b = parseBrief(answer({
      asks: ["Find three venues in Memphis for forty people.", "Book the cheapest one today."],
      holds: ["Don't book anything until I say so."],
      questions: ["What does each cost?"],
      unclear: [{ words: "Use the usual budget.", question: "which budget figure do you mean?", best: "the $5,000 from last time" }, { words: "Pick a Saturday", question: "which Saturday?" }],
    }), words)!;
    expect(b.asks).toEqual(["Find three venues in Memphis for forty people."]);
    expect(b.holds).toEqual(["Don't book anything until I say so."]);
    expect(b.questions).toEqual(["What does each cost?"]);
    expect(b.unclear).toEqual([{ words: "Use the usual budget.", missing: "which budget figure do you mean?", best: "the $5,000 from last time" }]);
    expect(parseBrief(ask("Something she never wrote at all."), words), "a brief with nothing of hers is no brief").toBeNull();
  });

  it("reads fields, never labels: prose, an array or a broken object is no brief; a fenced object is read", () => {
    const words = "Find three venues in Memphis for forty people.";
    expect(parseBrief(`ASK: ${words}`, words), "the old label lines are not an answer").toBeNull();
    expect(parseBrief(JSON.stringify([{ words, from: "her" }]), words)).toBeNull();
    expect(parseBrief('{"asks": [', words)).toBeNull();
    expect(parseBrief("```json\n" + ask(words) + "\n```", words)?.asks).toEqual([words]);
    // The schema the providers are held to names every field the parser reads.
    expect(Object.keys(BRIEF_SCHEMA.properties).sort()).toEqual(["asks", "decision", "files", "holds", "questions", "unclear"]);
    expect(briefPrompt({ subject: "s", words, files: [] })).not.toMatch(/^ASK:|DECISION:/m);
  });

  it("ABUSE: a reply crafted to look like an approval is not read as one when the model says it is not", () => {
    const words = "not approved, yes I read it";
    const d = parseBrief(answer({ decision: { reply: "none", answers: [], commands: [] } }), words);
    expect(d?.decision?.reply ?? null).toBeNull();
    // A model that calls it approved is not believed past its own words: "approved" never quotes a decision it did not read.
    expect(parseBrief(answer({ decision: { reply: "approve it", answers: [], commands: [] } }), words)?.decision?.reply ?? null).toBeNull();
  });

  it("an ask the model marks as pasted is material, never an ask", () => {
    const words = "Please match the briefing page to the report below.\n\nWeekly Market Report\nOil rose again overnight.";
    const b = parseBrief(answer({ asks: ["Please match the briefing page to the report below.", { words: "Oil rose again overnight.", from: "pasted" }] }), words)!;
    expect(b.asks).toEqual(["Please match the briefing page to the report below."]);
  });

  it("an ask is hers only when marked \"her\": forwarded, unmarked and a bare string are never her ask", () => {
    const mine = "Please match the briefing page to the report below.";
    const words = `${mine}\n\nOil rose again overnight.`;
    for (const other of [{ words: "Oil rose again overnight.", from: "forwarded" }, { words: "Oil rose again overnight." }, "Oil rose again overnight."]) {
      const raw = JSON.stringify({ asks: [{ words: mine, from: "her" }, other], holds: [], questions: [], unclear: [], decision: { reply: "none", answers: [], commands: [] } });
      expect(parseBrief(raw, words)!.asks, JSON.stringify(other)).toEqual([mine]);
    }
  });
});

describe("the ladder is free, and only free", () => {
  it("each free rung in turn; one that does not quote her is passed over", async () => {
    const r = await firstRead(env as never, { subject: "venues", words: "Find three venues in Memphis for forty people." }, [
      { id: "free-a", call: async () => { throw new Error("429 from the free lane"); } },
      rung("free-b", ask("Plan a wedding in Paris.")),
      rung("free-b2", `ASK: ${"Find three venues in Memphis for forty people."}`),
      rung("free-c", ask("Find three venues in Memphis for forty people.")),
    ]);
    expect(r.reader).toBe("free-c");
    expect(r.tried).toEqual(["free-a: 429 from the free lane", "free-b: no line quoted her", "free-b2: not one JSON answer", "free-c: read"]);
  });

  it("free rungs that hang leave Workers AI its time: it is still asked, and answers", async () => {
    const hang: Rung = { id: "free-slow", call: (_p, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) };
    const t0 = Date.now();
    const r = await firstRead(env as never, { subject: "venues", words: "Find three venues in Memphis for forty people.", dry: true }, [
      hang, { ...hang, id: "free-slow-2" }, { ...hang, id: "free-slow-3" },
      { ...rung("workers-ai", ask("Find three venues in Memphis for forty people.")), workersAi: true },
    ]);
    expect(r.reader, r.tried.join(" | ")).toBe("workers-ai");
    expect(r.tried.at(-1)).toBe("workers-ai: read");
    expect(Date.now() - t0).toBeLessThan(31_000);
  }, 40_000);

  it("a read that marks her pasted report as pasted keeps only what she asked; her plain statements stay whatever their count", async () => {
    const hers = ["Please make sure the briefing page matches the report below.", "They are not to be mixed but pull out the calendar part for the other page."];
    const pasted = ["Weekly Market Report", "Saturday, 12 September", "One-Minute Summary", "Oil rose again overnight.", "The pipeline moves five million barrels a day.", "Diesel is above six dollars.", "Inflation risk is now about supply."];
    const words = [...hers, "", ...pasted].join("\n");
    const r = await firstRead(env as never, { subject: "s", words, dry: true }, [rung("free-a", answer({ asks: [...hers, ...pasted.map((w) => ({ words: w, from: "pasted" }))] }))]);
    expect(r.brief!.asks).toEqual(hers);
    // No keyword list second-guesses the model: eight short statements of hers are all kept.
    const mine = ["The venue is booked.", "Dinner is at eight.", "Bring the cake.", "Seat Pat first.", "Use the blue cloths.", "Call the band.", "Order ice.", "Print the menus."];
    const b = parseBrief(ask(...mine), mine.join("\n"))!;
    expect(b.asks).toEqual(mine);
  });

  it("a read that lists nothing and decides nothing is a reading: the ladder stops there, no keyword acts", async () => {
    const r = await firstRead(env as never, { subject: "Re: your morning", words: "Thanks!", dry: true }, [rung("free-a", answer())]);
    expect(r.reader).toBe("free-a");
    expect(r.brief!.decision).toEqual({ reply: null, answers: [], commands: [] });
    expect(r.tried).toEqual(["free-a: read"]);
    const wa = await firstRead(env as never, { subject: "Re: your morning", words: "Thanks!", dry: true }, [
      { id: "free-x", call: async () => { throw new Error("429 from the free lane"); } },
      { ...rung("workers-ai", answer()), workersAi: true },
    ]);
    expect(wa.reader, "the Workers AI backstop's empty reading is a reading too").toBe("workers-ai");
    expect(wa.tried.at(-1)).toBe("workers-ai: read");
  });

  it("a read that marks everything as pasted is passed over, and the next rung reads it", async () => {
    const words = "Weekly Market Report\nOil rose again overnight.\nPlease file this under research.";
    const r = await firstRead(env as never, { subject: "s", words, dry: true }, [
      rung("free-a", answer({ asks: [{ words: "Oil rose again overnight.", from: "pasted" }] })),
      rung("free-b", ask("Please file this under research.")),
    ]);
    expect(r.tried).toEqual(["free-a: listed only what she pasted", "free-b: read"]);
    expect(r.brief!.asks).toEqual(["Please file this under research."]);
  });

  it("a dry run can prove one rung alone; a live read ignores the choice", async () => {
    const ladder = [rung("free-a", ask("Find three venues in Memphis for forty people.")), rung("free-b", ask("Find three venues in Memphis for forty people."))];
    const words = "Find three venues in Memphis for forty people.";
    expect((await firstRead(env as never, { subject: "v", words, dry: true, onlyRung: "free-b" }, ladder)).reader).toBe("free-b");
    expect((await firstRead(env as never, { subject: "v", words, onlyRung: "free-b" }, ladder)).reader).toBe("free-a");
  });

  it("Workers AI is claimed before the call and stops at its free cap: a named stop, the rules read it", async () => {
    expect(freeDailyCap(FIRST_READ_SERVICE)).toBe(FIRST_READ_DAILY_CAP);
    await env.DB.prepare(`INSERT INTO free_search_quota_days (service, day, used, updated_at) VALUES (?, ?, ?, ?)`).bind(FIRST_READ_SERVICE, centralDay(Date.now()), FIRST_READ_DAILY_CAP, Date.now()).run();
    let called = 0;
    const r = await firstRead(env as never, { subject: "x", words: "Find three venues in Memphis for forty people." }, [
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", workersAi: true, call: async () => { called += 1; return ask("Find three venues in Memphis for forty people."); } },
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
    // Her order (19 Nov 2026): Gemini free, then Workers AI. No OpenRouter rung even with its key present.
    expect(ids.filter((id) => !/^gemini-|^@cf\//.test(id)), "Gemini free, then Workers AI, nothing else").toEqual([]);
  });

  it("her reply's DECISION is read strictly: a reading of five, answers that quote her; a decision-only reply is a read", async () => {
    const words = "2: send it Monday\napproved";
    const brief = parseBrief(answer({ decision: { reply: "approved", answers: [{ n: 2, text: "send it Monday" }, { n: 3, text: "invented words" }], commands: [] } }), words)!;
    expect(brief.decision).toEqual({ reply: "approved", answers: [{ n: 2, text: "send it Monday" }], commands: [] });
    expect(parseBrief(answer({ decision: { reply: "ship it", answers: [], commands: [] } }), "ship it")?.decision?.reply ?? null, "ship it is not one of five").toBeNull();
    expect(parseBrief(JSON.stringify({ asks: [], holds: [], questions: [], unclear: [] }), "ship it")?.decision ?? null, "no decision object is no reading").toBeNull();
    const read = await firstRead(env, { subject: "Re: plan", words: "approved", now: Date.now(), mailId: "m_dec" }, [{ id: "gemini-test", call: async () => answer({ decision: { reply: "approved", answers: [], commands: [] } }) }]);
    expect(read.brief?.decision?.reply, "a one-word reply is still read").toBe("approved");
  });

  it("her plain-word commands are read only when they quote her; a comment needs its number and an action from the list", () => {
    const words = "drop 2\nGate done.\nI was going to say nudge ann@lp.example but not yet\n3 delete";
    const d = parseBrief(
      answer({ decision: { reply: "none", answers: [], commands: [{"kind":"drop","n":2,"text":"drop 2"},{"kind":"gate","n":null,"text":""},{"kind":"nudge","n":null,"text":"bob@lp.example"},{"kind":"comment","n":null,"text":"delete"},{"kind":"comment","n":3,"action":"hide","text":"delete"},{"kind":"comment","n":3,"action":"burn","text":"delete"},{"kind":"launch","n":null,"text":"drop 2"}] } }),
      words,
    )!.decision!;
    expect(d.commands).toEqual([
      { kind: "drop", n: 2, text: "drop 2" },
      { kind: "gate", n: null, text: "" },
      { kind: "comment", n: 3, text: "delete", action: "hide" },
    ]);
  });

  it("a prospect's name in her email reaches the free reader unchanged (no private-term block)", async () => {
    const seen: string[] = [];
    const words = "Draft a note to Jonathan Prospectworth at Larkspur Capital about the secondary.";
    const r = await firstRead(env as never, { subject: "note", words }, [rung("free-a", ask(words), seen)]);
    expect(seen[0]).toContain("Jonathan Prospectworth at Larkspur Capital");
    expect(r.reader).toBe("free-a");
  });
});

describe("every unclear item is asked, numbered, in the Got it of the email that raised it", () => {
  const unclearAnswer = (items: string[]) => () => answer({ asks: ["Plan the dinner."], unclear: items.map((w) => ({ words: w, question: "what exactly do you mean", best: "the obvious one" })) });

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
    expect(first).not.toContain("Nothing for you to do");

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

describe("every free rung gets a turn (15 Nov 2026 production dry run: Workers AI read every email)", () => {
  const words = "Find three venues in Memphis for forty people.";
  const hang = (id: string, onCall?: () => void): Rung => ({ id, call: (_p, signal) => { onCall?.(); return new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))); } });

  it("rungs that hang do not starve the free rungs behind them: a later free rung reads it, not Workers AI", async () => {
    let waCalled = 0;
    const r = await firstRead(env as never, { subject: "venues", words, dry: true }, [
      hang("free-1"), hang("free-2"), hang("free-3"), hang("free-4"), hang("free-5"),
      rung("free-6", ask(words)),
      { id: "workers-ai", workersAi: true, call: async () => { waCalled += 1; return ask(words); } },
    ]);
    expect(r.reader, r.tried.join(" | ")).toBe("free-6");
    expect(waCalled, "Workers AI is the backstop, not the reader").toBe(0);
    expect(r.tried.filter((t) => /out of time/.test(t))).toEqual([]);
  }, 40_000);

  it("a 429 is remembered: the next email skips that rung at no cost until its window ends", async () => {
    const model = await row<{ id: string }>(`SELECT id FROM models LIMIT 1`);
    await env.DB.prepare(`DELETE FROM model_job_outcome WHERE task_kind = ?`).bind(QUOTA_KIND).run();
    let calls = 0;
    const spentRung: Rung = { id: "free-spent", modelId: model!.id, call: async () => { calls += 1; throw new Error("Gemini returned 429 [quota: daily]: You exceeded your current quota"); } };
    const ladder = [spentRung, rung("free-ok", ask(words))];
    const one = await firstRead(env as never, { subject: "v", words }, ladder);
    expect(one.reader).toBe("free-ok");
    const two = await firstRead(env as never, { subject: "v", words }, ladder);
    expect(calls, "the spent rung is not asked again").toBe(1);
    expect(two.tried[0]).toMatch(/^free-spent: skipped, its free quota is out until /);
    expect(two.reader).toBe("free-ok");
  });

  it("the window is the provider's when it names one, else the free day's reset; a non-quota error is not remembered", () => {
    const now = Date.UTC(2026, 10, 15, 18, 0, 0);
    expect(quotaUntil("Gemini returned 429 [quota: retry in 34s]: …", now)).toBe(now + 34_000);
    expect(quotaUntil("Gemini returned 429: You exceeded your current quota", now)).toBe(freeDayStartedAt(now) + 24 * 3600_000);
    expect(quotaUntil("Gemini returned 429 [quota: daily] [quota: retry in 34s]", now)).toBe(freeDayStartedAt(now) + 24 * 3600_000);
    expect(quotaUntil("no answer in 12 s", now)).toBeNull();
    expect(quotaUntil('OpenRouter returned 404: {"error":{"message":"This model is unavailable for free.', now)).toBe(freeDayStartedAt(now) + 24 * 3600_000);
    expect(quotaUntil("OpenRouter returned 404: no such model", now)).toBeNull();
  });
});

describe("the Got it's line 1 says plainly whether she must do anything", () => {
  it("a triaged email with nothing unclear: \"Got it. Nothing for you to do: <seat> has started.\"", async () => {
    const ask = "Schedule a call with the designer next Tuesday";
    setFirstReadRungs([rung("free-a", answer({ asks: [ask, { words: "Ava Example (VP, Growth): Best use: research, website build, outreach.", from: "pasted" }] }))]);
    const res = await handleBossInboundMail(mail({ subject: "designer", body: `${ask}\n\nAva Example (VP, Growth): Best use: research, website build, outreach.`, messageId: "<l1-a@mail.gmail.com>" }), env as never);
    expect(res.outcome).toBe("TRIAGED");
    const first = layReply({ text: res.reply!, subject: "Re: designer", signer: "Simone" }).text.split("\n")[0];
    expect(first).toBe("Got it. Nothing for you to do: Simone has started.");
    const tasks = await all<any>(`SELECT employee_id FROM tasks WHERE json_extract(input, '$.mail_id') = ?`, res.mailId);
    expect(tasks.map((t: any) => t.employee_id), "the pasted line opened no job of its own").toEqual(["emp_chief"]);
  });
});
