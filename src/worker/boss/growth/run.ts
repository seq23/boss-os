/**
 * THE GROWTH DIRECTOR'S SHARED PARTS (21 Nov 2026; rebuilt 23 Nov 2026). Noelle is now a scheduled Claude
 * session (growth/noelle.ts is her record, scripts/ops/noelle.sh her run): the free-model weekly cycle that
 * lived here, its Open Loops "growth#" writer and its model seam were removed in the same PR (replace,
 * don't add). What stays is what her run and the AI answers week share:
 *
 *   loadRoster    the roster from the growth brains (GROWTH_BRAINS); a broken section is a named problem
 *   brainMd       one brain's body
 *
 * Her Decide cards (card, askedRecently) went with the plan path on 24 Nov 2026: full Claude Code brings
 * Sequoia only money, accounts, legal and her own calls, in her reply. The growth_proposal resume handler
 * stays so a card already on Sequoia's screen still resolves. It never posts, sends, spends, creates or
 * deletes anything.
 */
import type { Env } from "../env";
import { GROWTH_BRAINS, growthSection, parseRoster, rosterProblems, BRAIN_NAMES, type RosterEntry } from "../../../shared/boss/growth/roster.mjs";

export const DIRECTOR = "emp_growth";
export async function brainMd(db: D1Database, slug: string): Promise<string | null> {
  return (await db.prepare(`SELECT body_md FROM brains WHERE slug = ?`).bind(slug).first<{ body_md: string }>())?.body_md ?? null;
}

/** The roster from the growth brains only; a broken section is a named problem, never a quiet skip. */
export async function loadRoster(db: D1Database): Promise<{ roster: RosterEntry[]; problems: string[]; mds: Record<string, string | null> }> {
  const roster: RosterEntry[] = []; const problems: string[] = []; const mds: Record<string, string | null> = {};
  for (const slug of GROWTH_BRAINS) {
    const name = (BRAIN_NAMES as Record<string, string>)[slug] ?? slug;
    // One brain failing to read never stops the other's cycle, and never reads as "no rulings".
    let md: string | null = null;
    try { md = await brainMd(db, slug); } catch (e) { mds[slug] = null; problems.push(`${name}'s brain could not be read (${String((e as Error)?.message ?? e).slice(0, 120)}): its roster and rulings not read`); continue; }
    mds[slug] = md;
    if (!md) { problems.push(`${name}'s brain is missing: its roster and rulings not read`); continue; }
    try { const body = growthSection(slug, md); if (body) roster.push(...parseRoster(body, slug)); else problems.push(`${name}'s brain has no Growth section yet`); }
    catch (e) { problems.push(String((e as Error).message)); }
  }
  return { roster, problems: [...problems, ...rosterProblems(roster)], mds };
}
