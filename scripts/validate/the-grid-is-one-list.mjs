#!/usr/bin/env node
/**
 * THE GRID IS ONE LIST: sites.json's grid sites, and grid.mjs is only a view of it.
 *
 * ─── Her ruling, 10 Nov 2026 (spry brain, Settled decisions) ───────────────
 *
 * "The grid" is every site in `src/shared/boss/searchReadiness/sites.json` `grid_repos` (groups
 * divine_9 / support / friends) plus Whisper Almanac, a YouTube channel with no website
 * (recorded in `_groups.gaps` with its `repo` and `handle`). It replaces the 29 Aug 2026 table.
 *
 * ─── Why a validator ───────────────────────────────────────────────────────
 *
 * Before this, `grid.mjs` kept its own table and this validator kept a THIRD copy as a fixture. Both
 * drifted from sites.json (spryexecutiveos still in after she dropped it; keepmyproof, aplayermode,
 * memphisseniorcarehomes, the three libraries and two friends' sites missing), so "the grid" meant a
 * different set depending on which file a job read. Now grid.mjs derives from sites.json and this
 * guards the behaviour, not a copy:
 *
 *   0. RULE 0: the grid and sites.json's grid sites are non-empty, and exclusions are named.
 *   1. Every grid site and channel in sites.json is in grid.mjs's view, with its repo; and every
 *      repo, domain and handle in grid.mjs's view is in sites.json. Nothing added or lost on the way.
 *   2. Her rulings for what gets no search work never reach the grid: `never` (West Peek, Shirley
 *      Brown, WHA), `excluded` repos, `dropped` domains (spryexecutiveos.com). And grid.mjs's own
 *      scope exclusions (west-peek …) refuse every form a repo arrives in, and never a grid repo.
 *   3. A domain with a repo is never "no repo" (25 Oct 2026: time-2-read.com was marked repo-less while
 *      `dailystory` served it, so its audit failures were filed under "no repo" and never fixed).
 *      NEVER_IN_GRID names west-peek-os, westpeek-live and boss-os (owner, 10 Nov 2026).
 *   4. Tier and owner follow the group: friends → client, support → infrastructure, the generator →
 *      secondary; only primary properties may propose work to her.
 *
 *   node scripts/validate/the-grid-is-one-list.mjs
 *   node scripts/validate/the-grid-is-one-list.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GRID_FILE = "src/shared/boss/grid.mjs";
const SITES_FILE = "src/shared/boss/searchReadiness/sites.json";
const NAME = "the-grid-is-one-list";

const low = (s) => String(s ?? "").toLowerCase();

/**
 * NAMED, NEVER MERELY ABSENT (owner, 10 Nov 2026). These repos are never in the grid or any search
 * group, so a "portfolio-wide" scope can never pick them up: West Peek OS (a different business),
 * westpeek-live (the events app, a support system that gets no search work) and Boss OS itself.
 */
export const NEVER_IN_GRID = Object.freeze(["west-peek-os", "west-peek-network-os", "westpeek-live", "boss-os"]);

export function check({ GRID, EXCLUDED, isExcluded, suggestingKeys, sites, gridChannels }) {
  const problems = [];
  const rows = Array.isArray(sites?.grid_repos) ? sites.grid_repos : [];

  // ── 0. RULE 0 ──────────────────────────────────────────────────────────────
  if (rows.length === 0) problems.push(`${SITES_FILE} lists no grid sites, so the grid would be empty while every job reading it reports success.`);
  if (!Array.isArray(GRID) || GRID.length === 0) {
    problems.push(`${GRID_FILE} derives no grid. Everything downstream — the side-hustle slot, the daily examination, the repo-change lane — would scan nothing while reporting success.`);
    return problems;
  }
  if (!Array.isArray(EXCLUDED) || EXCLUDED.length === 0) {
    problems.push(`${GRID_FILE} names no exclusions. On 29 Aug 2026 an agent working "portfolio-wide" merged into west-peek-network-os; an exclusion that is only an absence cannot stop that.`);
  }

  // ── 1. One list: sites.json ⇄ grid.mjs, both ways ──────────────────────────
  const gridDomains = new Map(); // domain → property
  const gridRepos = new Set();
  const gridHandles = new Map();
  for (const p of GRID) {
    for (const d of p.domains ?? []) gridDomains.set(low(d), p);
    for (const r of p.repos ?? []) gridRepos.add(low(r));
    for (const h of p.handles ?? []) gridHandles.set(low(h), p);
  }
  const channels = typeof gridChannels === "function" ? gridChannels(sites) : [];
  const siteDomains = new Set(rows.map((r) => low(r.domain)).filter(Boolean));
  const siteRepos = new Set([...rows.map((r) => low(r.repo)), ...channels.map((c) => low(c.repo))].filter(Boolean));
  const siteHandles = new Set(channels.map((c) => low(c.handle)));

  for (const r of rows) {
    const p = gridDomains.get(low(r.domain));
    if (!p) { problems.push(`${r.domain} is a grid site in ${SITES_FILE} and is missing from ${GRID_FILE}'s grid.`); continue; }
    if (r.repo && !(p.repos ?? []).map(low).includes(low(r.repo))) problems.push(`${r.domain} is served by \`${r.repo}\` in ${SITES_FILE}, but its grid property \`${p.key}\` does not carry that repo.`);
  }
  for (const c of channels) {
    const p = gridHandles.get(low(c.handle));
    if (!p) problems.push(`${c.business} (${c.handle}) is a grid channel in ${SITES_FILE} and is missing from ${GRID_FILE}'s grid.`);
    else if (!(p.repos ?? []).map(low).includes(low(c.repo))) problems.push(`${c.handle} is made in \`${c.repo}\`, but its grid property \`${p.key}\` does not carry that repo.`);
  }
  if (!channels.some((c) => low(c.handle) === "@whisperalmanac")) {
    problems.push(`Whisper Almanac (@whisperalmanac, repo how-we-know) is not a grid channel in ${SITES_FILE}'s _groups.gaps. Her ruling (10 Nov 2026) puts it in the grid.`);
  }
  for (const [d, p] of gridDomains) if (!siteDomains.has(d)) problems.push(`\`${p.key}\` carries ${d}, which is not a grid site in ${SITES_FILE}. A second list has crept back in.`);
  for (const r of gridRepos) if (!siteRepos.has(r)) problems.push(`The grid carries the repo \`${r}\`, which no grid site or channel in ${SITES_FILE} names. A repo added here starts proposing work to her.`);
  for (const [h, p] of gridHandles) if (!siteHandles.has(h)) problems.push(`\`${p.key}\` carries the handle ${h}, which no grid channel in ${SITES_FILE} names.`);

  // ── 2. Her exclusions never reach the grid ─────────────────────────────────
  const never = (sites?.never ?? []).map(low).filter(Boolean);
  const excludedRepos = (sites?.excluded ?? []).map((x) => low(x.repo)).filter(Boolean);
  const dropped = (sites?.dropped ?? []).map((x) => low(x.domain)).filter(Boolean);
  if (!never.some((n) => n.startsWith("westpeek"))) problems.push(`${SITES_FILE} "never" no longer names West Peek. Her ruling: never anything West Peek.`);
  for (const p of GRID) {
    const words = [p.key, p.label, ...(p.businesses ?? []), ...(p.repos ?? []), ...(p.domains ?? [])].map(low);
    for (const n of never) if (words.some((w) => w.includes(n))) problems.push(`\`${p.key}\` touches "${n}", which ${SITES_FILE} says is NEVER searched or worked.`);
    for (const r of p.repos ?? []) {
      if (excludedRepos.includes(low(r))) problems.push(`\`${p.key}\` carries \`${r}\`, which ${SITES_FILE} excludes: ${(sites.excluded.find((x) => low(x.repo) === low(r)) ?? {}).why ?? ""}`);
      if (typeof isExcluded === "function" && isExcluded(r)) problems.push(`\`${r}\` is a grid repo and ${GRID_FILE}'s isExcluded refuses it — a grid property would be refused as out of scope.`);
    }
    for (const d of p.domains ?? []) if (dropped.includes(low(d))) problems.push(`\`${p.key}\` carries ${d}, which she dropped from Search Readiness.`);
  }
  if (typeof isExcluded === "function") {
    for (const form of ["west-peek-network-os", "seq23/west-peek-network-os", "/Users/x/GitHub/west-peek-os", "CourtScope_api"]) {
      if (!isExcluded(form)) problems.push(`isExcluded("${form}") returned false. It is out of scope in every form it can arrive in, or it is not out of scope.`);
    }
  } else problems.push(`${GRID_FILE} exports no \`isExcluded\`, so nothing can enforce the exclusions in practice.`);
  for (const e of EXCLUDED ?? []) if (!String(e.why ?? "").trim()) problems.push(`The exclusion "${e.match}" gives no reason.`);

  for (const name of NEVER_IN_GRID) {
    if (gridRepos.has(name) || rows.some((r) => low(r.repo) === name) || channels.some((c) => low(c.repo) === name)) {
      problems.push(`\`${name}\` is in the grid or a search group. Owner, 10 Nov 2026: West Peek OS, westpeek-live and Boss OS are never grid properties and never get search work.`);
    }
  }
  if (typeof isExcluded === "function") {
    for (const name of ["west-peek-os", "westpeek-live"]) if (!isExcluded(name)) problems.push(`isExcluded("${name}") returned false. West Peek is a hard stop in every spelling.`);
  }

  // ── 3. A domain with a repo is never "no repo" ─────────────────────────────
  for (const r of rows) if (r.domain && !r.repo) problems.push(`${SITES_FILE} gives ${r.domain} no repo. A site marked "no repo" never gets its audit failures fixed; name its repo.`);
  const repoOf = new Map(rows.filter((r) => r.repo).map((r) => [low(r.domain), r.repo]));
  for (const p of GRID) {
    for (const d of p.domains_without_repo ?? []) if (repoOf.has(low(d))) problems.push(`\`${p.key}\` records ${d} as having no repo, but ${SITES_FILE} serves it from seq23/${repoOf.get(low(d))}.`);
    for (const [d, r] of Object.entries(p.domain_repos ?? {})) {
      if (!(p.repos ?? []).includes(r)) problems.push(`\`${p.key}\` maps ${d} to \`${r}\`, which is not in its own repos list.`);
      const want = repoOf.get(low(d));
      if (want && want !== r) problems.push(`\`${p.key}\` maps ${d} to \`${r}\`; ${SITES_FILE} says \`${want}\`.`);
    }
    if ((p.domains ?? []).length > 1 && (p.repos ?? []).length > 1) {
      for (const d of p.domains) if (!(p.domain_repos ?? {})[d]) problems.push(`\`${p.key}\` has several repos and no repo for ${d}.`);
    }
  }

  // ── 4. Tier and owner follow the group; only primary suggests ──────────────
  const groupOf = new Map(rows.map((r) => [low(r.domain), r.group]));
  for (const c of channels) groupOf.set(low(c.handle), c.group);
  const gen = new Set(rows.filter((r) => (r.roles ?? []).includes("generator")).map((r) => low(r.domain)));
  for (const p of GRID) {
    const groups = [...new Set([...(p.domains ?? []), ...(p.handles ?? [])].map((x) => groupOf.get(low(x))).filter(Boolean))];
    if (groups.length !== 1) { problems.push(`\`${p.key}\` spans groups [${groups.join(", ")}]; a grid property belongs to exactly one group.`); continue; }
    const g = groups[0];
    const owner = g === "friends" ? "client" : "hers";
    if (p.owner !== owner) problems.push(`\`${p.key}\` is "${p.owner}" but its group is ${g}, so it is "${owner}". A client property's "needs her" item is a reply in her name on somebody else's site.`);
    const tier = g === "support" ? "infrastructure" : (p.domains ?? []).some((d) => gen.has(low(d))) ? "secondary" : "primary";
    if (p.tier !== tier) problems.push(`\`${p.key}\` is ${p.tier} but should be ${tier} (group ${g}).`);
  }
  if (typeof suggestingKeys === "function") {
    const s = new Set(suggestingKeys());
    for (const p of GRID) if (p.tier !== "primary" && s.has(p.key)) problems.push(`\`${p.key}\` is ${p.tier} and may still put an item in front of her.`);
    if (s.size === 0) problems.push(`suggestingKeys() is empty, so the side-hustle slot can never produce anything.`);
  } else problems.push(`${GRID_FILE} exports no \`suggestingKeys\`.`);

  return problems;
}

// ─── Self-test: negative proofs against mutated copies of the real files ────

async function selfTest(mod, realSites) {
  const clone = () => JSON.parse(JSON.stringify(realSites));
  const view = (sites, mutateGrid) => {
    const GRID = mod.deriveGrid(sites);
    if (mutateGrid) mutateGrid(GRID);
    const suggestingKeys = () => GRID.filter((p) => p.tier === "primary").map((p) => p.key);
    return { GRID, EXCLUDED: mod.EXCLUDED, isExcluded: mod.isExcluded, suggestingKeys, sites, gridChannels: mod.gridChannels };
  };
  const withSites = (f) => { const s = clone(); f(s); return s; };
  const cases = [
    { name: "the real files pass", input: view(clone()), expect: 0 },
    {
      name: "THE CASE THAT MADE THIS A RULE: local-guides-generator dropped from the grid view, losing six sites",
      input: view(clone(), (G) => { const i = G.findIndex((p) => p.repos.includes("local-guides-generator")); G.splice(i, 1); }),
      expect: 1,
    },
    { name: "a repo sites.json never names added to the grid view", input: view(clone(), (G) => G.push({ key: "extra", label: "x", domains: [], repos: ["some-experiment"], owner: "hers", tier: "primary" })), expect: 1 },
    { name: "a domain sites.json never names added to a grid property", input: view(clone(), (G) => G.find((p) => p.key === "hpc").domains.push("stale-second-list.com")), expect: 1 },
    { name: "THE STALE FIXTURE: spryexecutiveos.com (dropped) back in grid_repos", input: view(withSites((s) => s.grid_repos.push({ ...s.grid_repos.find((r) => r.domain === "billionairehighperformancecoach.com"), domain: "spryexecutiveos.com" }))), expect: 1 },
    { name: "a West Peek site (never) in grid_repos", input: view(withSites((s) => s.grid_repos.push({ domain: "westpeek.live", repo: "westpeek-live", group: "divine_9", business: "How We Know" }))), expect: 1 },
    { name: "an excluded repo (charm-nest) in grid_repos", input: view(withSites((s) => s.grid_repos.push({ domain: "charmnest.example", repo: "charm-nest", group: "friends", business: "Horse" }))), expect: 1 },
    { name: "boss-os added as a support site", input: view(withSites((s) => s.grid_repos.push({ domain: "boss.example", repo: "boss-os", group: "support", business: "Authority backlink network" }))), expect: 1 },
    { name: "westpeek-live added as a support site", input: view(withSites((s) => s.grid_repos.push({ domain: "events.example", repo: "westpeek-live", group: "support", business: "Authority backlink network" }))), expect: 1 },
    { name: "the westpeek (no hyphen) exclusion removed", input: (() => { const v = view(clone()); v.EXCLUDED = mod.EXCLUDED.filter((e) => e.match !== "westpeek"); v.isExcluded = (r) => { const n = low(r).split("/").pop(); return v.EXCLUDED.some((e) => n.startsWith(low(e.match))); }; return v; })(), expect: 1 },
    { name: "West Peek removed from sites.json never", input: view(withSites((s) => { s.never = s.never.filter((n) => !n.startsWith("westpeek")); })), expect: 1 },
    { name: "Whisper Almanac's handle dropped from the gaps", input: view(withSites((s) => { s._groups.gaps["Whisper Almanac"] = "no site yet"; })), expect: 1 },
    { name: "Whisper Almanac dropped from the grid view only", input: view(clone(), (G) => { const i = G.findIndex((p) => (p.handles ?? []).includes("@whisperalmanac")); G.splice(i, 1); }), expect: 1 },
    { name: "THE 25 OCT CASE: sites.json gives time-2-read.com no repo", input: view(withSites((s) => { s.grid_repos.find((r) => r.domain === "time-2-read.com").repo = null; })), expect: 1 },
    {
      name: "THE 25 OCT CASE: the grid view marks time-2-read.com as having no repo",
      input: view(clone(), (G) => { const p = G.find((x) => x.domains.includes("time-2-read.com")); p.repos = p.repos.filter((r) => r !== "dailystory"); delete p.domain_repos["time-2-read.com"]; p.domains_without_repo = ["time-2-read.com"]; }),
      expect: 1,
    },
    { name: "the grid view maps time-2-read.com to the wrong repo", input: view(clone(), (G) => { G.find((x) => x.domains.includes("time-2-read.com")).domain_repos["time-2-read.com"] = "heygetonmylevel"; }), expect: 1 },
    { name: "a friends' site recorded as hers", input: view(clone(), (G) => { G.find((p) => p.key === "hicks_consulting").owner = "hers"; }), expect: 1 },
    { name: "the generator promoted to primary", input: view(clone(), (G) => { G.find((p) => p.key === "guides_generator").tier = "primary"; }), expect: 1 },
    { name: "support (authority network) allowed to propose work", input: (() => { const v = view(clone()); v.suggestingKeys = () => v.GRID.map((p) => p.key); return v; })(), expect: 1 },
    { name: "a grid repo refused by isExcluded", input: (() => { const v = view(clone()); v.isExcluded = (r) => String(r).includes("west-peek") || String(r).toLowerCase().includes("courtscope") || r === "approvalprep"; return v; })(), expect: 1 },
    { name: "RULE 0 — sites.json with no grid sites", input: view(withSites((s) => { s.grid_repos = []; s._groups.gaps = {}; })), expect: 1 },
    { name: "RULE 0 — an empty grid view", input: view(clone(), (G) => G.splice(0)), expect: 1 },
    { name: "RULE 0 — no exclusions", input: (() => { const v = view(clone()); v.EXCLUDED = []; return v; })(), expect: 1 },
  ];
  let failed = 0;
  for (const c of cases) {
    const found = check(c.input);
    const ok = c.expect === 0 ? found.length === 0 : found.length >= 1;
    if (!ok) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found.length}`);
      for (const p of found) console.error(`          • ${p}`);
    }
  }
  if (failed) { console.error(`\n${NAME} self-test: ${failed}/${cases.length} fixtures wrong.`); process.exit(1); }
  console.log(`${NAME} self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

let mod, sites;
try {
  mod = await import(join(ROOT, GRID_FILE));
  sites = JSON.parse(readFileSync(join(ROOT, SITES_FILE), "utf8"));
} catch (err) {
  console.error(`${NAME} FAILED — could not read ${GRID_FILE} or ${SITES_FILE}: ${err?.message ?? err}`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest(mod, sites);
} else {
  const problems = check({ ...mod, sites });
  if (problems.length) {
    console.error(`${NAME} FAILED\n`);
    for (const p of problems) console.error(`  • ${p}\n`);
    console.error(`"The grid" is her defined term (owner, 10 Nov 2026): the grid sites in ${SITES_FILE} plus Whisper Almanac.\nThat file is the one list; ${GRID_FILE} only derives from it.\n`);
    process.exit(1);
  }
  const sitesN = mod.GRID.reduce((n, p) => n + (p.domains?.length ?? 0), 0);
  const channelsN = mod.GRID.reduce((n, p) => n + (p.handles?.length ?? 0), 0);
  console.log(`${NAME}: ${mod.GRID.length} grid properties — ${sitesN} sites and ${channelsN} channel(s) across ${mod.gridRepos().length} repositories, all from ${SITES_FILE}; ${mod.suggestingKeys().length} may propose work to her; ${mod.EXCLUDED.length} exclusions named. OK.`);
}
