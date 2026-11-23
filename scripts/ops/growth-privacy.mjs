#!/usr/bin/env node
/**
 * Does any private word reach the Growth Director? A dry run of the decision prompts against a copy of
 * the live brains (22 Nov 2026, after a review found client names and personal mail addresses in them).
 *
 *   npm run growth:privacy                 the copies in ~/Brains (brains:pull keeps them current)
 *   npm run growth:privacy -- <dir>        <dir>/spry.md and <dir>/porch-and-party.md
 *
 * It builds every active business's decision prompt the way the Monday cycle does (growthSection,
 * parseRoster, rulingsFor, fitDecisionPrompt; no counts or trends) and fails when a prompt carries:
 *   - a word her brains hold ONLY inside a confidential span (a capitalised word of 3+ letters, or a
 *     mail address): it is private, so the cut missed it;
 *   - a personal mail address (gmail and the like), marked or not.
 * Names and addresses are never printed: a hit names the business, the ruling heading and a count.
 *
 * FAILS CLOSED, exit 2 with a NAMED STOP: a brain copy missing or unreadable, a Growth section refused,
 * a business whose rulings were not read, fewer than MIN_PROMPTS prompts, or no private word found
 * at all (nothing to tell a client name from any other word). Exit 1 is a leak; exit 0 prints
 * `OUTPUT n prompts checked`.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { confidentialSpans, stripConfidential } from "../../src/shared/boss/brains/brain.mjs";
import { GROWTH_BRAINS, growthSection, parseRoster, rulingsFor } from "../../src/shared/boss/growth/roster.mjs";
import { fitDecisionPrompt } from "../../src/shared/boss/growth/director.mjs";
import { playbookBody } from "../../src/shared/boss/growth/playbook.mjs";

/** The active businesses on the two growth brains today: Porch & Party and five Spry Labs apps. */
export const MIN_PROMPTS = 6;
export const PERSONAL_MAIL_RE = /[\w.+-]+@(?:gmail|googlemail|yahoo|ymail|icloud|me|mac|hotmail|outlook|live|aol|proton|protonmail)\.[a-z.]+/gi;
const MAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const NAME_RE = /\b[A-Z][a-z]{2,}\b/g;
const words = (text) => new Set(String(text).toLowerCase().match(/[a-z]+/g) ?? []);

/** Words found only inside confidential spans of these brains, never in their public text or in `alsoPublic`. */
export function privateOnlyTerms(mds, alsoPublic = "") {
  const publicText = [...Object.values(mds).map((md) => stripConfidential(md)), alsoPublic].join("\n");
  const pub = words(publicText);
  const lowerPublic = publicText.toLowerCase();
  const names = new Set(); const mails = new Set();
  for (const md of Object.values(mds)) {
    for (const span of confidentialSpans(md)) {
      for (const m of span.match(MAIL_RE) ?? []) if (!lowerPublic.includes(m.toLowerCase())) mails.add(m.toLowerCase());
      for (const w of span.replace(MAIL_RE, " ").match(NAME_RE) ?? []) if (!pub.has(w.toLowerCase())) names.add(w.toLowerCase());
    }
  }
  return { names: [...names], mails: [...mails] };
}

/** How many private terms and personal addresses one text carries; `known` = words its fixed text already has. */
export function leaksIn(text, terms, known = new Set()) {
  const t = String(text); const w = words(t); const lower = t.toLowerCase();
  return {
    private: terms.names.filter((n) => w.has(n) && !known.has(n)).length + terms.mails.filter((m) => lower.includes(m)).length,
    mail: (t.match(PERSONAL_MAIL_RE) ?? []).length,
  };
}

const stop = (code, why) => ({ ok: false, exit: 2, stop: `NAMED STOP [${code}] ${why}`, rows: [], prompts: 0, terms: 0 });

/** The whole dry run over { slug: md | null }. Pure: no file or network. */
export function checkPrompts(mds, { playbook = playbookBody(), today = new Date().toISOString().slice(0, 10) } = {}) {
  for (const slug of GROWTH_BRAINS) if (typeof mds[slug] !== "string" || !mds[slug].trim()) return stop("BRAIN_COPY_MISSING", `the ${slug} brain copy could not be read`);
  const terms = privateOnlyTerms(mds, playbook);
  const nTerms = terms.names.length + terms.mails.length;
  if (!nTerms) return stop("NO_PRIVATE_TERMS", "no word sits only inside a confidential span, so a client name cannot be told from any other word");
  const rows = [];
  for (const slug of GROWTH_BRAINS) {
    let body;
    try { body = growthSection(slug, mds[slug]); } catch (e) { return stop("GROWTH_REFUSED", String(e?.message ?? e).slice(0, 200)); }
    if (!body) return stop("GROWTH_MISSING", `the ${slug} brain has no Growth section`);
    for (const entry of parseRoster(body, slug)) {
      if (entry.paused) continue;
      const rulings = rulingsFor(entry, mds[slug]);
      if (rulings.notRead) return stop("RULINGS_NOT_READ", `${entry.label}: ${rulings.notRead}`);
      const args = { playbook, entry, summary: { channels: [] }, trends: [], today, todos: [] };
      const fit = fitDecisionPrompt({ ...args, rulings });
      const text = fit.messages.map((m) => m.content).join("\n");
      // The prompt's own fixed words (its instructions, the playbook, the roster entry) are public by
      // origin: only what her rulings add can carry a private word.
      const known = words(fitDecisionPrompt(args).messages.map((m) => m.content).join("\n"));
      const hit = leaksIn(text, terms, known);
      const where = [...rulings.own, ...rulings.shared].filter((g) => { const h = leaksIn(g.body, terms, known); return h.private || h.mail; }).map((g) => g.heading);
      rows.push({ business: entry.label, chars: fit.chars, private: hit.private, mail: hit.mail, where });
    }
  }
  if (rows.length < MIN_PROMPTS) return { ...stop("TOO_FEW_PROMPTS", `${rows.length} prompts built, at least ${MIN_PROMPTS} expected`), rows };
  const leaked = rows.some((r) => r.private || r.mail);
  return { ok: !leaked, exit: leaked ? 1 : 0, stop: null, rows, prompts: rows.length, terms: nTerms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(homedir(), "Brains");
  const mds = {};
  for (const slug of GROWTH_BRAINS) { const f = join(dir, `${slug}.md`); mds[slug] = existsSync(f) ? readFileSync(f, "utf8") : null; }
  const r = checkPrompts(mds);
  for (const row of r.rows) console.log(`${row.business}: ${row.chars} chars · private words ${row.private} · personal addresses ${row.mail}${row.where.length ? ` · in: ${row.where.join(" | ")}` : ""}`);
  if (r.stop) { console.log(r.stop); process.exit(2); }
  console.log(`private words known: ${r.terms}`);
  if (!r.ok) { console.log("LEAK: a private word or personal address is in a decision prompt"); process.exit(1); }
  console.log(`OUTPUT ${r.prompts} prompts checked`);
}
