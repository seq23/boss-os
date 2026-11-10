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
  { repo: "local-guides-generator", path: "data/cadence/refresh_lane_ledger.json", label: "local guides" },
  // scripts/cadence/refresh_lane.mjs: pages keyed by path, `status: "REFRESHED"` and `at`; its guides
  // live on weddingchecklistpdf.com.
  { repo: "dream-wedding-builder", path: "data/cadence/refresh_lane_ledger.json", site: "weddingchecklistpdf.com", label: "Dream Wedding" },
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

/** What one lane did in [from, to], read from its ledger's runs. Pure. */
export function laneState(read, { from, to }) {
  if (read.problem || !read.ledger) return { state: "unread" };
  const runs = (read.ledger.runs ?? []).filter((r) => r.at >= from && r.at <= to);
  if (!runs.length) return { state: "no_runs" };
  const changed = runs.some((r) => (r.refreshed ?? 0) > 0);
  // A run that had pages due (local guides: due > 0; Dream Wedding: anything but QUEUE_EMPTY) and changed none.
  const stalled = runs.some((r) => (r.refreshed ?? 0) === 0 && (r.due != null ? r.due > 0 : r.outcome !== "QUEUE_EMPTY"));
  if (changed) return { state: "refreshed" };
  if (stalled) return { state: "stalled" };
  return { state: "nothing_due", next_due: read.ledger.next_due ?? runs.at(-1)?.next_due ?? null };
}

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

const dayWords = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const plural = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;

/**
 * The line for the email, or null when it is not the month's first weekly. A count is never bare:
 * a lane that changed nothing says why (nothing was due, and when the next is; pages were due and
 * nothing changed; it did not run; it could not be read).
 */
export function refreshLine(reads, { now = Date.now() } = {}) {
  if (!firstWeekOfMonth(now)) return null;
  const month = lastMonth(now);
  const c = refreshCount(reads, month);
  const states = reads.map((r) => ({ ...laneState(r, month), name: r.src.label ?? r.src.repo }));
  // Name which refresh, never "one lane", and promise no check nobody is shown doing (owner read, 10 Nov 2026).
  const names = (s) => states.filter((x) => x.state === s).map((x) => x.name);
  const and = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const refreshes = (xs) => `the ${and(xs)} refresh${xs.length > 1 ? "es" : ""}`;
  const why = [];
  if (c.pages === 0 && states.every((x) => x.state === "nothing_due")) {
    const next = states.map((x) => x.next_due).filter(Boolean).sort()[0];
    why.push(next && next > month.to ? `nothing was due; the next pages come due ${dayWords(next)}` : "nothing was due");
  }
  if (names("stalled").length) why.push(`${refreshes(names("stalled"))} had pages due and changed none this month`);
  if (names("no_runs").length) why.push(`${refreshes(names("no_runs"))} did not run this month`);
  if (names("unread").length) why.push(`${refreshes(names("unread"))} could not be read this month`);
  const counted = `${month.label}: ${plural(c.pages, "page")} refreshed across ${plural(c.sites, "site")}`;
  return why.length ? `${counted} (${why.join("; ")}).` : `${counted}.`;
}
