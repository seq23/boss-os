/**
 * A REPLY WITH NO CODE IN SIGHT STILL LANDS ON ITS JOB (owner, 22 Oct 2026).
 *
 * The plain-email change took `[rc_…]`, `[tsk_…]` and `[dd_…]` out of every subject and body she
 * reads. These tests prove her reply still reaches the right job, by the thread alone:
 *   - a Mac email's code is recorded against the Message-ID Resend gave it (`POST /api/mail-refs`),
 *     and her reply quotes that id in References;
 *   - the Worker's own reply records its code against HER message's Message-ID (`plainReply`).
 * And the negative: the same reply WITHOUT the thread does not touch the job.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, insertTask, row } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { plainReply, refsForChain } from "../../src/worker/boss/intake/mailRefs";
import { plainProblems } from "../../src/shared/boss/mail/plain.mjs";
import { claimSimone, finishSimoneHandoff } from "../../src/worker/boss/agents/simone";
import { fileDraft } from "../../src/worker/boss/duties/mailLane";

const FOLDER = "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv";
const DEVICE = "mac-thread-test";

function mail(opts: { to?: string; subject: string; body: string; messageId?: string; references?: string }) {
  const from = "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({
    from, subject: opts.subject,
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": opts.messageId ?? `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
    ...(opts.references ? { references: opts.references, "in-reply-to": opts.references.split(" ").pop()! } : {}),
  });
  const raw = `From: ${from}\r\nSubject: ${opts.subject}\r\n\r\n${opts.body}`;
  return { from: "seq.taylor@gmail.com", to: opts.to ?? "boss@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: raw.length };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM boss_mail_refs");
  await env.DB.exec("DELETE FROM repo_changes");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});

describe("Danielle's plan: her one-word reply finds the change by its thread", () => {
  async function planned() {
    const body = `Update WPP-llm from ${FOLDER}. New hero.`;
    const res = await handleBossInboundMail(mail({ subject: "#danielle refresh", body }), env);
    expect(res.outcome).toBe("SIMONE_QUEUED");
    const call = await claimSimone(env);
    expect(call?.id).toBe(res.taskId);
    expect(await finishSimoneHandoff(env, { ...call!, assignments: [{ employee: "emp_repo", words: body, delivery: "repository" }] }))
      .toEqual({ replied: true, refused: false });
    const rc = await row<any>(`SELECT c.id FROM repo_changes c JOIN tasks t ON c.task_id = t.id
      WHERE json_extract(t.input, '$.simone_handoff') = ?`, res.taskId);
    await apiJson(`/api/repo-changes/${rc.id}/claim`, { method: "POST", body: { device_id: DEVICE } });
    await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], publish_ready: true, ask_message_id: "re_thread_1" } });
    return rc.id as string;
  }

  it("the Mac records the plan email's Message-ID; \"approved\" with that id in References moves it to build", async () => {
    const id = await planned();
    const rec = await apiJson("/api/mail-refs", { method: "POST", body: { message_id: "<0100plan@email.amazonses.com>", refs: [id], subject: "Plan for WPP-llm: reply approved to start", sender: "danielle@sequoiataylor.com", context: "Here is my plan." } });
    expect(rec.status).toBe(200);
    const reply = await handleBossInboundMail(mail({ to: "danielle@sequoiataylor.com", subject: "Re: Plan for WPP-llm: reply approved to start", body: "approved", references: "<0100plan@email.amazonses.com>" }) as never, env as never);
    expect(reply.outcome).toBe("PLAN_ANSWERED");
    expect((await row<any>(`SELECT phase FROM repo_changes WHERE id = ?`, id)).phase).toBe("build");
  });

  it("NEGATIVE: the same reply with no thread does not touch the change", async () => {
    const id = await planned();
    await apiJson("/api/mail-refs", { method: "POST", body: { message_id: "<0100plan@email.amazonses.com>", refs: [id] } });
    const reply = await handleBossInboundMail(mail({ to: "danielle@sequoiataylor.com", subject: "Re: Plan for WPP-llm: reply approved to start", body: "approved" }) as never, env as never);
    expect(reply.outcome).not.toBe("PLAN_ANSWERED");
    expect((await row<any>(`SELECT phase FROM repo_changes WHERE id = ?`, id)).phase).toBe("asking");
  });

  it("the record refuses a body with no job code", async () => {
    const bad = await apiJson("/api/mail-refs", { method: "POST", body: { message_id: "<x@y>", refs: ["not-a-code"] } });
    expect(bad.status).toBe(400);
  });
});

describe("a stopped task: \"try again\" on the notice's thread runs it again", () => {
  it("the notice's code is read from References and the task is queued; without the thread nothing moves", async () => {
    const taskId = await insertTask({ status: "failed", title: "Make the cover", input: JSON.stringify({ from: "seq.taylor@gmail.com" }) });
    await apiJson("/api/mail-refs", { method: "POST", body: { message_id: "<0100notice@email.amazonses.com>", refs: [taskId] } });

    const lost = await handleBossInboundMail(mail({ to: "simone@sequoiataylor.com", subject: "Re: Stopped: Make the cover", body: "try again" }) as never, env as never);
    expect(lost.outcome).not.toBe("BLOCK_ANSWERED");
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("failed");

    const res = await handleBossInboundMail(mail({ to: "simone@sequoiataylor.com", subject: "Re: Stopped: Make the cover", body: "try again", references: "<0100notice@email.amazonses.com>" }) as never, env as never);
    expect(res.outcome).toBe("BLOCK_ANSWERED");
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    // And what she reads back has no code in it, while the code is kept against her message.
    const laid = await plainReply(env.DB, { text: res.reply!, subject: "Re: Stopped: Make the cover", signer: res.signer, messageId: res.messageId, from: "boss@sequoiataylor.com" });
    expect(plainProblems(laid)).toEqual([]);
    expect(laid.text).not.toContain(taskId);
    expect((await refsForChain(env.DB, [res.messageId!])).refs).toEqual([taskId]);
  });
});

describe("the Worker's own reply: the code moves from the text to her thread", () => {
  it("a kept duty draft's reply is plain, and its code is recorded against her request's Message-ID", async () => {
    const messageId = `<req-${Math.random().toString(36).slice(2)}@mail.gmail.com>`;
    const draft = await fileDraft(env, {
      employeeId: "emp_research", phrase: "every friday, write me a short report on what changed in the private markets this week",
      door: "mail", messageId, signer: { id: "emp_research", name: "Camille" }, sender: "owner@example.test", now: Date.now(),
    });
    expect(draft.state).toBe("drafted");
    const laid = await plainReply(env.DB, { text: draft.letter, subject: "Re: #camille new duty", signer: "Camille", messageId, from: "boss@sequoiataylor.com" });
    expect(plainProblems(laid)).toEqual([]);
    expect(laid.text).not.toMatch(/dd_/);
    expect(laid.text.trim().endsWith("— Camille")).toBe(true);
    expect(await row(`SELECT request_message_id FROM duty_drafts WHERE id = ?`, draft.draftId)).toEqual({ request_message_id: messageId });
    expect((await refsForChain(env.DB, [messageId])).refs).toEqual([draft.draftId]);
  });

  it("a reply to a Boss OS email carries that email's text to the employee, so \"move the KDP item to Monday\" has its list", async () => {
    await apiJson("/api/mail-refs", { method: "POST", body: { message_id: "<0100day@email.amazonses.com>", refs: ["yd_20261023"], context: "Yours today\n- KDP: approve the Gift Letter subtitle" } });
    const res = await handleBossInboundMail(mail({ to: "simone@sequoiataylor.com", subject: "Re: Your day: 2 things for you", body: "move the KDP item to Monday", references: "<0100day@email.amazonses.com>" }) as never, env as never);
    expect(res.taskId).toBeTruthy();
    const t = await row<any>(`SELECT employee_id, input FROM tasks WHERE id = ?`, res.taskId);
    expect(t.employee_id).toBe("emp_chief");
    expect(JSON.parse(t.input).body).toMatch(/move the KDP item to Monday[\s\S]*She is replying to this email from Boss OS:\nYours today\n- KDP: approve the Gift Letter subtitle/);
  });
});
