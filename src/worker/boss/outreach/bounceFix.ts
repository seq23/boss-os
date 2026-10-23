/**
 * THE BOUNCE AGENT (owner, 23 Oct 2026, rule 4 of the email fix).
 *
 * Her inbox on 22–23 Oct carried the same bounce line three times and a "Needs a look" beside
 * "Nothing needed". Her ruling: an agent removes the bad address the same day, finds a working
 * replacement at the same organisation, checks it, and restarts outreach on its own once the bounce
 * rate is under 3%. She sees one "done" line in Simone's morning email. $0 only: no paid verifier
 * (NeverBounce is paid; agents never spend money or create accounts).
 *
 * THE STEPS, all inside Monique's hourly outreach tick (engine.ts runOutreachTick):
 *   1. SAME DAY: the bounce is suppressed for good the moment it is read (processReplies →
 *      `suppress`), and `recordBounce` queues a replacement search here.
 *   2. A REPLACEMENT AT THE SAME ORGANISATION, from two sources only — never a guessed pattern
 *      (first.last@, info@ invented from the domain):
 *        a. someone at that organisation who has WRITTEN TO US (an outreach reply from the same
 *           domain that was not a bounce, a complaint or an unsubscribe) — a proven inbox;
 *        b. an address the organisation PUBLISHES on its own website (home, /contact, /about),
 *           on the site's own domain, role mailboxes first (`pickEmail`, the same rule list-building
 *           uses).
 *   3. CHECKED: business address syntax, not on the do-not-contact list, an MX record for its domain
 *      (DNS over HTTPS), and its source recorded (`source`, `source_url`).
 *   4. The replacement joins the list as a new prospect; the bounced one never returns.
 *   5. RESTART: a bounce pause lifts itself once the 14-day bounce rate is back under 3% (the brake in
 *      brakes.ts `pauseReason`, applied in engine.ts) — and `recordRestart` notes it for her line.
 *
 * `bounceSummary` is what GET /api/boss/outreach/bounce-fixes returns and the morning email turns into
 * one sentence (scripts/ops/your-day.mjs `bounceLine`).
 */
import { newId } from "../lib/id";
import { BUSINESSES } from "./catalog";
import { baseDomain, emailsIn, hasMx, pickEmail, randomToken } from "./lists";
import { isBusinessEmail, isSuppressed, normaliseEmail } from "./suppression";

const PAGES = ["", "/contact", "/contact-us", "/about", "/about-us", "/team"];
const PAGE_LIMIT = 400_000;
const TIMEOUT_MS = 10_000;
export const FIXES_PER_TICK = 6;
const DAY_MS = 86_400_000;

/** Reply classes that prove a person at that address reads mail and did not ask us to stop. */
const PROVEN = new Set(["interested", "not_now", "wrong_person", "auto_reply"]);

export interface Replier { email: string; classification: string; gmail_message_id: string }
export interface Choice { email: string; source: "replied" | "website"; source_url: string }

/**
 * The replacement, or null. Pure: the caller fetched the pages and the repliers. Never the bounced
 * address, never a suppressed one, never an address the organisation did not itself use or publish.
 */
export function chooseReplacement(input: {
  bounced: string;
  website: string | null;
  pages: Array<{ url: string; html: string }>;
  repliers: Replier[];
  suppressed: Set<string>;
  preferRoles?: readonly string[];
}): Choice | null {
  const bounced = normaliseEmail(input.bounced);
  const domain = bounced.split("@")[1] ?? "";
  const site = input.website ? safeBase(input.website) : null;
  const sameOrg = (e: string) => {
    const d = e.split("@")[1] ?? "";
    return baseDomain(d) === baseDomain(domain) || (site !== null && baseDomain(d) === site);
  };
  const usable = (e: string) => e !== bounced && isBusinessEmail(e) && !input.suppressed.has(e) && sameOrg(e);

  for (const r of input.repliers) {
    const e = normaliseEmail(r.email);
    if (PROVEN.has(r.classification) && usable(e)) return { email: e, source: "replied", source_url: `gmail:message/${r.gmail_message_id}` };
  }
  if (!input.website) return null;
  for (const p of input.pages) {
    const found = emailsIn(p.html).filter(usable);
    const pick = found.length ? pickEmail(found, input.website, null, input.preferRoles ?? []) : null;
    if (pick && usable(pick)) return { email: pick, source: "website", source_url: p.url };
  }
  return null;
}

function safeBase(website: string): string | null {
  try { return baseDomain(new URL(website).hostname); } catch { return null; }
}

async function fetchPage(fetchImpl: typeof fetch, url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "BossOS-Outreach/1.0 (+https://time-2-read.com)" } });
    if (!res.ok || !/html|text/i.test(res.headers.get("content-type") ?? "html")) return "";
    return (await res.text()).slice(0, PAGE_LIMIT);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

/** Step 1: queue the search, once per bounced address. */
export async function recordBounce(db: D1Database, prospect: { id?: string; business_key?: string } | null, failed: string, now: number): Promise<void> {
  const e = normaliseEmail(failed);
  await db.prepare(
    `INSERT INTO outreach_bounce_fixes (id, kind, business_key, prospect_id, bounced_email, bounced_domain, state, created_at)
     VALUES (?, 'replace', ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(kind, bounced_email) DO NOTHING`,
  ).bind(newId("obf"), prospect?.business_key ?? "unknown", prospect?.id ?? null, e, e.split("@")[1] ?? "", now).run();
}

/** Step 5: a bounce pause lifted itself; noted once per business per day for her line. */
export async function recordRestart(db: D1Database, businessKey: string, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO outreach_bounce_fixes (id, kind, business_key, bounced_email, state, detail, created_at, done_at)
     VALUES (?, 'restart', ?, ?, 'restarted', 'the 14-day bounce rate is back under 3%', ?, ?)
     ON CONFLICT(kind, bounced_email) DO NOTHING`,
  ).bind(newId("obf"), businessKey, `${businessKey}:${new Date(now).toISOString().slice(0, 10)}`, now, now).run();
}

/** Steps 2–4 for the queued bounces, a few per tick. Returns how many were replaced and dropped. */
export async function fixBounces(db: D1Database, fetchImpl: typeof fetch, now: number, limit = FIXES_PER_TICK): Promise<{ replaced: number; dropped: number }> {
  const rows = await db.prepare(
    `SELECT f.*, p.website, p.org_name, p.segment, p.metro, p.business_key AS p_business
       FROM outreach_bounce_fixes f LEFT JOIN outreach_prospects p ON p.id = f.prospect_id
      WHERE f.kind = 'replace' AND f.state = 'pending' ORDER BY f.created_at LIMIT ?`,
  ).bind(limit).all<any>();
  let replaced = 0;
  let dropped = 0;
  for (const row of rows.results ?? []) {
    const domain = String(row.bounced_domain ?? "");
    const repliers = await db.prepare(
      `SELECT from_email AS email, classification, gmail_message_id FROM outreach_replies
        WHERE from_email LIKE ? ORDER BY received_at DESC LIMIT 10`,
    ).bind(`%@${domain}`).all<Replier>();
    const pages: Array<{ url: string; html: string }> = [];
    if (row.website) {
      for (const p of PAGES) {
        const url = `${String(row.website).replace(/\/$/, "")}${p}`;
        const html = await fetchPage(fetchImpl, url);
        if (html) pages.push({ url, html });
      }
    }
    // The do-not-contact list, for every address the pages and replies name.
    const named = new Set<string>([
      ...(repliers.results ?? []).map((r) => normaliseEmail(r.email)),
      ...pages.flatMap((p) => emailsIn(p.html)),
    ]);
    const suppressed = new Set<string>();
    for (const e of named) if (await isSuppressed(db, e)) suppressed.add(e);
    const choice = chooseReplacement({ bounced: row.bounced_email, website: row.website ?? null, pages, repliers: repliers.results ?? [], suppressed });
    const mx = choice ? await hasMx(choice.email.split("@")[1] ?? "", fetchImpl).catch(() => false) : false;

    if (choice && mx && row.p_business) {
      await db.batch([
        db.prepare(
          `INSERT INTO outreach_prospects
             (id, business_key, email, email_domain, org_name, segment, metro, website, source, source_url,
              mx_verified_at, state, step, next_due_at, unsub_token, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'new',0,?,?,?,?)
           ON CONFLICT(business_key, email) DO NOTHING`,
        ).bind(newId("opr"), row.p_business, choice.email, choice.email.split("@")[1] ?? "", row.org_name ?? null, row.segment ?? "unknown",
          row.metro ?? null, row.website ?? null, `bounce-replacement:${choice.source}`, choice.source_url, now, now, randomToken(), now, now),
        db.prepare(`UPDATE outreach_bounce_fixes SET state = 'replaced', replacement_email = ?, source = ?, source_url = ?, done_at = ? WHERE id = ?`)
          .bind(choice.email, choice.source, choice.source_url, now, row.id),
      ]);
      replaced += 1;
    } else {
      const why = !row.p_business ? "the bounced address was not one of our prospects"
        : !choice ? "no other address at that organisation has written to us or is published on its own site"
          : "the replacement's domain has no MX record";
      await db.prepare(`UPDATE outreach_bounce_fixes SET state = 'dropped', detail = ?, done_at = ? WHERE id = ?`).bind(why, now, row.id).run();
      dropped += 1;
    }
  }
  return { replaced, dropped };
}

/** The last day of the agent's work, for her one line: `{ replaced, dropped, restarted: [brand] }`. */
export async function bounceSummary(db: D1Database, now: number, windowMs = DAY_MS): Promise<{ replaced: number; dropped: number; restarted: string[]; pending: number }> {
  const since = now - windowMs;
  const counts = await db.prepare(
    `SELECT SUM(CASE WHEN state = 'replaced' AND done_at >= ? THEN 1 ELSE 0 END) AS replaced,
            SUM(CASE WHEN state = 'dropped' AND done_at >= ? AND prospect_id IS NOT NULL THEN 1 ELSE 0 END) AS dropped,
            SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM outreach_bounce_fixes WHERE kind = 'replace'`,
  ).bind(since, since).first<{ replaced: number | null; dropped: number | null; pending: number | null }>();
  const restarts = await db.prepare(`SELECT DISTINCT business_key FROM outreach_bounce_fixes WHERE kind = 'restart' AND created_at >= ?`).bind(since).all<{ business_key: string }>();
  const brand = (k: string) => BUSINESSES.find((b) => b.key === k)?.brand ?? k;
  return {
    replaced: counts?.replaced ?? 0,
    dropped: counts?.dropped ?? 0,
    pending: counts?.pending ?? 0,
    restarted: [...new Set((restarts.results ?? []).map((r) => brand(r.business_key)))],
  };
}
