/**
 * THE SPRY LABS WEEKLY, WORDED (owner, 1 Nov 2026). Pure: summaries in, one calm email's sections
 * out. scripts/ops/spry-weekly.mjs fetches; this decides what she reads. Make-it-calm rules: one
 * short section per business, plain words, the good news in one line, at most three things to look
 * at, no codes and no jargon. Client properties and parked sites are never named (Boss OS rule).
 *
 * RULE 0: every source gets a section. A summary that did not arrive, arrived stale, or could not be
 * read says so in one plain line; it is never left out.
 */
import { GRID } from "../grid.mjs";

/** Client property domains (grid.mjs `owner: "client"`), never named in her email. */
const CLIENT_DOMAINS = GRID.filter((p) => p.owner === "client").flatMap((p) => p.domains ?? []);
import { SPRY_WEEKLY_SOURCES } from "./sources.mjs";

export const SPRY_WEEKLY = SPRY_WEEKLY_SOURCES;
const MAX_LOOKS = 3;
/** A business's own lines: ApprovalPrep and Dream Wedding each send four (sales, search, Pinterest, pages). */
export const MAX_NOTES = 4;
const n = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Is this host one the email may name? Never a client's, never a parked site. */
export function hostAllowed(host, parked = SPRY_WEEKLY.parked_hosts) {
  const h = String(host ?? "").toLowerCase().replace(/^www\./, "");
  if (!h) return false;
  if (CLIENT_DOMAINS.some((d) => h === d.toLowerCase() || h.endsWith(`.${d.toLowerCase()}`))) return false;
  return !parked.some((p) => h === p || h.endsWith(`.${p}`));
}

/** Why a fetched summary cannot be used, or null. */
export function summaryProblem(summary, { now = Date.now(), maxAgeHours = 36 } = {}) {
  if (!summary || typeof summary !== "object") return "it could not be read";
  if (summary.schema !== SPRY_WEEKLY.schema) return "it was in a format Boss OS does not know";
  const at = Date.parse(summary.generated_at ?? "");
  if (Number.isNaN(at)) return "it carried no date";
  if (now - at > maxAgeHours * 3_600_000) return `the newest one is from ${new Date(at).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "short", day: "numeric" })}, not this week`;
  return null;
}

function clicksLine(sites) {
  const withNow = sites.filter((s) => n(s.clicks) != null);
  if (!withNow.length) return null;
  const now = withNow.reduce((a, s) => a + n(s.clicks), 0);
  const withPrev = withNow.filter((s) => n(s.prev_clicks) != null);
  const prev = withPrev.length === withNow.length ? withPrev.reduce((a, s) => a + n(s.prev_clicks), 0) : null;
  return prev == null ? `Clicks from search this week: ${now}.` : `Clicks from search this week: ${now} (the week before: ${prev}).`;
}

/** One business's section: `{ title, items }` for layoutEmail. */
export function sectionFor(source, summary, problem = null) {
  const title = source.label;
  if (problem || !summary) {
    return { title, items: [`No report this week: ${problem ?? "it did not arrive"}. Nothing is lost; the team checks why.`] };
  }
  const sites = (summary.sites ?? []).filter((s) => hostAllowed(s.host));
  const hidden = (summary.sites ?? []).length - sites.length;
  const items = [];
  if (sites.length) {
    const fine = sites.filter((s) => s.state === "fine").length;
    const look = sites.filter((s) => s.state === "needs-a-look");
    const watch = sites.filter((s) => s.state === "watch");
    if (!look.length && !watch.length) items.push(sites.length === 1 ? "The site is fine." : `All ${sites.length} sites are fine.`);
    else items.push([fine ? `${fine} fine` : null, watch.length ? `${watch.length} to watch` : null, look.length ? `${look.length} worth a look` : null].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase()) + ".");
    for (const s of [...look, ...watch].slice(0, MAX_LOOKS)) {
      const why = (s.why ?? []).filter(Boolean)[0];
      items.push(`${s.label ?? s.host}: ${why ? String(why) : s.state === "watch" ? "worth watching" : "worth a look"}.`.replace(/\.\.$/, "."));
    }
    const more = look.length + watch.length - MAX_LOOKS;
    if (more > 0) items.push(`And ${more} more in the full report.`);
    const clicks = clicksLine(sites);
    if (clicks) items.push(clicks);
  }
  // "Needs you" from a repo's own wording becomes "waiting on you": this email asks nothing of her
  // (its decisions live in Simone's morning email), and the plain-email gate holds the contradiction.
  for (const note of (summary.notes ?? []).slice(0, MAX_NOTES)) items.push(String(note).replace(/\bneeds you\b/gi, "waiting on you"));
  if (!items.length) items.push(hidden ? "Ran. Nothing of yours to report." : "Ran. Nothing to report.");
  if (summary.state === "needs-a-look" && !sites.length) items.unshift("Worth a look this week.");
  return { title, items, link: summary.run_url ? { label: "Full report", url: summary.run_url } : undefined };
}

/** The whole email's parts. `got` maps source key → { summary } or { problem }. */
export function composeSpryWeekly(got, { now = Date.now() } = {}) {
  const sections = SPRY_WEEKLY.sources.map((src) => {
    const g = got[src.key] ?? { problem: "it did not arrive" };
    const problem = g.problem ?? summaryProblem(g.summary, { now, maxAgeHours: src.max_age_hours ?? 36 });
    return sectionFor(src, g.summary, problem);
  });
  const missing = sections.filter((s) => s.items[0].startsWith("No report this week")).length;
  const looks = SPRY_WEEKLY.sources.reduce((a, src) => {
    const s = got[src.key]?.summary;
    if (!s || got[src.key]?.problem || summaryProblem(s, { now, maxAgeHours: src.max_age_hours ?? 36 })) return a;
    return a + (s.sites ?? []).filter((x) => hostAllowed(x.host) && x.state === "needs-a-look").length + (s.state === "needs-a-look" ? 1 : 0);
  }, 0);
  const happened = looks === 0 && missing === 0
    ? "Every Spry Labs business reported this week, and all is quiet."
    : [looks ? `${plural(looks, "thing")} worth a look` : null, missing ? `${plural(missing, "report")} did not arrive` : null].filter(Boolean).join("; ").replace(/^./, (c) => c.toUpperCase()) + ". The team has each one.";
  const date = new Date(now).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
  return { subject: `Spry Labs weekly, ${date}`, happened, sections, missing, looks };
}
