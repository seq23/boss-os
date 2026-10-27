import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound } from "../lib/http";
import { audit } from "../lib/audit";
import { extractAddress } from "../../../shared/boss/intake/mail.mjs";
import { readableText } from "../../../shared/boss/intake/messageBody.mjs";

export interface SentMail {
  message_id: string; from: string; to: string; subject: string; text: string;
  html?: string; raw?: string; delivery_state?: "pending" | "sent" | "failed"; provider_id?: string; employee_id?: string | null; command_id?: string | null;
  in_reply_to?: string | null; thread_id?: string | null; sent_at?: number;
}

/** Persist the exact accepted payload. A replay records the same send once. */
export async function recordSentMail(env: Env, mail: SentMail): Promise<void> {
  const id = mail.provider_id ?? mail.message_id;
  const key = `boss-sent-mail/${encodeURIComponent(id)}.json`;
  const parent = mail.in_reply_to ? await env.DB.prepare(`SELECT thread_id, command_id FROM boss_inbound_mail WHERE message_id = ? UNION ALL SELECT thread_id, command_id FROM boss_sent_mail WHERE message_id = ? LIMIT 1`).bind(mail.in_reply_to, mail.in_reply_to).first<{ thread_id: string; command_id: string | null }>() : null;
  const commandId = mail.command_id ?? parent?.command_id ?? null;
  const command = commandId ? await env.DB.prepare(`SELECT id FROM boss_commands WHERE id = ?`).bind(commandId).first<{ id: string }>() : null;
  const employee = !mail.employee_id ? await env.DB.prepare(`SELECT id FROM employees WHERE lower(name) = ? LIMIT 1`).bind((extractAddress(mail.from) ?? "").split("@")[0]).first<{ id: string }>() : null;
  await env.VAULT.put(key, JSON.stringify({ text: mail.text, html: mail.html ?? null, raw: mail.raw ?? null }), { httpMetadata: { contentType: "application/json" } });
  await env.DB.prepare(`INSERT INTO boss_sent_mail (id, message_id, sent_at, delivery_state, from_addr, to_addr, employee_id, subject, object_key, thread_id, in_reply_to, command_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO NOTHING`).bind(
    id, mail.message_id, mail.sent_at ?? Date.now(), mail.delivery_state ?? "sent", extractAddress(mail.from), mail.to, mail.employee_id ?? employee?.id ?? null, mail.subject, key,
    command?.id ?? parent?.thread_id ?? mail.thread_id ?? mail.in_reply_to ?? id, mail.in_reply_to ?? null, command?.id ?? null,
  ).run();
}

/** Save the body before a Worker sends. A failed receipt update never causes a duplicate send. */
export async function stageSentMail(env: Env, mail: Omit<SentMail, "message_id">) {
  const pendingId = `pending:${crypto.randomUUID()}`;
  await recordSentMail(env, { ...mail, message_id: pendingId, delivery_state: "pending" });
  return {
    async accepted(messageId: string) {
      await env.DB.prepare(`UPDATE boss_sent_mail SET message_id = ?, delivery_state = 'sent', thread_id = CASE WHEN thread_id = ? THEN ? ELSE thread_id END WHERE id = ?`).bind(messageId, pendingId, mail.thread_id ?? messageId, pendingId).run().catch((e) => console.error("Sent email receipt is pending; its full copy is kept", e));
    },
    async failed() { await env.DB.prepare(`UPDATE boss_sent_mail SET delivery_state = 'failed' WHERE id = ?`).bind(pendingId).run(); },
  };
}

export async function replyWithHistory(message: { reply: (mail: { from: string; subject: string; text: string; html?: string }) => Promise<unknown> }, env: Env, mail: SentMail) {
  const receipt = await stageSentMail(env, mail);
  try { await message.reply({ from: mail.from, subject: mail.subject, text: mail.text, html: mail.html }); }
  catch (e) { await receipt.failed(); throw e; }
  await receipt.accepted(mail.message_id);
}

type MailRow = { id: string; message_id: string | null; direction: string; at: number; from_addr: string; to_addr: string; employee_id: string | null; subject: string; object_key: string | null; thread_id: string | null; command_id: string | null; outcome: string | null };
export async function mailHistory(env: Env, filter: { employee?: string; counterpart?: string; command?: string; thread?: string } = {}) {
  // Filters apply before the cap, so an employee or counterpart cannot disappear behind other mail.
  const where: string[] = []; const args: string[] = [];
  if (filter.employee) { where.push("employee_id = ?"); args.push(filter.employee); }
  if (filter.counterpart) { where.push("(lower(from_addr) = ? OR instr(',' || replace(lower(to_addr), ' ', '') || ',', ',' || ? || ',') > 0)"); args.push(filter.counterpart.toLowerCase(), filter.counterpart.toLowerCase()); }
  if (filter.command) { where.push("(command_id = ? OR id = (SELECT mail_id FROM boss_commands WHERE id = ?))"); args.push(filter.command, filter.command); }
  if (filter.thread) { where.push("thread_id = ?"); args.push(filter.thread); }
  const union = `SELECT id, message_id, 'received' AS direction, received_at AS at, from_addr, to_addr, employee_id, subject, object_key, COALESCE(thread_id, message_id, id) AS thread_id, command_id, outcome FROM boss_inbound_mail
    UNION ALL SELECT id, message_id, 'sent' AS direction, sent_at AS at, from_addr, to_addr, employee_id, subject, object_key, thread_id, command_id, NULL AS outcome FROM boss_sent_mail WHERE delivery_state = 'sent'`;
  const query = `WITH mail AS (${union}), chosen AS (SELECT thread_id, MAX(at) AS newest FROM mail ${where.length ? `WHERE ${where.join(" AND ")}` : ""} GROUP BY thread_id ORDER BY newest DESC LIMIT 25)
    SELECT mail.* FROM mail JOIN chosen ON chosen.thread_id = mail.thread_id ORDER BY mail.at DESC`;
  const rows = (await env.DB.prepare(query).bind(...args).all<MailRow>()).results ?? [];
  const threads = new Map<string, { id: string; at: number; messages: (MailRow & { body: string | null; original_url: string | null })[] }>();
  // R2 is the full copy, including MIME and quoted history; command JSON is only the operational read.
  const messages = await Promise.all(rows.map(async (r) => {
    let body: string | null = null;
    if (r.object_key) {
      const object = await env.VAULT.get(r.object_key);
      if (object) {
        const raw = await object.text();
        body = r.direction === "sent" ? (JSON.parse(raw).text || readableText(JSON.parse(raw).raw ?? "", { full: true }).text) : readableText(raw, { full: true }).text;
      }
    }
    return { ...r, body, original_url: r.object_key ? `/api/boss/mail/${encodeURIComponent(r.id)}/original` : null };
  }));
  for (const m of messages) {
    const id = m.thread_id ?? m.id;
    if (!threads.has(id)) threads.set(id, { id, at: m.at, messages: [] });
    threads.get(id)!.messages.unshift(m);
  }
  return { threads: [...threads.values()].sort((a, b) => b.at - a.at), received: messages.filter((m) => m.direction === "received"), sent: messages.filter((m) => m.direction === "sent") };
}

export const mail = new Hono<{ Bindings: Env; Variables: Vars }>();
mail.get("/", async (c) => ok(c, await mailHistory(c.env, { employee: c.req.query("employee"), counterpart: c.req.query("counterpart"), command: c.req.query("command"), thread: c.req.query("thread") })));
mail.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT COALESCE(thread_id, message_id, id) AS thread_id FROM boss_inbound_mail WHERE id = ? UNION ALL SELECT thread_id FROM boss_sent_mail WHERE id = ? LIMIT 1`).bind(id, id).first<{ thread_id: string }>();
  if (!row) throw notFound("This email could not be found.");
  return ok(c, await mailHistory(c.env, { thread: row.thread_id }));
});
mail.post("/sent", async (c) => {
  const b = await c.req.json<SentMail>();
  if (!b.message_id || !b.from || !b.to || !b.subject || !(typeof b.text === "string")) throw badRequest("The sent email needs its address, subject, words and message identifier.");
  await recordSentMail(c.env, b);
  return ok(c, { recorded: true });
});
mail.get("/:id/original", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT object_key FROM boss_inbound_mail WHERE id = ? UNION ALL SELECT object_key FROM boss_sent_mail WHERE id = ? LIMIT 1`).bind(id, id).first<{ object_key: string | null }>();
  const object = row?.object_key ? await c.env.VAULT.get(row.object_key) : null;
  if (!object) throw notFound("The original email is unavailable.");
  // Never render untrusted email HTML as a page in the authenticated origin.
  return new Response(object.body, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": 'attachment; filename="original-email.txt"', "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
mail.post("/:id/admit", async (c) => {
  const r = await c.env.DB.prepare(`SELECT from_addr, outcome FROM boss_inbound_mail WHERE id = ?`).bind(c.req.param("id")).first<{ from_addr: string; outcome: string }>();
  if (!r || r.outcome !== "REFUSED_SENDER") throw badRequest("This email is not waiting for you to let its sender in.");
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO boss_mail_senders (address, admitted_at) VALUES (?,?) ON CONFLICT(address) DO NOTHING`).bind(r.from_addr, Date.now()),
    c.env.DB.prepare(`UPDATE boss_inbound_mail SET outcome = 'ADMITTED_MAIL', why = 'Owner let this sender in for reading; no work or reply authorised.' WHERE id = ?`).bind(c.req.param("id")),
  ]);
  await audit(c.env.DB, { actor: "owner", lane: "ops", entityType: "inbound_mail", entityId: c.req.param("id"), action: "sender_admitted" });
  return ok(c, { recorded: true, line: "Sender let in. You can read their emails here. Nothing was sent." });
});
