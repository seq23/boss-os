/**
 * THE MAPS CHAIN (owner, 8 Nov 2026: "do all the maps we maybe missing"; "looking at the first one
 * should be repos then domains then …"). Every map she reads joins on three keys, so no join is
 * guessed: `repo` (a Repos map row, or "outside"), `business` (a brain slug) and `domain` (a Domains
 * map row). This module is the ONE place those joins are made, for the pages, the CI test
 * and the one guard (tests/infraMaps.test.ts).
 *
 * Read in this order: Repos → Domains → Sites (→ Scorecard, Search Readiness) → Accounts → Emails →
 * Social → Schedule. The new maps carry the keys themselves; the older maps (Email Map, Schedule,
 * Scorecard, Search Readiness) are joined by deriving the key from what their rows already cite
 * (code paths, triggers, jobs, domains). A row whose key cannot be derived is "not linked": counted
 * and shown, never guessed. A key that points at nothing is a problem by name.
 *
 * Pure: no fs, no network. Every check returns problems by name; an empty list is a pass.
 */

export const OUTSIDE = "outside";
export const NOT_LINKED = "not linked";

/** The order she reads them in, with each map's tab. The page's chain strip is drawn from this. */
export const MAP_ORDER = Object.freeze([
  { tab: "repos", label: "Repos" },
  { tab: "domains", label: "Domains" },
  { tab: "sites", label: "Sites" },
  { tab: "accounts", label: "Accounts" },
  { tab: "emails", label: "Emails" },
  { tab: "social", label: "Social" },
  { tab: "schedule", label: "Schedule" },
]);

/** The brain slugs a `business` key may hold (src/shared/boss/brains/brain.mjs BRAINS), plus retired ones that resolve. */
export const BUSINESS_KEYS = Object.freeze(["brokerage", "west-peek-ventures", "west-peek", "porch-and-party", "time-2-read", "spry", "friends", "personal"]);
const RETIRED = { "industry-guides": "spry" };
export const businessKey = (b) => (RETIRED[b] ?? b);

/** The registrable domain of a host (keeps two-label TLDs like .co as they are). */
export function registrable(host) {
  if (!host) return null;
  const h = String(host).toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  const parts = h.split(".");
  return parts.length <= 2 ? h : parts.slice(-2).join(".");
}

// ─── Deriving keys for the older maps ─────────────────────────────────────────────────────────

/** Email Map row → repos, from the code it cites. "~/bin" is seq-bin; "external" is outside any repo. */
export function emailRepos(row) {
  const out = new Set();
  for (const c of row?.code ?? []) {
    const r = c?.repo === "~/bin" ? "seq-bin" : c?.repo === "external" ? OUTSIDE : c?.repo;
    if (r) out.add(r);
  }
  return [...out];
}

/** Schedule row → repos, from its trigger. A Mac label is placed by its prefix or by seq-bin's own list. */
export function scheduleRepos(row, repos) {
  const t = row?.trigger ?? {};
  if (t.repo) return [t.repo];
  if (t.wpos) return ["west-peek-os"];
  const binLabels = new Set((repos?.rows ?? []).find((r) => r.repo === "seq-bin")?.launchd ?? []);
  const out = new Set();
  for (const l of t.launchd ?? []) {
    if (/^com\.howweknow\./.test(l)) out.add("how-we-know");
    else if (/^ventures\.westpeek\.os\./.test(l)) out.add("west-peek-os");
    else if (binLabels.has(l)) out.add("seq-bin");
    else if (/^com\.seq\./.test(l)) out.add("boss-os");
  }
  if (!out.size && t.duty) out.add("boss-os");
  return [...out];
}

/** Scorecard row → repos, through the Schedule jobs it names. */
export function scorecardRepos(row, schedule, repos) {
  const byId = new Map((schedule?.rows ?? []).map((r) => [r.id, r]));
  const out = new Set();
  for (const j of row?.jobs ?? []) for (const r of scheduleRepos(byId.get(j), repos)) out.add(r);
  return [...out];
}

/** Social Map row → repo, through its site's domain in the Sites map. */
export function socialRepos(row, sites) {
  const d = registrable(row?.site);
  const s = (sites?.rows ?? []).find((x) => x.domain === d || (x.aliases ?? []).some((a) => registrable(a) === d));
  return s ? [s.repo] : [];
}

/** Search Readiness grid row → the Sites map row that serves its domain. */
export function readinessSite(grid, sites) {
  return (sites?.rows ?? []).find((s) => s.domain === grid.domain && s.status !== "redirect") ?? null;
}

/** Every site of a scorecard row: the sites its repos serve that carry a Search Readiness row. */
export function scorecardSites(row, ctx) {
  const rs = new Set(scorecardRepos(row, ctx.schedule, ctx.repos));
  const grid = new Set((ctx.readiness?.grid_repos ?? []).map((g) => g.domain));
  return (ctx.sites?.rows ?? []).filter((s) => rs.has(s.repo) && grid.has(s.domain));
}

// ─── Links per repo (the Repos map's counts) ─────────────────────────────────────────────────

/**
 * ctx = { repos, domains, sites, accounts, emails, schedule, scorecard, readiness, social? }.
 * Returns, per repo, the ids each map holds for it.
 */
export function linksByRepo(ctx) {
  const out = new Map();
  const add = (repo, kind, id) => {
    if (!repo || repo === OUTSIDE || repo === NOT_LINKED) return;
    if (!out.has(repo)) out.set(repo, { domains: [], sites: [], accounts: [], emails: [], social: [], schedule: [], scorecard: [], readiness: [] });
    const l = out.get(repo)[kind];
    if (!l.includes(id)) l.push(id);
  };
  for (const d of ctx.domains?.rows ?? []) add(d.repo, "domains", d.domain);
  for (const s of ctx.sites?.rows ?? []) add(s.repo, "sites", s.id);
  for (const a of ctx.accounts?.rows ?? []) for (const r of a.repos ?? []) add(r, "accounts", a.id);
  for (const e of ctx.emails?.rows ?? []) for (const r of emailRepos(e)) add(r, "emails", e.id);
  for (const j of ctx.schedule?.rows ?? []) for (const r of scheduleRepos(j, ctx.repos)) add(r, "schedule", j.id);
  for (const c of ctx.scorecard?.rows ?? []) for (const r of scorecardRepos(c, ctx.schedule, ctx.repos)) add(r, "scorecard", c.id);
  for (const g of ctx.readiness?.grid_repos ?? []) add(g.repo, "readiness", g.domain);
  for (const s of ctx.social?.rows ?? []) for (const r of socialRepos(s, ctx.sites)) add(r, "social", s.id);
  return out;
}

/** The older maps' rows whose repo cannot be derived, by map. Shown and counted; never guessed. */
export function notLinked(ctx) {
  return {
    emails: (ctx.emails?.rows ?? []).filter((e) => !emailRepos(e).length).map((e) => e.id),
    schedule: (ctx.schedule?.rows ?? []).filter((j) => !scheduleRepos(j, ctx.repos).length).map((j) => j.id),
    scorecard: (ctx.scorecard?.rows ?? []).filter((c) => !scorecardRepos(c, ctx.schedule, ctx.repos).length).map((c) => c.id),
    social: (ctx.social?.rows ?? []).filter((s) => !socialRepos(s, ctx.sites).length).map((s) => s.id),
  };
}

// ─── The guard ───────────────────────────────────────────────────────────────────────────────

const req = (row, fields, where) => fields.filter((f) => row?.[f] === undefined || row?.[f] === null || row?.[f] === "").map((f) => `${where}: no ${f}`);
const dupes = (ids, where) => ids.filter((x, i) => ids.indexOf(x) !== i).map((x) => `${where}: ${x} is listed twice`);

/** Shape: required fields, unique keys, known enums. Rule 0: an empty map is a problem. */
export function shapeProblems(ctx) {
  const p = [];
  const { repos, domains, sites, accounts } = ctx;
  for (const [n, m] of [["Repos", repos], ["Domains", domains], ["Sites", sites], ["Accounts", accounts]]) {
    if (!m?.rows?.length) p.push(`the ${n} map has no rows (the guard cannot see anything)`);
    if (!String(m?._note ?? "").includes("same PR")) p.push(`the ${n} map's _note does not say a new row goes in the same PR`);
  }
  const cats = Object.keys(repos?.categories ?? {});
  for (const r of repos?.rows ?? []) {
    p.push(...req(r, ["repo", "label", "category", "business", "what"], `repo ${r.repo}`));
    if (!cats.includes(r.category)) p.push(`repo ${r.repo}: unknown category ${r.category}`);
  }
  p.push(...dupes((repos?.rows ?? []).map((r) => r.repo), "Repos"));
  const dnsKeys = Object.keys(domains?.dns ?? {}), mailKeys = Object.keys(domains?.mail ?? {}), tiers = Object.keys(domains?.tiers ?? {});
  for (const d of domains?.rows ?? []) {
    p.push(...req(d, ["domain", "business", "repo", "registrar", "dns", "mail", "mail_words", "tier", "tier_why"], `domain ${d.domain}`));
    if (!dnsKeys.includes(d.dns)) p.push(`domain ${d.domain}: unknown DNS account ${d.dns}`);
    if (!mailKeys.includes(d.mail)) p.push(`domain ${d.domain}: unknown mail kind ${d.mail}`);
    if (!tiers.includes(d.tier)) p.push(`domain ${d.domain}: unknown tier ${d.tier}`);
  }
  p.push(...dupes((domains?.rows ?? []).map((d) => d.domain), "Domains"));
  const hosts = Object.keys(sites?.hosts ?? {}), statuses = Object.keys(sites?.statuses ?? {});
  for (const s of sites?.rows ?? []) {
    p.push(...req(s, ["id", "name", "url", "business", "repo", "host", "project", "deploy", "status"], `site ${s.id}`));
    if (!hosts.includes(s.host)) p.push(`site ${s.id}: unknown host ${s.host}`);
    if (!statuses.includes(s.status)) p.push(`site ${s.id}: unknown status ${s.status}`);
    if (!s.domain && !s.no_domain_why) p.push(`site ${s.id}: no domain and no reason why`);
  }
  p.push(...dupes((sites?.rows ?? []).map((s) => s.id), "Sites"));
  const owners = Object.keys(accounts?.owners ?? {});
  for (const a of accounts?.rows ?? []) {
    p.push(...req(a, ["id", "service", "owner", "business", "used_by", "security"], `account ${a.id}`));
    if (!owners.includes(a.owner)) p.push(`account ${a.id}: unknown owner key ${a.owner}`);
    if (!Array.isArray(a.repos) || !a.repos.length) p.push(`account ${a.id}: no repo (say "outside" when no repo uses it)`);
    if (!Array.isArray(a.vault_keys)) p.push(`account ${a.id}: vault_keys is not a list`);
  }
  p.push(...dupes((accounts?.rows ?? []).map((a) => a.id), "Accounts"));
  p.push(...dupes((accounts?.rows ?? []).flatMap((a) => a.vault_keys ?? []), "Accounts vault keys"));
  return p;
}

/**
 * The chain: every row of every map resolves to a repo (or says "outside"), a business and, where it
 * names one, a domain or site that exists. A key pointing at nothing is a problem by name.
 */
export function chainProblems(ctx) {
  const p = [];
  const repoSet = new Set((ctx.repos?.rows ?? []).map((r) => r.repo));
  const okRepo = (r) => r === OUTSIDE || repoSet.has(r);
  const okBiz = (b) => BUSINESS_KEYS.includes(businessKey(b));
  const domainSet = new Set((ctx.domains?.rows ?? []).map((d) => d.domain));
  const siteSet = new Set((ctx.sites?.rows ?? []).map((s) => s.id));
  for (const r of ctx.repos?.rows ?? []) if (!okBiz(r.business)) p.push(`repo ${r.repo}: business ${r.business} is not a brain`);
  for (const d of ctx.domains?.rows ?? []) {
    if (!okRepo(d.repo)) p.push(`domain ${d.domain}: repo ${d.repo} is not on the Repos map`);
    if (!okBiz(d.business)) p.push(`domain ${d.domain}: business ${d.business} is not a brain`);
    if (d.site && !siteSet.has(d.site)) p.push(`domain ${d.domain}: site ${d.site} is not on the Sites map`);
    if (d.redirects_to && !domainSet.has(registrable(d.redirects_to))) p.push(`domain ${d.domain}: forwards to ${d.redirects_to}, which is not on the Domains map`);
  }
  for (const s of ctx.sites?.rows ?? []) {
    if (!okRepo(s.repo)) p.push(`site ${s.id}: repo ${s.repo} is not on the Repos map`);
    if (!okBiz(s.business)) p.push(`site ${s.id}: business ${s.business} is not a brain`);
    for (const h of [s.domain, ...(s.aliases ?? [])].filter(Boolean)) if (!domainSet.has(registrable(h))) p.push(`site ${s.id}: ${h} is not on the Domains map`);
  }
  for (const a of ctx.accounts?.rows ?? []) {
    for (const r of a.repos ?? []) if (!okRepo(r)) p.push(`account ${a.id}: repo ${r} is not on the Repos map`);
    if (!okBiz(a.business)) p.push(`account ${a.id}: business ${a.business} is not a brain`);
  }
  for (const e of ctx.emails?.rows ?? []) for (const r of emailRepos(e)) if (!okRepo(r)) p.push(`Email Map ${e.id}: repo ${r} is not on the Repos map`);
  for (const j of ctx.schedule?.rows ?? []) for (const r of scheduleRepos(j, ctx.repos)) if (!okRepo(r)) p.push(`Schedule ${j.id}: repo ${r} is not on the Repos map`);
  for (const s of ctx.social?.rows ?? []) for (const r of socialRepos(s, ctx.sites)) if (!okRepo(r)) p.push(`Social Map ${s.id}: repo ${r} is not on the Repos map`);
  for (const g of ctx.readiness?.grid_repos ?? []) {
    const s = readinessSite(g, ctx.sites);
    if (!s) p.push(`Search Readiness ${g.domain}: no Sites map row serves it`);
    else if (s.repo !== g.repo) p.push(`Search Readiness ${g.domain}: its repo is ${g.repo}, the Sites map says ${s.repo}`);
  }
  if (!(ctx.readiness?.grid_repos ?? []).length) p.push("Search Readiness has no sites (the guard cannot see anything)");
  return p;
}

/** Seq-bin's launchd list holds only labels the Schedule cites, and every Mac label boss-os does not define is placed. */
export function launchdProblems(ctx, bossLabels) {
  const p = [];
  const bin = (ctx.repos?.rows ?? []).find((r) => r.repo === "seq-bin")?.launchd ?? [];
  if (!bin.length) p.push("the seq-bin row lists no launchd labels (the guard cannot see anything)");
  const cited = new Set((ctx.schedule?.rows ?? []).flatMap((j) => j.trigger?.launchd ?? []));
  for (const l of bin) if (!cited.has(l)) p.push(`seq-bin lists ${l}, which the Schedule does not cite`);
  for (const l of cited) if (/^com\.seq\./.test(l) && !bossLabels.has(l) && !bin.includes(l)) p.push(`Schedule label ${l} is not defined in boss-os and is not on seq-bin's list`);
  return p;
}

/**
 * Addresses are written MASKED, the owner's way (8 Nov 2026): the first two letters of the local part,
 * "**", then "@" and the full domain (st**@time-2-read.com). She can tell which inbox it is; the full
 * address is never written (the repo is public). Any other x@y.z in a map is a problem. Handles like
 * @howweknowdeep are not addresses.
 */
export const ADDRESS = /([A-Za-z0-9._%+*-]+)@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
export const MASKED_LOCAL = /^[A-Za-z0-9._%+-]{1,2}\*\*$/;
export function unmaskedAddresses(map) {
  return [...JSON.stringify(map ?? {}).matchAll(ADDRESS)].filter((m) => !MASKED_LOCAL.test(m[1])).map((m) => m[0]);
}
export function privacyProblems(name, map) {
  return unmaskedAddresses(map).map((a) => `the ${name} map holds an unmasked address (${a.slice(0, 2)}…); write it as ${a.slice(0, 2)}**@${a.split("@")[1]}`);
}

/** The words a page shows for a count link: "3 emails ›". */
export function countWords(n, one, many) {
  return `${n} ${n === 1 ? one : many} ›`;
}
