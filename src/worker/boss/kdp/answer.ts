/**
 * HER WORD ON A KINDLE PROBLEM — the `[kml_…]` reply.
 *
 * Simone's needs_owner email carries `#simone [kml_<id>]` in its subject and asks for ONE decision
 * with a recommended default ("reply approved"). Her reply lands here by token, exactly as
 * `[rc_…]` reaches Danielle's lane and `[cw_…]` reaches Monique's: the answer is written on the
 * row (`owner_answer`, `answered_at`, `answer_mail_id`) and the next surface run — which reads the
 * open problems before it reads any mail — executes on it. A reply that is not "approved" is her
 * words, verbatim, on the row: a different subtitle, a hold, a question.
 */
import type { Env } from "../env";
import { audit } from "../lib/audit";
import { readReply } from "../../../shared/boss/repoChange/lane.mjs";

export function kdpTokenIn(text: string | null | undefined): string | null {
  const m = /\[(kml_[a-z0-9]+)\]/i.exec(String(text ?? ""));
  return m?.[1] ? m[1].toLowerCase() : null;
}

export async function answerKdpFromMail(
  env: Env, input: { sender: string; subject: string; text: string; mailId: string; now: number },
): Promise<{ id: string; answered: boolean; note: string } | null> {
  const id = kdpTokenIn(`${input.subject}\n${input.text}`);
  if (!id) return null;
  const row = await env.DB
    .prepare(`SELECT id, disposition, needs_owner, owner_ask, owner_answer, resolved_at, title_ref FROM kdp_mail_log WHERE id = ?`)
    .bind(id)
    .first<any>();
  if (!row) return { id, answered: false, note: `Your message names ${id}, and no Kindle item has that id. Nothing was changed.` };
  if (row.resolved_at) return { id, answered: false, note: `${id} was already resolved; your reply is on the record and changes nothing. If something is wrong again, Simone's next run will see Amazon's mail.` };

  const reply = readReply(input.text);
  if (reply.mode === "empty") return { id, answered: false, note: `Your reply to ${id} carried no readable text; nothing was recorded.` };
  const answer = reply.mode === "approved" ? "approved" : reply.mode === "held" ? `held: ${reply.text.slice(0, 1500)}` : reply.text.slice(0, 1500);
  await env.DB
    .prepare(`UPDATE kdp_mail_log SET owner_answer = ?, answered_at = ?, answer_mail_id = ? WHERE id = ?`)
    .bind(answer, input.now, input.mailId, id)
    .run();
  await audit(env.DB, {
    actor: input.sender, lane: "ops", entityType: "kdp_mail_log", entityId: id,
    action: "owner_answered", detail: { mode: reply.mode, mail_id: input.mailId },
  });
  const what = reply.mode === "approved"
    ? `Approved as recommended. Simone executes it on her next run (09:30 daily, or sooner if kicked) and reports Live-or-not from the bookshelf.`
    : reply.mode === "held"
      ? "Held. Simone will not act on it; the problem stays open and is chased with you until you say otherwise."
      : "Your words are on the row. Simone reads them as the decision on her next run and reports what she did.";
  return { id, answered: true, note: `Recorded on ${id}: ${what}` };
}
