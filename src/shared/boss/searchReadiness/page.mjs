/**
 * THE PINNED CHECKLIST PAGE, RENDERED FROM THE MANIFEST — so the page and the weekly checks are one
 * definition (owner, 25 Oct 2026). `page-template.html` is the page as published with each phase's
 * items cut out and a `<!--PHASE:X-->` marker left in their place; every item, its why, its how and
 * what the Monday audit does with it come from `checklist.json`. Pure: `renderChecklistPage(checklist,
 * template)` returns the HTML. `scripts/ops/search-readiness-page.mjs` writes it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shownToOwner } from "./audit.mjs";

export const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "page-template.html");
export const loadTemplate = () => readFileSync(TEMPLATE_PATH, "utf8");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STYLE = `
  .check { margin: 6px 0 0; font-size: 13px; color: var(--muted, #666); }
  .check b { font-weight: 600; }
  .check.manual b { color: var(--muted, #666); }
  .standings td:first-child { white-space: nowrap; }
  .standings .ok { color: var(--ok, #2b7a4b); }`;

export function renderItem(item) {
  const label = item.title_html ?? esc(item.title);
  const burned = item.burned ? ' <span class="bad">burned</span>' : "";
  const c = item.check;
  const check = c.mode === "auto"
    ? `<p class="check"><b>Checked every Monday on every grid repo site it applies to:</b> ${esc(c.how)}</p>`
    : `<p class="check manual"><b>Checked by hand:</b> ${esc(c.reason)}</p>`;
  return `    <div class="item" data-id="${item.id}"><input type="checkbox" id="${item.id}"><div><label class="t" for="${item.id}">${label}${burned}</label><p class="why">${item.why_html}</p><p class="how">${item.how_html}</p>${check}</div></div>`;
}

export function renderPhase(phase, items) {
  return [
    `<section class="phase" data-phase="${phase.id}">`,
    `    <div class="phase-head"><h2>${esc(phase.title)}</h2><span class="when">${esc(phase.when)}</span><span class="count"></span></div>`,
    ...items.map(renderItem),
    "  </section>",
  ].join("\n");
}

/**
 * "WHERE EVERY SITE STANDS" — one row per grid repo site from a Monday results file
 * (`~/.boss-os/search-readiness/results-<day>.json`): its repo, the automatic checks that passed of
 * those with a verdict, and each failing item by id and title. Counts are computed here, never typed.
 */
export function standingsSummary(results) {
  // Client sites are audited but never shown on her page (shownToOwner, 1 Nov 2026).
  const sites = (results?.sites ?? []).filter((s) => shownToOwner(s.site));
  let pass = 0, failing = 0, notChecked = 0;
  for (const s of sites) for (const r of s.results ?? []) {
    if (r.status === "pass") pass++; else if (r.status === "fail") failing++; else if (r.status === "not_checked") notChecked++;
  }
  return { sites: sites.length, checks: pass + failing, failing, notChecked, day: results?.day ?? null };
}

export function renderStandings(results, checklist) {
  const title = Object.fromEntries(checklist.items.map((i) => [i.id, i.title]));
  const sum = standingsSummary(results);
  const rows = [...(results?.sites ?? [])].filter((s) => shownToOwner(s.site))
    .sort((a, b) => (b.failing?.length ?? 0) - (a.failing?.length ?? 0) || String(a.site?.domain).localeCompare(String(b.site?.domain)))
    .map((s) => {
      const res = s.results ?? [];
      const passed = res.filter((r) => r.status === "pass").length;
      const judged = res.filter((r) => r.status === "pass" || r.status === "fail").length;
      const fails = res.filter((r) => r.status === "fail");
      const cell = fails.length
        ? fails.map((r) => `<b>${esc(r.id)}</b> ${esc(title[r.id] ?? "")}`).join("<br>")
        : '<span class="ok">nothing failing</span>';
      // Not on the search loop yet: said once, informational (the rollout owns adoption, wave by wave).
      const loopNote = res.find((r) => r.status === "skipped")?.detail;
      return `      <tr data-site="${esc(s.site?.domain ?? "")}"><td>${esc(s.site?.domain ?? "")}</td><td><code>${esc(s.site?.repo ?? "no repo")}</code></td><td>${passed} of ${judged}</td><td>${cell}${loopNote ? `<br><span class="muted">${esc(loopNote)}</span>` : ""}</td></tr>`;
    });
  return [
    `  <h2 id="standings">Where every site stands</h2>`,
    `  <p data-standings="${sum.sites}/${sum.checks}/${sum.failing}">The Monday audit of ${esc(sum.day ?? "the latest week")}: <b>${sum.sites} sites, ${sum.checks} automatic checks with a verdict, ${sum.failing} failing</b>${sum.notChecked ? ` (${sum.notChecked} could not be checked that week)` : ""}. Every failure is a fix brief Danielle works on Tuesday.</p>`,
    `  <div class="tbl"><table class="standings">`,
    `    <thead><tr><th>Site</th><th>Repo</th><th>Passed</th><th>Failing</th></tr></thead>`,
    `    <tbody>`,
    ...rows,
    `    </tbody>`,
    `  </table></div>`,
  ].join("\n");
}

export function renderChecklistPage(checklist, template, { results = null } = {}) {
  let html = template;
  if (!html.includes("<!--STANDINGS-->")) throw new Error("the page template has no <!--STANDINGS-->");
  html = html.replace("<!--STANDINGS-->", results ? renderStandings(results, checklist) : "");
  for (const phase of checklist.phases) {
    const marker = `<!--PHASE:${phase.id}-->`;
    if (!html.includes(marker)) throw new Error(`the page template has no ${marker}`);
    html = html.replace(marker, renderPhase(phase, checklist.items.filter((i) => i.phase === phase.id)));
  }
  const left = html.match(/<!--PHASE:\w+-->/);
  if (left) throw new Error(`the manifest has no phase for ${left[0]}`);
  const auto = checklist.items.filter((i) => i.check.mode === "auto").length;
  html = html.replace("</style>", `${STYLE}\n</style>`);
  return html.replace("<!--MANIFEST-->", "").replace(/(<body[^>]*>)/i, `$1\n<!-- Rendered from boss-os src/shared/boss/searchReadiness/checklist.json: ${checklist.items.length} items, ${auto} checked automatically every Monday, ${checklist.items.length - auto} by hand. -->`);
}
