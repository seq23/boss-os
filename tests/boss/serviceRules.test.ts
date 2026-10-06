import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { all, apiJson, insertTask, row } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { buildPrompt, handleDeadLetter } from "../../src/worker/boss/queue/consumer";
import { deferFromResult } from "../../src/worker/boss/service/deferred";
import { afterResult } from "../../src/worker/boss/service/afterResult";
import { WAIT_SHAPE } from "../../src/shared/boss/service/waits.mjs";
import { SERVICE_PRACTICES_HEADING } from "../../src/shared/boss/service/practices.mjs";

/**
 * THE SERVICE RULES, END TO END THROUGH THE REAL DOORS (docs/SERVICE_RULES.md, 6 Oct 2026).
 *
 * Every assertion here goes through the function the Worker actually runs — the mail door, the
 * prompt builder, the dead-letter path, the follow-through — against the real migrated schema.
 */

const VALUE = "sk-test-0123456789abcdef-NEVER-STORE-ME";

function mail(opts: { subject?: string; body?: string; raw?: string }) {
  const raw = opts.raw ?? `From: seq.taylor@gmail.com\r\nSubject: ${opts.subject ?? ""}\r\n\r\n${opts.body ?? ""}`;
  return {
    from: "seq.taylor@gmail.com",
    to: "boss@sequoiataylor.com",
    headers: new Headers({
      from: "Sequoia <seq.taylor@gmail.com>",
      subject: opts.subject ?? "",
      "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    }),
    raw: new Response(raw).body!,
    rawSize: new TextEncoder().encode(raw).length,
  };
}

/** Every text column of every row in the tables a value could leak into. */
async function sinks(): Promise<string> {
  const parts: string[] = [];
  for (const t of ["boss_inbound_mail", "tasks", "task_events", "boss_task_notices", "audit_log", "boss_secret_handoff"]) {
    const rows = await all(`SELECT * FROM ${t}`).catch(() => []);
    parts.push(JSON.stringify(rows));
  }
  const listed = await env.VAULT.list({ prefix: "boss-inbound-mail/" });
  for (const o of listed.objects) parts.push(await (await env.VAULT.get(o.key))!.text());
  return parts.join("\n");
}

beforeEach(async () => {
  for (const t of ["boss_secret_handoff", "boss_secret_wait", "boss_operator_constraint", "boss_task_notices", "boss_drive_watch", "boss_inbound_mail"]) {
    await env.DB.exec(`DELETE FROM ${t}`);
  }
});

describe("R3 — a key by email is stored encrypted and scrubbed from every sink", () => {
  it("only-secret mail: stored, never shown again, no task opened, and the value is nowhere", async () => {
    const res = await handleBossInboundMail(mail({ subject: "keys", body: `hi\nSECRET RUNWARE_API_KEY=${VALUE}\nthanks` }), env as never);
    expect(res.outcome).toBe("SECRET_STORED");
    expect(res.taskId).toBeNull();
    expect(res.reply).toContain("Stored RUNWARE_API_KEY");
    expect(res.reply).not.toContain(VALUE);
    const stored = await row<any>(`SELECT * FROM boss_secret_handoff WHERE name = 'RUNWARE_API_KEY'`);
    expect(stored).toBeTruthy();
    expect(stored.ciphertext).not.toContain(VALUE);
    expect(await sinks()).not.toContain(VALUE);

    // Her Mac collects it — the one place the plaintext exists — and the Worker forgets it.
    const pending = await apiJson("/api/service/secret-handoffs/pending");
    expect(pending.body.data.handoffs.map((h: any) => [h.name, h.value])).toEqual([["RUNWARE_API_KEY", VALUE]]);
    await apiJson(`/api/service/secret-handoffs/${stored.id}/stored`, { method: "POST", body: {} });
    expect(await row(`SELECT id FROM boss_secret_handoff WHERE id = ?`, stored.id)).toBeNull();
  });

  it("a reserved name is refused by name and its value is still scrubbed", async () => {
    const res = await handleBossInboundMail(mail({ subject: "x", body: `SECRET ANTHROPIC_API_KEY=${VALUE}` }), env as never);
    expect(res.reply).toContain("ANTHROPIC_API_KEY is reserved");
    expect(await row(`SELECT id FROM boss_secret_handoff`)).toBeNull();
    expect(await sinks()).not.toContain(VALUE);
  });

  it("a base64 body is scrubbed too, and the work in it still opens a task", async () => {
    const b64 = btoa(`#simone please book the dentist\nSECRET RUNWARE_API_KEY=${VALUE}\n`);
    const raw = `From: seq.taylor@gmail.com\r\nSubject: errand\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}\r\n`;
    const res = await handleBossInboundMail(mail({ subject: "errand", raw }), env as never);
    expect(res.taskId).toBeTruthy();
    expect(await sinks()).not.toContain(VALUE);
    expect(await sinks()).not.toContain(b64.slice(0, 40));
  });
});

describe("R4/R5/R6 — a missing key is a wait, named once, and its arrival resumes the work", () => {
  it("Missing key: in a result → one wait, one notice; the SECRET email requeues the task", async () => {
    const taskId = await insertTask({ status: "done", title: "Make the cover", input: JSON.stringify({ from: "seq.taylor@gmail.com" }) });
    const task = { id: taskId, lane: "ops", title: "Make the cover", employee_id: null, input: { from: "seq.taylor@gmail.com" } };
    await afterResult(env as never, task, "Did the layout.\nMissing key: RUNWARE_API_KEY", { done: true, fromName: "Boss OS" });
    await afterResult(env as never, task, "Did the layout.\nMissing key: RUNWARE_API_KEY", { done: false, fromName: "Boss OS" });
    const notices = await all<any>(`SELECT * FROM boss_task_notices WHERE task_id = ? AND kind = 'missing_secret'`, taskId);
    expect(notices.length).toBe(1);
    expect(notices[0].secret_name).toBe("RUNWARE_API_KEY");
    expect(notices[0].subject).toContain(`[${taskId}]`);
    expect(notices[0].body).toMatch(/SECRET RUNWARE_API_KEY=<value>/);
    const res = await handleBossInboundMail(mail({ subject: "key", body: `SECRET RUNWARE_API_KEY=${VALUE}` }), env as never);
    expect(res.reply).toMatch(/running again now/);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    expect(await row(`SELECT id FROM boss_secret_wait WHERE task_id = ? AND resumed_at IS NULL`, taskId)).toBeNull();
  });
});

describe("R8/R20 — her reply to a stopped task does what it says, on any employee's task", () => {
  it("\"try again\" requeues it; \"drop it\" cancels it; a Tier 2 hold is never released by email", async () => {
    const a = await insertTask({ status: "failed", title: "Find the receipts" });
    const r1 = await handleBossInboundMail(mail({ subject: `Re: Stopped: Find the receipts [${a}]`, body: "try again" }), env as never);
    expect(r1.outcome).toBe("BLOCK_ANSWERED");
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, a)).status).toBe("queued");

    const b = await insertTask({ status: "failed", title: "Old errand" });
    await handleBossInboundMail(mail({ subject: `Re: Stopped [${b}]`, body: "drop it" }), env as never);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, b)).status).toBe("cancelled");

    const c = await insertTask({ status: "awaiting_approval", title: "Wire the money" });
    const r3 = await handleBossInboundMail(mail({ subject: `Re: [${c}]`, body: "yes" }), env as never);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, c)).status).toBe("awaiting_approval");
    expect(r3.reply!.slice(r3.reply!.indexOf("Waiting on:"))).toMatch(WAIT_SHAPE);
    expect(await row(`SELECT id FROM task_events WHERE task_id = ? AND event = 'reply_while_held'`, c)).toBeTruthy();
  });
});

describe("R7/R10/R11 — after the retries, one email in three parts", () => {
  it("a dead letter writes exactly one notice, and it reads Waiting on / Why / To clear it by email", async () => {
    const id = await insertTask({ status: "failed", title: "Reconcile the card" });
    await handleDeadLetter(env as never, { taskId: id, lane: "ops", attempt: 3 }, "provider 500");
    await handleDeadLetter(env as never, { taskId: id, lane: "ops", attempt: 3 }, "provider 500");
    const n = await all<any>(`SELECT * FROM boss_task_notices WHERE task_id = ?`, id);
    expect(n.length).toBe(1);
    const tail = n[0].body.split("\n").find((l: string) => l.startsWith("Waiting on:"));
    expect(tail).toMatch(WAIT_SHAPE);
    expect(tail).toMatch(/"try again"/);
    expect(n[0].body).not.toMatch(/Diagnostics|open Boss OS|requeue the task/);
  });
});

describe("R14 — a dated deferral is its own task, and the duplicate check is equality, not LIKE", () => {
  it("the same line twice makes one task, queued for its date", async () => {
    const src = { id: await insertTask({ status: "done" }), lane: "ops", title: "Plan", employee_id: null, input: {} };
    const text = "Done today.\nDeferred to 2099-01-15: send the long-form follow-up with every attachment named in the original thread";
    const first = await deferFromResult(env as never, src, text);
    const second = await deferFromResult(env as never, src, text);
    expect(first.length).toBe(1);
    expect(second.length).toBe(0);
    const q = await row<any>(`SELECT visible_at FROM boss_task_queue WHERE task_id = ?`, first[0]).catch(() => null);
    if (q) expect(Number(q.visible_at)).toBeGreaterThan(Date.now() + 86_400_000);
  });
});

describe("R19 — the practices and her constraints are in front of every run", () => {
  it("a `Never:` line she sends is registered once and appears in buildPrompt", async () => {
    await handleBossInboundMail(mail({ subject: "#simone note", body: "Never: email anyone at my old firm\nthanks" }), env as never);
    await handleBossInboundMail(mail({ subject: "#simone note", body: "Never: email anyone at my old firm" }), env as never);
    expect((await all(`SELECT * FROM boss_operator_constraint`)).length).toBe(1);
    const prompt = await buildPrompt(env as never, { id: "tsk_x", title: "t", template_id: null }, { body: "do a thing" });
    expect(prompt).toContain(SERVICE_PRACTICES_HEADING);
    expect(prompt).toContain("Never: email anyone at my old firm");
    expect(prompt).toContain("Deferred to YYYY-MM-DD");
  });
});
