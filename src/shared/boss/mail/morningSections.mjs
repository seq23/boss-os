/**
 * THE MORNING SECTIONS' PURE PARTS — shared by the writers (morning.mjs, on her Mac or a cloud runner)
 * and the Boss OS store (src/worker/boss/routes/morning.ts, D1 `morning_sections`), so the shape a
 * section must have and the way lines are appended are one rule in one place. No node imports: the
 * Worker bundles this file.
 */

/**
 * THE ONE SECTION REGISTRY. Producers: D writes deals + monique_found; L writes lp, prospects,
 * catchups; the Worker writes eightraise (L adds the live balance); E the rest. `expect` is the weekdays (Central) whose morning email must carry
 * a copy written within REPORT_IN_MS — the producer's schedule, said once here; a producer with
 * nothing to say posts an empty "all clear" so absence means it did not run (rule 0, 1 Nov 2026).
 * `null` = event-driven, never expected. `label` is the plain name her email uses when one is missing.
 *
 * `catchUp` (an expected section only, repair rc_m6gtk44dhfjq6rvj, 3 Nov 2026): the `npm run` args
 * that rewrite this section safely before the 06:32 Central catch-up's 06:40 deadline — only a
 * producer that sends nothing (proved against SENDING_PATTERNS by tests/morningCatchup.test.ts).
 * `catchUpWhy` is the plain reason it has none. Every expected section carries exactly one of the two.
 */
const DAILY = Object.freeze(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
export const MORNING_SECTION_SPECS = Object.freeze([
  // interest-grid.mjs, daily 05:30 on her Mac (com.seq.boss-capital). No email: safe to catch up.
  { name: "deals", label: "New deals", expect: DAILY, catchUp: "capital:grid -- --keep-seen" },
  { name: "monique_found", label: "Monique's matches", expect: DAILY, catchUp: "capital:grid -- --keep-seen" },
  // lp-daily.mjs 06:15 (Mac); prospects Mon–Fri 09:30, so the next morning's email (Mac);
  // catchups 06:20 (cloud, job-catchups.yml). Eightraise: Worker hourly tick from 05:00 Central;
  // lp-eightraise.mjs replaces it at 06:25 (Mac) with the live balance when readable.
  { name: "lp", label: "LP updates", expect: DAILY, catchUpWhy: "lp-daily.mjs can act on live LP replies; never re-run blind before the email" },
  {
    name: "prospects", label: "Prospect emails", expect: Object.freeze(["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]),
    catchUpWhy: "lp-prospects.mjs sends prospect outreach; never re-run blind before the email",
  },
  { name: "catchups", label: "Catch up with", expect: DAILY, catchUpWhy: "moved to the cloud (job-catchups.yml, 1 Nov 2026); not a Mac script to re-run" },
  { name: "eightraise", label: "the 8Raise credits", expect: DAILY, catchUpWhy: "written by the Worker hourly tick, with live balance supplied separately; not a Mac producer to re-run" },
  // risk-watch.mjs daily 08:20 (Mac), so the next morning's email; posts an empty all clear.
  { name: "risk", label: "Toni's money and mail check", expect: DAILY, catchUpWhy: "risk-watch.mjs can send an alert when money is at risk (sendAs); never re-run blind" },
  // archive-audit.mjs Fridays 08:40 (Mac), so Saturday's email; posts an empty all clear. No email: safe to catch up.
  { name: "archive", label: "Zora's archive check", expect: Object.freeze(["Saturday"]), catchUp: "archive:audit" },
  // One line per email she sent Boss OS (boss-mail-tail-report.mjs): event-driven.
  { name: "tail", label: "Your email jobs", expect: null },
  { name: "bounces", label: "Bounces", expect: null },
  { name: "notices", label: "Notices", expect: null },
  // Mondays 06:00: the weekly Search Readiness check of the grid repo sites (scripts/ops/search-readiness-audit.mjs).
  {
    name: "grid_repos", label: "the grid repos' search check", expect: Object.freeze(["Monday"]),
    catchUpWhy: "the weekly Search Readiness audit (sites:audit) runs long — longer than the window before the email",
  },
  // Camille's office outreach: a campaign that ends, so never expected.
  { name: "pnp_outreach", label: "Office outreach", expect: null },
  // Camille's Marketplace listings: the at-most-weekly ask for new real-job photos (scripts/ops/pnp-photo-ask.mjs).
  { name: "pnp_marketplace", label: "Marketplace photos", expect: null },
  // Mondays 06:10: "📊 Scorecard: N on track, M need a look" (scripts/ops/scorecard-monday.mjs; owner ruling, 1 Nov 2026).
  // Carries its own `title`; lists only switches, pauses and rows with no number. No email: safe to catch up.
  { name: "scorecard", label: "the Scorecard", expect: Object.freeze(["Monday"]), catchUp: "scorecard:monday" },
  // Every morning from 05:00 Central: "Open loops: N, M overdue" + one line per overdue row, written by
  // the Worker's hourly tick (src/worker/boss/routes/openLoops.ts runOpenLoopsDaily; owner ruling, 1 Nov 2026).
  // Carries its own `title`; an empty list is still written, so absence means the tick did not run.
  { name: "open_loops", label: "Open loops", expect: DAILY, catchUpWhy: "written by the Worker's hourly tick (runOpenLoopsDaily); not a Mac script to re-run" },
].map((s) => Object.freeze(s)));
export const MORNING_SECTIONS = Object.freeze(MORNING_SECTION_SPECS.map((s) => s.name));

/** An expected section must have been written within this of the email (a daily job runs once a day). */
export const REPORT_IN_MS = 24 * 3_600_000;

/**
 * THE SECTIONS THAT DID NOT REPORT IN (rule 0, 1 Nov 2026): a producer whose post failed used to leave
 * its section silently out of the email. Every section expected on `weekday` with no copy written
 * within REPORT_IN_MS is returned `{ name, label }`, and `sections` comes back without those old
 * copies, so the email never shows yesterday's section as today's. Pure.
 */
export function sectionsNotReported(sections, { weekday, now = Date.now() }) {
  const kept = { ...(sections ?? {}) };
  const missing = [];
  for (const s of MORNING_SECTION_SPECS) {
    if (!s.expect?.includes(weekday)) continue;
    const at = Date.parse(kept[s.name]?.at ?? "");
    if (Number.isFinite(at) && now - at <= REPORT_IN_MS) continue;
    delete kept[s.name];
    missing.push({ name: s.name, label: s.label });
  }
  return { sections: kept, missing };
}

/** The one thin line her email carries when sections are missing; null when none. Pure. */
export function notReportedLine(missing) {
  if (!missing?.length) return null;
  const names = missing.map((m) => m.label);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `⚠ Not in today's email: ${list} (${names.length === 1 ? "its job" : "their jobs"} did not report in). The team is fixing it.`;
}
/**
 * THE CATCH-UP PLAN (repair rc_m6gtk44dhfjq6rvj, 3 Nov 2026): the distinct `catchUp` commands the
 * sections in `missing` need, in registry order (so two sections sharing one producer — deals and
 * monique_found both run `capital:grid`— run it once), plus every section with none, named with why.
 * Pure.
 */
export function catchUpPlan(missing) {
  const commands = [];
  const cannotCatchUp = [];
  for (const m of missing ?? []) {
    const spec = MORNING_SECTION_SPECS.find((s) => s.name === m.name);
    if (spec?.catchUp) { if (!commands.includes(spec.catchUp)) commands.push(spec.catchUp); }
    else cannotCatchUp.push({ name: m.name, label: m.label, why: spec?.catchUpWhy ?? "no catch-up is defined for this section" });
  }
  return { commands, cannotCatchUp };
}

export const STALE_MS = 30 * 3_600_000;

const isButton = (b) => b && typeof b.label === "string" && typeof b.url === "string" && /^(?:https?:\/\/|mailto:)\S+$/.test(b.url);

/** What is wrong with a section object, by name. `[]` means it is shown. Pure. */
export function morningSectionProblems(obj) {
  const p = [];
  if (!obj || typeof obj !== "object") return ["not an object"];
  if (!MORNING_SECTIONS.includes(obj.section)) p.push(`unknown section "${obj.section}"`);
  if (!obj.at || Number.isNaN(Date.parse(obj.at))) p.push("no valid \"at\"");
  for (const [i, d] of (obj.decide ?? []).entries()) {
    if (!d || typeof d.title !== "string" || !d.title.trim()) p.push(`decide[${i}] has no title`);
    if (!Array.isArray(d?.buttons) || !d.buttons.length) p.push(`decide[${i}] has no one-tap button`);
    else if (!d.buttons.every(isButton)) p.push(`decide[${i}] has a button without a real link`);
  }
  for (const [i, r] of (obj.rows ?? []).entries()) if (!r || typeof r.company !== "string") p.push(`rows[${i}] has no company`);
  for (const [i, l] of (obj.lines ?? []).entries()) if (!(typeof l === "string" || (l && typeof l.text === "string"))) p.push(`lines[${i}] is not a line`);
  if (obj.link && !isButton(obj.link)) p.push("link is not { label, url }");
  return p;
}


/** Lines/decide appended to a section "today": a copy older than APPEND_FRESH_MS starts fresh. Pure. */
export const APPEND_FRESH_MS = 20 * 3_600_000;
export function appendToSection(prev, section, { lines = [], decide = [] } = {}, now = Date.now()) {
  const fresh = prev && Date.parse(prev.at) && now - Date.parse(prev.at) < APPEND_FRESH_MS;
  const base = fresh ? prev : { decide: [], rows: [], lines: [] };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mergedLines = [...(base.lines ?? [])];
  for (const l of lines) if (!mergedLines.some((x) => same(x, l))) mergedLines.push(l);
  const mergedDecide = [...(base.decide ?? [])];
  for (const d of decide) if (!mergedDecide.some((x) => x.title === d.title)) mergedDecide.push(d);
  return { decide: [], rows: [], ...base, section, at: new Date(now).toISOString(), lines: mergedLines, decide: mergedDecide };
}

/**
 * THE CUTOVER RULE (1 Nov 2026): a section can be in the Boss OS store, in a Mac file, or both (a Mac
 * writer writes both). Per section the copy with the newer "at" wins WHOLE — never a union, so a
 * section a writer replaced today never brings back yesterday's lines from an older copy. Pure.
 */
export function newerSections(...sources) {
  const out = {};
  for (const src of sources) for (const [name, obj] of Object.entries(src ?? {})) {
    if (!out[name] || Date.parse(obj.at) > Date.parse(out[name].at)) out[name] = obj;
  }
  return out;
}
