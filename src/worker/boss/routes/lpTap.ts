/**
 * THE ONE-TAP BUTTONS IN HER MORNING EMAIL (Boss fix L, 23 Oct 2026; owner rulings 2, 10, 11).
 *
 *   Send as is · Edit, then send · Skip      — a held LP reply (or an interested prospect's reply)
 *   Approve · Edit                           — the prospect email, before its first send
 *
 * PUBLIC BY NECESSITY, SAFE BY CONSTRUCTION. She taps from her phone, often not signed in, so the
 * link is its own authority: a 144-bit random token stored on the one row it acts on (the same shape
 * as the unsubscribe link). An unknown token gets the same calm page and does nothing.
 *
 * A GET NEVER ACTS. Mail scanners fetch links. The GET renders a page that POSTs itself (one tap
 * for her; a scanner that does not run script changes nothing), with a button for no-script phones.
 *
 * SENDING IS ONLY HERE, AND ONLY ON HER TAP. The draft already sits in the LP's own thread in the
 * mailbox the LP wrote to; "Send as is" sends that draft (gmail.compose covers drafts.send — the
 * delegation grants compose, not send/modify; probed 23 Oct 2026).
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { audit } from "../lib/audit";
import { mintComposeToken, serviceAccountFrom } from "../wealth/gmailDraft";
import { approveTemplate } from "../lp/desk";

export const lpTap = new Hono<{ Bindings: Env; Variables: Vars }>();

const WEST_PEEK = /@westpeek\.ventures$/i;
// Boss OS has one address and keeps the tab in memory; the Deals page Prospects tab is one tap from it.
const DECK = "https://boss.sequoiataylor.com/";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
function page(title: string, line: string, form?: { action: string; label: string }) {
  const auto = form
    ? `<form id="f" method="post" action="${esc(form.action)}"><button type="submit">${esc(form.label)}</button></form>
       <script>document.getElementById("f").submit();</script>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font:17px/1.5 -apple-system,system-ui,sans-serif;background:#faf8f5;color:#222;margin:0;padding:48px 20px;text-align:center}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 24px;color:#555}
button{font:inherit;padding:14px 28px;border-radius:10px;border:0;background:#1f4d3a;color:#fff}
</style></head><body><h1>${esc(title)}</h1><p>${esc(line)}</p>${auto}</body></html>`;
}

type Found =
  | { kind: "lp"; row: any }
  | { kind: "prospect_reply"; row: any }
  | { kind: "template"; row: any };

async function find(db: D1Database, token: string): Promise<Found | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const lp = await db.prepare(`SELECT * FROM lp_reply_drafts WHERE tap_token = ?`).bind(token).first<any>();
  if (lp) return { kind: "lp", row: lp };
  const pr = await db.prepare(`SELECT * FROM prospects WHERE draft_tap_token = ?`).bind(token).first<any>();
  if (pr) return { kind: "prospect_reply", row: pr };
  const t = await db.prepare(`SELECT * FROM prospect_templates WHERE tap_token = ?`).bind(token).first<any>();
  if (t) return { kind: "template", row: t };
  return null;
}

const VERBS: Record<string, string> = { send: "Sending your reply…", skip: "Skipping…", approve: "Approving…" };

lpTap.get("/:token", async (c) => {
  const action = c.req.query("do") ?? "";
  const f = await find(c.env.DB, c.req.param("token"));
  if (!f) return c.html(page("This link has done its job", "Nothing else to do here."), 200);
  if (f.kind === "template" && action === "edit") {
    return c.redirect(DECK, 302);
  }
  if (!VERBS[action]) return c.html(page("This link has done its job", "Nothing else to do here."), 200);
  return c.html(page(VERBS[action]!, "One moment.", { action: `?do=${action}`, label: "Tap to confirm" }));
});

/** Send a held Gmail draft from the mailbox it sits in. */
async function sendDraft(env: Env, mailbox: string, draftId: string): Promise<{ ok: boolean; why?: string; messageId?: string }> {
  if (!WEST_PEEK.test(mailbox)) return { ok: false, why: "that reply does not sit in a West Peek mailbox" };
  const creds = serviceAccountFrom(env);
  if (!creds) return { ok: false, why: "the Google key is not on the Worker" };
  const tok = await mintComposeToken(creds, mailbox, fetch);
  if (!tok.ok) return { ok: false, why: `Google refused the sign-in (${tok.status})` };
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts/send", {
    method: "POST",
    headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json" },
    body: JSON.stringify({ id: draftId }),
  });
  if (!res.ok) return { ok: false, why: res.status === 404 ? "the draft is no longer in Gmail (sent or deleted by hand)" : `Gmail refused it (${res.status})` };
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, messageId: j.id };
}

lpTap.post("/:token", async (c) => {
  const action = c.req.query("do") ?? "";
  const db = c.env.DB;
  const f = await find(db, c.req.param("token"));
  const now = Date.now();
  if (!f) return c.html(page("This link has done its job", "Nothing else to do here."));

  if (f.kind === "template") {
    if (action !== "approve") return c.redirect(DECK, 302);
    if (f.row.status === "approved") return c.html(page("Already approved", "It goes out on the usual schedule."));
    if (f.row.status !== "pending") return c.html(page("A newer version is waiting", "Approve the newest one in this morning's email."));
    await approveTemplate(db, f.row.id, now);
    await audit(db, { actor: "owner", lane: "ops", entityType: "prospect_template", entityId: f.row.id, action: "approved", detail: { via: "one_tap" } });
    return c.html(page("Approved", "Monique sends it on the usual schedule: up to 20 new people a day, two gentle follow-ups, then stop."));
  }

  const row = f.row;
  const table = f.kind === "lp" ? "lp_reply_drafts" : "prospects";
  const done = f.kind === "lp" ? ["sent", "skipped", "replied_again"].includes(row.status) : ["replied", "opted_out", "bounced", "done"].includes(row.status) && !row.draft_id;
  if (done) return c.html(page(row.status === "skipped" ? "Already skipped" : "Already sent", "Nothing else to do here."));

  if (action === "skip") {
    if (f.kind === "lp") {
      await db.prepare(`UPDATE lp_reply_drafts SET status = 'skipped', decision = 'skip', decided_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, row.id).run();
    } else {
      await db.prepare(`UPDATE prospects SET draft_id = NULL, draft_tap_token = NULL, updated_at = ? WHERE id = ?`).bind(now, row.id).run();
    }
    await audit(db, { actor: "owner", lane: "ops", entityType: table, entityId: row.id, action: "skipped", detail: { via: "one_tap" } });
    return c.html(page("Skipped", "No reply goes. It stays on the tracker as Skipped."));
  }

  if (action !== "send") return c.html(page("This link has done its job", "Nothing else to do here."));
  if (!row.draft_id) return c.html(page("The reply is not ready yet", "Monique will have it in tomorrow's email."));
  const mailbox = f.kind === "lp" ? row.reply_from : "sequoia@westpeek.ventures";
  const r = await sendDraft(c.env, mailbox, row.draft_id);
  if (!r.ok) {
    if (f.kind === "lp") {
      await db.prepare(`UPDATE lp_reply_drafts SET decision = 'send', decided_at = ?, send_error = ?, updated_at = ? WHERE id = ?`).bind(now, r.why ?? null, now, row.id).run();
    }
    await audit(db, { actor: "owner", lane: "ops", entityType: table, entityId: row.id, action: "send_failed", detail: { why: r.why } });
    return c.html(page("Not sent yet", `${r.why}. Monique tries again in the morning; you can also open the draft in Gmail and press Send.`));
  }
  if (f.kind === "lp") {
    await db.prepare(`UPDATE lp_reply_drafts SET status = 'sent', decision = 'send', decided_at = ?, sent_at = ?, send_error = NULL, updated_at = ? WHERE id = ?`).bind(now, now, now, row.id).run();
  } else {
    await db.prepare(`UPDATE prospects SET draft_id = NULL, draft_tap_token = NULL, updated_at = ? WHERE id = ?`).bind(now, row.id).run();
  }
  await audit(db, { actor: "owner", lane: "ops", entityType: table, entityId: row.id, action: "sent", detail: { via: "one_tap" } });
  return c.html(page("Sent", "Your reply went in their thread."));
});
