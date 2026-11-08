/**
 * HER REPO CATEGORIES, READ FROM THE ONE LIST (owner, 1 Nov 2026: the hard "client repos are never
 * listed or raised" ban is replaced by categories; "a category sets defaults, not bans").
 *
 * The list lives in the `personal` brain, section "## Repo categories" (Boss OS Brains page; the Mac
 * reads its copy at ~/Brains/personal.md). No repo name is copied into code: every page and job that
 * groups or filters repos parses that section with `parseRepoCategories`.
 *
 *   mine     her businesses: fully in Boss OS (reports, emails, schedule)
 *   friends  friends & clients: work happens, results stay in their own repo; shown apart on her
 *            pages ("Friends' sites"); in her inbox only when something needs her
 *   system   the plumbing: shown only when it breaks
 *
 * The one firm line stays in code where it is enforced: client data never feeds her own networks.
 */
export const CATEGORIES = Object.freeze(["mine", "friends", "system"]);
// "**Support systems**" (KDP, the backlink network, creator-network…) are plumbing that serves her and her
// friends' businesses: they read as "system". A repo listed there AND under Mine or Friends keeps the earlier
// category (categoryOf checks mine, friends, system in that order). 8 Nov 2026: creator-network sat only
// there and every map called it "in no repo category".
const HEADINGS = [[/^\*\*\s*mine\b/i, "mine"], [/^\*\*\s*friends\b/i, "friends"], [/^\*\*\s*the system\b/i, "system"], [/^\*\*\s*support systems\b/i, "system"]];
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const bareRepo = (r) => String(r ?? "").trim().replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";

/**
 * `{ mine: string[], friends: string[], system: string[] }` from the personal brain's markdown, or
 * `{ problem }` in plain words. RULE 0: a missing section or an empty category is a problem, never an
 * empty list that would quietly show or hide everything.
 */
export function parseRepoCategories(md) {
  const m = /^## Repo categories[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(String(md ?? ""));
  if (!m) return { problem: "the personal brain has no \"## Repo categories\" section" };
  const out = { mine: [], friends: [], system: [], parked: [] };
  let cat = null;
  for (const raw of m[1].split("\n")) {
    const line = raw.trim();
    const head = HEADINGS.find(([re]) => re.test(line));
    let body;
    if (head) {
      cat = head[1];
      // A heading that carries its own list ("**Support systems** (…): KDP, authority-backlink-network, …").
      const rest = line.replace(/^\*\*[^*]*\*\*/, "");
      if (!/:\s*\S/.test(rest.replace(/\([^()]*\)/g, " "))) continue;
      body = rest;
    } else {
      if (/^\*\*/.test(line)) { cat = null; continue; } // any other bold line ends the lists
      if (!cat || !/^[-*]\s/.test(line)) continue;
      body = line.replace(/^[-*]\s+/, "");
    }
    // A "Parked …:" line (her ruling 1 Nov 2026: "no work, no jobs … until she un-parks it") keeps its
    // repos in their category AND lists them in `parked`, which the automatic fixer never touches.
    const parkedLine = /^parked\b/i.test(body);
    // A repo named inside a note ("Dianne's Place / Detox Denver (one business…; repo dianne-place-recovery-services)")
    // is kept before the notes are dropped: 8 Nov 2026 that repo was uncategorised and every map read it as hers.
    const named = [...body.matchAll(/\(([^()]*)\)/g)].flatMap((p) => [...p[1].matchAll(/\brepo\s+([A-Za-z0-9][A-Za-z0-9._-]*)/g)].map((x) => x[1].replace(/[.;]+$/, "")));
    for (const name of named) {
      if (REPO_NAME.test(name) && !out[cat].includes(name)) out[cat].push(name);
      if (parkedLine && !out.parked.includes(name)) out.parked.push(name);
    }
    while (/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, " ");
    const colon = body.indexOf(":");
    if (colon >= 0) body = body.slice(colon + 1);
    // A repo's note can run on past its parentheses into prose ("dianne-place-recovery-services . **Dianne's
    // Place: …" in the live brain, 1 Nov 2026, which left that client repo uncategorised and swept as hers):
    // a sentence break ends a repo name the way a comma does.
    for (const part of body.split(/,| and |\s\.(?=\s|$)/)) {
      const name = part.trim().replace(/[.;]+$/, "");
      if (REPO_NAME.test(name) && !out[cat].includes(name)) out[cat].push(name);
      if (parkedLine && REPO_NAME.test(name) && !out.parked.includes(name)) out.parked.push(name);
    }
  }
  const empty = CATEGORIES.filter((c) => !out[c].length);
  if (empty.length) return { problem: `the Repo categories section lists no repo under ${empty.join(", ")}` };
  return out;
}

/** Is this repo parked in the brain's Repo categories (owner/name and trailing slashes allowed)? */
export function isParkedRepo(repo, cats) {
  const name = bareRepo(repo);
  return Boolean(name && cats && !cats.problem && (cats.parked ?? []).some((r) => r.toLowerCase() === name));
}

/** "mine" | "friends" | "system" | null for a repo name (owner/name and trailing slashes allowed). */
export function categoryOf(repo, cats) {
  const name = bareRepo(repo);
  if (!name || !cats || cats.problem) return null;
  if (name === "~" || name === "bin" || String(repo).trim().startsWith("~/bin")) return cats.system.some((r) => r.toLowerCase() === "seq-bin") ? "system" : null;
  for (const c of CATEGORIES) if (cats[c].some((r) => r.toLowerCase() === name)) return c;
  return null;
}
