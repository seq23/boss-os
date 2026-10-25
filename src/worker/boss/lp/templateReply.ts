/**
 * ─── HER REPLY TO THE PROSPECT-EMAIL CARD (owner, 25 Oct 2026) ───────────────
 *
 * Her morning email numbers every Decide card and says how to answer it ("Reply '5: your changes'").
 * A reply that names the prospect-email card — by its number in that morning's email, or by the
 * template's id — goes to Monique's template, never to generic intake:
 *
 *   "5: approved"                 approves it (the follow-ups it releases ride with it)
 *   "5: try again" / "5: I don't like this, try again"
 *                                 a structurally different draft (`PROSPECT_VARIANTS`), old one retired
 *   "5: <her changes>"            her words kept on the template; what they say plainly is applied
 *                                 (`applyTemplateNotes`), a general rule ("never …", "always …")
 *                                 becomes a standing template rule; the redraft retires the old one
 *
 * She gets ONE short reply: the new email word for word with Approve / Change / Try again. Nothing
 * goes to a prospect until she taps Approve. Called below the mailbox's sender refusal.
 */
import type { Env } from "../env";
import { audit } from "../lib/audit";
import { approveTemplate, redraftTemplate, followUpsReleased } from "./desk";
import { renderProspect, tapUrl } from "../../../shared/boss/lp/plan.mjs";

/** "5: …", "#5 …", "5. …", "5) …" at the start of her reply. */
export const NUMBERED_REPLY_RE = /^\s*#?(\d{1,2})\s*(?::|\.|\)|-|—|\s)\s*([\s\S]*)$/;
const TEMPLATE_ID_RE = /\b(ptp_[a-z0-9]{6,40})\b/i;

/** The card a numbered reply names, from the newest morning she was sent. */
async function cardOf(env: Env, n: number): Promise<{ key: string; title: string } | null> {
  const r = await env.DB.prepare(`SELECT payload FROM morning_digests ORDER BY day DESC LIMIT 1`).first<{ payload: string }>();
  if (!r) return null;
  try {
    const p = JSON.parse(r.payload);
    const d = (p?.decide ?? [])[n - 1];
    return d?.key ? { key: String(d.key), title: String(d.title ?? "") } : null;
  } catch { return null; }
}

/** Her words that are a rule for every future email, not a one-off edit. */
const GENERAL = /\b(?:never|always|every(?:\s+(?:email|template|time))?|from now on|in future|going forward|don't ever)\b/i;

/** The one reply she gets: the new email word for word and the three links. Plain. */
export function redraftReply(tpl: any, opts: { applied?: string[]; kept?: string[]; released?: { count: number; firstSentOn: string | null }; headline?: string }) {
  const names = JSON.parse(tpl.names_json ?? "[]");
  const t = { subject: tpl.subject, body: tpl.body, follow_up: tpl.follow_up };
  const first = renderProspect(t, { first: "Alex", names });
  const follow = renderProspect(t, { first: "Alex", names, touch: 2 });
  const day = opts.released?.firstSentOn ? new Date(`${opts.released.firstSentOn}T12:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).replace(/^(\w+) (\d+)$/, "$2 $1") : null;
  return [
    opts.headline ?? "Here is the new prospect email, word for word. Nothing goes out until you tap Approve.",
    ...(opts.applied?.length ? [`What I changed: ${opts.applied.join("; ")}.`] : []),
    ...(opts.kept?.length ? [`Kept on record as your note: ${opts.kept.map((k) => `"${k}"`).join("; ")}.`] : []),
    ...(opts.released?.count ? [`Approving this also sends one follow-up to the ${opts.released.count} people who got your first email${day ? ` on ${day}` : ""}.`] : []),
    "",
    `Subject: ${first.subject}`,
    "",
    first.body,
    "",
    "The one follow-up:",
    "",
    follow.body,
    "",
    `Approve: ${tapUrl(tpl.tap_token, "approve")}`,
    `Change: ${tapUrl(tpl.tap_token, "edit")} (or reply with your changes)`,
    `Try again: ${tapUrl(tpl.tap_token, "retry")}`,
  ].join("\n");
}

export async function prospectTemplateFromMail(env: Env, text: string, now = Date.now()): Promise<{ note: string; outcome: string } | null> {
  // Her words only: never the quoted morning email under them.
  const her = String(text ?? "").split(/\n\s*On .{4,200} wrote:\s*\n|\n-{2,}\s*Original Message|\n>/i)[0]!.trim();
  let templateId: string | null = null;
  let words = her;
  const numbered = NUMBERED_REPLY_RE.exec(her);
  if (numbered) {
    const card = await cardOf(env, Number(numbered[1]));
    if (card?.key.startsWith("prospect-template:")) { templateId = card.key.slice("prospect-template:".length); words = numbered[2]!.trim(); }
  }
  if (!templateId) {
    const id = TEMPLATE_ID_RE.exec(her)?.[1];
    if (!id) return null;
    templateId = id.toLowerCase();
    words = her.replace(TEMPLATE_ID_RE, "").replace(/^\s*[:.\-—]\s*/, "").trim();
  }
  const row = await env.DB.prepare(`SELECT * FROM prospect_templates WHERE id = ?`).bind(templateId).first<any>();
  if (!row) return null;
  // A reply to an older draft lands on the one waiting now.
  const live = row.status === "pending" ? row : await env.DB.prepare(`SELECT * FROM prospect_templates WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`).first<any>() ?? row;
  const released = await followUpsReleased(env.DB);

  if (/^(?:approved?|yes|go|ok(?:ay)?)[.!]?$/i.test(words)) {
    if (live.status !== "pending") return { outcome: "TEMPLATE_ANSWERED", note: "That prospect email is already approved; it goes out on the usual schedule." };
    await approveTemplate(env.DB, live.id, now);
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "prospect_template", entityId: live.id, action: "approved", detail: { via: "reply" } });
    return { outcome: "TEMPLATE_ANSWERED", note: `Approved. The prospect email goes out in the next sending window${released.count ? `, with one follow-up to the ${released.count} people who already got your first email` : ""}.` };
  }

  const tryAgain = /\btry again\b|\bstart over\b|\bdifferent (?:one|draft|version)\b|\banother (?:go|draft|version)\b/i.test(words);
  const notes = words.replace(/[,.;\s]*\b(?:try again|start over)\b[.!]?\s*$/i, "").trim();
  if (notes && GENERAL.test(notes)) {
    await env.DB.prepare(`INSERT OR IGNORE INTO prospect_template_rules (key, rule, said, created_at) VALUES (?,?,?,?)`)
      .bind(`her_${now}`, notes.slice(0, 600), notes.slice(0, 600), now).run();
  }
  const r = await redraftTemplate(env.DB, live.id, { notes: notes || (tryAgain ? null : words), tryAgain }, now);
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "prospect_template", entityId: live.id, action: tryAgain ? "try_again" : "changed", detail: { via: "reply", ok: r.ok, applied: r.applied ?? [], kept: r.kept ?? [] } });
  if (!r.ok) {
    return { outcome: "TEMPLATE_ANSWERED", note: `I kept your note, but that change would break one of your rules for this email (${(r.problems ?? []).join("; ")}). The draft waiting for you is unchanged; reply with another wording, or "try again" for a different draft.` };
  }
  return { outcome: "TEMPLATE_ANSWERED", note: redraftReply(r.template, { applied: r.applied, kept: r.kept, released, headline: tryAgain ? "Here is a different draft, word for word. The old one is retired; nothing goes out until you tap Approve." : undefined }) };
}
