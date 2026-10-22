/**
 * THE JOB A REPLY ANSWERS, READ FROM ITS THREAD AND NOT FROM ITS SUBJECT (owner, 22 Oct 2026).
 *
 * Every Boss OS email used to carry its job code in the subject — `#danielle … [rc_m5jh89zfkeyv3tmm]`
 * — so a reply could name the job. She called those emails confusing and full of jargon, and the
 * codes left (src/shared/boss/mail/plain.mjs). The code now lives against the Message-ID of the
 * email that carried it, in `boss_mail_refs`:
 *
 *   - the Mac records it after each send (`postEmployeeMail` reads the Message-ID back from Resend);
 *   - the Worker records it when its own reply named a job, keyed on HER message's Message-ID, which
 *     her next reply in that thread quotes in `References`.
 *
 * `refsForChain` turns the ids in her reply's References / In-Reply-To into those codes, and the
 * inbound handler hands them to the lanes as a bracketed tail on the subject they read — the exact
 * shape every lane's token reader already accepts, so no lane changed.
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { refsIn, fromLegacy } from "../../../shared/boss/mail/plain.mjs";
import type { LaidOutEmail } from "../../../shared/boss/mail/plain.mjs";

const MAX_CHAIN = 20;

export async function recordMailRefs(
  db: D1Database,
  input: { messageId: string; refs: string[]; subject?: string | null; sender?: string | null; context?: string | null; now?: number },
): Promise<boolean> {
  const id = String(input.messageId ?? "").trim().slice(0, 400);
  const refs = refsIn(input.refs.join(" "));
  if (!id || refs.length === 0) return false;
  await db.prepare(
    `INSERT INTO boss_mail_refs (message_id, refs, subject, sender, context, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(message_id) DO UPDATE SET refs = excluded.refs, subject = excluded.subject, sender = excluded.sender, context = excluded.context`,
  ).bind(id, refs.join(" "), input.subject?.slice(0, 300) ?? null, input.sender?.slice(0, 200) ?? null, input.context?.slice(0, 6000) ?? null, input.now ?? Date.now()).run();
  return true;
}

/** The ids in a References / In-Reply-To pair, angle brackets kept, newest last. */
export function chainIds(references: string | null | undefined, inReplyTo: string | null | undefined): string[] {
  return (`${references ?? ""} ${inReplyTo ?? ""}`.match(/<[^>]+>/g) ?? []).slice(-MAX_CHAIN);
}

/** Every job code the thread carries, newest email first, and the text of the newest one that had any. */
export async function refsForChain(db: D1Database, ids: string[]): Promise<{ refs: string[]; context: string | null }> {
  if (ids.length === 0) return { refs: [], context: null };
  const marks = ids.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT message_id, refs, context, created_at FROM boss_mail_refs WHERE message_id IN (${marks}) ORDER BY created_at DESC`)
    .bind(...ids).all<{ message_id: string; refs: string; context: string | null }>().catch(() => ({ results: [] as Array<{ message_id: string; refs: string; context: string | null }> }));
  const refs: string[] = [];
  for (const r of rows.results ?? []) for (const ref of String(r.refs).split(/\s+/)) if (ref && !refs.includes(ref)) refs.push(ref);
  return { refs, context: rows.results?.[0]?.context ?? null };
}

/** The bracketed tail the lanes read: " [rc_x] [tsk_y]". Never shown to her; only lanes read it. */
export function refTail(refs: string[]): string {
  return refs.length ? ` ${refs.map((r) => `[${r}]`).join(" ")}` : "";
}

export const mailRefs = new Hono<{ Bindings: Env; Variables: Vars }>();

/** The Mac records the Message-ID of a send that carried job codes. */
mailRefs.post("/", async (c) => {
  const b = await c.req.json<{ message_id?: string; refs?: string[]; subject?: string; sender?: string; context?: string }>().catch(() => null);
  if (!b?.message_id || !Array.isArray(b.refs) || b.refs.length === 0) throw badRequest("message_id and refs are both required");
  const saved = await recordMailRefs(c.env.DB, { messageId: b.message_id, refs: b.refs, subject: b.subject, sender: b.sender, context: b.context });
  if (!saved) throw badRequest("no job code in refs");
  return ok(c, { recorded: true });
});

/**
 * THE WORKER'S REPLY TO HER, IN THE ONE LAYOUT, WITH ITS CODES MOVED TO THE THREAD.
 *
 * `message.reply()` in src/worker/index.ts sends exactly what this returns. The job codes the reply
 * named are recorded against HER message's Message-ID; her next reply in the thread quotes it in
 * References, so "approved" lands on the draft it answers with no code in sight.
 */
export async function plainReply(
  db: D1Database,
  input: { text: string; subject: string; signer?: string | null; messageId?: string | null; from: string },
): Promise<LaidOutEmail> {
  const laid = fromLegacy({ who: input.signer ?? "Simone", subject: input.subject, text: input.text });
  if (laid.refs.length && input.messageId) {
    await recordMailRefs(db, { messageId: input.messageId, refs: laid.refs, subject: input.subject, sender: input.from, context: laid.text })
      .catch((e) => console.error("reply refs not recorded", e));
  }
  return laid;
}
