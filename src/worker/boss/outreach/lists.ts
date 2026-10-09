/**
 * LISTS FROM PUBLIC SOURCES ONLY. Two steps, a small slice per tick:
 *
 *   1. READ A PUBLIC LISTING. OpenStreetMap, through the public Overpass API, for one business,
 *      segment and metro: the businesses of that kind in that city that publish a website.
 *   2. READ THE BUSINESS'S OWN WEBSITE. Home, /contact, /about. Keep it only if the site says what
 *      the segment requires (a civil-surgeon page must say civil surgeon or I-693), and take the
 *      business address it publishes. Then verify the address: syntax, not free mail, and an MX
 *      record (DNS over HTTPS). Deduped per business; anything suppressed is never added.
 *
 * Never her network, never client data: nothing here reads a mailbox, a contact list or a sheet.
 */
import { newId } from "../lib/id";
import { BUSINESSES, METROS, businessByKey, type Business, type Segment } from "./catalog";
import { isBusinessEmail, isSuppressed, normaliseEmail } from "./suppression";

/** Public Overpass instances, tried in order (the main one refuses some clients with a 406). */
export const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
/** Public instances answer a city-sized query in 10–25 s when busy (measured 9 Oct 2026). */
const OVERPASS_TIMEOUT_MS = 40_000;
/** A slice whose read failed is tried again after this, never parked for the 30-day refresh. */
export const SLICE_RETRY_MS = 2 * 3_600_000;
const UA = "BossOS-Outreach/1.0 (+https://time-2-read.com)";
const PAGE_LIMIT = 400_000;
const TIMEOUT_MS = 10_000;
const CRAWL_PER_TICK = 8;

async function timed(fetchImpl: typeof fetch, url: string, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, headers: { "user-agent": UA, ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}

export function overpassQuery(seg: Segment, bbox: [number, number, number, number]): string {
  const box = `(${bbox.join(",")})`;
  // `website` only: adding `contact:website` doubled the work on servers that were already timing out.
  const parts = seg.osm.map((f) => `nwr${f}["website"]${box};`);
  return `[out:json][timeout:25];(${parts.join("")});out tags 150;`;
}

export interface Listed {
  name: string | null;
  website: string;
  email: string | null;
  sourceUrl: string;
}

export function parseOverpass(json: unknown): Listed[] {
  const out: Listed[] = [];
  const seen = new Set<string>();
  for (const e of ((json as { elements?: any[] })?.elements ?? [])) {
    const t = e?.tags ?? {};
    const site = normaliseWebsite(t.website ?? t["contact:website"] ?? "");
    if (!site || seen.has(site)) continue;
    seen.add(site);
    const email = t.email ?? t["contact:email"] ?? null;
    out.push({
      name: t.name ?? null,
      website: site,
      email: email ? normaliseEmail(String(email).split(/[;,]/)[0] ?? "") : null,
      sourceUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    });
  }
  return out;
}

export function normaliseWebsite(raw: string): string | null {
  let s = String(raw).trim().split(/[;\s]/)[0];
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (/facebook\.com|instagram\.com|linkedin\.com|yelp\.com|google\.com|twitter\.com|x\.com/.test(u.hostname)) return null;
    // One business per host: http and https of the same site are the same business.
    return `https://${u.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** The registrable-ish domain: last two labels (three for co.uk-style). */
export function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length > 2 && (parts[parts.length - 2] ?? "").length <= 3 && (parts[parts.length - 1] ?? "").length === 2) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

/** Emails a page publishes, from mailto links and from the text. */
export function emailsIn(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(normaliseEmail(decodeURIComponent(m[1] ?? "")));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#64;|&commat;/g, "@");
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)) found.add(normaliseEmail(m[0]));
  return [...found];
}

const ROLE_ORDER = ["info", "contact", "hello", "office", "frontdesk", "admin", "appointments", "intake", "partners", "team"];

/**
 * The address to write to: a business address on the site's own domain, role addresses first.
 * An address on another domain is accepted only when it is not free mail and the site lists no
 * address of its own.
 */
export function pickEmail(emails: string[], website: string): string | null {
  const site = baseDomain(new URL(website).hostname);
  const valid = emails.filter(isBusinessEmail);
  const own = valid.filter((e) => baseDomain(e.split("@")[1] ?? "") === site);
  const pool = own.length ? own : valid.filter((e) => !/noreply|no-reply|donotreply|privacy|abuse|webmaster|careers|jobs|billing/i.test(e));
  if (!pool.length) return null;
  pool.sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.split("@")[0] ?? "");
    const rb = ROLE_ORDER.indexOf(b.split("@")[0] ?? "");
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });
  return pool[0] ?? null;
}

/** An MX record exists for the address's domain (Cloudflare DNS over HTTPS). */
export async function hasMx(domain: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await timed(fetchImpl, `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
    headers: { accept: "application/dns-json" },
  });
  if (!res.ok) return false;
  const j = (await res.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
  return j.Status === 0 && (j.Answer ?? []).some((a) => a.type === 15 && !/^0 \.$/.test(a.data.trim()));
}

async function page(fetchImpl: typeof fetch, url: string): Promise<string> {
  try {
    const res = await timed(fetchImpl, url, { redirect: "follow" });
    if (!res.ok || !/html|text/i.test(res.headers.get("content-type") ?? "html")) return "";
    const text = await res.text();
    return text.slice(0, PAGE_LIMIT);
  } catch {
    return "";
  }
}

/** Step 1: read one public listing slice that has not been read in 30 days. */
export async function readNextSlice(db: D1Database, fetchImpl: typeof fetch, now: number, only?: string[]): Promise<{ slice: string; found: number } | null> {
  const done = await db.prepare(`SELECT business_key, segment, metro, fetched_at, found FROM outreach_slices`).all<any>();
  // Fresh = read successfully in the last 30 days, or failed in the last two hours. A failure is
  // never parked for a month: the public servers are busy at times and fine an hour later.
  const fresh = new Set((done.results ?? [])
    .filter((r) => (r.found >= 0 ? now - r.fetched_at < 30 * 86_400_000 : now - r.fetched_at < SLICE_RETRY_MS))
    .map((r) => `${r.business_key}|${r.segment}|${r.metro}`));
  for (const b of BUSINESSES) {
    if (only && !only.includes(b.key)) continue;
    for (const seg of b.segments) {
      for (const metro of METROS) {
        const id = `${b.key}|${seg.key}|${metro.key}`;
        if (fresh.has(id)) continue;
        const listed = await queryOverpass(fetchImpl, overpassQuery(seg, metro.bbox));
        let found = 0;
        for (const l of listed.items) {
          const r = await db.prepare(
            `INSERT INTO outreach_candidates (id, business_key, segment, metro, org_name, website, listed_email, source_url, state, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,'pending',?,?) ON CONFLICT(business_key, website) DO NOTHING`,
          ).bind(newId("ocd"), b.key, seg.key, metro.key, l.name, l.website, l.email, l.sourceUrl, now, now).run();
          found += r.meta?.changes ?? 0;
        }
        await db.prepare(
          `INSERT INTO outreach_slices (business_key, segment, metro, fetched_at, found, detail) VALUES (?,?,?,?,?,?)
           ON CONFLICT(business_key, segment, metro) DO UPDATE SET fetched_at = excluded.fetched_at, found = excluded.found, detail = excluded.detail`,
        ).bind(b.key, seg.key, metro.key, now, listed.ok ? found : -1, listed.detail).run();
        return { slice: id, found };
      }
    }
  }
  return null;
}

async function queryOverpass(fetchImpl: typeof fetch, q: string): Promise<{ ok: boolean; items: Listed[]; detail: string }> {
  const errors: string[] = [];
  for (const url of OVERPASS) {
    try {
      // No `accept: application/json`: overpass-api.de answers that header with a 406.
      const res = await timed(fetchImpl, url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: q }).toString(),
      }, OVERPASS_TIMEOUT_MS);
      if (!res.ok) { errors.push(`${new URL(url).hostname} ${res.status}`); continue; }
      const items = parseOverpass(await res.json());
      return { ok: true, items, detail: `${new URL(url).hostname}: ${items.length} listed with a website` };
    } catch (err) {
      errors.push(`${new URL(url).hostname} ${(err as Error).message}`);
    }
  }
  return { ok: false, items: [], detail: `every Overpass instance failed: ${errors.join("; ")}` };
}

/** Step 2: crawl a few pending candidates, qualify them, and admit verified business addresses. */
export async function crawlCandidates(db: D1Database, fetchImpl: typeof fetch, now: number, limit = CRAWL_PER_TICK): Promise<{ crawled: number; admitted: number }> {
  const rows = await db.prepare(
    `SELECT * FROM outreach_candidates WHERE state = 'pending' ORDER BY created_at LIMIT ?`,
  ).bind(limit).all<any>();
  let admitted = 0;
  for (const c of rows.results ?? []) {
    const b = businessByKey(c.business_key);
    const seg = b?.segments.find((s) => s.key === c.segment);
    const metro = METROS.find((m) => m.key === c.metro);
    if (!b || !seg || !metro) {
      await mark(db, c.id, "failed", "business, segment or metro no longer in the catalog", now);
      continue;
    }
    const outcome = await admitCandidate(db, fetchImpl, b, seg, metro.label, c, now);
    if (outcome === "ok") admitted += 1;
  }
  return { crawled: rows.results?.length ?? 0, admitted };
}

async function mark(db: D1Database, id: string, state: string, detail: string, now: number) {
  await db.prepare(`UPDATE outreach_candidates SET state = ?, detail = ?, updated_at = ? WHERE id = ?`).bind(state, detail, now, id).run();
}

async function admitCandidate(
  db: D1Database, fetchImpl: typeof fetch, b: Business, seg: Segment, metroLabel: string, c: any, now: number,
): Promise<string> {
  const pages = [await page(fetchImpl, c.website)];
  for (const p of ["/contact", "/contact-us", "/about"]) {
    if (pages.join("").length > PAGE_LIMIT) break;
    pages.push(await page(fetchImpl, `${c.website}${p}`));
  }
  const html = pages.join("\n");
  if (!html) { await mark(db, c.id, "failed", "the website did not answer", now); return "failed"; }
  if (!seg.qualify.test(html.replace(/<[^>]+>/g, " "))) {
    await mark(db, c.id, "unqualified", `the website does not say ${seg.qualify.source.slice(0, 60)}`, now);
    return "unqualified";
  }
  const listed = c.listed_email ? [c.listed_email] : [];
  const email = pickEmail([...listed, ...emailsIn(html)], c.website);
  if (!email) { await mark(db, c.id, "no_email", "no business address published on the site", now); return "no_email"; }
  if (await isSuppressed(db, email)) { await mark(db, c.id, "no_email", "the address is on the do-not-contact list", now); return "suppressed"; }
  const domain = email.split("@")[1] ?? "";
  if (!(await hasMx(domain, fetchImpl))) { await mark(db, c.id, "no_email", `${domain} has no MX record`, now); return "no_mx"; }

  await db.prepare(
    `INSERT INTO outreach_prospects
       (id, business_key, email, email_domain, org_name, segment, metro, website, source, source_url,
        mx_verified_at, state, step, next_due_at, unsub_token, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'new',0,?,?,?,?)
     ON CONFLICT(business_key, email) DO NOTHING`,
  ).bind(
    newId("opr"), b.key, email, domain, c.org_name, seg.key, metroLabel, c.website,
    "openstreetmap+website", c.source_url, now, now, randomToken(), now, now,
  ).run();
  await mark(db, c.id, "ok", email, now);
  return "ok";
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
