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
import { loopLine, weekProblem } from "../searchLoop/week.mjs";

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

/** The Monday that starts the week holding `ms`, on her clock (America/Chicago), as YYYY-MM-DD. Pure. */
export function chicagoWeekOf(ms) {
  const [y, m, d] = new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/**
 * Why a fetched summary cannot be used, or null. A report from this week (Monday to Sunday, her clock)
 * always counts; an older one counts only inside its source's age limit (7 Nov 2026 live read: a
 * re-send on Saturday called that Wednesday's reports "from Wednesday, Nov 4, not this week").
 */
export function summaryProblem(summary, { now = Date.now(), maxAgeHours = 36 } = {}) {
  if (!summary || typeof summary !== "object") return "it could not be read";
  if (summary.schema !== SPRY_WEEKLY.schema) return "it was in a format Boss OS does not know";
  const at = Date.parse(summary.generated_at ?? "");
  if (Number.isNaN(at)) return "it carried no date";
  // A source that runs before Monday (How We Know on Sunday: `max_age_hours` past the default 36) gets
  // that much slack before the week's Monday too, so its report counts all week.
  const weekStart = Date.parse(`${chicagoWeekOf(now)}T06:00:00Z`) - Math.max(0, maxAgeHours - 36) * 3_600_000;
  if (now - at > maxAgeHours * 3_600_000 && at < weekStart) return `the newest one is from ${new Date(at).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "short", day: "numeric" })}, not this week`;
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
    if (!look.length && !watch.length) items.push(sites.length === 1 ? "The site is fine." : sites.length === 2 ? "Both sites are fine." : `All ${sites.length} sites are fine.`);
    else items.push([fine ? `${fine} fine` : null, watch.length ? `${watch.length} to watch` : null, look.length ? `${look.length} worth a look` : null].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase()) + ".");
    for (const s of [...look, ...watch].slice(0, MAX_LOOKS)) {
      const why = (s.why ?? []).filter(Boolean)[0];
      items.push(`${s.label ?? s.host}: ${why ? String(why) : s.state === "watch" ? "worth watching" : "worth a look"}.`.replace(/\.\.$/, "."));
    }
    const more = look.length + watch.length - MAX_LOOKS;
    if (more > 0) items.push(`And ${more} more; the team has them.`);
    const clicks = clicksLine(sites);
    if (clicks) items.push(clicks);
  }
  /*
   * THIS EMAIL ASKS NOTHING OF HER (its decisions live in Simone's morning email), so a repo's note
   * that asks her for something, or sends her to GitHub, is the team's: counted in one line, never
   * shown as her task (7 Nov 2026 live read: "waiting on you: read the stop issue on GitHub" under a
   * "Nothing to do" headline).
   */
  // "not read" is the system's word; on her email a number nobody measured is "not measured" (7 Nov 2026).
  const notes = (summary.notes ?? []).map((t) => String(t).replace(/\bnot read\b/gi, "not measured"));
  const asksHer = (t) => /\b(?:needs you|waiting on you|for you to|you (?:need|must|should))\b|github/i.test(t);
  const team = notes.filter(asksHer);
  for (const note of notes.filter((t) => !asksHer(t)).slice(0, MAX_NOTES)) items.push(note);
  if (team.length) items.push(`The team has ${team.length === 1 ? "one thing" : `${team.length} things`} to clear here; nothing for you.`);
  if (!items.length) items.push(hidden ? "Ran. Nothing of yours to report." : "Ran. Nothing to report.");
  if (summary.state === "needs-a-look" && !sites.length) items.unshift("Worth a look this week.");
  // No link to the repo's run: GitHub pages are never in her email (7 Nov 2026).
  return { title, items };
}

/**
 * The "Search loop" section: one plain line per site of hers. `loop` maps a repo to what was read:
 * `{ weeks, adopted }` or `{ problem }`. RULE 0: a site whose numbers were not read never shows a 0.
 *   no report and not adopted → "not started yet"; adopted, nothing fresh → "this week's report did not
 *   arrive"; GitHub unreadable → "could not be read this week".
 * Returns the section and the keys whose report did not arrive (the run opens a fix job for them).
 */
export function loopSection(loop, { now = Date.now(), sites = SPRY_WEEKLY.search_loop.sites } = {}) {
  const items = [], late = [];
  for (const site of sites) {
    const reads = site.repos.map((r) => loop?.[r] ?? { problem: "not read" });
    if (reads.some((r) => r.problem)) { items.push(`${site.label}: could not be read this week.`); continue; }
    const fresh = reads.flatMap((r) => r.weeks ?? []).filter((w) => !weekProblem(w, { now }));
    // A site reports once a week; keep the newest report per site, so a re-run never counts twice.
    const newest = Object.values(fresh.reduce((a, w) => {
      const k = String(w.site).toLowerCase();
      if (!a[k] || Date.parse(w.generated_at) > Date.parse(a[k].generated_at)) a[k] = w;
      return a;
    }, {}));
    if (newest.length) { items.push(`${site.label}: ${loopLine(newest, { actionWord: site.action_word })}.`); continue; }
    if (reads.some((r) => r.adopted)) { items.push(`${site.label}: this week's report did not arrive. The team checks why.`); late.push(site.key); continue; }
    items.push(`${site.label}: not started yet.`);
  }
  return { section: { title: "Search loop", items }, late };
}

/** The whole email's parts. `got` maps source key → { summary } or { problem }. */
export function composeSpryWeekly(got, { now = Date.now(), loop = null } = {}) {
  const sections = SPRY_WEEKLY.sources.map((src) => {
    const g = got[src.key] ?? { problem: "it did not arrive" };
    const problem = g.problem ?? summaryProblem(g.summary, { now, maxAgeHours: src.max_age_hours ?? 36 });
    return sectionFor(src, g.summary, problem);
  });
  const loopPart = loopSection(loop, { now });
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
  return { subject: `Spry Labs weekly, ${date}`, happened, sections: [...sections, loopPart.section], missing, looks, loopLate: loopPart.late };
}
