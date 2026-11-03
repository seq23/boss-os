/**
 * THE HICKS QUARTERLY WEBSITE UPDATE, THE WORKER HALF (owner, 3 Nov 2026). Camille owns it.
 *
 *   1. THE HOURLY TICK (`runHicksUpdate`, from `runDuties`): on the first Monday of Feb/May/Aug/Nov
 *      from 08:00 Central (`quarterDue`), claim the quarter (one row, UNIQUE client+quarter), read
 *      Search Console and the site repo's merged PRs, compose the draft, park it `pending`. A failure
 *      releases the claim so the next tick tries again; a crashed claim is re-offered after 15 minutes.
 *   2. THE APPROVAL EMAIL (`POST /api/boss/clients/hicks-update/notice`): the errand-reminders tick
 *      (scripts/ops/errand-reminders.mjs) claims the waiting draft's notice and Camille sends it to her.
 *   3. HER TAP (`/tap/hq…`, through routes/lpTap.ts): Approve · Change the words · Skip. A GET never
 *      acts. Approve records the approval, marks the carry-over lines used, records the subject, and
 *      opens her own Gmail with the approved words (`SEND_ROUTE_STOP`: Boss OS has no route that sends
 *      as her personal Gmail, so she presses Send there).
 *
 * NOTHING IN THIS FILE SENDS EMAIL TO THE CLIENT. There is no transport here; the only path to the
 * client is her own Gmail, opened by her Approve. Pinned by tests/hicksUpdate.test.ts.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Vars } from "../env";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { getSetting, setSetting } from "../lib/settings";
import { mintGscToken } from "../health/readers";
import { serviceAccountFrom } from "../wealth/gmailDraft";
import {
  CLIENT, SITE, REPO, NOT_READ, SEND_ROUTE_STOP, RECIPIENT_STOP,
  quarterDue, clickWindows, sumWindows, plainFixes, composeDraft, draftProblems, composeUrl, approvalNotice, aiWindows, researchWins,
  type Clicks, type Fixes, type Recipient, type Research,
} from "../../../shared/boss/clients/hicksUpdate.mjs";

export const ORIGIN = "https://boss.sequoiataylor.com";
export const RECIPIENT_KEY = "hicks_update_recipient";
export const CLAIM_HOLD_MS = 15 * 60 * 1000;
const GSC_SITES = "https://searchconsole.googleapis.com/webmasters/v3/sites";
const GSC_QUERY = (p: string) => `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(p)}/searchAnalytics/query`;
const AI_DAILY = `https://raw.githubusercontent.com/${REPO}/main/data/search-loop/ai-daily.json`;
const GH_PULLS = `https://api.github.com/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100`;

type Row = {
  id: string; client: string; quarter: string; status: string; version: number; subject: string | null; body: string | null;
  verdict: string | null; clicks_now: number | null; clicks_prev: number | null; clicks_last_sent: number | null;
  data_json: string | null; fix_keys: string | null; carry_ids: string | null; tap_token: string | null;
  claimed_at: number | null; created_at: number; emailed_at: number | null; decided_at: number | null; sent_at: number | null;
};

const json = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
export const hicksToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(28));
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return `hq${[...b].map((x) => abc[x % abc.length]).join("").slice(0, 28)}`;
};
export const isHicksToken = (t: string) => /^hq[A-Za-z0-9]{28}$/.test(t);

export async function recipientOf(db: D1Database): Promise<Recipient | null> {
  return json<Recipient | null>(await getSetting(db, RECIPIENT_KEY), null);
}

// ─── The reads (live only; an unreadable source is { ok: false, why }, never 0) ──────────────────

type Gsc = { ok: true; token: string; property: string } | { ok: false; why: string };

/** One Search Console sign-in and the site's property, for every read below. */
export async function gscSession(env: Env, fetchImpl: typeof fetch, now: number): Promise<Gsc> {
  const creds = serviceAccountFrom(env);
  if (!creds) return { ok: false, why: "the Worker holds no Search Console key" };
  const tok = await mintGscToken(creds, fetchImpl, now);
  if (!tok.ok) return { ok: false, why: "Search Console refused a sign-in" };
  const sites = await fetchImpl(GSC_SITES, { headers: { authorization: `Bearer ${tok.token}` } }).catch(() => null);
  if (!sites?.ok) return { ok: false, why: `Search Console answered ${sites?.status ?? "nothing"} for the site list` };
  const have = new Set(((await sites.json().catch(() => ({}))) as any).siteEntry?.map((s: any) => s.siteUrl) ?? []);
  const property = [`sc-domain:${SITE}`, `https://www.${SITE}/`, `https://${SITE}/`].find((p) => have.has(p));
  if (!property) return { ok: false, why: `no Search Console property for ${SITE} is shared with the service account` };
  return { ok: true, token: tok.token, property };
}

async function gscRows(g: Gsc, fetchImpl: typeof fetch, body: Record<string, unknown>): Promise<{ ok: true; rows: any[] } | { ok: false; why: string }> {
  if (!g.ok) return g;
  const q = await fetchImpl(GSC_QUERY(g.property), { method: "POST", headers: { authorization: `Bearer ${g.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!q?.ok) return { ok: false, why: `Search Console answered ${q?.status ?? "nothing"}` };
  return { ok: true, rows: (((await q.json().catch(() => ({}))) as any).rows ?? []) };
}

export async function readClicks(g: Gsc, fetchImpl: typeof fetch, now: number, last: { clicks: number | null; at: number | null }): Promise<Clicks> {
  const w = clickWindows(now);
  const r = await gscRows(g, fetchImpl, { startDate: w.prev.start, endDate: w.now.end, dimensions: ["date"], rowLimit: 500 });
  if (!r.ok) return r;
  const s = sumWindows(r.rows.map((x) => ({ date: x.keys[0], clicks: x.clicks })), w);
  return { ok: true, now: s.now, prev: s.prev, lastSent: last.clicks, lastSentAt: last.at };
}

/** The research reads: searches by position, pages by impressions (both windows), AI signals from the site repo. */
export async function readResearch(g: Gsc, fetchImpl: typeof fetch, now: number): Promise<Research> {
  const w = clickWindows(now);
  const both = async (dim: string, map: (x: any) => any) => {
    const a = await gscRows(g, fetchImpl, { startDate: w.now.start, endDate: w.now.end, dimensions: [dim], rowLimit: 1000 });
    const b = await gscRows(g, fetchImpl, { startDate: w.prev.start, endDate: w.prev.end, dimensions: [dim], rowLimit: 1000 });
    if (!a.ok) return a;
    if (!b.ok) return b;
    return { ok: true as const, now: a.rows.map(map), prev: b.rows.map(map) };
  };
  const queries = await both("query", (x) => ({ query: x.keys[0], position: x.position, impressions: x.impressions }));
  const pages = await both("page", (x) => ({ page: x.keys[0], impressions: x.impressions }));
  const res = await fetchImpl(AI_DAILY, { headers: { "user-agent": "boss-os-hicks-update" } }).catch(() => null);
  const daily = res?.ok ? await res.json().catch(() => null) : null;
  const ai = daily ? { ok: true as const, ...aiWindows(daily, w) } : { ok: false as const, why: `the site's AI measurement file answered ${res?.status ?? "nothing"}` };
  return researchWins({ ai, queries, pages });
}

export async function readMergedPrs(fetchImpl: typeof fetch, since: number | null): Promise<{ ok: true; prs: Array<{ title: string; merged_at: string }> } | { ok: false; why: string }> {
  const res = await fetchImpl(GH_PULLS, { headers: { accept: "application/vnd.github+json", "user-agent": "boss-os-hicks-update" } }).catch(() => null);
  if (!res?.ok) return { ok: false, why: `GitHub answered ${res?.status ?? "nothing"}` };
  const list = (await res.json().catch(() => null)) as any[] | null;
  if (!Array.isArray(list)) return { ok: false, why: "GitHub's answer did not parse" };
  return { ok: true, prs: list.filter((p) => p.merged_at && (!since || Date.parse(p.merged_at) > since)).map((p) => ({ title: String(p.title ?? ""), merged_at: p.merged_at })) };
}

async function lastApproved(db: D1Database): Promise<Row | null> {
  return db.prepare(`SELECT * FROM client_update_drafts WHERE client = ? AND status = 'approved' ORDER BY sent_at DESC LIMIT 1`).bind(CLIENT).first<Row>();
}

// ─── 1. The hourly tick ──────────────────────────────────────────────────────────────────────────

export async function runHicksUpdate(env: Env, now = Date.now(), fetchImpl: typeof fetch = fetch) {
  const due = quarterDue(now);
  if (!due.due) return { ran: false as const, reason: due.reason };
  const db = env.DB;
  const id = `cud_${CLIENT}_${due.quarter.replace("-", "")}`;
  const claim = await db.prepare(`INSERT OR IGNORE INTO client_update_drafts (id, client, quarter, status, claimed_at, created_at) VALUES (?,?,?,'drafting',?,?)`)
    .bind(id, CLIENT, due.quarter, now, now).run();
  if (!claim.meta.changes) {
    const re = await db.prepare(`UPDATE client_update_drafts SET claimed_at = ? WHERE client = ? AND quarter = ? AND status = 'drafting' AND claimed_at < ?`)
      .bind(now, CLIENT, due.quarter, now - CLAIM_HOLD_MS).run();
    if (!re.meta.changes) return { ran: false as const, reason: "claimed_this_quarter" };
  }
  try {
    const last = await lastApproved(db);
    const g = await gscSession(env, fetchImpl, now);
    const clicks = await readClicks(g, fetchImpl, now, { clicks: last?.clicks_now ?? null, at: last?.sent_at ?? null });
    const research = await readResearch(g, fetchImpl, now);
    const pr = await readMergedPrs(fetchImpl, last?.sent_at ?? null);
    const fixes: Fixes = pr.ok ? { ok: true, items: plainFixes(pr.prs, { told: json<string[]>(last?.fix_keys, []) }) } : { ok: false, why: pr.why };
    const carry = (await db.prepare(`SELECT id, line FROM client_update_carryover WHERE client = ? AND used_at IS NULL ORDER BY position, created_at`).bind(CLIENT).all<{ id: string; line: string }>()).results ?? [];
    const past = ((await db.prepare(`SELECT subject FROM client_update_subjects WHERE client = ?`).bind(CLIENT).all<{ subject: string }>()).results ?? []).map((r) => r.subject);
    const recipient = await recipientOf(db);
    const draft = composeDraft({ name: recipient?.name ?? null, clicks, fixes, carryOver: carry, pastSubjects: past, wins: research.wins, now });
    const problems = draftProblems(draft.text, draft.subject);
    if (problems.length) throw new Error(`NAMED STOP [HICKS_UPDATE_DRAFT_REFUSED] ${problems.join("; ")}`);
    await db.prepare(
      `UPDATE client_update_drafts SET status = 'pending', subject = ?, body = ?, verdict = ?, clicks_now = ?, clicks_prev = ?, clicks_last_sent = ?,
         data_json = ?, fix_keys = ?, carry_ids = ?, tap_token = ? WHERE id = ?`,
    ).bind(draft.subject, draft.text, draft.verdict, clicks.ok ? clicks.now : null, clicks.ok ? clicks.prev : null, clicks.ok ? clicks.lastSent : null,
      JSON.stringify({ clicks, fixes, research }), JSON.stringify(draft.fixKeys), JSON.stringify(draft.carryIds), hicksToken(), id).run();
    await audit(db, { actor: "system", lane: "ops", entityType: "client_update_drafts", entityId: id, action: "hicks_update_drafted", detail: { verdict: draft.verdict, clicks: clicks.ok, fixes: fixes.ok } });
    return { ran: true as const, id, verdict: draft.verdict, clicks: clicks.ok ? clicks.now : NOT_READ, fixes: fixes.ok ? fixes.items.length : NOT_READ };
  } catch (err) {
    // Release the claim so the next tick tries again; the reason is logged, never swallowed.
    await db.prepare(`DELETE FROM client_update_drafts WHERE id = ? AND status = 'drafting'`).bind(id).run();
    await logEvent(db, { level: "error", scope: "cron", event: "hicks_update_failed", detail: { message: err instanceof Error ? err.message : String(err) } }).catch(() => {});
    return { ran: false as const, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ─── 2. The approval email's notice (claimed by the errand-reminders tick) ───────────────────────

export function noticeFor(row: Row, recipient: Recipient | null) {
  const data = json<{ clicks: Clicks; fixes: Fixes; research?: Research }>(row.data_json, { clicks: { ok: false, why: NOT_READ }, fixes: { ok: false, why: NOT_READ } });
  const tap = (d: string) => `${ORIGIN}/tap/${row.tap_token}?do=${d}`;
  return approvalNotice({
    draft: { subject: row.subject ?? "", text: row.body ?? "", verdict: (row.verdict as any) ?? "unread", fixKeys: [], carryIds: [] },
    clicks: data.clicks, fixes: data.fixes, recipient, version: row.version, research: data.research ?? null,
    taps: { approve: tap("approve"), change: tap("change"), skip: tap("skip") },
  });
}

export const hicksUpdateRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

hicksUpdateRoutes.post("/notice", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM client_update_drafts WHERE client = ? AND status = 'pending' AND emailed_at IS NULL ORDER BY created_at LIMIT 1`).bind(CLIENT).first<Row>();
  if (!row) return c.json({ ok: true, data: { due: false, reason: "nothing waiting" } });
  return c.json({ ok: true, data: { due: true, id: row.id, version: row.version, notice: noticeFor(row, await recipientOf(c.env.DB)) } });
});

hicksUpdateRoutes.post("/:id/emailed", async (c) => {
  const v = Number(c.req.query("version") ?? 0);
  const r = await c.env.DB.prepare(`UPDATE client_update_drafts SET emailed_at = ? WHERE id = ? AND status = 'pending' AND emailed_at IS NULL AND (? = 0 OR version = ?)`)
    .bind(Date.now(), c.req.param("id"), v, v).run();
  return c.json({ ok: true, data: { recorded: Boolean(r.meta.changes) } });
});

/** The recipient is runtime config, never code: { name, to, gmail_user }. */
hicksUpdateRoutes.put("/recipient", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Recipient;
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!b?.name || !b?.to || !email.test(String(b.to)) || (b.gmail_user && !email.test(String(b.gmail_user)))) {
    return c.json({ ok: false, error: "name and a valid to address are required; gmail_user is optional" }, 400);
  }
  await setSetting(c.env.DB, RECIPIENT_KEY, JSON.stringify({ name: String(b.name).trim(), to: String(b.to).trim(), gmail_user: b.gmail_user ? String(b.gmail_user).trim() : null }));
  return c.json({ ok: true, data: { set: true } });
});

hicksUpdateRoutes.get("/", async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT id, quarter, status, version, subject, verdict, clicks_now, created_at, emailed_at, decided_at FROM client_update_drafts WHERE client = ? ORDER BY created_at DESC LIMIT 8`).bind(CLIENT).all()).results ?? [];
  return c.json({ ok: true, data: { rows, recipient_set: Boolean(await recipientOf(c.env.DB)) } });
});

// ─── 3. Her tap ──────────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
function page(title: string, line: string, extra = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font:17px/1.5 -apple-system,system-ui,sans-serif;background:#faf8f5;color:#222;margin:0;padding:48px 20px;text-align:center}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 24px;color:#555}input,textarea{width:100%;max-width:560px;font:inherit;padding:12px;border-radius:10px;border:1px solid #ccc;box-sizing:border-box;text-align:left}
textarea{min-height:380px}a.b,button{display:inline-block;font:inherit;padding:14px 28px;border-radius:10px;border:0;background:#1f4d3a;color:#fff;margin-top:12px;text-decoration:none}
</style></head><body><h1>${esc(title)}</h1><p>${esc(line)}</p>${extra}</body></html>`;
}
const DONE = () => page("This link has done its job", "Nothing else to do here.");

async function byToken(db: D1Database, token: string) {
  return db.prepare(`SELECT * FROM client_update_drafts WHERE tap_token = ?`).bind(token).first<Row>();
}
function gmailFor(row: Row, r: Recipient | null) {
  return composeUrl({ to: r?.to ?? null, gmailUser: r?.gmail_user ?? null, subject: row.subject ?? "", text: row.body ?? "" });
}

export async function hicksTapGet(c: Context<any>, token: string): Promise<Response> {
  const db = (c.env as Env).DB;
  const row = await byToken(db, token);
  const action = c.req.query("do") ?? "";
  if (!row) return c.html(DONE());
  if (row.status === "approved") {
    return c.html(page("Already approved", "It is ready in Gmail; press Send there if you have not yet.", `<a class="b" href="${esc(gmailFor(row, await recipientOf(db)))}">Open it in Gmail</a>`));
  }
  if (row.status === "skipped") return c.html(page("Already skipped", "Nothing went to Hicks Consulting this quarter."));
  if (row.status !== "pending") return c.html(DONE());
  if (action === "change") {
    return c.html(page("Change the words", "Edit it the way you want it to go. Nothing is sent; the new version comes back to you for approval.",
      `<form method="post" action="?do=change"><input name="subject" value="${esc(row.subject ?? "")}"><br><br><textarea name="body">${esc(row.body ?? "")}</textarea><br><button type="submit">Save my version</button></form>`));
  }
  const verbs: Record<string, string> = { approve: "Approving and opening Gmail…", skip: "Skipping this quarter…" };
  if (!verbs[action]) return c.html(DONE());
  return c.html(page(verbs[action]!, "One moment.", `<form id="f" method="post" action="?do=${action}"><button type="submit">Tap to confirm</button></form><script>document.getElementById("f").submit();</script>`));
}

export async function hicksTapPost(c: Context<any>, token: string): Promise<Response> {
  const env = c.env as Env;
  const db = env.DB;
  const action = c.req.query("do") ?? "";
  const row = await byToken(db, token);
  if (!row) return c.html(DONE());
  if (row.status !== "pending") return hicksTapGet(c, token);
  const now = Date.now();

  if (action === "skip") {
    await db.prepare(`UPDATE client_update_drafts SET status = 'skipped', decided_at = ? WHERE id = ? AND status = 'pending'`).bind(now, row.id).run();
    await audit(db, { actor: "owner", lane: "ops", entityType: "client_update_drafts", entityId: row.id, action: "hicks_update_skipped", detail: { via: "one_tap" } });
    return c.html(page("Skipped", "Nothing goes to Hicks Consulting this quarter. The carried-over line waits for next quarter."));
  }

  if (action === "change") {
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const subject = String((form as any).subject ?? "").trim().slice(0, 200);
    const body = String((form as any).body ?? "").replace(/\r\n/g, "\n").trim().slice(0, 8000);
    if (!subject || !body) return c.html(page("Nothing changed", "The subject or the words were empty, so the waiting version is unchanged."));
    // A new version under a new token: the old email's buttons now say "this link has done its job".
    await db.prepare(`UPDATE client_update_drafts SET subject = ?, body = ?, version = version + 1, tap_token = ?, emailed_at = NULL WHERE id = ? AND status = 'pending'`)
      .bind(subject, body, hicksToken(), row.id).run();
    await audit(db, { actor: "owner", lane: "ops", entityType: "client_update_drafts", entityId: row.id, action: "hicks_update_changed", detail: { via: "one_tap", version: row.version + 1 } });
    return c.html(page("Saved", "Your version comes back to you by email in a few minutes, for one last approval."));
  }

  if (action !== "approve") return c.html(DONE());
  const r = await db.prepare(`UPDATE client_update_drafts SET status = 'approved', decided_at = ?, sent_at = ? WHERE id = ? AND status = 'pending'`).bind(now, now, row.id).run();
  if (!r.meta.changes) return hicksTapGet(c, token);
  for (const cid of json<string[]>(row.carry_ids, [])) {
    await db.prepare(`UPDATE client_update_carryover SET used_at = ?, used_in = ? WHERE id = ? AND used_at IS NULL`).bind(now, row.id, cid).run();
  }
  await db.prepare(`INSERT OR IGNORE INTO client_update_subjects (client, subject, sent_at) VALUES (?,?,?)`).bind(CLIENT, row.subject ?? "", now).run();
  await audit(db, { actor: "owner", lane: "ops", entityType: "client_update_drafts", entityId: row.id, action: "hicks_update_approved", detail: { via: "one_tap", stop: SEND_ROUTE_STOP } });
  const recipient = await recipientOf(db);
  const url = gmailFor(row, recipient);
  // The NAMED STOP, said where she is: Boss OS cannot send from her personal Gmail, so it opens there.
  if (!recipient?.to) return c.html(page("Approved", RECIPIENT_STOP.replace(/^NAMED STOP \[[A-Z_]+\] /, ""), `<a class="b" href="${esc(url)}">Open it in Gmail</a>`));
  return c.redirect(url, 303);
}
