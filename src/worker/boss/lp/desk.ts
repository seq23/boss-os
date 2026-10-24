/**
 * LPs AND PROSPECTS — THE D1 HALF (Boss fix L, 23 Oct 2026; owner rulings 10, 11, 12, 14).
 *
 * The Mac reads the West Peek mailbox through the delegation and posts what it found here; this
 * file keeps the rows, mints the one-tap tokens, and decides — with the outreach brakes — which
 * prospect touches may go today. Sending a held LP reply happens in the Worker the moment she taps
 * (routes/lpTap.ts), from the address the LP wrote to.
 */
import { newId } from "../lib/id";
import { pauseReason, inSendWindow, dailyCap, DAY_MS } from "../outreach/brakes";
import { isSuppressed, suppress } from "../outreach/suppression";
import { readSettings } from "../outreach/engine";
import {
  DEFAULT_PROSPECT_TEMPLATE, MAX_NEW_PER_DAY, MAX_TOUCHES, dueTouch, nextTouchAt, excluded, prospectProblems, renderProspect,
  templateHash, type Template,
} from "../../../shared/boss/lp/plan.mjs";

/** 144 random bits, url-safe. The tap links carry it and nothing else. */
export function tapToken(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ─── Her two lists, owned by Builder D (rules 6 and 15) ──────────────────────
 *
 * Read here, never written. Table and column names are D's; until D's migration (0293) lands they
 * may be absent, and an absent list FAILS CLOSED: no catch-up and no new prospect is suggested or
 * sent on a day the lists cannot be read (`established: false`).
 */
export const EXCLUSION_SOURCES = Object.freeze({
  doNotSuggest: { table: "do_not_suggest", column: "value" },
  rainmaker: { table: "same_firm_list", column: "value" },
});

export async function readExclusions(db: D1Database): Promise<{ doNotSuggest: string[]; rainmaker: string[]; established: boolean; note: string }> {
  try {
    const [d, r] = await db.batch<{ v: string }>([
      db.prepare(`SELECT ${EXCLUSION_SOURCES.doNotSuggest.column} AS v FROM ${EXCLUSION_SOURCES.doNotSuggest.table}`),
      db.prepare(`SELECT ${EXCLUSION_SOURCES.rainmaker.column} AS v FROM ${EXCLUSION_SOURCES.rainmaker.table}`),
    ]);
    const vals = (x: any) => (x.results ?? []).map((row: any) => String(row.v ?? "")).filter(Boolean);
    return { doNotSuggest: vals(d), rainmaker: vals(r), established: true, note: "read" };
  } catch (err) {
    return { doNotSuggest: [], rainmaker: [], established: false, note: `the do-not-suggest and Rainmaker lists could not be read (${String((err as Error).message).slice(0, 80)})` };
  }
}

/* ─── LP replies ─────────────────────────────────────────────────────────── */

export interface LpRowIn {
  address: string; name?: string | null; firm?: string | null; bucket: "call" | "warm"; quote?: string | null;
  reply_from: string; thread_id?: string | null; in_reply_to?: string | null; subject?: string | null;
  draft_id?: string | null; draft_message_id?: string | null; body_hash?: string | null;
  status: string; first_seen: string; drafted_at?: number | null; sent_at?: number | null; last_reply_at?: number | null;
  draft_body?: string | null; said?: string | null; last_reply_text?: string | null;
}

/** A mailbox address as stored: lower case, an address only, or null. */
export const sentFrom = (v: unknown): string | null => {
  const m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(String(v ?? ""));
  return m ? m[0].toLowerCase() : null;
};

const LP_STATUSES = new Set(["drafted", "sent", "scheduled", "skipped", "not_answered", "replied_again"]);

/** Upsert what the morning read found. A decision she already made (skip) is never undone by a read. */
export async function upsertLpRows(db: D1Database, rows: LpRowIn[], now = Date.now()): Promise<number> {
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const address = String(r.address ?? "").toLowerCase().trim();
    if (!address.includes("@") || !LP_STATUSES.has(r.status) || !["call", "warm"].includes(r.bucket)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.first_seen))) continue;
    stmts.push(db.prepare(
      `INSERT INTO lp_reply_drafts (id, address, name, firm, bucket, quote, reply_from, thread_id, in_reply_to, subject,
         draft_id, draft_message_id, body_hash, status, tap_token, first_seen, drafted_at, sent_at, last_reply_at, created_at, updated_at,
         draft_body, said, last_reply_text)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(address) DO UPDATE SET
         name = excluded.name, firm = COALESCE(excluded.firm, lp_reply_drafts.firm), bucket = excluded.bucket,
         quote = excluded.quote, reply_from = excluded.reply_from, thread_id = excluded.thread_id,
         in_reply_to = excluded.in_reply_to, subject = excluded.subject,
         draft_id = COALESCE(excluded.draft_id, lp_reply_drafts.draft_id),
         draft_message_id = COALESCE(excluded.draft_message_id, lp_reply_drafts.draft_message_id),
         body_hash = COALESCE(excluded.body_hash, lp_reply_drafts.body_hash),
         status = CASE WHEN lp_reply_drafts.status = 'skipped' AND excluded.status IN ('drafted','not_answered')
                       THEN 'skipped' ELSE excluded.status END,
         tap_token = COALESCE(lp_reply_drafts.tap_token, excluded.tap_token),
         drafted_at = COALESCE(lp_reply_drafts.drafted_at, excluded.drafted_at),
         sent_at = COALESCE(excluded.sent_at, lp_reply_drafts.sent_at),
         last_reply_at = excluded.last_reply_at, updated_at = excluded.updated_at,
         -- The held draft word for word (0296). NULL when she edited it in Gmail: then the morning email
         -- shows no "Send as is", because it could not show what would be sent.
         draft_body = excluded.draft_body,
         said = COALESCE(excluded.said, lp_reply_drafts.said),
         last_reply_text = COALESCE(excluded.last_reply_text, lp_reply_drafts.last_reply_text)`,
    ).bind(
      newId("lpr"), address, r.name ?? null, r.firm ?? null, r.bucket, r.quote ? String(r.quote).slice(0, 300) : null,
      String(r.reply_from).toLowerCase(), r.thread_id ?? null, r.in_reply_to ?? null, r.subject ?? null,
      r.draft_id ?? null, r.draft_message_id ?? null, r.body_hash ?? null, r.status, tapToken(),
      r.first_seen, r.drafted_at ?? (r.status === "drafted" ? now : null), r.sent_at ?? null, r.last_reply_at ?? null, now, now,
      r.draft_body ? String(r.draft_body).slice(0, 6000) : null, r.said ? String(r.said).slice(0, 1200) : null,
      r.last_reply_text ? String(r.last_reply_text).slice(0, 1200) : null,
    ));
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

export async function listLpRows(db: D1Database): Promise<any[]> {
  const rows = await db.prepare(`SELECT * FROM lp_reply_drafts ORDER BY first_seen ASC`).all<any>();
  return rows.results ?? [];
}

/* ─── Prospects ──────────────────────────────────────────────────────────── */

export interface ProspectIn { email: string; name?: string | null; firm?: string | null; kind?: string; source: string; source_ref?: string | null;
  touches?: number; first_sent_at?: number | null; last_touch_at?: number | null; thread_id?: string | null; last_message_id?: string | null; subject?: string | null; status?: string }

const KINDS = new Set(["family_office", "sovereign_wealth", "fund_of_funds", "pension_endowment_foundation", "secondary_fund", "crossover_growth", "spv_manager", "inbox_buyer", "other"]);

/** Insert-or-ignore: an address already known keeps its history (touches, replies, opt-outs). */
export async function importProspects(db: D1Database, rows: ProspectIn[], now = Date.now()): Promise<{ added: number; skipped: number }> {
  let added = 0, skipped = 0;
  for (const r of rows) {
    const email = String(r.email ?? "").toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) || !r.source) { skipped++; continue; }
    const res = await db.prepare(
      `INSERT OR IGNORE INTO prospects (id, email, name, firm, kind, source, source_ref, status, touches, first_sent_at, last_touch_at,
         thread_id, last_message_id, subject, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      newId("prs"), email, r.name ?? null, r.firm ?? null, KINDS.has(String(r.kind)) ? r.kind : "other", String(r.source).slice(0, 60),
      r.source_ref ? String(r.source_ref).slice(0, 300) : null,
      r.status && ["new", "active", "replied", "bounced", "done"].includes(r.status) ? r.status : (Number(r.touches ?? 0) > 0 ? "active" : "new"),
      Math.min(3, Math.max(0, Number(r.touches ?? 0))), r.first_sent_at ?? null, r.last_touch_at ?? null,
      r.thread_id ?? null, r.last_message_id ?? null, r.subject ?? null, now, now,
    ).run();
    if ((res.meta?.changes ?? 0) > 0) added++; else skipped++;
  }
  return { added, skipped };
}

export async function approvedTemplate(db: D1Database): Promise<any | null> {
  return db.prepare(`SELECT * FROM prospect_templates WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 1`).first<any>();
}
export async function pendingTemplate(db: D1Database): Promise<any | null> {
  return db.prepare(`SELECT * FROM prospect_templates WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`).first<any>();
}

/**
 * Propose a template + featured names for her approval. Refused if the rendered email breaks a tone
 * rule. The same text and names as an approved template is a no-op; anything changed re-asks.
 */
export async function proposeTemplate(db: D1Database, t: Template | null, names: { name: string; why?: string }[], now = Date.now()) {
  const template = t ?? DEFAULT_PROSPECT_TEMPLATE;
  if (names.length < 3 || names.length > 5) return { ok: false as const, problems: [`needs 3 to 5 featured names, got ${names.length}`] };
  const sample = renderProspect(template, { first: "Alex", names });
  const follow = renderProspect(template, { first: "Alex", names, touch: 2 });
  const problems = [...prospectProblems(sample), ...prospectProblems(follow).map((p) => `follow-up ${p}`)];
  if (problems.length) return { ok: false as const, problems };
  const hash = templateHash(template, names);
  const existing = await db.prepare(`SELECT * FROM prospect_templates WHERE hash = ?`).bind(hash).first<any>();
  if (existing) return { ok: true as const, template: existing, created: false };
  const row = { id: newId("ptp"), hash, tap_token: tapToken() };
  await db.batch([
    db.prepare(`UPDATE prospect_templates SET status = 'retired' WHERE status = 'pending'`),
    db.prepare(
      `INSERT INTO prospect_templates (id, hash, subject, body, follow_up, names_json, status, tap_token, created_at)
       VALUES (?,?,?,?,?,?, 'pending', ?, ?)`,
    ).bind(row.id, hash, template.subject, template.body, template.follow_up, JSON.stringify(names), row.tap_token, now),
  ]);
  return { ok: true as const, template: await db.prepare(`SELECT * FROM prospect_templates WHERE id = ?`).bind(row.id).first<any>(), created: true };
}

export async function approveTemplate(db: D1Database, id: string, now = Date.now()) {
  await db.batch([
    db.prepare(`UPDATE prospect_templates SET status = 'retired' WHERE status = 'approved' AND id <> ?`).bind(id),
    db.prepare(`UPDATE prospect_templates SET status = 'approved', approved_at = ? WHERE id = ?`).bind(now, id),
  ]);
}

/** Health over the last 14 days of prospect touches, for the shared bounce brake. */
async function prospectHealth(db: D1Database, now: number) {
  const since = now - 14 * DAY_MS;
  const sent = await db.prepare(`SELECT COUNT(*) AS n FROM prospect_touches WHERE sent_at >= ?`).bind(since).first<{ n: number }>();
  const bounced = await db.prepare(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'bounced' AND updated_at >= ?`).bind(since).first<{ n: number }>();
  return { sent: Number(sent?.n ?? 0), bounced: Number(bounced?.n ?? 0), complaints: 0 };
}

const chicagoDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(ms));

/**
 * Today's sends. Nothing goes without: an approved template, the kill switch off, sending live (else
 * the plan is marked dry-run), the bounce brake clear, the sending window, the lists readable, the
 * address unsuppressed and not on either list. New first emails ≤ min(20, the outreach ramp).
 */
export async function prospectPlan(db: D1Database, now = Date.now()) {
  const stops: string[] = [];
  const tpl = await approvedTemplate(db);
  if (!tpl) stops.push("No prospect email is approved yet. Monique proposes one for your Approve once she has at least three fresh names to feature.");
  const settings = await readSettings(db);
  if (settings.killSwitch) stops.push("The global outreach kill switch is on.");
  const dryRun = settings.sending !== "live";
  const paused = pauseReason(await prospectHealth(db, now));
  if (paused) stops.push(paused);
  if (!inSendWindow(now)) stops.push("Outside the sending window (weekdays 9 to 5 Central).");
  const lists = await readExclusions(db);
  if (!lists.established) stops.push(`Held: ${lists.note}.`);
  if (stops.length) return { sends: [], stops, dryRun, template: tpl ?? null };

  const first = await db.prepare(`SELECT MIN(sent_at) AS t FROM prospect_touches`).first<{ t: number | null }>();
  const cap = Math.min(MAX_NEW_PER_DAY, dailyCap(first?.t ?? null, now));
  const today = chicagoDay(now);
  const recent = await db.prepare(`SELECT sent_at FROM prospect_touches WHERE touch_no = 1 AND sent_at >= ?`).bind(now - 2 * DAY_MS).all<{ sent_at: number }>();
  let newLeft = cap - (recent.results ?? []).filter((r) => chicagoDay(r.sent_at) === today).length;

  const names = JSON.parse(tpl.names_json ?? "[]");
  const template: Template = { subject: tpl.subject, body: tpl.body, follow_up: tpl.follow_up };
  const rows = (await db.prepare(`SELECT * FROM prospects WHERE status IN ('new','active') ORDER BY touches DESC, created_at ASC LIMIT 400`).all<any>()).results ?? [];
  const sends: any[] = [];
  let i = 0;
  for (const p of rows) {
    const touch = dueTouch(p, now);
    if (!touch) continue;
    if (touch === 1 && newLeft <= 0) continue;
    if (await isSuppressed(db, p.email)) continue;
    if (excluded({ email: p.email, name: p.name }, lists)) continue;
    const r = renderProspect(template, { first: (p.name ?? "").split(/\s+/)[0], names, touch, variant: i++ });
    sends.push({
      prospect_id: p.id, email: p.email, name: p.name, touch, template_id: tpl.id,
      subject: touch === 1 ? r.subject : (p.subject ?? r.subject),
      body: r.body, thread_id: touch === 1 ? null : p.thread_id, in_reply_to: touch === 1 ? null : p.last_message_id,
    });
    if (touch === 1) newLeft--;
  }
  return { sends, stops, dryRun, template: tpl };
}

/**
 * PROSPECT OUTREACH, FOR HER (owner, 24 Oct 2026: "keep me abreast of prospect outreach"): every
 * email sent since `since` with its words, the replies, who is next and when, and the totals.
 * Read by Simone's morning email and the Deals → Prospects screen. Names stay in D1.
 */
export async function prospectActivity(db: D1Database, since: number, now = Date.now()) {
  const sent = (await db.prepare(
    `SELECT t.touch_no, t.sent_at, t.subject AS sent_subject, t.body, t.sent_from, p.id AS prospect_id, p.name, p.firm, p.email, p.side, p.kind, p.subject, p.thread_id
       FROM prospect_touches t JOIN prospects p ON p.id = t.prospect_id WHERE t.sent_at >= ? ORDER BY t.sent_at DESC LIMIT 500`,
  ).bind(since).all<any>()).results ?? [];
  const replies = (await db.prepare(
    `SELECT id, name, firm, email, side, status, reply_note, thread_id, touches, updated_at, draft_tap_token IS NOT NULL AS has_draft
       FROM prospects WHERE status IN ('interested','replied','opted_out','bounced') AND updated_at >= ? ORDER BY updated_at DESC LIMIT 200`,
  ).bind(since).all<any>()).results ?? [];
  const active = (await db.prepare(`SELECT id, name, firm, email, side, status, touches, first_sent_at, last_touch_at FROM prospects WHERE status IN ('new','active') LIMIT 1000`).all<any>()).results ?? [];
  const next = active.map((p) => ({ ...p, next_touch: Number(p.touches) + 1, next_at: nextTouchAt(p) }))
    .filter((p) => p.next_touch <= MAX_TOUCHES)
    .sort((a, b) => (a.next_at ?? 0) - (b.next_at ?? 0));
  const counts = (await db.prepare(`SELECT status, COUNT(*) AS n FROM prospects GROUP BY status`).all<{ status: string; n: number }>()).results ?? [];
  const touches = await db.prepare(`SELECT COUNT(*) AS n FROM prospect_touches`).first<{ n: number }>();
  const plan = await prospectPlan(db, now);
  return {
    since, sent, replies, next: next.slice(0, 60), next_total: next.length,
    totals: { ...Object.fromEntries(counts.map((c) => [c.status, c.n])), emails_sent: touches?.n ?? 0 },
    stops: plan.stops, dry_run: plan.dryRun,
    approved: await approvedTemplate(db), pending: await pendingTemplate(db),
  };
}

/**
 * WHAT WAS ACTUALLY SENT, FROM HER SENT MAIL (owner, 24 Oct 2026: "the system KNOWS what has been
 * sent and what each said"). Each touch she sent — by Monique or from Gmail herself — is kept with
 * its words, date and thread, so a follow-up builds on it, nobody gets a second first touch, and a
 * reply lands on the right prospect. `touches` and the dates move only forward.
 */
export async function backfillTouches(db: D1Database, touches: Array<{ email: string; touch_no: number; sent_at: number; subject?: string | null; body?: string | null; gmail_id?: string | null; thread_id?: string | null; sent_from?: string | null }>, now = Date.now()) {
  let n = 0;
  for (const t of touches) {
    const p = await db.prepare(`SELECT * FROM prospects WHERE email = ?`).bind(String(t.email ?? "").toLowerCase()).first<any>();
    const no = Number(t.touch_no);
    if (!p || !(no >= 1 && no <= MAX_TOUCHES) || !(Number(t.sent_at) > 0)) continue;
    await db.batch([
      // sent_from: the mailbox it went from, off the message's own From header; a fresh read wins.
      db.prepare(`INSERT INTO prospect_touches (id, prospect_id, touch_no, gmail_id, template_id, sent_at, subject, body, sent_from) VALUES (?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(prospect_id, touch_no) DO UPDATE SET body = COALESCE(prospect_touches.body, excluded.body),
                    subject = COALESCE(prospect_touches.subject, excluded.subject), gmail_id = COALESCE(prospect_touches.gmail_id, excluded.gmail_id),
                    sent_from = COALESCE(excluded.sent_from, prospect_touches.sent_from)`)
        .bind(newId("ptc"), p.id, no, t.gmail_id ?? null, null, Number(t.sent_at), t.subject ? String(t.subject).slice(0, 300) : null, t.body ? String(t.body).slice(0, 6000) : null, sentFrom(t.sent_from)),
      db.prepare(`UPDATE prospects SET touches = MAX(touches, ?), first_sent_at = MIN(COALESCE(first_sent_at, ?), ?),
                    last_touch_at = MAX(COALESCE(last_touch_at, 0), ?), thread_id = COALESCE(thread_id, ?),
                    status = CASE WHEN status IN ('new','active') AND ? >= 3 THEN 'done' WHEN status = 'new' THEN 'active' ELSE status END
                    WHERE id = ?`)
        // updated_at is left alone: reading her Sent mail is not news, and the morning email reads
        // updated_at as "a reply came in" (24 Oct 2026: an old bounce showed as new).
        .bind(no, Number(t.sent_at), Number(t.sent_at), Number(t.sent_at), t.thread_id ?? null, no, p.id),
    ]);
    n++;
  }
  return n;
}

export interface ProspectEvent {
  prospect_id?: string; email?: string;
  kind: "sent" | "interested" | "replied" | "opt_out" | "bounce" | "ooo";
  touch?: number; gmail_id?: string | null; thread_id?: string | null; message_id?: string | null; subject?: string | null;
  side?: string | null; note?: string | null; draft_id?: string | null; body?: string | null; template_id?: string | null;
}

/** Record sends and replies. Opt-outs and bounces go on the shared suppression list the same moment. */
export async function recordProspectEvents(db: D1Database, events: ProspectEvent[], now = Date.now()) {
  let n = 0;
  for (const e of events) {
    const p = e.prospect_id
      ? await db.prepare(`SELECT * FROM prospects WHERE id = ?`).bind(e.prospect_id).first<any>()
      : await db.prepare(`SELECT * FROM prospects WHERE email = ?`).bind(String(e.email ?? "").toLowerCase()).first<any>();
    if (!p) continue;
    n++;
    if (e.kind === "sent") {
      const touch = Number(e.touch ?? p.touches + 1);
      if (touch !== Number(p.touches) + 1 || touch > 3) continue;
      await db.batch([
        // The words that went, kept (0296): her morning email and the Prospects screen show each send.
        db.prepare(`INSERT OR IGNORE INTO prospect_touches (id, prospect_id, touch_no, gmail_id, template_id, sent_at, subject, body) VALUES (?,?,?,?,?,?,?,?)`)
          .bind(newId("ptc"), p.id, touch, e.gmail_id ?? null, e.template_id ?? null, now, e.subject ? String(e.subject).slice(0, 300) : null, e.body ? String(e.body).slice(0, 6000) : null),
        db.prepare(`UPDATE prospects SET touches = ?, status = CASE WHEN ? >= 3 THEN 'done' ELSE 'active' END,
            first_sent_at = COALESCE(first_sent_at, ?), last_touch_at = ?, thread_id = COALESCE(?, thread_id),
            last_message_id = COALESCE(?, last_message_id), subject = COALESCE(subject, ?), updated_at = ? WHERE id = ?`)
          .bind(touch, touch, now, now, e.thread_id ?? null, e.message_id ?? null, e.subject ?? null, now, p.id),
      ]);
      continue;
    }
    if (e.kind === "ooo") continue; // an autoresponder is not a reply; the sequence carries on
    const status = e.kind === "interested" ? "interested" : e.kind === "opt_out" ? "opted_out" : e.kind === "bounce" ? "bounced" : "replied";
    const side = ["buyer", "seller", "both", "unknown"].includes(String(e.side)) ? e.side : p.side ?? "unknown";
    await db.prepare(`UPDATE prospects SET status = ?, side = ?, reply_note = COALESCE(?, reply_note), draft_id = COALESCE(?, draft_id),
        draft_tap_token = CASE WHEN ? = 'interested' THEN COALESCE(draft_tap_token, ?) ELSE draft_tap_token END, updated_at = ? WHERE id = ?`)
      .bind(status, side, e.note ? String(e.note).slice(0, 240) : null, e.draft_id ?? null, status, tapToken(), now, p.id).run();
    if (e.kind === "opt_out" || e.kind === "bounce") await suppress(db, p.email, e.kind === "opt_out" ? "opted_out" : "bounced", "prospects", now);
  }
  return n;
}

/**
 * Hard bounces read from the West Peek mailbox, and addresses NeverBounce called invalid, go on the
 * shared suppression list (owner, 24 Oct 2026: "2nd emails went out to emails that were already
 * bounced or blocked"). `prospectPlan` checks that list before EVERY touch, so no later email goes.
 * A prospect Boss OS already wrote to is marked bounced; one it never wrote to is only suppressed, so
 * another system's bounce does not trip this sequence's bounce brake.
 */
export async function suppressAddresses(db: D1Database, emails: string[], reason: "bounced" | "invalid", now = Date.now()) {
  let n = 0;
  for (const raw of emails ?? []) {
    const email = String(raw ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) continue;
    const before = await isSuppressed(db, email);
    await suppress(db, email, reason, reason === "invalid" ? "neverbounce" : "wp_mailbox_bounce", now);
    await db.prepare(`UPDATE prospects SET status = 'bounced', updated_at = ? WHERE email = ? AND status IN ('new','active') AND touches > 0`).bind(now, email).run();
    await db.prepare(`UPDATE prospects SET status = 'done', updated_at = ? WHERE email = ? AND status = 'new' AND touches = 0`).bind(now, email).run();
    if (!before) n++;
  }
  return n;
}

/* ─── 8Raise ledger ─────────────────────────────────────────────────────── */

export async function ledgerRows(db: D1Database, month?: string) {
  const rows = month
    ? await db.prepare(`SELECT * FROM eightraise_ledger WHERE month = ? ORDER BY at ASC`).bind(month).all<any>()
    : await db.prepare(`SELECT * FROM eightraise_ledger ORDER BY at DESC LIMIT 200`).all<any>();
  return rows.results ?? [];
}
