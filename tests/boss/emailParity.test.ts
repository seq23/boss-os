import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { afterResult } from "../../src/worker/boss/service/afterResult";
import { handleTask, outageWait } from "../../src/worker/boss/queue/consumer";
import { ProviderFailure } from "../../src/worker/boss/router";
import { insertTask, row, all } from "./helpers";

/**
 * EMAILING HER SYSTEM FEELS LIKE TYPING TO CLAUDE IN A CHAT (15 Nov 2026): everything she writes is
 * read once, in full, acted on, and answered once. One behaviour test per defect class that was
 * CONFIRMED in Boss OS (the West Peek OS fixes #442-#445, brought across).
 */

function mail(o: { subject?: string; body?: string; messageId?: string; inReplyTo?: string; raw?: string }) {
  const raw = o.raw ?? `From: seq.taylor@gmail.com\r\nSubject: ${o.subject ?? ""}\r\n\r\n${o.body ?? ""}`;
  return {
    from: "seq.taylor@gmail.com",
    to: "boss@sequoiataylor.com",
    headers: new Headers({
      from: "Sequoia <seq.taylor@gmail.com>",
      subject: o.subject ?? "",
      "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
      ...(o.messageId ? { "message-id": o.messageId } : {}),
      ...(o.inReplyTo ? { "in-reply-to": o.inReplyTo, references: o.inReplyTo } : {}),
    }),
    raw: new Response(raw).body!,
    rawSize: new TextEncoder().encode(raw).length,
  };
}

const QUOTED = "\n\nOn Sat, Nov 14, 2026 at 9:00 AM Simone <simone@sequoiataylor.com> wrote:\n> Old instruction: delete the whole site.\n> Reply \"drop it\" to close it.";
const tasksOf = (mailId: string) => all<any>(`SELECT id, status, input FROM tasks WHERE json_extract(input, '$.mail_id') = ?`, mailId);
const notices = (taskId: string) => all<any>(`SELECT kind, body FROM boss_task_notices WHERE task_id = ?`, taskId);
const resultTask = async (id: string) => {
  const t = (await row<any>(`SELECT id, lane, title, employee_id, input, attempts FROM tasks WHERE id = ?`, id))!;
  return { ...t, input: JSON.parse(t.input ?? "{}") };
};

beforeEach(async () => {
  await env.DB.exec("DELETE FROM boss_inbound_mail");
  await env.DB.exec("DELETE FROM boss_task_notices");
});

describe("a. one email is worked once", () => {
  it("a re-delivered email (same Message-ID) opens no second job and sends no second reply", async () => {
    const first = await handleBossInboundMail(mail({ subject: "#camille hosting", body: "Research the three cheapest ways to host a static site.", messageId: "<dup-1@mail.gmail.com>" }), env as never);
    expect(first.taskId).toBeTruthy();
    const again = await handleBossInboundMail(mail({ subject: "#camille hosting", body: "Research the three cheapest ways to host a static site.", messageId: "<dup-1@mail.gmail.com>" }), env as never);
    expect(again.outcome).toBe("DUPLICATE");
    expect(again.reply).toBeNull();
    expect(again.taskId).toBeNull();
    expect((await tasksOf(again.mailId)).length).toBe(0);
  });
});

describe("b. quoted history is not a new instruction", () => {
  it("her answer to a stopped job carries her own words, never the notice quoted under them", async () => {
    const id = await insertTask({ status: "failed", input: JSON.stringify({ body: "Make the landing page.", from: "seq.taylor@gmail.com" }) });
    const res = await handleBossInboundMail(mail({ subject: `Re: Stopped: landing page [${id}]`, body: `Use the blue logo.${QUOTED}`, messageId: "<b-1@mail.gmail.com>" }), env as never);
    expect(res.outcome).toBe("BLOCK_ANSWERED");
    const body = JSON.parse((await row<any>(`SELECT input FROM tasks WHERE id = ?`, id))!.input).body as string;
    expect(body).toContain("Use the blue logo.");
    expect(body).not.toContain("delete the whole site");
  });
});

describe("c. one round, one reply", () => {
  it("a second email while the job is queued or running joins it, and ONE answer covers both", async () => {
    const first = await handleBossInboundMail(mail({ subject: "#camille hosting", body: "Research the three cheapest ways to host a static site.", messageId: "<c-1@mail.gmail.com>" }), env as never);
    const taskId = first.taskId!;
    const steer = await handleBossInboundMail(mail({ subject: "Re: #camille hosting", body: `Also cover what each costs a month.${QUOTED}`, messageId: "<c-2@mail.gmail.com>", inReplyTo: "<c-1@mail.gmail.com>" }), env as never);
    expect(steer.outcome).toBe("STEERED");
    expect(steer.taskId).toBe(taskId);
    expect((await tasksOf(steer.mailId)).length).toBe(0); // no second job
    let input = JSON.parse((await row<any>(`SELECT input FROM tasks WHERE id = ?`, taskId))!.input);
    expect(input.body).toContain("Also cover what each costs a month.");
    expect(input.body).not.toContain("delete the whole site");

    // While it RUNS: the finished run takes her newer words first, and sends nothing yet.
    await env.DB.prepare(`UPDATE tasks SET status = 'running' WHERE id = ?`).bind(taskId).run();
    await handleBossInboundMail(mail({ subject: "Re: #camille hosting", body: "And which one you would pick.", messageId: "<c-3@mail.gmail.com>", inReplyTo: "<c-1@mail.gmail.com>" }), env as never);
    await env.DB.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).bind(taskId).run();
    await afterResult(env as never, await resultTask(taskId), "Three hosts, without the prices.", { done: true, fromName: "Camille" });
    expect(await notices(taskId)).toHaveLength(0);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId))!.status).toBe("queued");
    input = JSON.parse((await row<any>(`SELECT input FROM tasks WHERE id = ?`, taskId))!.input);
    expect(input.body).toContain("And which one you would pick.");

    // The rerun's answer is the ONE reply.
    await env.DB.prepare(`UPDATE tasks SET status = 'done', attempts = attempts + 1 WHERE id = ?`).bind(taskId).run();
    await afterResult(env as never, await resultTask(taskId), "Three hosts, their prices, and my pick.", { done: true, fromName: "Camille" });
    expect(await notices(taskId)).toHaveLength(1);
  });

  it("one email split into several jobs is answered in ONE email, after the last job finishes", async () => {
    const input = JSON.stringify({ source: "boss_inbound_mail", mail_id: "iml_round_test", from: "seq.taylor@gmail.com", subject: "two things" });
    const a = await insertTask({ status: "done", title: "two things (1 of 2)", input });
    const b = await insertTask({ status: "running", title: "two things (2 of 2)", input });
    await afterResult(env as never, await resultTask(a), "Answer to the first ask.", { done: true, fromName: "Simone" });
    expect(await notices(a)).toHaveLength(0);
    await env.DB.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).bind(b).run();
    await afterResult(env as never, await resultTask(b), "Answer to the second ask.", { done: true, fromName: "Simone" });
    const sent = [...(await notices(a)), ...(await notices(b))];
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("Answer to the first ask.");
    expect(sent[0].body).toContain("Answer to the second ask.");
  });
});

describe("e. an answer is never cut without saying so", () => {
  it("a done answer longer than an email holds says it stops and where the rest is", async () => {
    const id = await insertTask({ status: "done", input: JSON.stringify({ from: "seq.taylor@gmail.com" }) });
    await afterResult(env as never, await resultTask(id), "x".repeat(25_000), { done: true, fromName: "Camille" });
    const [n] = await notices(id);
    expect(n.body).toContain("longer than one email holds");
  });
});

describe("g. a voice note is her words", () => {
  const withAudio = (body: string) => [
    "From: seq.taylor@gmail.com", "Subject: #camille voice", "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b1"', "",
    "--b1", "Content-Type: text/plain; charset=utf-8", "", body, "",
    "--b1", 'Content-Type: audio/mp4; name="New Recording 4.m4a"', 'Content-Disposition: attachment; filename="New Recording 4.m4a"', "Content-Transfer-Encoding: base64", "",
    btoa("fake audio bytes"), "--b1--", "",
  ].join("\r\n");

  it("is transcribed into the job, and one that cannot be heard is a named stop in the reply", async () => {
    const heard = Object.create(env);
    heard.AI = { run: async () => ({ text: "Find venues in Memphis for forty people." }) };
    const res = await handleBossInboundMail(mail({ raw: withAudio("Recording attached."), subject: "#camille voice", messageId: "<g-1@mail.gmail.com>" }), heard as never);
    const body = JSON.parse((await row<any>(`SELECT input FROM tasks WHERE id = ?`, res.taskId))!.input).body as string;
    expect(body).toContain("Find venues in Memphis for forty people.");

    const deaf = Object.create(env);
    deaf.AI = undefined;
    const res2 = await handleBossInboundMail(mail({ raw: withAudio("Recording attached."), subject: "#camille voice", messageId: "<g-2@mail.gmail.com>" }), deaf as never);
    expect(res2.reply).toContain("NAMED STOP [VOICE_NOTE_NOT_TRANSCRIBED]");
  });
});

describe("h. an outage spends no attempt", () => {
  it("every model failing waits by name and tries later, for up to a day", async () => {
    const id = await insertTask({ status: "running" });
    const task = { id, lane: "ops", title: "A task" };
    expect(await outageWait(env as never, task, new ProviderFailure("Every model on this route failed: 503", "down"))).toBe(true);
    const stop = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'named_stop'`, id);
    expect(JSON.parse(stop!.detail).code).toBe("MODELS_DOWN");
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, id))!.status).toBe("queued");
    // A day of waiting later, it takes the old path (attempts, then one stopped email).
    expect(await outageWait(env as never, task, new ProviderFailure("still down", "down"), Date.now() + 25 * 3600_000)).toBe(false);
  });
});

describe("i. an explicit hold is honoured while work is in flight", () => {
  it("\"stop\" holds the job (nothing runs, no new job), and \"go\" releases it", async () => {
    const first = await handleBossInboundMail(mail({ subject: "#camille venues", body: "Research venues for the launch party.", messageId: "<i-1@mail.gmail.com>" }), env as never);
    const taskId = first.taskId!;
    const held = await handleBossInboundMail(mail({ subject: "Re: #camille venues", body: `Stop, don't send anything yet.${QUOTED}`, messageId: "<i-2@mail.gmail.com>", inReplyTo: "<i-1@mail.gmail.com>" }), env as never);
    expect(held.outcome).toBe("HELD");
    expect((await tasksOf(held.mailId)).length).toBe(0);
    await handleTask(env as never, { taskId, lane: "ops" });
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId))!.status).toBe("queued");
    expect(await row(`SELECT id FROM task_events WHERE task_id = ? AND event = 'skipped_held_by_her'`, taskId)).toBeTruthy();

    const go = await handleBossInboundMail(mail({ subject: "Re: #camille venues", body: "go", messageId: "<i-3@mail.gmail.com>", inReplyTo: "<i-1@mail.gmail.com>" }), env as never);
    expect(go.outcome).toBe("RELEASED");
    expect(JSON.parse((await row<any>(`SELECT input FROM tasks WHERE id = ?`, taskId))!.input).held_by_her).toBeUndefined();
  });
});
