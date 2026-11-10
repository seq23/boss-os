/**
 * THE MONTHLY REFRESH COUNT (owner goal, 10 Nov 2026): one line in the first Spry Labs weekly of each
 * month, "Last month: N pages refreshed across M sites". Pure. Each refresh lane keeps a ledger in its
 * own repo; a page counts when its content really changed in that month (risk rule R-ADV-12: the
 * lanes never move a date without a change, so a refreshed page is a changed page).
 *
 * RULE 0: a ledger that could not be read makes the line say so, never a smaller number.
 */
export const REFRESH_LEDGERS = [
  // scripts/automation/refresh_lane.mjs: pages keyed by full URL, `refreshed_at` on a real change.
  { repo: "local-guides-generator", path: "data/cadence/refresh_lane_ledger.json" },
  // scripts/cadence/refresh_lane.mjs: pages keyed by path, `status: "REFRESHED"` and `at`; its guides
  // live on weddingchecklistpdf.com.
  { repo: "dream-wedding-builder", path: "data/cadence/refresh_lane_ledger.json", site: "weddingchecklistpdf.com" },
];

/** The calendar month before `now` on her clock: { from, to, label } as YYYY-MM-DD. */
export function lastMonth(now = Date.now()) {
  const [y, m] = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 2, 1));
  const end = new Date(Date.UTC(y, m - 1, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), label: start.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }) };
}

/** Is `now` in the first seven days of the month on her clock (the first Wednesday's email)? */
export const firstWeekOfMonth = (now = Date.now()) => Number(new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).split("-")[2]) <= 7;

/** Pages refreshed and distinct sites in [from, to], from ledgers read as { ledger } or { problem }. */
export function refreshCount(reads, { from, to }) {
  const pages = new Set(), sites = new Set(), unread = [];
  for (const { src, ledger, problem } of reads) {
    if (problem || !ledger) { unread.push(src.repo); continue; }
    for (const [key, entry] of Object.entries(ledger.pages ?? {})) {
      const day = entry?.refreshed_at ?? (entry?.status === "REFRESHED" ? entry.at : null);
      if (!day || day < from || day > to) continue;
      let site = src.site;
      try { site = new URL(key).hostname; } catch { /* a bare path: the source's site */ }
      pages.add(`${site}${key}`);
      sites.add(site);
    }
  }
  return { pages: pages.size, sites: sites.size, unread };
}

/** The line for the email, or null when it is not the month's first weekly. */
export function refreshLine(reads, { now = Date.now() } = {}) {
  if (!firstWeekOfMonth(now)) return null;
  const month = lastMonth(now);
  const c = refreshCount(reads, month);
  const plural = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const counted = `${month.label}: ${plural(c.pages, "page")} refreshed across ${plural(c.sites, "site")}`;
  return c.unread.length ? `${counted} (not measured for ${c.unread.length === 1 ? "one lane" : `${c.unread.length} lanes`}; the team checks why).` : `${counted}.`;
}
