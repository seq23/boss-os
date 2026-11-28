#!/usr/bin/env node
/**
 * THE DETERMINISTIC HALF OF DANIELLE'S AUDIT PASS: in-flight detection, landing, and the verdict.
 *
 * Owner, 16 Oct 2026: "fix danielle's job so she can actually fix things". The model reads the mail,
 * crawls and fixes; everything that must not depend on a model remembering lives here, where it is
 * tested (`tests/danielleAuditFixer.test.ts`) and pinned (`validate:audit-fixer`):
 *
 *   inflight <repo> <term...>   an open PR or branch in that repo already touching this? -> IN_FLIGHT
 *   land <findings.json>        every `fixed_pr`: `gh pr checks --watch --fail-fast`, then `~/bin/land`
 *                               — ONCE PER PULL REQUEST, however many rows it fixed, one LAND line each
 *   scope <repo> [ids]          the queue briefs a scoped pass was handed: its search evidence
 *   repo-for <domain>           which repository serves a domain, from the one list (domainRepos.mjs)
 *   packet <repo> [ids]         a scoped pass's briefs, repo map and open work, read before the model starts
 *   finish <findings.json>      crawls the live site of every row that claims a defect and has no crawl yet
 *   tokens <transcript.jsonl>   what a Claude pass cost: SESSION-TOKENS input=<n> output=<n> turns=<n>
 *   verdict <findings.json>     RULE 0: a pass that left fixable defects unfixed exits RED, named
 *
 * WHY LANDING MOVED IN HERE. The first version of this duty said "IT MERGES NOTHING. She merges."
 * That contradicted her standing rules — merge green PRs without asking (14 Sep), merge and deploy
 * are one action through `~/bin/land` (18 Sep), nothing waits on the owner (25 Sep), repairs found
 * in passing need no yes — and left every fix it might have made waiting on her. It still never
 * calls a bare merge or a deploy itself: `~/bin/land` refuses rather than guesses (not green, head
 * moved, main red), watches main to a terminal state and deploys, and that is the only door.
 *
 * IN_FLIGHT MEANS WORK OF ITS OWN, NOT A NAME MATCH (30 Oct 2026). `matchInFlight` used to return any
 * remote branch whose NAME contained a brief's term, merged or not — dream-wedding-builder kept 33
 * merged branches, six of them Danielle's own `danielle/site-audit-*`, and every one was a permanent
 * false "someone is already on it". `feat/clarity-tag-install` matched "clarity" two days after its
 * PR merged (`ahead_by: 0, behind_by: 303`) and six real briefs were skipped three rounds running —
 * `AUDIT-VERDICT: GREEN fixed=0 in_flight=6`, a pass that ran and did nothing, which Rule 0 forbids.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mayAutoFix } from "../../src/shared/boss/siteAudit/repoPolicy.mjs";
import { scopeSnapshot, scopeBriefs } from "../../src/shared/boss/siteAudit/evidence.mjs";
import { repoForDomain, domainOfRow } from "../../src/shared/boss/siteAudit/domainRepos.mjs";
import { heldForOwner } from "../../src/shared/boss/searchReadiness/ownerApproval.mjs";

import { orphanVerdict, mergedOnMain, NEEDS_WORKER, clientApprovalHold } from "../../src/shared/boss/searchReadiness/orphanPr.mjs";
import { pathsFrom } from "./clickthrough.mjs";
import { envForRepoRun } from "../lib/vault-env.mjs";
import { isParked } from "./lib/repo-categories.mjs";

const SITES = JSON.parse(readFileSync(new URL("../../src/shared/boss/searchReadiness/sites.json", import.meta.url), "utf8")).grid_repos ?? [];
const repoName = (r) => String(r ?? "").trim().replace(/\/+$/, "").split("/").pop();
/**
 * The `owner_approval` sites whose fix plan she approved this cycle, as the Monday audit wrote them
 * into the fix queue (`approved_sites`). Unreadable → none approved: fail closed.
 */
export function approvedSitesFromQueue(path = process.env.SR_FIX_QUEUE ?? join(homedir(), ".boss-os/search-readiness/fix-queue.json")) {
  try { const q = JSON.parse(readFileSync(path, "utf8")); return Array.isArray(q.approved_sites) ? q.approved_sites : []; } catch { return []; }
}
/** The sites.json row with `owner_approval` this finding belongs to (by domain, then repo), or null. */
const ownerApprovalSite = (f, sites) => sites.find((s) => s.owner_approval && ((f.domain && String(f.domain).replace(/^www\./, "") === s.domain) || (f.repo && repoName(f.repo) === s.repo))) ?? null;

/** Dispositions that are a CONFIRMED site defect in a repo the fixer may change. */
const FIXABLE_LEFT = new Set(["surfaced"]);
/** Dispositions that claim the run looked at the live site, and so must carry the evidence. */
const NEEDS_CRAWL = new Set(["surfaced", "fixed_pr"]);

/**
 * RULE 0 for the pass. Returns { red, reasons, counts }.
 *
 *   FIXABLE_LEFT_UNFIXED  fixed=0 while a confirmed, fixable defect was surfaced — the 15/16 Oct shape
 *   IN_FLIGHT_STALE       skipped as "in flight" on a branch with no commits of its own, or a merged
 *                         or closed PR — dead evidence, not work in progress — the 30 Oct shape
 *   NOT_LANDED            a PR was opened and did not land: work left waiting on her
 *   DEPLOY_FAILED         the PR merged but land's deploy step failed: "merged, deploy failed: <reason>"
 *   NOT_CRAWLED           a row claims a defect (or a fix) with no crawl of the live site behind it
 *   NOT_PROBED            an Ahrefs-side crawl failure asserted with no outside probe behind it
 *   OWNER_ASKED           a row's next action is the owner's: Danielle decides, she never parks it
 *                         "for a person" (31 Oct 2026, 16 findings; see OWNER_ACTOR)
 */
/*
 * NOTHING WAITS ON THE OWNER (31 Oct 2026). Sixteen rows sat on Today as "left for a person to
 * decide": "Owner creates one real profile…", "Publish … through the Lovable release path", a check
 * that clears itself on Monday, the protected page. Every one had a decision Danielle could make (use
 * the precedent the grid already passes with, dispatch the job now, record the platform limit, leave
 * the protected page to its own pass). A row whose next action names the owner as the one to act is
 * that parking, so the pass is RED and comes back to her, never to Sequoia.
 */
export const OWNER_ACTOR = /^\s*(?:the\s+)?(?:owner|sequoia|she|you)\b|\b(?:ask|tell|needs?|waits? (?:on|for))\s+(?:her|the owner|sequoia)\b|\b(?:owner|sequoia) (?:creates?|decides?|must|needs?|should|publishes?|adds?|signs?|approves?|chooses?)\b|for a person to decide/i;

export function runVerdict(payload) {
  const findings = Array.isArray(payload?.findings) ? payload.findings : [];
  const counts = {};
  for (const f of findings) counts[f.disposition] = (counts[f.disposition] ?? 0) + 1;
  const fixed = counts.fixed_pr ?? 0;
  const reasons = [];
  if (findings.length === 0) reasons.push("NO_FINDINGS: the findings file holds no rows; an empty week writes one 'none' row.");
  for (const f of findings) {
    const who = `${f.project ?? "?"} (${f.repo ?? f.domain ?? "no repo"}) — ${f.headline ?? ""}`;
    if (FIXABLE_LEFT.has(f.disposition) && fixed === 0 && mayAutoFix(f.repo)) {
      reasons.push(`FIXABLE_LEFT_UNFIXED: ${who}: ${f.because ?? "no reason given"}`);
    }
    if (f.disposition === "in_flight" && mayAutoFix(f.repo)) {
      const ahead = Number(f.in_flight?.comparison_to_main?.ahead_by);
      const prState = String(f.in_flight?.pr_state ?? "").toUpperCase();
      if (f.in_flight?.kind === "branch" && Number.isFinite(ahead) && ahead === 0) {
        reasons.push(`IN_FLIGHT_STALE: ${who}: skipped on branch ${f.in_flight?.ref ?? "?"}, which is ${ahead} commits ahead of main — merged or stale, not work in progress.`);
      } else if (f.in_flight?.kind === "pr" && (prState === "MERGED" || prState === "CLOSED")) {
        reasons.push(`IN_FLIGHT_STALE: ${who}: skipped on ${f.in_flight?.ref ?? "a pull request"}, which is already ${prState.toLowerCase()} — not work in progress.`);
      }
    }
    if (f.disposition === "fixed_pr" && f.land === "merged_deploy_failed") {
      reasons.push(`DEPLOY_FAILED: ${who}: ${f.pr_url} ${f.land_detail ?? "merged, deploy failed"}`);
    } else if (f.disposition === "fixed_pr" && f.land !== "landed") {
      reasons.push(`NOT_LANDED: ${who}: ${f.pr_url ?? "no PR"} is ${f.land ?? "not landed"}${f.land_detail ? ` (${f.land_detail})` : ""}`);
    }
    if (NEEDS_CRAWL.has(f.disposition) && !(f.crawl && Number(f.crawl.pages_crawled) > 0)) {
      reasons.push(`NOT_CRAWLED: ${who}: no crawl of the live site recorded, so the row rests on the Ahrefs mail alone.`);
    }
    if (OWNER_ACTOR.test(String(f.suggested_action ?? ""))) {
      reasons.push(`OWNER_ASKED: ${who}: the next action is left to the owner ("${String(f.suggested_action).slice(0, 120)}"). Decide it: fix it, dispatch it, record the limit as none, or leave a protected page as off_limits.`);
    }
    if (f.disposition === "ahrefs_side" && !(f.probe && f.probe.verdict === "AHREFS_SIDE_CRAWL_FAILURE")) {
      reasons.push(`NOT_PROBED: ${who}: called an Ahrefs-side crawl failure without an outside probe saying so.`);
    }
  }
  return { red: reasons.length > 0, reasons, counts, fixed };
}

/** owner/name for a repo given as a name, a path or owner/name. */
export function repoSlug(repo, root = process.env.AUDIT_GITHUB_ROOT ?? join(homedir(), "GitHub")) {
  const s = String(repo ?? "").trim().replace(/\/+$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !existsSync(s)) return s;
  const dir = s.includes("/") ? s : join(root, s);
  const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`cannot tell the GitHub repo for ${dir} from ${url}`);
  return m[1];
}

/**
 * Is an open PR or a pushed branch already working on this? Pure over the lists, so it is testable;
 * `inflight()` below feeds it from `gh`. Other agents fix the same sites (16 Oct 2026: dead outbound
 * and email-protection links in local-guides-generator and WPP-llm, the theindustryguides link in
 * LGCV); a duplicate PR from Danielle collides with theirs.
 *
 * A branch is either a bare name (unknown ahead — matches as before, for callers with no commit
 * count to give) or `{ name, ahead }`; a branch with `ahead === 0` has no commits of its own — merged
 * into the default branch or never diverged from it — and is never work in progress (30 Oct 2026).
 */
export function matchInFlight(prs, branches, terms) {
  const t = terms.map((x) => String(x).toLowerCase()).filter(Boolean);
  if (t.length === 0) return null;
  const hit = (s) => t.some((x) => String(s ?? "").toLowerCase().includes(x));
  for (const p of prs) {
    const files = (p.files ?? []).map((f) => f.path ?? f).join(" ");
    if (hit(p.title) || hit(p.body) || hit(p.headRefName) || hit(files)) {
      const own = String(p.headRefName ?? "").startsWith("danielle/site-audit-");
      return { kind: "pr", ref: p.url ?? `#${p.number}`, title: p.title, ...(own ? { own, branch: p.headRefName } : {}) };
    }
  }
  for (const b of branches) {
    const name = typeof b === "string" ? b : b.name;
    if (/^(main|master|gh-pages)$/.test(name)) continue;
    if (!hit(name)) continue;
    if (typeof b === "object" && Number(b.ahead) === 0) continue;
    return { kind: "branch", ref: name };
  }
  return null;
}

export function inflight(repo, terms) {
  const slug = repoSlug(repo);
  const prs = JSON.parse(execFileSync("gh", ["pr", "list", "-R", slug, "--state", "open", "--limit", "50",
    "--json", "number,title,body,headRefName,url,files"], { encoding: "utf8" }));
  const names = JSON.parse(execFileSync("gh", ["api", `repos/${slug}/branches?per_page=100`, "--jq", "[.[].name]"],
    { encoding: "utf8" }));
  /*
   * ONLY THE NAME-MATCHED CANDIDATES PAY FOR A COMPARE READ (30 Oct 2026): resolving every branch's
   * ahead-of-default would be dozens of extra `gh api` calls on a repo like dream-wedding-builder (33
   * branches); a branch that does not match no term is never in play anyway.
   */
  const t = terms.map((x) => String(x).toLowerCase()).filter(Boolean);
  const candidates = names.filter((name) => !/^(main|master|gh-pages)$/.test(name) && t.some((x) => name.toLowerCase().includes(x)));
  let defaultBranch = null;
  const branches = names.map((name) => {
    if (!candidates.includes(name)) return name;
    try {
      defaultBranch ??= execFileSync("gh", ["api", `repos/${slug}`, "--jq", ".default_branch"], { encoding: "utf8" }).trim();
      const cmp = JSON.parse(execFileSync("gh", ["api", `repos/${slug}/compare/${defaultBranch}...${name}`], { encoding: "utf8" }));
      return { name, ahead: cmp.ahead_by };
    } catch {
      return name; // the compare read failed; fall back to a name match rather than a false CLEAR
    }
  });
  return matchInFlight(prs, branches, terms);
}

/** One line saying which repository serves a domain, as `repo-for` prints it. */
export function repoForLine(domain) {
  const r = repoForDomain(domain);
  return r ? (r.repo ? `REPO ${r.repo} (${r.source})` : `NO_REPO ${r.why}`) : "UNKNOWN: this domain is in neither sites.json nor AUDITED_ELSEWHERE (src/shared/boss/siteAudit/domainRepos.mjs); add it there with its repo or the reason it has none.";
}

/*
 * ─── THE PASS'S ENVELOPE IS CODE, NOT TURNS (27 Nov 2026, the ahrefs-code-tools job) ─────────────
 *
 * Measured over the 165 Claude passes of the 30 days to 27 Nov (~/.claude/projects transcripts): 7.07M
 * input tokens a pass, 57.8 model turns, 53 of them a single tool call, and every turn re-reads the
 * whole session. Tool output was only ~26K tokens of a pass: the cost is the NUMBER of turns. A slice
 * of those turns were the same every pass and needed no judgement: reading the queue for this repo,
 * asking repo-for, listing open PRs and running the keyword in-flight check, then, after the PR,
 * crawling the site only to copy pages_crawled onto the row and pruning. Code does those now:
 *
 *   passPacket   before the model: the briefs exactly as the queue holds them (every id the pass was
 *                handed, or named as missing), the repository for each domain, and the repo's open work
 *                (every open PR with what it changes, every pushed branch with commits of its own). The
 *                model decides "already in flight" by reading that, not by a term match.
 *   finishPass   after the model: crawls each claimed row's live site once per domain and records
 *                `crawl`. A crawl that fails, times out or reads no sitemap leaves the row uncrawled
 *                (`crawl_error`), so the verdict stays RED (NOT_CRAWLED): an outage is never "crawled".
 */

const OPEN_WORK_FILES = 40;
/** This file as the worker types it (`~/…`, the allow list's form), wherever the runner's checkout is. */
const SELF = fileURLToPath(import.meta.url).replace(homedir(), "~");

/** Pure: the open work of a repo from `gh pr list` JSON and the pushed branches (`{ name, ahead }`). */
export function openWorkFrom(prs, branches, defaultBranch = "main") {
  const heads = new Set((prs ?? []).map((p) => p.headRefName));
  return {
    prs: (prs ?? []).map((p) => {
      const files = (p.files ?? []).map((f) => f.path ?? f);
      return {
        number: p.number, url: p.url, title: p.title, branch: p.headRefName, draft: Boolean(p.isDraft),
        own: String(p.headRefName ?? "").startsWith("danielle/site-audit-"),
        files: files.slice(0, OPEN_WORK_FILES), more_files: Math.max(0, files.length - OPEN_WORK_FILES),
      };
    }),
    // A branch with no commits of its own (merged, or never diverged) is not work in progress (30 Oct 2026).
    branches: (branches ?? []).filter((b) => b.name !== defaultBranch && !/^(main|master|gh-pages)$/.test(b.name) && !heads.has(b.name) && !(Number(b.ahead) === 0)),
  };
}

/**
 * The open work of `slug` read from GitHub, or `{ unread }` naming why it could not be read (never an
 * empty list). A branch whose pull request was merged or closed is finished work, not work in progress:
 * a squash merge leaves its commits "ahead" for ever (keepmyproof, 27 Nov 2026: 87 such branches).
 */
export function readOpenWork(slug, { run = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) } = {}) {
  let prs, ended, names, defaultBranch;
  try {
    prs = JSON.parse(run(["pr", "list", "-R", slug, "--state", "open", "--limit", "100", "--json", "number,title,headRefName,url,isDraft,files"]));
    ended = JSON.parse(run(["pr", "list", "-R", slug, "--state", "all", "--limit", "1000", "--json", "headRefName,state"]));
    names = JSON.parse(run(["api", `repos/${slug}/branches?per_page=100`, "--jq", "[.[].name]"]));
    defaultBranch = String(run(["api", `repos/${slug}`, "--jq", ".default_branch"])).trim();
    if (!Array.isArray(prs) || !Array.isArray(ended) || !Array.isArray(names) || !defaultBranch) throw new Error("GitHub answered with something that is not a list");
  } catch (e) {
    return { unread: `could not read ${slug}'s open PRs and branches from GitHub (${String(e?.message ?? e).split("\n")[0].slice(0, 160)})` };
  }
  const open = new Set(prs.map((p) => p.headRefName));
  const done = new Set(ended.filter((p) => p.state === "MERGED" || p.state === "CLOSED").map((p) => p.headRefName));
  const branches = names.filter((n) => n !== defaultBranch && !/^(main|master|gh-pages)$/.test(n) && !open.has(n) && !done.has(n)).map((name) => {
    try { return { name, ahead: JSON.parse(run(["api", `repos/${slug}/compare/${defaultBranch}...${name}`, "--jq", "{ahead_by}"])).ahead_by }; }
    catch { return { name, ahead: "unknown" }; } // unread: kept, so it counts as possible work, never as none
  });
  return openWorkFrom(prs, branches, defaultBranch);
}

/** Pure: the packet a scoped pass works from. Every id it was handed is a brief or a named missing id. */
export function passPacket({ queue, queueFile, repo, briefIds = [], openWork, repoFor = repoForLine }) {
  const { wanted } = scopeBriefs(queue, repo, briefIds);
  const found = new Set(wanted.map((b) => b.id));
  const domains = [...new Set(wanted.map((b) => b.domain).filter(Boolean))];
  return {
    repo, queue_file: queueFile, queue_written_at: queue?.written_at ?? null,
    briefs: wanted,
    missing_ids: briefIds.filter((id) => !found.has(id)),
    approved_sites: Array.isArray(queue?.approved_sites) ? queue.approved_sites : [],
    repo_for: Object.fromEntries(domains.map((d) => [d, repoFor(d)])),
    open_work: openWork,
  };
}

/** The packet as the model reads it: the briefs verbatim, one JSON per line, and the rest in short lines. */
export function packetText(pk) {
  const ow = pk.open_work ?? { unread: "no open-work read was made" };
  const work = ow.unread
    ? [`OPEN WORK: UNREAD — ${ow.unread}. Before you fix each brief, run \`node ${SELF} inflight ${pk.repo} <term...>\` as section 2 says.`]
    : [
        `OPEN WORK in ${pk.repo}: ${ow.prs.length} open PR(s), ${ow.branches.length} pushed branch(es) with commits of their own. Decide IN_FLIGHT by reading what each one changes; a PR marked OWN LANE is yours to finish, never in_flight.`,
        ...ow.prs.map((p) => `- PR #${p.number}${p.draft ? " [draft]" : ""}${p.own ? " [OWN LANE]" : ""} ${p.url} branch ${p.branch} — ${p.title} — files: ${p.files.join(", ") || "none"}${p.more_files ? ` (+${p.more_files} more: gh pr view ${p.number})` : ""}`),
        ...ow.branches.map((b) => `- branch ${b.name} (${b.ahead} commit(s) ahead)`),
      ];
  return [
    `## YOUR PASS PACKET (read by code before you started)`,
    ``,
    `The queue (${pk.queue_file}, written ${pk.queue_written_at ?? "?"}) was read for you: do not read it again, and do not run repo-for for these domains.`,
    `BRIEFS (${pk.briefs.length}, exactly as the queue holds them):`,
    ...pk.briefs.map((b) => JSON.stringify(b)),
    ...(pk.missing_ids.length ? [`NOT IN THE QUEUE ANY MORE (record each as a \`none\` row saying so): ${pk.missing_ids.join(", ")}`] : []),
    ...(pk.approved_sites.length ? [`APPROVED SITES this cycle: ${pk.approved_sites.join(", ")}`] : []),
    `REPO FOR EACH DOMAIN (site-audit-lib.mjs repo-for):`,
    ...Object.entries(pk.repo_for).map(([d, line]) => `- ${d}: ${line}`),
    ...work,
  ].join("\n");
}

/** The runner's crawl of one domain: { crawl } with what the row records, or { error } naming why not. */
export function defaultCrawl(domain, { outDir = process.env.BOSS_OS_SITE_AUDIT_DIR ?? tmpdir(), crawler = process.env.SITE_CRAWL_BIN ?? join(dirname(fileURLToPath(import.meta.url)), "site-crawl.py"), timeoutS = 900 } = {}) {
  const out = join(outDir, `crawl-${String(domain).replace(/[^a-z0-9.-]/gi, "_")}.json`);
  try { rmSync(out, { force: true }); } catch { /* an old file is replaced or the read below fails */ }
  const r = spawnSync("timeout", [String(timeoutS), "python3", crawler, "crawl", domain, "--out", out], { encoding: "utf8" });
  if (r.status !== 0) return { error: `the crawl of ${domain} exited ${r.status ?? r.signal ?? "?"}${r.status === 124 ? " (timed out)" : ""}: ${lastLine(r.stderr || r.stdout)}` };
  let res;
  try { res = JSON.parse(readFileSync(out, "utf8")); } catch { return { error: `the crawl of ${domain} wrote no readable result` }; }
  return crawlRecord(domain, res);
}

/** Pure: what a row records from a crawl result, or { error } when the crawl never reached the site. */
export function crawlRecord(domain, res) {
  const pages = Number(res?.pages_crawled), total = Number(res?.sitemap_total);
  // No sitemap read means the crawl saw at most a homepage it could not confirm: the site or the network was down.
  if (!(pages > 0) || !(total > 0)) return { error: `the crawl of ${domain} read no sitemap pages (pages_crawled=${res?.pages_crawled ?? "?"}, sitemap_total=${res?.sitemap_total ?? "?"}): site or network unreachable` };
  return { crawl: { pages_crawled: pages, sitemap_total: total, counts: res.counts ?? {}, by: "runner" } };
}

/**
 * WHAT A CLAUDE PASS COST, FROM ITS OWN TRANSCRIPT (27 Nov 2026): `SESSION-TOKENS input=<n> output=<n>
 * turns=<n>`, input = fresh + cache read + cache write, each model call counted once (a call is written
 * as several lines sharing one message id). The runner logs it after every Claude pass, so the cost of
 * the next pass is a read of its log, not a guess. A transcript that cannot be read, or holds no model
 * call, is `SESSION-TOKENS unread (<why>)`, never 0.
 */
export function sessionTokensLine(text) {
  const seen = new Set();
  let input = 0, output = 0;
  for (const line of String(text ?? "").split("\n")) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e?.type !== "assistant" || e.isSidechain) continue;
    const id = e.message?.id, u = e.message?.usage;
    if (!id || !u || seen.has(id)) continue;
    seen.add(id);
    input += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    output += u.output_tokens ?? 0;
  }
  return seen.size ? `SESSION-TOKENS input=${input} output=${output} turns=${seen.size}` : "SESSION-TOKENS unread (the transcript holds no model call)";
}

/** Records `crawl` on every row that claims a defect and has none, one crawl per domain. Returns FINISH lines. */
export function finishPass(payload, { crawl = defaultCrawl } = {}) {
  const lines = [];
  const seen = new Map();
  for (const f of payload?.findings ?? []) {
    if (!NEEDS_CRAWL.has(f.disposition) || (f.crawl && Number(f.crawl.pages_crawled) > 0)) continue;
    const domain = domainOfRow(f);
    if (!domain) { f.crawl_error = "the row names no domain, so the runner could not crawl it"; lines.push(`FINISH NOT_CRAWLED ${f.project ?? "?"}: ${f.crawl_error}`); continue; }
    if (!seen.has(domain)) {
      let r;
      try { r = crawl(domain); } catch (e) { r = { error: `the crawl of ${domain} threw: ${String(e?.message ?? e).slice(0, 160)}` }; }
      seen.set(domain, r && (r.crawl || r.error) ? r : { error: `the crawl of ${domain} returned nothing` });
      const got = seen.get(domain);
      lines.push(got.crawl ? `FINISH crawled ${domain}: pages=${got.crawl.pages_crawled}/${got.crawl.sitemap_total}` : `FINISH NOT_CRAWLED ${domain}: ${got.error}`);
    }
    const got = seen.get(domain);
    if (got.crawl) { f.crawl = { ...got.crawl }; delete f.crawl_error; } else f.crawl_error = got.error;
  }
  if (!lines.length) lines.push("FINISH nothing to crawl: every row that claims a defect already carries its crawl");
  return lines;
}

/**
 * Land every `fixed_pr` row: checks to green (30 min cap), then `~/bin/land` from the repo's
 * worktree. The result is written onto the row (`land`, `land_detail`) so the verdict and Boss OS
 * both see it. `run` is injectable for the test.
 */
/** The repository a pull request URL belongs to (`seq23/boss-os/pull/318` → "boss-os"), or null. */
export const prRepoOf = (url) => /github\.com\/[^/]+\/([^/]+)\/pull\/\d+/.exec(String(url ?? ""))?.[1] ?? null;

/*
 * THE REASON A LAND FAILED, NOT ITS LAST LINE (7 Nov 2026). boss-os #318's land_detail was wrangler's
 * "Logs were written to …" line; the error two lines above it was the reason.
 */
const REASON_LINE = /✘ \[ERROR\]|NAMED STOP|STOPPED|refus|not green|failed|error/i;
export function landReason(out) {
  // eslint-disable-next-line no-control-regex
  const lines = String(out ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const hit = [...lines].reverse().find((l) => REASON_LINE.test(l) && !/^🪵|Logs were written/.test(l));
  return (hit ?? lines.pop() ?? "").replace(/^✘ \[ERROR\]\s*/, "").slice(0, 300);
}

/*
 * LAND'S REVIEW GATE, NAMED ON THE ROW (25 Nov 2026). ~/bin/land refused all 42 fixes of that week's
 * run with a plain "STOPPED: PR #N needs a review (its body has no `Review class:` line …)" — no
 * NAMED STOP — so the round read as "fixed nothing" (SR_QUEUE_STALLED). land's own words are read,
 * never a second copy of its rule (the click-through refusal is read the same way, 17 Nov 2026):
 *  - REVIEW_CLASS_MISSING: the body's Review class line is missing or unreasoned; the next pass's own
 *    worker adds it (ahrefs-audit-fix-prompt.md §4);
 *  - REVIEW_PASS_MISSING: any other review refusal (a repo not on live-repos.json, a review-required
 *    label, something new in public): only a fresh reviewer's PASS clears it.
 * A refusal land already named (NAMED STOP [...]) keeps its own name. Returns null when it is not a
 * review refusal (a red check, a network blip), which stays a genuine stall.
 */
export function reviewGate(out, prUrl = "the PR") {
  // eslint-disable-next-line no-control-regex
  const text = String(out ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  if (/NAMED STOP \[[A-Z0-9_]+\]/.test(text)) return null;
  if (/needs a review \((its body has no `Review class:` line|its `Review class: none` gives no reason)/.test(text)) {
    return { code: "REVIEW_CLASS_MISSING", action: `Land refused ${prUrl}: its body has no reasoned \`Review class:\` line. The next Search Readiness pass adds \`Review class: none — <why>\` (or the class it is in) to the body and the runner lands it again.` };
  }
  if (/needs a review \(|puts something new in public|(Ship|Launch)-ready:? PASS/.test(text)) {
    return { code: "REVIEW_PASS_MISSING", action: `Land refused ${prUrl} until a fresh reviewer (never the builder) looks at its real output and signs land's Ship-ready PASS line on the PR; then the runner lands it again.` };
  }
  return null;
}

/*
 * ~/bin/land GETS THE CLOUDFLARE NAMES AND NOTHING ELSE FROM THE VAULT (7 Nov 2026). The land step
 * runs under `vault:run` (ahrefs-audit-fix.sh); a land's post-merge steps run wrangler, which under
 * launchd has no login and refused ("In a non-interactive environment, it's necessary to set a
 * CLOUDFLARE_API_TOKEN"). `envForRepoRun` strips every other vault name.
 */
const CLICKTHROUGH = join(dirname(fileURLToPath(import.meta.url)), "clickthrough.mjs");
export const LAND_VAULT_NAMES = Object.freeze(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

export function landAll(payload, { run = defaultRun, landBin = process.env.AUDIT_LAND_BIN ?? join(homedir(), "bin/land"), sites = SITES, approvedSites = approvedSitesFromQueue(), parked = isParked, env = envForRepoRun(process.env, LAND_VAULT_NAMES) } = {}) {
  /*
   * ONE LAND PER PULL REQUEST (26 Oct 2026). A PR that fixes five briefs is five `fixed_pr` rows, and
   * this used to watch checks and run ~/bin/land once per ROW: five lands of one PR, four of them
   * "already MERGED … nothing to merge", and five identical LAND lines in the log. The first row's
   * outcome is now written onto every row that shares its pr_url.
   */
  const done = new Map();
  const clientHolds = new Map();
  for (const f of payload.findings ?? []) {
    if (!["fixed_pr", "in_flight"].includes(f.disposition) || f.land === "landed") continue;
    if (f.disposition === "in_flight") {
      let pr = null;
      // Validate identity and policy before even looking up the remote PR.
      if (orphanVerdict(f, null, { sites, approvedSites }) === "another_lane") {
        const view = run("gh", ["pr", "view", f.pr_url, "--json", PR_FIELDS], undefined);
        try { if (view.status === 0) pr = JSON.parse(view.out); } catch { /* fail closed */ }
        if (pr && sites.some((s) => s.repo === repoName(f.repo) && s.client_approval)) pr.client_proof = clientProof(f.pr_url, sites.filter((s) => s.repo === repoName(f.repo)), run);
      }
      const verdict = orphanVerdict(f, pr, { sites, approvedSites });
      if (verdict !== "land") {
        f.land = verdict === "already_merged" ? "already_merged" : "blocked";
        f.land_detail = verdict === "another_lane" && !pr ? "refused_policy: PR metadata unavailable" : verdict;
        continue;
      }
    }
    if (!f.pr_url) continue;
    /*
     * THE PR LANDS FROM ITS OWN REPOSITORY (7 Nov 2026). A brief fixed in the checker carries the
     * site's repo on the row and a boss-os PR: `land 319` ran in sprylabs-hpc-site ("Could not resolve
     * to a PullRequest with the number of 319"), and a row renamed to boss-os to dodge that was then
     * refused by Boss OS as unmapped. The row's repo stays the site's; the PR link says where to land.
     */
    const prRepo = prRepoOf(f.pr_url) ?? String(f.repo);
    if (!mayAutoFix(f.repo) || !mayAutoFix(prRepo)) { f.land = "refused_policy"; continue; }
    if (parked(f.repo) || parked(prRepo)) { f.land = "refused_policy"; f.land_detail = `${parked(prRepo) ? prRepo : f.repo} is parked in the personal brain's Repo categories`; continue; }
    /*
     * HER YES ON AN `owner_approval` SITE (Hicks, owner 3 Nov 2026). A fix to already-published
     * Resources posts lands like any other ("if it has repairs for already published resources they
     * should just fix them not queue"); a fix touching a core page, or naming no page at all, is
     * never landed: it waits for her approved plan. The pages are the row's `pages` (the published
     * URLs the PR changes), else any URL in its headline or reason. Fails closed.
     */
    const oa = ownerApprovalSite(f, sites);
    if (oa && heldForOwner(oa, { approved: approvedSites.includes(oa.domain), texts: f.pages?.length ? f.pages : [f.headline, f.because] })) {
      f.land = "held_owner_approval";
      f.land_detail = `${oa.domain}: a repair outside its published posts (${(oa.owner_approval_direct_repairs?.paths ?? []).join(", ") || "none listed"}) waits for her approved fix plan.`;
      continue;
    }
    /*
     * NEW POSTS WAIT FOR THE CLIENT; FIXES SHIP, ON THE fixed_pr PATH TOO (owner, 9 Nov 2026). On a
     * `client_approval` site (Horse) a fix lands like any other; a PR that adds a new post, or
     * changes an approval record, is held with the reason (clientApprovalHold, which fails closed).
     */
    const clientSites = sites.filter((s) => s.client_approval && s.repo === prRepo);
    if (clientSites.length) {
      if (!clientHolds.has(f.pr_url)) {
        const proof = clientProof(f.pr_url, clientSites, run);
        clientHolds.set(f.pr_url, clientSites.map((s) => clientApprovalHold(s, proof)).find(Boolean) ?? "");
      }
      const why = clientHolds.get(f.pr_url);
      if (why) { f.land = "held_client_approval"; f.land_detail = `${clientSites[0].domain ?? prRepo}: ${why}`; continue; }
    }
    const prior = done.get(f.pr_url);
    if (prior) {
      f.land = prior.land; f.land_detail = prior.land_detail;
      if (prior.suggested_action) f.suggested_action = prior.suggested_action;
      continue;
    }
    const num = /\/pull\/(\d+)/.exec(f.pr_url)?.[1];
    const repoDir = join(process.env.AUDIT_GITHUB_ROOT ?? join(homedir(), "GitHub"), prRepo);
    const cwd = f.worktree && existsSync(f.worktree) && prRepo === repoName(f.repo) ? f.worktree : repoDir;
    const checks = run("timeout", ["1800", "gh", "pr", "checks", f.pr_url, "--watch", "--fail-fast"], cwd, env);
    if (checks.status !== 0) {
      f.land = "checks_red";
      f.land_detail = lastLine(checks.out);
    } else {
      let landed = run("timeout", ["3600", landBin, num], cwd, env);
      /*
       * LAND'S CLICK-THROUGH GATE IS MET BY THIS LANE, NOT LEFT UNREACHABLE (17 Nov 2026). ~/bin/land
       * refuses a PR that changes an operated screen (detoxdenver.org #18, components/ClarityLoader.tsx)
       * without a "Clicked through:" line, and nothing here ever wrote one: three rounds redid the same
       * fix and the run stopped SR_QUEUE_STALLED. The refusal is land's own file test, so this reads it
       * rather than copying it: the PR's preview is clicked at 390 px (clickthrough.mjs), a clean run
       * posts the line and lands again; a dirty or unreadable one is `clickthrough_failed` with why.
       */
      if (landed.status !== 0 && /NOT_CLICKED_THROUGH/.test(String(landed.out))) {
        const paths = pathsFrom(payload.findings.filter((x) => x.pr_url === f.pr_url));
        const ct = run("timeout", ["900", process.execPath, CLICKTHROUGH, f.pr_url, "--paths", paths.join(",")], cwd, env);
        if (ct.status === 0) landed = run("timeout", ["3600", landBin, num], cwd, env);
        else landed = { status: ct.status || 1, out: ct.out, clickthrough: true };
      }
      f.land = landed.status === 0 ? "landed" : landed.clickthrough ? "clickthrough_failed" : "land_refused";
      f.land_detail = landReason(landed.out);
      /*
       * A MERGED PR IS NEVER "NOT LANDED" (7 Nov 2026: p-n-p #201/#202 and boss-os #318 were merged,
       * /hotels was live, and the run said land_refused). When land fails, GitHub is asked whether the
       * merge happened; merged means "merged, deploy failed: <reason>" — the deploy is still owed.
       */
      if (f.land === "land_refused") {
        const st = run("gh", ["pr", "view", f.pr_url, "--json", "state", "-q", ".state"], cwd, env);
        if (st.status === 0 && /^MERGED$/m.test(String(st.out).trim())) {
          f.land = "merged_deploy_failed";
          f.land_detail = `merged, deploy failed: ${f.land_detail}`;
        } else {
          /*
           * ON MAIN BUT STILL OPEN IS ALREADY MERGED (9 Nov 2026): approvalprep #80's land lost the
           * network mid-merge; c8833d7 "(#80)" was on main, the PR stayed open and was recorded
           * land_refused for four days. The leftover PR is closed with a one-line comment.
           */
          const sha = onMainSha(f.pr_url, run, cwd, env);
          if (sha) {
            f.land = "already_merged";
            f.land_detail = `already on main as ${sha.slice(0, 7)} (land stopped after the merge); the leftover PR is closed`;
            run("gh", ["pr", "close", f.pr_url, "--comment", `Already on main as ${sha.slice(0, 7)}: land stopped after the merge, so this leftover PR is closed. (Danielle's audit runner)`], cwd, env);
          } else {
            const gate = reviewGate(landed.out, f.pr_url);
            if (gate) { f.land_detail = `NAMED STOP [${gate.code}] ${f.land_detail}`; f.suggested_action = gate.action; }
          }
        }
      }
      if (f.land === "landed") {
        f.suggested_action = `Landed ${f.pr_url} through ~/bin/land: checks green, merged, main watched, deployed. Nothing to do.`;
      }
    }
    if (f.disposition === "in_flight" && !["landed", "merged_deploy_failed", "already_merged"].includes(f.land)) {
      f.land_detail = `${f.land}: ${f.land_detail}`;
      f.land = "blocked";
    }
    done.set(f.pr_url, { land: f.land, land_detail: f.land_detail, suggested_action: f.land === "landed" || /NAMED STOP \[REVIEW_(CLASS|PASS)_MISSING\]/.test(f.land_detail) ? f.suggested_action : null });
  }
  return payload;
}

const PR_FIELDS = "number,state,isDraft,headRefName,headRefOid,baseRefName,mergeable,statusCheckRollup,files,createdAt,url";
const slugOf = (url) => /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(String(url ?? ""))?.[1] ?? null;

/** The sha on the PR's base branch that already carries it (mergedOnMain), or null. Unread = null. */
function onMainSha(url, run, cwd, env) {
  const view = run("gh", ["pr", "view", url, "--json", "number,headRefOid,baseRefName"], cwd, env);
  let pr; try { pr = JSON.parse(view.out); } catch { return null; }
  if (view.status !== 0 || !pr?.baseRefName) return null;
  const log = run("gh", ["api", `repos/${slugOf(url)}/commits?sha=${pr.baseRefName}&per_page=50`, "--jq", "[.[] | {sha, subject: (.commit.message | split(\"\\n\")[0])}]"], cwd, env);
  try { return log.status === 0 ? mergedOnMain(pr, JSON.parse(log.out)) : null; } catch { return null; }
}

/**
 * What clientApprovalHold reads: every changed file with GitHub's status (added, modified, removed,
 * renamed), and for each touched approval-queue file its text on the base and at the head. An unread
 * or capped list (GitHub stops at 3000 files) is files: null, which holds the PR.
 */
function clientProof(url, clientSites, run) {
  const num = /\/pull\/(\d+)/.exec(String(url ?? ""))?.[1];
  const list = run("gh", ["api", `repos/${slugOf(url)}/pulls/${num}/files`, "--paginate", "--jq", ".[] | [.status, .filename] | @tsv"], undefined);
  let files = list.status === 0 ? String(list.out).split("\n").filter(Boolean).map((l) => { const [status, path] = l.split("\t"); return { status, path }; }) : null;
  if (files && files.length >= 3000) files = null;
  const contents = {};
  const queue = new Set(clientSites.flatMap((s) => s.client_approval_queue_files ?? []));
  const touched = (files ?? []).filter((f) => queue.has(f.path));
  if (touched.length) {
    const view = run("gh", ["pr", "view", url, "--json", "baseRefName,headRefOid"], undefined);
    let pr = null; try { if (view.status === 0) pr = JSON.parse(view.out); } catch { /* unread: the hold fails closed */ }
    const read = (path, ref) => {
      if (!ref) return undefined;
      const r = run("gh", ["api", `repos/${slugOf(url)}/contents/${path}?ref=${ref}`, "-H", "Accept: application/vnd.github.raw"], undefined);
      return r.status === 0 ? r.out : (/HTTP 404|Not Found/i.test(String(r.out)) ? null : undefined);
    };
    for (const f of touched) contents[f.path] = { base: f.status === "added" ? null : read(f.path, pr?.baseRefName), head: read(f.path, pr?.headRefOid) };
  }
  return { files, contents };
}

/**
 * OUR OWN OPEN PRs IN A REPO, FOR THE NEXT PASS TO FINISH FIRST (9 Nov 2026). Pure over `gh pr list`
 * JSON: the open `danielle/site-audit-*` PRs, each with why it is not landed yet.
 */
export function ownOpenPrs(prs) {
  return (Array.isArray(prs) ? prs : [])
    .filter((p) => p?.state !== "MERGED" && p?.state !== "CLOSED" && String(p?.headRefName ?? "").startsWith("danielle/site-audit-"))
    .map((p) => ({ url: p.url, branch: p.headRefName, title: p.title, why: p.isDraft ? "draft_left_behind" : p.mergeable === "CONFLICTING" ? "conflicting" : "open" }));
}

/**
 * A STALE GRID PR FROM OUR OWN LANE IS AN ACTION, NOT A REPORT LINE (9 Nov 2026). ci-sweep.sh hands
 * the grid inbox here: every `pr_stale` row on a `danielle/site-audit-*` PR open for more than 24h
 * goes through landAll as an orphan (landed if green; already_merged closed) and any that still need
 * the worker (NEEDS_WORKER) re-arm the Search Readiness run, whose next scoped pass finishes them.
 * Returns { lines, rearm }. `view` is injectable for the test.
 */
export function staleGridHandoff(tsv, { now = Date.now(), run = defaultRun, view = (url) => { const r = run("gh", ["pr", "view", url, "--json", "state,headRefName,createdAt"], undefined); try { return r.status === 0 ? JSON.parse(r.out) : null; } catch { return null; } }, ...opts } = {}) {
  const rows = [];
  for (const line of String(tsv ?? "").split("\n")) {
    const [repo, kind, url] = line.split("\t");
    if (kind !== "pr_stale" || !/\/pull\/\d+$/.test(url ?? "") || rows.some((r) => r.pr_url === url)) continue;
    const pr = view(url);
    if (pr?.state !== "OPEN" || !String(pr.headRefName ?? "").startsWith("danielle/site-audit-")) continue;
    if (!(now - Date.parse(pr.createdAt) > 24 * 3600 * 1000)) continue;
    rows.push({ repo: repoName(repo), disposition: "in_flight", pr_url: url });
  }
  if (!rows.length) return { lines: ["HANDOFF none: no own-lane (danielle/site-audit-*) PR in the grid inbox has been open more than 24h"], rearm: false };
  landAll({ findings: rows }, { run, ...opts });
  const needs = (r) => r.land === "blocked" && NEEDS_WORKER.some((v) => String(r.land_detail ?? "").startsWith(v));
  return { lines: rows.map((r) => `HANDOFF ${r.pr_url}: ${r.land}${r.land_detail ? ` (${r.land_detail})` : ""}${needs(r) ? " -> the next Search Readiness pass finishes it" : ""}`), rearm: rows.some(needs) };
}

/** One `LAND <repo> <pr>: <outcome>` line per pull request, never one per row. */
export function landLines(payload) {
  const seen = new Map();
  for (const f of payload.findings ?? []) if (["fixed_pr", "in_flight"].includes(f.disposition) && f.pr_url && !seen.has(f.pr_url)) seen.set(f.pr_url, `LAND ${prRepoOf(f.pr_url) ?? f.repo} ${f.pr_url}: ${f.land === "merged_deploy_failed" ? f.land_detail : f.land}`);
  return [...seen.values()];
}

function defaultRun(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...(env ? { env } : {}) });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(out.split("\n").slice(-15).join("\n") + "\n");
  return { status: r.status ?? 1, out };
}

const lastLine = (s) => String(s ?? "").trim().split("\n").filter(Boolean).pop()?.slice(0, 300) ?? "";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if ((cmd === "verdict" || cmd === "land") && !existsSync(rest[0])) {
    // A RUN THAT NEVER WROTE A FINDINGS FILE IS UNFINISHED, NOT A CRASH (28 Oct 2026). A false
    // sentinel match once let an incomplete pass reach here, and `readFileSync` threw an ENOENT with
    // a Node stack — indistinguishable from "ran and fixed nothing" to the shell around it. Named,
    // not a stack trace: Rule 0.
    console.log(`NAMED STOP [NO_FINDINGS_FILE] ${rest[0]}`);
    process.exit(9);
  }
  if (cmd === "verdict") {
    const v = runVerdict(JSON.parse(readFileSync(rest[0], "utf8")));
    console.log(`AUDIT-VERDICT: ${v.red ? "RED" : "GREEN"} fixed=${v.fixed} ${Object.entries(v.counts).map(([k, n]) => `${k}=${n}`).join(" ")}`);
    for (const r of v.reasons) console.log(`  NAMED STOP [${r.split(":")[0]}] ${r.slice(r.indexOf(":") + 1).trim()}`);
    process.exit(v.red ? 1 : 0);
  } else if (cmd === "land") {
    const payload = JSON.parse(readFileSync(rest[0], "utf8"));
    landAll(payload);
    writeFileSync(rest[0], JSON.stringify(payload, null, 2));
    for (const l of landLines(payload)) console.log(l);
  } else if (cmd === "land-orphans") {
    const root = join(homedir(), ".boss-os/site-audit");
    for (const dir of readdirSync(root).filter(n => n.startsWith("sr-"))) {
      const file = join(root, dir, "findings.json");
      if (!existsSync(file)) continue;
      const payload = JSON.parse(readFileSync(file, "utf8"));
      const orphans = { findings: (payload.findings ?? []).filter(f => f.disposition === "in_flight") };
      landAll(orphans);
      writeFileSync(file, JSON.stringify(payload, null, 2));
      for (const line of landLines(orphans)) console.log(line);
    }
  } else if (cmd === "own-open") {
    const view = spawnSync("gh", ["pr", "list", "-R", repoSlug(rest[0]), "--state", "open", "--limit", "50", "--json", "url,title,headRefName,isDraft,mergeable,state"], { encoding: "utf8" });
    if (view.status !== 0) { console.log(`NAMED STOP [OWN_OPEN_UNREAD] could not list ${rest[0]}'s open PRs`); process.exit(13); }
    for (const p of ownOpenPrs(JSON.parse(view.stdout))) console.log(`OWN_OPEN ${p.url} branch ${p.branch} (${p.why}) — ${p.title}`);
  } else if (cmd === "stale-grid") {
    if (!existsSync(rest[0])) { console.log(`HANDOFF none: no grid inbox at ${rest[0]}`); process.exit(0); }
    const { lines, rearm } = staleGridHandoff(readFileSync(rest[0], "utf8"));
    for (const l of lines) console.log(l);
    if (rearm) {
      const r = spawnSync("bash", [new URL("./search-readiness-fix.sh", import.meta.url).pathname, "--rearm"], { encoding: "utf8" });
      console.log(r.status === 0 ? "HANDOFF rearmed: the Search Readiness run resumes within 15 minutes and finishes them first" : `NAMED STOP [REARM_FAILED] search-readiness-fix.sh --rearm exited ${r.status}`);
      if (r.status !== 0) process.exit(1);
    }
  } else if (cmd === "scope") {
    const queueFile = process.env.SR_QUEUE_FILE ?? join(homedir(), ".boss-os/search-readiness/fix-queue.json");
    const snap = scopeSnapshot({ queue: JSON.parse(readFileSync(queueFile, "utf8")), queueFile, repo: rest[0], briefIds: String(rest[1] ?? "").split(/[\s,]+/).filter(Boolean) });
    console.log(JSON.stringify(snap, null, 2));
  } else if (cmd === "repo-for") {
    console.log(repoForLine(rest[0]));
    process.exit(repoForDomain(rest[0]) ? 0 : 3);
  } else if (cmd === "packet") {
    const queueFile = process.env.SR_QUEUE_FILE ?? join(homedir(), ".boss-os/search-readiness/fix-queue.json");
    let queue;
    try { queue = JSON.parse(readFileSync(queueFile, "utf8")); } catch (e) {
      console.log(`NAMED STOP [NO_PASS_PACKET] the queue ${queueFile} could not be read (${String(e?.message ?? e).split("\n")[0]}); a queue pass never runs without its briefs.`);
      process.exit(11);
    }
    let slug = null, openWork;
    try { slug = repoSlug(rest[0]); } catch (e) { openWork = { unread: `no checkout of ${rest[0]} to name its GitHub repo (${String(e?.message ?? e).split("\n")[0].slice(0, 120)})` }; }
    if (slug) openWork = readOpenWork(slug);
    const pk = passPacket({ queue, queueFile, repo: rest[0], briefIds: String(rest[1] ?? "").split(/[\s,]+/).filter(Boolean), openWork });
    console.log(packetText(pk));
  } else if (cmd === "tokens") {
    let text;
    try { text = readFileSync(rest[0], "utf8"); } catch (e) { console.log(`SESSION-TOKENS unread (${String(e?.message ?? e).split("\n")[0].slice(0, 160)})`); process.exit(0); }
    console.log(sessionTokensLine(text));
  } else if (cmd === "finish") {
    if (!existsSync(rest[0])) { console.log(`NAMED STOP [NO_FINDINGS_FILE] ${rest[0]}`); process.exit(9); }
    const payload = JSON.parse(readFileSync(rest[0], "utf8"));
    const lines = finishPass(payload);
    writeFileSync(rest[0], JSON.stringify(payload, null, 2));
    for (const l of lines) console.log(l);
  } else if (cmd === "inflight") {
    const hit = inflight(rest[0], rest.slice(1));
    // Our own lane's open PR is not someone else's work in flight: the pass finishes it (9 Nov 2026).
    if (hit?.own) console.log(`RESUME_OWN pr ${hit.ref} branch ${hit.branch} — your own unfinished PR: finish it on its branch (FINISH YOUR OWN OPEN PULL REQUESTS); never record in_flight against it`);
    else console.log(hit ? `IN_FLIGHT ${hit.kind} ${hit.ref}${hit.title ? ` — ${hit.title}` : ""}` : "CLEAR");
  } else {
    console.error("usage: site-audit-lib.mjs verdict|land|finish <findings.json> | inflight <repo> <term...> | scope|packet <repo> [ids] | repo-for <domain>");
    process.exit(2);
  }
}
