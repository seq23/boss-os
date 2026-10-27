#!/usr/bin/env node
/**
 * TONI'S WEEKLY OUTSIDE-LOCKS CHECK (owner, 22 Oct 2026).
 *
 * duty_outside_locks (migration 0288), Mondays 08:40 CT on her Mac through duty-run.sh, `ops` lane —
 * Toni's trading lane is untouched. A lock someone else put on one of her accounts — a LinkedIn
 * restriction, a KDP title review, a suspension at Google, YouTube, Pinterest, Etsy or Meta — arrives
 * as an email and sits there. This reads for those notices in the last 8 days:
 *
 *   spry.vc mailbox    the service account (gmail.readonly), headers only, never a body
 *   personal Gmail     her Claude session's Gmail connector (one short Haiku run), headers only
 *
 * WHAT SHE SEES (owner, 23 Oct 2026, rule 1): no Toni email. A new lock is a Decide item in Simone's
 * morning email (only she can answer for her own account) with the notice one tap away; a lock that is
 * gone is a "Done for you" line; a mailbox it cannot read is a fix job for the team (`planLocks`).
 * Rule 0: both mailboxes unreadable → exit 3.
 *
 * GITHUB'S OWN NOTIFICATION MAIL IS NEVER A LOCK AND NEVER HERS TO DECIDE (owner, 27 Oct 2026).
 * "[seq23/local-guides-generator] PR run failed: Validate - Drop form leads from blocked email
 * domains quietly" matched github.com + "blocked" and became "Answer the github.com notice on your
 * account?" in Decide, for a PR merged long before on a green main. A CI or PR email (a
 * "[owner/repo] …" subject, or a run/workflow/pull-request notice) is routed by `planCiNotices`:
 * still red on the repo's default branch (checked with `gh`) → a red_check repair on Danielle's desk
 * and at most one thin "What broke / What we did / Status" line; already green, or the PR closed →
 * dropped silently. Pinned by tests/githubNoticesNeverDecide.test.ts.
 *
 *   npm run risk:locks             # read and email what moved
 *   npm run risk:locks -- --dry    # read and print only
 */
import {
  askClaudeJson, fromDomain, gmailHeaders, googleToken, loadState, movedReadings, readNothingStop,
  saveState, stateMap, toMorning, fixJob, bossApi,
} from "./lib/duty-kit.mjs";
import { gmailSearchLink } from "../../src/shared/boss/mail/plain.mjs";
import { repairReport } from "../../src/shared/boss/repoChange/repairReport.mjs";
import { execFileSync } from "node:child_process";

/** Moved lock readings → `{ decide, lines, fixes }`. Pure; tested. */
export function planLocks(moved) {
  const out = { decide: [], lines: [], fixes: [] };
  for (const m of moved) {
    // A GitHub CI/PR notice never reaches her from here, alerting or cleared (planCiNotices owns it).
    if (m.key.startsWith("lock:github.com:") && GITHUB_NOTICE_SLUG_RE.test(m.key.slice("lock:github.com:".length))) continue;
    if (m.state === "alert" && /\sgithub\.com: "/.test(` ${m.line}`) && githubNotice({ from_domain: "github.com", subject: /"([^"]+)"/.exec(m.line)?.[1] ?? "" })) continue;
    if (m.state === "alert") {
      const subj = /"([^"]+)"/.exec(m.line)?.[1] ?? "";
      const domain = /\s([a-z0-9.-]+\.[a-z]{2,}):/i.exec(` ${m.line}`)?.[1] ?? "an account";
      out.decide.push({ title: `Answer the ${domain} notice on your account?`, body: subj ? `"${subj}"` : "", buttons: [{ label: "Open the email", url: gmailSearchLink(subj) }], priority: 2 });
    } else if (m.state === "cleared" || m.state === "ok") {
      if (m.key.startsWith("lock:")) out.lines.push(`An account notice from ${m.key.split(":")[1]} is no longer showing (resolved or older than 8 days).`);
    } else if (m.state === "stop") {
      out.fixes.push({ title: `Toni cannot check ${m.key.replace("mailbox:", "")} mail for account locks`, prompt: `Toni's weekly outside-locks check (scripts/ops/outside-locks.mjs) could not read ${m.key}: ${m.line} Fix the read. A team chore, never her email.` });
    }
  }
  return out;
}

const DRY = process.argv.includes("--dry");
/** The one model this duty names (its duty row says the same): a short Haiku run on her Claude seat, mail headers or the gallery only. */
export const MODEL = "claude-haiku-4-5-20251001";

/** The senders whose notices are locks, and the words that make one a lock. */
export const LOCK_SENDERS = Object.freeze([
  "linkedin.com", "amazon.com", "kdp.amazon.com", "google.com", "youtube.com", "pinterest.com", "etsy.com",
  "facebookmail.com", "meta.com", "stripe.com", "cloudflare.com", "github.com",
]);
export const LOCK_RE = /\b(restrict(?:ed|ion)|suspend(?:ed|ion)|locked|disabled|under review|in review|policy violation|violat(?:es|ion)|blocked|terminated|limited|action required|appeal)\b/i;

export const LOCK_QUERY =
  `newer_than:8d (from:(${LOCK_SENDERS.join(" OR ")})) (subject:(restricted OR restriction OR suspended OR suspension OR locked OR disabled OR "under review" OR "policy" OR violation OR blocked OR terminated OR limited OR "action required" OR appeal))`;

/**
 * GitHub's own notification mail: a "[owner/repo] …" subject (every CI, PR, issue and review mail
 * GitHub sends carries one), mail from notifications@github.com, or a run/workflow/pull-request
 * notice. `{ repo, subject }` (repo null when the subject names none), or null for anything else —
 * a real account notice from GitHub ("Your account has been suspended") stays a lock.
 */
export const GITHUB_REPO_SUBJECT_RE = /^\s*(?:re:\s*)?\[([\w.-]+\/[\w.-]+)\]/i;
export const GITHUB_NOTICE_RE = /\b(?:run (?:failed|cancelled|canceled|succeeded)|workflow|pull request|PR run|checks? (?:failed|passed)|dependabot|deployment (?:failed|review))\b/i;
/** The same test on a lock key's slug (lowercased, punctuation gone): old state never resurfaces. */
export const GITHUB_NOTICE_SLUG_RE = /^re\b|\b(?:pr run|run failed|run cancelled|run canceled|run succeeded|workflow|pull request|checks? failed|dependabot)\b/;
export function githubNotice(m) {
  const domain = m.from_domain ?? fromDomain(m.from);
  if (!(domain === "github.com" || domain.endsWith(".github.com"))) return null;
  const subject = String(m.subject ?? "");
  const repo = GITHUB_REPO_SUBJECT_RE.exec(subject)?.[1] ?? null;
  const fromNotifications = /notifications@github\.com/i.test(String(m.from ?? ""));
  return repo || fromNotifications || GITHUB_NOTICE_RE.test(subject) ? { repo, subject: subject.slice(0, 140) } : null;
}

/**
 * GitHub notices + what `gh` says now → `{ fixes, lines }`. Pure; tested.
 * `live[repo]` is "red" (a workflow's newest run on the default branch failed), "green", "closed"
 * or "unknown". Red or unknown → one red_check repair per repo for Danielle and one thin line;
 * green or closed → nothing at all. Never a Decide item.
 */
export function planCiNotices(notices, live = {}, { at = Date.now(), handed = {} } = {}) {
  const out = { fixes: [], lines: [] };
  const repos = [...new Set(notices.map((n) => n.repo).filter(Boolean))];
  for (const repo of repos) {
    const state = live[repo] ?? "unknown";
    if (state === "green" || state === "closed") continue;
    if (handed[repo] && at - Date.parse(handed[repo]) < 6 * 86_400_000) continue;
    const name = repo.split("/")[1];
    const subj = notices.find((n) => n.repo === repo)?.subject ?? "";
    out.fixes.push({
      repo,
      title: `Fix the red check on ${repo}`,
      prompt: `${repo} — GitHub mailed "${subj}". ${state === "red" ? "The newest run of a workflow on the default branch failed" : "Whether the default branch is still red could not be read"}. Check with gh; if red, find the cause, fix it at source with a test, land it and watch the default branch green; if green, close with the reason. A repair: never her email.`,
    });
    const r = repairReport({ kind: "red_check", whatBroke: `An automatic check on ${name} found a problem.`, whatWeDid: "Danielle took it as a repair and is fixing it.", live: false, at });
    out.lines.push(`What broke: ${r.whatBroke} What we did: ${r.whatWeDid} Status: ${r.status}`);
  }
  return out;
}

/** What `gh` says about a repo's default branch now: "red" | "green" | "unknown". */
export function ciStateOf(repo, run = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 })) {
  try {
    const branch = run(["api", `repos/${repo}`, "--jq", ".default_branch"]).trim();
    const runs = JSON.parse(run(["run", "list", "--repo", repo, "--branch", branch, "--limit", "40", "--json", "workflowName,status,conclusion"]));
    const newest = new Map();
    for (const r of runs) if (r.status === "completed" && !newest.has(r.workflowName)) newest.set(r.workflowName, r.conclusion);
    if (!newest.size) return "unknown";
    return [...newest.values()].some((c) => c === "failure" || c === "timed_out" || c === "startup_failure") ? "red" : "green";
  } catch { return "unknown"; }
}

/** One header row → a lock reading, or null when the subject is not a lock. Pure. */
export function lockReading(m, mailbox) {
  const domain = m.from_domain ?? fromDomain(m.from);
  const subject = String(m.subject ?? "").slice(0, 140);
  if (githubNotice(m)) return null;
  if (!LOCK_RE.test(subject)) return null;
  if (!LOCK_SENDERS.some((d) => domain === d || domain.endsWith(`.${d}`))) return null;
  return { key: `lock:${domain}:${subject.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60)}`, state: "alert", line: `${m.date ?? ""} ${domain}: "${subject}" (${mailbox}).`.trim() };
}

/** GitHub CI/PR notices seen this run (never locks); routed by planCiNotices in main. */
const CI_NOTICES = [];

/** A red_check repair on Danielle's desk for another repo. Returns why it was not opened, or null. */
async function ciRepairJob(api, { title, prompt }) {
  try { await api.post("/tasks", { title: String(title).slice(0, 160), lane: "ops", employee_id: "emp_repo", input: { origin: "repair", repair_kind: "red_check", prompt } }); return null; }
  catch (e) { return String(e?.message ?? e); }
}

async function readSpry() {
  try {
    const token = await googleToken("https://www.googleapis.com/auth/gmail.readonly", "staylor@spry.vc");
    const hits = await gmailHeaders(token, LOCK_QUERY, 30);
    CI_NOTICES.push(...hits.map(githubNotice).filter(Boolean));
    return [{ key: "mailbox:spry", state: "ok", line: `spry.vc read: ${hits.length} candidate notice(s).` }, ...hits.map((m) => lockReading(m, "spry.vc")).filter(Boolean)];
  } catch (e) {
    return [{ key: "mailbox:spry", state: "stop", line: `The spry.vc mailbox could not be read (${String(e?.message ?? e).slice(0, 120)}).` }];
  }
}

function readPersonal() {
  const a = askClaudeJson(
    `Use the Gmail tool on my mailbox. Search exactly: ${LOCK_QUERY}. Do not open bodies. ` +
    "Reply with ONLY a JSON array, one object per message: {\"from_domain\":\"<sender domain>\",\"subject\":\"<subject, max 140 chars>\",\"date\":\"YYYY-MM-DD\"}. No results is [].",
    { model: MODEL, toolSearch: "gmail", requireTool: /gmail/i },
  );
  if (!a.ok || !Array.isArray(a.json)) return [{ key: "mailbox:personal", state: "stop", line: `Her personal Gmail could not be read: ${a.ok ? "the answer was not a list" : a.why}.` }];
  CI_NOTICES.push(...a.json.map(githubNotice).filter(Boolean));
  return [{ key: "mailbox:personal", state: "ok", line: `Personal Gmail read: ${a.json.length} candidate notice(s).` }, ...a.json.map((m) => lockReading(m, "personal Gmail")).filter(Boolean)];
}

async function main() {
  const prev = loadState("outside-locks");
  const readings = [...(await readSpry()), ...readPersonal()];
  for (const r of readings) console.log(`  [${r.state}] ${r.line}`);
  const stop = readNothingStop(readings, "LOCKS_READ_NOTHING");
  if (stop) { console.error(stop); process.exit(3); }
  const moved = movedReadings(readings, prev.states ?? {});
  console.log(`outside locks: ${readings.filter((r) => r.key.startsWith("lock:")).length} lock notice(s), ${moved.length} moved.`);
  const live = Object.fromEntries([...new Set(CI_NOTICES.map((n) => n.repo).filter(Boolean))].map((r) => [r, ciStateOf(r)]));
  const ci = planCiNotices(CI_NOTICES, live, { handed: prev.ci_handed ?? {} });
  console.log(`github notices: ${CI_NOTICES.length} (${Object.entries(live).map(([r, s]) => `${r} ${s}`).join(", ") || "none"}), ${ci.fixes.length} repair(s).`);
  if (DRY) { console.log("OUTSIDE-LOCKS-COMPLETE: dry"); return; }
  const ciHanded = { ...(prev.ci_handed ?? {}) };
  if (ci.fixes.length) {
    let api = null;
    try { api = await bossApi(); } catch (e) { console.error(String(e?.message ?? e)); }
    const opened = [];
    for (const f of ci.fixes) {
      const why = api ? await ciRepairJob(api, f) : "Boss OS was not reachable";
      console.log(`  repair: ${f.title}${why ? ` — NOT opened (${why})` : ""}`);
      if (!why) { opened.push(ci.lines[ci.fixes.indexOf(f)]); ciHanded[f.repo] = new Date().toISOString(); }
    }
    if (opened.length && !toMorning("risk", { lines: opened })) { console.error("state not saved."); process.exit(8); }
  }
  if (moved.length) {
    const plan = planLocks(moved);
    if (plan.fixes.length) {
      let api = null;
      try { api = await bossApi(); } catch (e) { console.error(String(e?.message ?? e)); }
      for (const f of plan.fixes) { const why = api ? await fixJob(api, f) : "Boss OS was not reachable"; console.log(`  fix job: ${f.title}${why ? ` — NOT opened (${why})` : ""}`); }
    }
    if ((plan.lines.length || plan.decide.length) && !toMorning("risk", { lines: plan.lines, decide: plan.decide })) {
      console.error("state not saved."); process.exit(8);
    }
  }
  saveState("outside-locks", { at: new Date().toISOString(), states: stateMap(readings), ci_handed: ciHanded });
  console.log(`OUTSIDE-LOCKS-COMPLETE: ${moved.length} moved`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`OUTSIDE-LOCKS FAILED: ${err?.message ?? err}`); process.exit(1); });
}
