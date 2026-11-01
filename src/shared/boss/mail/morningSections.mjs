/**
 * THE MORNING SECTIONS' PURE PARTS — shared by the writers (morning.mjs, on her Mac or a cloud runner)
 * and the Boss OS store (src/worker/boss/routes/morning.ts, D1 `morning_sections`), so the shape a
 * section must have and the way lines are appended are one rule in one place. No node imports: the
 * Worker bundles this file.
 */

/** Producers: D writes deals + monique_found; L writes lp, prospects, catchups, eightraise; E the rest. */
export const MORNING_SECTIONS = Object.freeze([
  "deals", "monique_found", "lp", "prospects", "catchups", "eightraise",
  "risk", "archive", "tail", "bounces", "notices",
  // Mondays: the weekly Search Readiness check of the grid repo sites (scripts/ops/search-readiness-audit.mjs).
  "grid_repos",
  "pnp_outreach",
  // Camille's Marketplace listings: the at-most-weekly ask for new real-job photos (scripts/ops/pnp-photo-ask.mjs).
  "pnp_marketplace",
  // Mondays: "📊 Scorecard: N on track, M need a look" (scripts/ops/scorecard-monday.mjs; owner ruling, 1 Nov 2026).
  // Carries its own `title`; lists only switches, pauses and rows with no number.
  "scorecard",
]);
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
