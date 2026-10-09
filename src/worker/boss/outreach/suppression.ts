/**
 * DO-NOT-CONTACT. Checked before every send, written the moment an unsubscribe, a complaint or a
 * hard bounce arrives. Global across every business: someone who asked one of them to stop has
 * asked all of them.
 */

export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com",
  "mail.com", "zoho.com", "yandex.com", "comcast.net", "att.net", "verizon.net", "sbcglobal.net",
]);

const SYNTAX = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase().replace(/^mailto:/, "").replace(/[?#].*$/, "");
}

export function validSyntax(email: string): boolean {
  if (!SYNTAX.test(email)) return false;
  const [local = "", domain = ""] = email.split("@");
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (domain.includes("..") || domain.startsWith("-") || domain.startsWith(".")) return false;
  // Image names and template junk scraped from HTML: logo@2x.png, user@domain.com
  if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(domain)) return false;
  if (/^(example|domain|email|yourdomain|sentry|wixpress)\./.test(domain)) return false;
  return true;
}

/** Business addresses only: valid syntax and not a free-mail domain. */
export function isBusinessEmail(email: string): boolean {
  return validSyntax(email) && !FREE_MAIL.has(email.split("@")[1] ?? "");
}

export async function isSuppressed(db: D1Database, email: string): Promise<boolean> {
  const e = normaliseEmail(email);
  const domain = e.split("@")[1] ?? "";
  const hit = await db
    .prepare(`SELECT value FROM outreach_suppression WHERE (kind = 'email' AND value = ?) OR (kind = 'domain' AND value = ?) LIMIT 1`)
    .bind(e, domain)
    .first();
  return Boolean(hit);
}

/**
 * Suppress an address, and stop every sequence that would write to it — in every business, in the
 * same batch, so there is no window in which a follow-up can still go.
 */
export async function suppress(
  db: D1Database, email: string, reason: string, source: string, now = Date.now(),
): Promise<void> {
  const e = normaliseEmail(email);
  await db.batch([
    db.prepare(
      `INSERT INTO outreach_suppression (value, kind, reason, source, created_at) VALUES (?, 'email', ?, ?, ?)
       ON CONFLICT(value) DO NOTHING`,
    ).bind(e, reason, source, now),
    db.prepare(
      `UPDATE outreach_prospects SET state = 'suppressed', next_due_at = NULL, updated_at = ?
        WHERE email = ? AND state IN ('new','in_sequence')`,
    ).bind(now, e),
  ]);
}
