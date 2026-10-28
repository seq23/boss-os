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
 *   verdict <findings.json>     RULE 0: a pass that left fixable defects unfixed exits RED, named
 *
 * WHY LANDING MOVED IN HERE. The first version of this duty said "IT MERGES NOTHING. She merges."
 * That contradicted her standing rules — merge green PRs without asking (14 Sep), merge and deploy
 * are one action through `~/bin/land` (18 Sep), nothing waits on the owner (25 Sep), repairs found
 * in passing need no yes — and left every fix it might have made waiting on her. It still never
 * calls a bare merge or a deploy itself: `~/bin/land` refuses rather than guesses (not green, head
 * moved, main red), watches main to a terminal state and deploys, and that is the only door.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { mayAutoFix } from "../../src/shared/boss/siteAudit/repoPolicy.mjs";
import { scopeSnapshot } from "../../src/shared/boss/siteAudit/evidence.mjs";
import { repoForDomain } from "../../src/shared/boss/siteAudit/domainRepos.mjs";

/** Dispositions that are a CONFIRMED site defect in a repo the fixer may change. */
const FIXABLE_LEFT = new Set(["surfaced"]);
/** Dispositions that claim the run looked at the live site, and so must carry the evidence. */
const NEEDS_CRAWL = new Set(["surfaced", "fixed_pr"]);

/**
 * RULE 0 for the pass. Returns { red, reasons, counts }.
 *
 *   FIXABLE_LEFT_UNFIXED  fixed=0 while a confirmed, fixable defect was surfaced — the 15/16 Oct shape
 *   NOT_LANDED            a PR was opened and did not land: work left waiting on her
 *   NOT_CRAWLED           a row claims a defect (or a fix) with no crawl of the live site behind it
 *   NOT_PROBED            an Ahrefs-side crawl failure asserted with no outside probe behind it
 */
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
    if (f.disposition === "fixed_pr" && f.land !== "landed") {
      reasons.push(`NOT_LANDED: ${who}: ${f.pr_url ?? "no PR"} is ${f.land ?? "not landed"}${f.land_detail ? ` (${f.land_detail})` : ""}`);
    }
    if (NEEDS_CRAWL.has(f.disposition) && !(f.crawl && Number(f.crawl.pages_crawled) > 0)) {
      reasons.push(`NOT_CRAWLED: ${who}: no crawl of the live site recorded, so the row rests on the Ahrefs mail alone.`);
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
 */
export function matchInFlight(prs, branches, terms) {
  const t = terms.map((x) => String(x).toLowerCase()).filter(Boolean);
  if (t.length === 0) return null;
  const hit = (s) => t.some((x) => String(s ?? "").toLowerCase().includes(x));
  for (const p of prs) {
    const files = (p.files ?? []).map((f) => f.path ?? f).join(" ");
    if (hit(p.title) || hit(p.body) || hit(p.headRefName) || hit(files)) {
      return { kind: "pr", ref: p.url ?? `#${p.number}`, title: p.title };
    }
  }
  for (const b of branches) {
    if (/^(main|master|gh-pages)$/.test(b)) continue;
    if (hit(b)) return { kind: "branch", ref: b };
  }
  return null;
}

export function inflight(repo, terms) {
  const slug = repoSlug(repo);
  const prs = JSON.parse(execFileSync("gh", ["pr", "list", "-R", slug, "--state", "open", "--limit", "50",
    "--json", "number,title,body,headRefName,url,files"], { encoding: "utf8" }));
  const branches = JSON.parse(execFileSync("gh", ["api", `repos/${slug}/branches?per_page=100`, "--jq", "[.[].name]"],
    { encoding: "utf8" }));
  return matchInFlight(prs, branches, terms);
}

/**
 * Land every `fixed_pr` row: checks to green (30 min cap), then `~/bin/land` from the repo's
 * worktree. The result is written onto the row (`land`, `land_detail`) so the verdict and Boss OS
 * both see it. `run` is injectable for the test.
 */
export function landAll(payload, { run = defaultRun, landBin = process.env.AUDIT_LAND_BIN ?? join(homedir(), "bin/land") } = {}) {
  /*
   * ONE LAND PER PULL REQUEST (26 Oct 2026). A PR that fixes five briefs is five `fixed_pr` rows, and
   * this used to watch checks and run ~/bin/land once per ROW: five lands of one PR, four of them
   * "already MERGED … nothing to merge", and five identical LAND lines in the log. The first row's
   * outcome is now written onto every row that shares its pr_url.
   */
  const done = new Map();
  for (const f of payload.findings ?? []) {
    if (f.disposition !== "fixed_pr" || !f.pr_url || f.land === "landed") continue;
    if (!mayAutoFix(f.repo)) { f.land = "refused_policy"; continue; }
    const prior = done.get(f.pr_url);
    if (prior) {
      f.land = prior.land; f.land_detail = prior.land_detail;
      if (prior.suggested_action) f.suggested_action = prior.suggested_action;
      continue;
    }
    const num = /\/pull\/(\d+)/.exec(f.pr_url)?.[1];
    const cwd = f.worktree && existsSync(f.worktree) ? f.worktree
      : join(process.env.AUDIT_GITHUB_ROOT ?? join(homedir(), "GitHub"), String(f.repo));
    const checks = run("timeout", ["1800", "gh", "pr", "checks", f.pr_url, "--watch", "--fail-fast"], cwd);
    if (checks.status !== 0) {
      f.land = "checks_red";
      f.land_detail = lastLine(checks.out);
    } else {
      const landed = run("timeout", ["3600", landBin, num], cwd);
      f.land = landed.status === 0 ? "landed" : "land_refused";
      f.land_detail = lastLine(landed.out);
      if (f.land === "landed") {
        f.suggested_action = `Landed ${f.pr_url} through ~/bin/land: checks green, merged, main watched, deployed. Nothing to do.`;
      }
    }
    done.set(f.pr_url, { land: f.land, land_detail: f.land_detail, suggested_action: f.land === "landed" ? f.suggested_action : null });
  }
  return payload;
}

/** One `LAND <repo> <pr>: <outcome>` line per pull request, never one per row. */
export function landLines(payload) {
  const seen = new Map();
  for (const f of payload.findings ?? []) if (f.disposition === "fixed_pr" && f.pr_url && !seen.has(f.pr_url)) seen.set(f.pr_url, `LAND ${f.repo} ${f.pr_url}: ${f.land}`);
  return [...seen.values()];
}

function defaultRun(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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
  } else if (cmd === "scope") {
    const queueFile = process.env.SR_QUEUE_FILE ?? join(homedir(), ".boss-os/search-readiness/fix-queue.json");
    const snap = scopeSnapshot({ queue: JSON.parse(readFileSync(queueFile, "utf8")), queueFile, repo: rest[0], briefIds: String(rest[1] ?? "").split(/[\s,]+/).filter(Boolean) });
    console.log(JSON.stringify(snap, null, 2));
  } else if (cmd === "repo-for") {
    const r = repoForDomain(rest[0]);
    console.log(r ? (r.repo ? `REPO ${r.repo} (${r.source})` : `NO_REPO ${r.why}`) : "UNKNOWN: this domain is in neither sites.json nor AUDITED_ELSEWHERE (src/shared/boss/siteAudit/domainRepos.mjs); add it there with its repo or the reason it has none.");
    process.exit(r ? 0 : 3);
  } else if (cmd === "inflight") {
    const hit = inflight(rest[0], rest.slice(1));
    console.log(hit ? `IN_FLIGHT ${hit.kind} ${hit.ref}${hit.title ? ` — ${hit.title}` : ""}` : "CLEAR");
  } else {
    console.error("usage: site-audit-lib.mjs verdict|land <findings.json> | inflight <repo> <term...> | scope <repo> [ids] | repo-for <domain>");
    process.exit(2);
  }
}
