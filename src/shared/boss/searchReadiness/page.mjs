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

export const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "page-template.html");
export const loadTemplate = () => readFileSync(TEMPLATE_PATH, "utf8");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STYLE = `
  .check { margin: 6px 0 0; font-size: 13px; color: var(--muted, #666); }
  .check b { font-weight: 600; }
  .check.manual b { color: var(--muted, #666); }`;

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

export function renderChecklistPage(checklist, template) {
  let html = template;
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
