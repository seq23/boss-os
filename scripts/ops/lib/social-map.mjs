/**
 * THE SOCIAL MAP'S GUARD (owner, 8 Nov 2026: "a canonical map of what repos and sites have social
 * media pages"). src/shared/boss/socialMap/manifest.json is the one list the page renders; this module
 * keeps it true. Every check returns problems by name; an empty list is a pass.
 *
 * Read by tests/socialMap.test.ts (CI: this repo's posting files and the Schedule manifest) and by
 * scripts/ops/social-map-check.mjs (`npm run social-map:check`, her Mac: every grid site's entity.json
 * sameAs and every repo's posting code on its default branch, each URL, each live_auto job's last run),
 * which the Sunday cohesion check also runs for one clause of Simone's Monday line.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const STATUSES = Object.freeze(["live_auto", "live_manual", "planned", "paused", "dead", "never"]);
/** The page's sections. Every group but "other" is a key of sites.json `_groups`, the one place groups are named. */
export const PAGE_SECTIONS = Object.freeze([
  { key: "mine", label: "Your businesses", groups: ["selling", "divine_9", "other"] },
  { key: "support", label: "Support systems", groups: ["support"] },
  { key: "friends", label: "Friends' sites", groups: ["friends"] },
]);

/**
 * What counts as POSTING to a social account: a platform's write endpoint, or a Pinterest RSS feed
 * file (Pinterest auto-publish reads it, so the feed IS the poster). A new poster reaches one of these.
 */
export const POSTING_PATTERNS = [
  /api\.buffer\.com|api\.bufferapp\.com/,
  /videos\(\)\.insert|\bvideos\.insert\b|upload\/youtube\/v3\/videos|youtube\/v3\/videos\?[^"'`\s]*part=/,
  /com\.atproto\.repo\.createRecord/,
  /blogger\/v3\/blogs\/[^"'`\s]*\/posts/,
  /public-api\.wordpress\.com\/rest\/v1(\.\d)?\/sites\/[^"'`\s]*\/posts\/new/,
  /graph\.facebook\.com\/[^"'`\s]*\/(feed|photos|videos)\b|\bmedia_publish\b/,
  /open\.tiktokapis\.com\/v2\/post/,
  /api\.pinterest\.com\/v5\/pins/,
  /api\.(twitter|x)\.com\/2\/tweets/,
  /api\.linkedin\.com\/(v2\/ugcPosts|rest\/posts)/,
];
export const PIN_FEED_PATH = /(^|\/)pinfeed[^/]*(\/|$)/;

/** Code files only; tests, fixtures, validators, docs, data and type stubs name platforms without posting. */
export function isScanned(file) {
  if (!/\.(ts|tsx|mjs|js|cjs|sh|py)$/.test(file)) return false;
  if (/\.d\.m?ts$/.test(file) || /\.test\.[a-z]+$/.test(file) || /(^|\/)node_modules\//.test(file)) return false;
  if (/^(public|dist|build)\//.test(file)) return false;
  return !/^(tests?|e2e|docs|content|data)\//.test(file) && !/(^|\/)(__tests__|fixtures?|tests?|validators?|scripts\/validat[a-z]*)\//.test(file);
}
export const posts = (file, source) => PIN_FEED_PATH.test(file) || POSTING_PATTERNS.some((re) => re.test(source));

/** Every path the manifest cites in one repo. */
export function citedIn(manifest, repo) {
  return new Set((manifest.rows ?? []).flatMap((r) => (r.posts?.code ?? []).filter((c) => c.repo === repo).flatMap((c) => c.paths ?? [])));
}
const exemptIn = (manifest, repo) => new Set((manifest.code_exempt ?? []).filter((e) => e.repo === repo).map((e) => e.path));

/** Files that post and that no row cites (nor exempts), by name. Rule 0: zero files scanned is a problem. */
export function uncoveredCode(files, manifest, repo) {
  const scanned = files.filter(({ file }) => isScanned(file));
  if (!scanned.length) return [`${repo}: no code file was scanned (the guard cannot see anything)`];
  const cited = citedIn(manifest, repo);
  const exempt = exemptIn(manifest, repo);
  return scanned.filter(({ file, source }) => posts(file, source) && !cited.has(file) && !exempt.has(file))
    .map(({ file }) => `${repo}: ${file} posts to a social account and no Social Map row cites it`);
}

/** An exemption whose file is gone or no longer posts is stale (exemptions cannot rot). */
export function staleExemptions(files, manifest, repo) {
  const byPath = new Map(files.map((f) => [f.file, f.source]));
  return (manifest.code_exempt ?? []).filter((e) => e.repo === repo).flatMap((e) => {
    if (!byPath.has(e.path)) return [`${repo}: exempt ${e.path} no longer exists`];
    return posts(e.path, byPath.get(e.path)) ? [] : [`${repo}: exempt ${e.path} no longer posts (drop the exemption)`];
  });
}

/** A Schedule job that posts (by its plain words) is in some row's `posts.jobs`, or exempt with a reason. */
export const POSTING_JOB_RE = /pinterest|social|auto-?post|\bupload|\bshorts?\b|posting|marketplace|tiktok|instagram|bluesky|wordpress|blogger|buffer/i;
export function uncoveredJobs(schedule, manifest) {
  const rows = schedule?.rows ?? [];
  if (!rows.length) return ["the Schedule manifest has no rows (the guard cannot see anything)"];
  const cited = new Set((manifest.rows ?? []).flatMap((r) => r.posts?.jobs ?? []));
  const exempt = new Set((manifest.schedule_exempt ?? []).map((e) => e.id));
  const ids = new Set(rows.map((r) => r.id));
  const out = [];
  const matched = rows.filter((r) => POSTING_JOB_RE.test(`${r.name} ${r.what ?? ""}`));
  if (!matched.length) out.push("no Schedule job reads as posting (POSTING_JOB_RE went stale)");
  for (const r of matched) if (!cited.has(r.id) && !exempt.has(r.id)) out.push(`Schedule job ${r.id} ("${r.name}") posts and no Social Map row lists it in posts.jobs`);
  for (const id of cited) if (!ids.has(id)) out.push(`a Social Map row lists Schedule job ${id}, which is not on the Schedule`);
  for (const id of exempt) if (!ids.has(id)) out.push(`schedule_exempt ${id} is not on the Schedule`);
  return out;
}

/** The URL key two lists compare by: lower-case host without www., no query noise, no trailing slash. */
export function urlKey(u) {
  try {
    const x = new URL(String(u).trim());
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${x.pathname.replace(/\/+$/, "").toLowerCase()}${x.search}`;
  } catch { return String(u).trim().toLowerCase(); }
}
/** A person's own profile is never a business account (public repo: no private people). */
export const PERSON_PROFILE = /(^|\.)linkedin\.com\/in\//;
const isPersonNode = (n) => [].concat(n?.["@type"] ?? []).some((t) => /person/i.test(String(t)));

/** Every sameAs and pending profile URL in an entity file, skipping Person nodes and person profiles. */
export function profileUrls(json) {
  const out = new Set();
  const walk = (x) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (isPersonNode(x)) return;
    for (const [k, v] of Object.entries(x)) {
      if (k === "sameAs") for (const u of [].concat(v ?? [])) { if (typeof u === "string" && /^https?:\/\//.test(u)) out.add(u); }
      else if (k === "profiles_pending" && Array.isArray(v)) for (const p of v) { if (typeof p?.url === "string") out.add(p.url); }
      else if (k !== "founder" && k !== "author" && k !== "employee" && k !== "member") walk(v);
    }
  };
  walk(json);
  return [...out].filter((u) => !PERSON_PROFILE.test(urlKey(u)));
}

/** Entity files' profiles that no row lists, by name. `docs` = [{ repo, path, json }]. Rule 0 on zero. */
export function uncoveredSameAs(docs, manifest) {
  if (!docs.length) return ["no entity file was read (the guard cannot see anything)"];
  const known = new Set((manifest.rows ?? []).filter((r) => r.url).map((r) => urlKey(r.url)));
  const out = [];
  let seen = 0;
  for (const d of docs) for (const u of profileUrls(d.json)) {
    seen++;
    if (!known.has(urlKey(u))) out.push(`${d.repo}: ${d.path} lists ${u} and no Social Map row has that URL`);
  }
  if (!seen) out.push("the entity files hold no sameAs at all (the scan went stale)");
  return out;
}

/** The shape every row must have; a row the page cannot show fully is a problem by name. */
export function shapeProblems(manifest, sites) {
  const out = [];
  const gridGroups = sites?._groups ?? {};
  const groupKeys = new Set([...Object.keys(gridGroups).filter((k) => Array.isArray(gridGroups[k])), "other"]);
  if (groupKeys.size < 2) out.push("sites.json _groups was not read (no group to check against)");
  for (const g of Object.keys(manifest.groups ?? {})) if (!groupKeys.has(g)) out.push(`group ${g} is not a sites.json _groups key`);
  const biz = new Map();
  for (const b of manifest.businesses ?? []) {
    if (biz.has(b.key)) out.push(`business ${b.key}: duplicate key`);
    biz.set(b.key, b);
    if (!manifest.groups?.[b.group]) out.push(`business ${b.key}: group ${b.group} is not one of the map's groups`);
    const grid = b.grid_business;
    if (grid) {
      const home = Object.entries(gridGroups).find(([, list]) => Array.isArray(list) && list.includes(grid))?.[0];
      if (!home) out.push(`business ${b.key}: ${grid} is not in sites.json _groups`);
      else if (home !== b.group) out.push(`business ${b.key}: sites.json puts ${grid} in ${home}, the map says ${b.group}`);
    }
  }
  const ids = new Set();
  for (const r of manifest.rows ?? []) {
    const id = r.id ?? "(no id)";
    if (ids.has(r.id)) out.push(`${id}: duplicate id`);
    ids.add(r.id);
    for (const f of ["id", "business", "site", "platform", "status", "decision"]) if (typeof r[f] !== "string" || !r[f].trim()) out.push(`${id}: ${f} is empty`);
    if (!biz.has(r.business)) out.push(`${id}: business ${r.business} is not one of the map's businesses`);
    if (!STATUSES.includes(r.status)) out.push(`${id}: status ${r.status} is not one of ${STATUSES.join(", ")}`);
    if (!r.posts || !["job", "hand", "none"].includes(r.posts.by) || !String(r.posts.what ?? "").trim()) out.push(`${id}: posts must say by (job, hand or none) and what`);
    if (r.url != null && !/^https:\/\//.test(r.url)) out.push(`${id}: url ${r.url} is not https`);
    if ((r.status === "live_auto" || r.status === "live_manual") && !r.url && !r.no_url_why) out.push(`${id}: a live account needs its url (or no_url_why)`);
    if (r.status === "live_auto") {
      if (r.posts?.by !== "job") out.push(`${id}: live_auto but no job posts to it`);
      if (!r.posts?.check) out.push(`${id}: live_auto needs a check (feed, workflow, launchd or worker with why)`);
    }
    if (r.posts?.by === "job") {
      if (!(r.posts.code ?? []).length) out.push(`${id}: a job row cites no code`);
      for (const c of r.posts.code ?? []) if (!c.repo || !(c.paths ?? []).length) out.push(`${id}: ${c.repo ?? "(no repo)"} cites no path`);
    }
    const ck = r.posts?.check;
    if (ck) {
      if (!["feed", "workflow", "launchd", "worker"].includes(ck.kind)) out.push(`${id}: check kind ${ck.kind} is unknown`);
      if (ck.kind === "feed" && !(ck.feeds ?? []).length) out.push(`${id}: a feed check names no feed`);
      if (ck.kind === "workflow" && !(ck.workflow?.repo && ck.workflow?.file)) out.push(`${id}: a workflow check names no repo and file`);
      if (ck.kind === "launchd" && !ck.label) out.push(`${id}: a launchd check names no label`);
      if (ck.kind === "worker" && !String(ck.why ?? "").trim()) out.push(`${id}: a worker check must say why it cannot be read`);
    }
  }
  for (const b of biz.keys()) if (!(manifest.rows ?? []).some((r) => r.business === b)) out.push(`business ${b} has no rows`);
  for (const e of manifest.code_exempt ?? []) if (!e.repo || !e.path || !String(e.why ?? "").trim()) out.push(`code_exempt ${e.path ?? "(no path)"}: repo, path and why are required`);
  return out;
}

/**
 * WHERE EACH ACCOUNT SITS (her ruling, 8 Nov 2026): every social and blog account is under an address
 * of its own site or brand, never her personal Gmail. `account_email` is a role address on one of the
 * grid's own domains, "<domain> mailbox" (a named mailbox on the brand's domain, not written out),
 * "personal — move" (the personal address itself is never written: public repo), "no account" or "unknown".
 */
export const PERSONAL_MOVE = "personal — move";
export const ROLE_LOCAL = /^(hello|support|info|contact|team|admin|social|press|studio)$/;
/** Addresses are written masked (her ruling, 8 Nov 2026): the first two letters, "**", "@" and the full domain. */
export const MASKED_LOCAL = /^[a-z0-9._%+-]{1,2}\*\*$/;
export function brandDomains(sites) {
  return new Set((sites?.grid_repos ?? []).map((s) => String(s.domain ?? "").toLowerCase().replace(/^www\./, "")).filter(Boolean));
}
export function accountEmailProblems(manifest, sites) {
  const domains = brandDomains(sites);
  if (!domains.size) return ["sites.json lists no domain (the account_email check cannot see anything)"];
  const out = [];
  for (const r of manifest.rows ?? []) {
    const v = r.account_email;
    if (typeof v !== "string" || !v.trim()) { out.push(`${r.id}: account_email is empty (write "unknown" when it is not known)`); continue; }
    if ([PERSONAL_MOVE, "no account", "unknown"].includes(v)) continue;
    const mailbox = /^([a-z0-9.-]+\.[a-z]{2,}) mailbox$/.exec(v);
    if (mailbox) { if (!domains.has(mailbox[1])) out.push(`${r.id}: ${mailbox[1]} is not one of the grid's own domains`); continue; }
    const at = /^([a-z0-9._%+*-]+)@([a-z0-9.-]+\.[a-z]{2,})$/.exec(v);
    if (!at) out.push(`${r.id}: account_email "${v}" is not an address, "<domain> mailbox", "${PERSONAL_MOVE}", "no account" or "unknown"`);
    else if (!domains.has(at[2])) out.push(`${r.id}: ${v} is not on one of the grid's own domains (a personal address is written "${PERSONAL_MOVE}")`);
    else if (MASKED_LOCAL.test(at[1])) continue;
    else if (ROLE_LOCAL.test(at[1])) out.push(`${r.id}: ${v} is written in full; write it masked, ${at[1].slice(0, 2)}**@${at[2]} (her ruling, 8 Nov 2026)`);
    else out.push(`${r.id}: ${v} is a named mailbox; write "${at[2]} mailbox" (no owner addresses in a public repo)`);
  }
  return out;
}
/** The rows still under a personal address: one clause of the Monday cohesion line until they move. */
export const personalMoveRows = (manifest) => (manifest.rows ?? []).filter((r) => r.account_email === PERSONAL_MOVE).map((r) => r.id);

/** Public repo: no email address outside account_email, and no person's own profile. */
export function privacyProblems(manifest) {
  const text = JSON.stringify({ ...manifest, rows: (manifest.rows ?? []).map(({ account_email, ...r }) => r) });
  const out = [];
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[a-z]{2,}/g)) out.push(`${m[0]} looks like an email address`);
  for (const r of manifest.rows ?? []) if (r.url && PERSON_PROFILE.test(urlKey(r.url))) out.push(`${r.id}: ${r.url} is a person's own profile`);
  return out;
}

// ---------------------------------------------------------------- the Mac / CI runner's half

/** Where a repo's checkout lives on her Mac: next to this checkout, or ~/GitHub/<repo>. */
export function repoDir(repo, root, home = homedir()) {
  if (repo === "~/bin") return !process.env.CI && existsSync(path.join(home, "bin")) ? path.join(home, "bin") : null;
  for (const d of [path.resolve(root, "..", repo), path.join(home, "GitHub", repo)]) if (existsSync(path.join(d, ".git"))) return d;
  return null;
}
function defaultRef(dir) {
  try { return execFileSync("git", ["-C", dir, "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { encoding: "utf8" }).trim(); } catch { return "origin/main"; }
}
/** A repo read on its default branch, never a stale working tree. */
export function readRepo(dir) {
  const ref = defaultRef(dir);
  const names = execFileSync("git", ["-C", dir, "ls-tree", "-r", "--name-only", ref], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean);
  const show = (f) => { try { return execFileSync("git", ["-C", dir, "show", `${ref}:${f}`], { encoding: "utf8", maxBuffer: 1 << 26 }); } catch { return null; } };
  return { ref, names, show };
}

/**
 * Every grid site's entity file (sites.json `entity_file`, else every entity.json in its repo) on the
 * repo's default branch, plus every non-client repo's posting code and the cited paths.
 * `repos` = repos to scan for posting code (her own and the system's, from the repo categories).
 */
export function checkOtherRepos(manifest, sites, root, { repos = [], home = homedir() } = {}) {
  const problems = [];
  const docs = [];
  const checked = new Set();
  const missing = new Set();
  const cache = new Map();
  const open = (repo) => {
    if (cache.has(repo)) return cache.get(repo);
    const dir = repoDir(repo, root, home);
    const r = dir ? readRepo(dir) : null;
    cache.set(repo, r);
    if (r) checked.add(repo); else missing.add(repo);
    return r;
  };
  for (const s of sites.grid_repos ?? []) {
    const r = open(s.repo);
    if (!r) continue;
    const paths = s.entity_file ? [s.entity_file] : r.names.filter((f) => /(^|\/)entity\.json$/.test(f) && !/node_modules/.test(f));
    for (const p of paths) {
      if (docs.some((d) => d.repo === s.repo && d.path === p)) continue;
      const raw = r.show(p);
      if (raw == null) { problems.push(`${s.repo}: ${p} is not on ${r.ref}`); continue; }
      try { docs.push({ repo: s.repo, path: p, json: JSON.parse(raw) }); } catch { problems.push(`${s.repo}: ${p} is not JSON`); }
    }
  }
  problems.push(...uncoveredSameAs(docs, manifest));
  const codeRepos = [...new Set([...repos, ...(manifest.rows ?? []).flatMap((x) => (x.posts?.code ?? []).map((c) => c.repo))])].filter((x) => x !== "boss-os");
  for (const repo of codeRepos) {
    if (repo === "~/bin") {
      const dir = repoDir(repo, root, home);
      if (!dir) { missing.add(repo); continue; }
      checked.add(repo);
      for (const p of citedIn(manifest, repo)) if (!existsSync(path.join(dir, p))) problems.push(`~/bin/${p} does not exist`);
      continue;
    }
    const r = open(repo);
    if (!r) continue;
    const have = new Set(r.names);
    for (const p of citedIn(manifest, repo)) if (!have.has(p)) problems.push(`${repo}: ${p} is not on ${r.ref}`);
    const files = r.names.filter(isScanned).map((file) => ({ file, source: r.show(file) ?? "" }));
    problems.push(...uncoveredCode(files, manifest, repo).filter((p) => !/no code file was scanned/.test(p)), ...staleExemptions(files, manifest, repo));
  }
  return { checked: [...checked], missing: [...missing], problems, entityFiles: docs.length };
}

/** How one URL answered: ok, dead (404/410) or unverifiable (a login wall or a refusal is not death). */
export function classifyProbe(status, body = "") {
  if (status === 404 || status === 410) return "dead";
  if (status >= 200 && status < 300) {
    if (/User not found|"statusCode":10202|Sorry, this page isn't available|This account doesn.t exist/i.test(body)) return "dead";
    return "ok";
  }
  return "unverifiable";
}
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
export async function probe(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
    const body = (await res.text()).slice(0, 200_000);
    return { status: res.status, body };
  } catch (e) { return { status: 0, body: String(e?.message ?? e) }; }
}

/** Each URL of a row that should exist: dead is a problem; unverifiable is counted and named, never a pass in disguise. */
export async function checkUrls(manifest, { fetchImpl = fetch } = {}) {
  const out = { ok: [], unverifiable: [], problems: [] };
  for (const r of manifest.rows ?? []) {
    if (!r.url || r.status === "dead" || r.status === "never") continue;
    const p = await probe(r.url, fetchImpl);
    const state = classifyProbe(p.status, p.body);
    if (state === "ok") out.ok.push(r.id);
    else if (state === "unverifiable") out.unverifiable.push(`${r.id} (HTTP ${p.status})`);
    else if (r.status === "planned" && /^None|does not exist|not created/i.test(r.posts?.what ?? "")) out.ok.push(r.id);
    else out.problems.push(`${r.id}: ${r.url} answers ${p.status || "nothing"} as gone, but the map says ${r.status}`);
  }
  return out;
}

/** Newest <pubDate> in an RSS body, as ms, or null. */
export function newestPubDate(xml) {
  const ds = [...String(xml).matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => Date.parse(m[1])).filter(Number.isFinite);
  return ds.length ? Math.max(...ds) : null;
}

/**
 * Each live_auto row's job: its feed has an item within max_age_days, its workflow's last run is
 * recent and not failed, its launchd job is installed and logged recently. A worker row is named as
 * not machine-readable (counted, never a quiet pass).
 */
export async function checkJobs(manifest, { now = Date.now(), fetchImpl = fetch, gh = ghLastRun, home = homedir() } = {}) {
  const out = { checked: [], unreadable: [], problems: [] };
  const DAY = 86_400_000;
  for (const r of (manifest.rows ?? []).filter((x) => x.status === "live_auto")) {
    const ck = r.posts?.check ?? {};
    const max = (ck.max_age_days ?? 3) * DAY;
    if (ck.kind === "worker") { out.unreadable.push(r.id); continue; }
    if (ck.kind === "feed") {
      let newest = null;
      for (const f of ck.feeds ?? []) {
        const p = await probe(f, fetchImpl);
        const n = p.status === 200 ? newestPubDate(p.body) : null;
        if (n != null && (newest == null || n > newest)) newest = n;
      }
      if (newest == null) out.problems.push(`${r.id}: no feed item could be read from ${(ck.feeds ?? []).join(", ")}`);
      else if (now - newest > max) out.problems.push(`${r.id}: the newest pin is ${Math.floor((now - newest) / DAY)} days old`);
    }
    if (ck.workflow) {
      const run = gh(ck.workflow.repo, ck.workflow.file);
      if (!run) out.problems.push(`${r.id}: ${ck.workflow.repo} ${ck.workflow.file} has no run`);
      else if (run.conclusion && run.conclusion !== "success" && run.status === "completed") out.problems.push(`${r.id}: ${ck.workflow.file}'s last run ended ${run.conclusion}`);
      else if (now - Date.parse(run.createdAt) > max) out.problems.push(`${r.id}: ${ck.workflow.file} last ran ${Math.floor((now - Date.parse(run.createdAt)) / DAY)} days ago`);
    }
    if (ck.kind === "launchd") {
      const plist = path.join(home, "Library", "LaunchAgents", `${ck.label}.plist`);
      if (!existsSync(plist)) out.problems.push(`${r.id}: launchd ${ck.label} is not installed`);
      else if (ck.log_dir) {
        // The job writes one log file a day; its newest file is its last run.
        const dir = path.join(home, ck.log_dir);
        const times = existsSync(dir) ? readdirSync(dir).map((f) => statSync(path.join(dir, f)).mtimeMs) : [];
        const last = times.length ? Math.max(...times) : null;
        if (last == null) out.problems.push(`${r.id}: ${ck.label} has never logged (${ck.log_dir})`);
        else if (now - last > max) out.problems.push(`${r.id}: ${ck.label} last logged ${Math.floor((now - last) / DAY)} days ago`);
      }
    }
    out.checked.push(r.id);
  }
  return out;
}

/** The last run of a workflow, via the gh CLI; null when there is none or gh cannot answer. */
export function ghLastRun(repo, file) {
  try {
    const raw = execFileSync("gh", ["run", "list", "-R", `seq23/${repo}`, "-w", file, "-L", "1", "--json", "conclusion,status,createdAt"], { encoding: "utf8", timeout: 30_000 });
    return JSON.parse(raw)[0] ?? null;
  } catch { return null; }
}

export function readManifest(root) {
  return JSON.parse(readFileSync(path.join(root, "src/shared/boss/socialMap/manifest.json"), "utf8"));
}
export function readSites(root) {
  return JSON.parse(readFileSync(path.join(root, "src/shared/boss/searchReadiness/sites.json"), "utf8"));
}

/**
 * The whole check, as the Mac runner and the Sunday cohesion check run it. `status` 0 clean, 1
 * problems, 2 NAMED STOP [SOCIAL_MAP_NOTHING_CHECKED] (no sibling repo found).
 */
export async function runSocialMapCheck({ root, home = homedir(), repos = [], fetchImpl = fetch, gh = ghLastRun, now = Date.now(), live = true } = {}) {
  const manifest = readManifest(root);
  const sites = readSites(root);
  const shape = [...shapeProblems(manifest, sites), ...privacyProblems(manifest), ...accountEmailProblems(manifest, sites)];
  const personal = personalMoveRows(manifest);
  const other = checkOtherRepos(manifest, sites, root, { repos, home });
  if (!other.checked.length) {
    return { status: 2, census: `NAMED STOP [SOCIAL_MAP_NOTHING_CHECKED] no repo checkout was found next to boss-os or in ~/GitHub`, problems: [], personal };
  }
  const urls = live ? await checkUrls(manifest, { fetchImpl }) : { ok: [], unverifiable: [], problems: [] };
  const jobs = live ? await checkJobs(manifest, { now, fetchImpl, gh, home }) : { checked: [], unreadable: [], problems: [] };
  const problems = [...shape, ...other.problems, ...urls.problems, ...jobs.problems];
  const census = `Social Map: ${manifest.rows.length} rows; ${other.checked.length} repos read${other.missing.length ? ` (not on this Mac: ${other.missing.join(", ")})` : ""}; ${other.entityFiles} entity files; ` +
    `${urls.ok.length} URLs answer, ${urls.unverifiable.length} unverifiable (login wall)${urls.unverifiable.length ? ` [${urls.unverifiable.join(", ")}]` : ""}; ` +
    `${jobs.checked.length} live_auto jobs checked${jobs.unreadable.length ? `, ${jobs.unreadable.length} not machine-readable (${jobs.unreadable.join(", ")})` : ""}; ` +
    `${personal.length} under a personal address${personal.length ? ` (${personal.join(", ")})` : ""}.`;
  return { status: problems.length ? 1 : 0, census, problems, personal };
}

/**
 * The Social Map's words for Simone's Monday cohesion line, or null when there is nothing to say: gaps
 * in the map, and (her ruling, 8 Nov 2026) the accounts still under a personal address, as one clause.
 */
export function socialMapFlagWords(result) {
  if (!result) return "the Social Map check did not run";
  if (result.status === 2) return "the Social Map check found no repo to read";
  const parts = [];
  const n = result.problems.length;
  if (n) parts.push(`the Social Map has ${n} ${n === 1 ? "gap" : "gaps"} (${result.problems.slice(0, 2).join("; ")}${n > 2 ? `; and ${n - 2} more` : ""}; npm run social-map:check)`);
  const p = result.personal ?? [];
  if (p.length) parts.push(`${p.length} social ${p.length === 1 ? "account is" : "accounts are"} still under a personal address, move to the brand's (${p.join(", ")})`);
  return parts.length ? parts.join("; ") : null;
}
