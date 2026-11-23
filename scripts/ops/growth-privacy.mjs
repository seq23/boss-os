#!/usr/bin/env node
/**
 * Does any private word reach the Growth Director? A dry run of the decision prompts against a copy of
 * the live brains (22 Nov 2026, after a review found client names and personal mail addresses in them).
 *
 *   npm run growth:privacy                 the copies in ~/Brains (brains:pull keeps them current)
 *   npm run growth:privacy -- <dir>        <dir>/spry.md and <dir>/porch-and-party.md
 *
 * It builds every active business's decision prompt the way the Monday cycle does (growthSection,
 * parseRoster, rulingsFor, fitDecisionPrompt; no counts or trends) and runs the cycle's own check on it
 * (promptLeak, src/shared/boss/growth/privacy.mjs; the cycle holds a leaking business before any model
 * call). Use it before the cycle, on a fresh copy, after marking something in a brain. Names and
 * addresses are never printed: a hit names the business, the ruling heading and a count.
 *
 * FAILS CLOSED, exit 2 with a NAMED STOP: a brain copy missing or unreadable, a Growth section refused
 * or empty, no active business on the rosters (one prompt per active business, so pausing one never
 * breaks it), a business whose rulings were not read, or no private word found at all (nothing to tell a client name from
 * any other word). Exit 1 is a leak; exit 0 prints `OUTPUT n prompts checked`.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GROWTH_BRAINS, growthSection, parseRoster, rulingsFor } from "../../src/shared/boss/growth/roster.mjs";
import { fitDecisionPrompt } from "../../src/shared/boss/growth/director.mjs";
import { playbookBody } from "../../src/shared/boss/growth/playbook.mjs";
import { privateOnlyTerms, promptLeak, termCount } from "../../src/shared/boss/growth/privacy.mjs";

const stop = (code, why) => ({ ok: false, exit: 2, stop: `NAMED STOP [${code}] ${why}`, rows: [], prompts: 0, terms: 0 });

/** The whole dry run over { slug: md | null }. Pure: no file or network. */
export function checkPrompts(mds, { playbook = playbookBody(), today = new Date().toISOString().slice(0, 10) } = {}) {
  for (const slug of GROWTH_BRAINS) if (typeof mds[slug] !== "string" || !mds[slug].trim()) return stop("BRAIN_COPY_MISSING", `the ${slug} brain copy could not be read`);
  const terms = privateOnlyTerms(mds, playbook);
  const nTerms = termCount(terms);
  if (!nTerms) return stop("NO_PRIVATE_TERMS", "no word sits only inside a confidential span, so a client name cannot be told from any other word");
  const rows = [];
  for (const slug of GROWTH_BRAINS) {
    let body;
    try { body = growthSection(slug, mds[slug]); } catch (e) { return stop("GROWTH_REFUSED", String(e?.message ?? e).slice(0, 200)); }
    if (!body) return stop("GROWTH_MISSING", `the ${slug} brain has no Growth section`);
    const entries = parseRoster(body, slug);
    if (!entries.length) return stop("ROSTER_EMPTY", `the ${slug} brain's Growth section has no business on it`);
    for (const entry of entries) {
      if (entry.paused) continue;
      const rulings = rulingsFor(entry, mds[slug]);
      if (rulings.notRead) return stop("RULINGS_NOT_READ", `${entry.label}: ${rulings.notRead}`);
      const args = { playbook, entry, summary: { channels: [] }, trends: [], today, todos: [] };
      const fit = fitDecisionPrompt({ ...args, rulings });
      const hit = promptLeak({ fit, bare: fitDecisionPrompt(args), rulings, terms });
      rows.push({ business: entry.label, chars: fit.chars, private: hit.private, mail: hit.mail, where: hit.where });
    }
  }
  // One prompt per active business on the rosters, whatever their number: pausing one never breaks the
  // check, and a roster with nothing active is a stop, never "0 prompts, all clean".
  if (!rows.length) return stop("NO_ACTIVE_BUSINESS", "every business on the growth rosters is paused, so no prompt was checked");
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
