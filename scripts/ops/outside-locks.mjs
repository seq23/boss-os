#!/usr/bin/env node
/**
 * TONI'S WEEKLY OUTSIDE-LOCKS CHECK (owner, 22 Oct 2026).
 *
 * duty_outside_locks (migration 0288), Fridays 08:40 CT on her Mac (Mondays until the rebalanced week, 1 Nov 2026) through duty-run.sh, `ops` lane —
 * Toni's trading lane is untouched. A lock someone else put on one of her accounts — a LinkedIn
 * restriction, a KDP title review, a suspension at Google, YouTube, Pinterest, Etsy or Meta — arrives
 * as an email and sits there. This reads for those notices in the last 8 days:
 *
 *   spry.vc mailbox    the service account (gmail.readonly), full threads
 *   personal Gmail     direct read-only Gmail OAuth, full threads
 *
 * WHAT SHE SEES (owner, 23 Oct 2026, rule 1): no Toni email. A new lock is a Decide item in Simone's
 * morning email (only she can answer for her own account) with the notice one tap away; an older notice
 * leaving the check window is reported as such; a mailbox it cannot read is a fix job for the team (`planLocks`).
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
  fromDomain, loadState, readNothingStop, saveState, toMorning, fixJob, bossApi,
} from "./lib/duty-kit.mjs";
import { gmailSearchLink } from "../../src/shared/boss/mail/plain.mjs";
import { repairReport } from "../../src/shared/boss/repoChange/repairReport.mjs";
import { execFileSync } from "node:child_process";
import { nameToniHeld, readToniMail, reconcileToniReadings } from "./lib/toni-mail.mjs";

/** Moved lock readings → `{ decide, lines, fixes }`. Pure; tested. */
export function planLocks(moved) {
  const out = { decide: [], lines: [], fixes: [] };
  for (const m of moved) {
    if (m.state === "alert") {
      const { subject: subj = "", domain = "this platform" } = m;
      out.decide.push({ title: `Answer the ${domain} notice on your account?`, body: subj ? `"${subj}"` : "", buttons: [{ label: "Open the email", url: gmailSearchLink(subj) }], priority: 2 });
    } else if (m.state === "cleared" || m.state === "ok") {
      if (m.key.startsWith("lock:")) out.lines.push(`An account notice from ${m.key.split(":")[2]} is outside the latest check window.`);
    } else if (m.state === "stop") {
      out.fixes.push({ title: `Toni cannot check ${m.key.replace("mailbox:", "")} mail for account locks`, prompt: `Toni's weekly outside-locks check (scripts/ops/outside-locks.mjs) could not read ${m.key}: ${m.line} Fix the read. A team chore, never her email.` });
    }
  }
  return out;
}

const DRY = process.argv.includes("--dry");
export const LOCK_MAIL = {
  days: 8,
  kinds: ["lock", "github_ci", "other"],
  connectorQuery: 'newer_than:8d subject:(restricted OR restriction OR suspended OR suspension OR locked OR disabled OR "under review" OR policy OR violation OR blocked OR terminated OR limited OR "action required" OR appeal)',
  instruction: "Identify actual restrictions, suspensions, appeals or platform policy reviews affecting the recipient’s accounts or listings. Routine login alerts, generic marketing policy updates and billing reminders are other. GitHub repository, issue, PR, dependency or build notices are github_ci; a real GitHub account suspension is lock.",
};

/** GitHub's repository-notification envelope. Also recognizes the model's CI verdict on GitHub mail. */
export function githubNotice(m) {
  const domain = m.from_domain ?? fromDomain(m.from);
  if (domain !== "github.com" && !domain.endsWith(".github.com")) return null;
  const subject = String(m.subject ?? "");
  const repo = /^\s*(?:re:\s*)?\[([\w.-]+\/[\w.-]+)\]/i.exec(subject)?.[1] ?? null;
  const fromNotifications = /(?:^|[ <])notifications@github\.com(?:>|$)/i.test(String(m.from ?? ""));
  return repo || fromNotifications || m.kind === "github_ci" ? { repo, subject } : null;
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

/** A model-read account lock becomes the existing Decide reading. */
export function lockReading(m, mailbox, mailboxId) {
  if (m.kind !== "lock" || githubNotice(m)) return null;
  const domain = m.from_domain ?? fromDomain(m.from);
  const subject = m.subject ?? "";
  return { key: `lock:${mailboxId}:${domain}:${m.id}`, state: "alert", domain, subject, line: `${m.date ?? ""} ${domain}: "${subject}" (${mailbox}).`.trim() };
}

/** A red_check repair on Danielle's desk for another repo. Returns why it was not opened, or null. */
async function ciRepairJob(api, { title, prompt }) {
  try { await api.post("/tasks", { title: String(title).slice(0, 160), lane: "ops", employee_id: "emp_repo", input: { origin: "repair", repair_kind: "red_check", prompt } }); return null; }
  catch (e) { return String(e?.message ?? e); }
}

async function main() {
  const prev = loadState("outside-locks");
  const mail = await readToniMail(LOCK_MAIL, prev.mail, Date.now());
  const readings = mail.flatMap((box) => [
    { key: `mailbox:${box.id}`, state: box.why ? "stop" : "ok",
      line: `${box.label}: checked ${box.handled} of ${box.count} listed messages${box.why ? `. ${box.why}` : ""}.` },
    ...box.notices.map((notice) => lockReading(notice, box.label, box.id)).filter(Boolean),
  ]);
  const ciNotices = mail.flatMap((box) => box.notices.map(githubNotice).filter(Boolean));
  for (const r of readings) console.log(`  [${r.state}] ${r.line}`);
  const checkpoints = Object.fromEntries(mail.map((box) => [box.id, box.checkpoint]));
  const stop = readNothingStop(readings, "LOCKS_READ_NOTHING");
  if (stop) {
    if (!DRY) saveState("outside-locks", { ...prev, mail: checkpoints });
    console.error(stop);
    process.exitCode = 3;
    return;
  }
  const previous = Object.fromEntries(Object.entries(prev.states ?? {}).filter(([key]) => !key.startsWith("lock:") || key.startsWith("lock:spry:") || key.startsWith("lock:personal:")));
  const { moved, states } = reconcileToniReadings(readings, previous, mail.filter((box) => box.why).map((box) => `lock:${box.id}:`));
  console.log(`outside locks: ${readings.filter((r) => r.key.startsWith("lock:")).length} lock notice(s), ${moved.length} moved.`);
  const live = Object.fromEntries([...new Set(ciNotices.map((n) => n.repo).filter(Boolean))].map((r) => [r, ciStateOf(r)]));
  const ci = planCiNotices(ciNotices, live, { handed: prev.ci_handed ?? {} });
  console.log(`github notices: ${ciNotices.length} (${Object.entries(live).map(([r, s]) => `${r} ${s}`).join(", ") || "none"}), ${ci.fixes.length} repair(s).`);
  if (DRY) { console.log("OUTSIDE-LOCKS-COMPLETE: dry"); return; }
  const heldCount = await nameToniHeld(mail, "account lock or restriction emails");
  if (heldCount) console.log(`NOTE [HELD_FOR_HER] ${heldCount} account lock or restriction emails held for her in the morning email after three uncertain reads.`);
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
  saveState("outside-locks", { at: new Date().toISOString(), states, mail: checkpoints, ci_handed: ciHanded });
  if (mail.some((box) => box.why)) {
    console.error("NAMED STOP [LOCKS_MAIL_UNREAD] At least one source will be retried");
    process.exitCode = 3;
    return;
  }
  console.log(`OUTSIDE-LOCKS-COMPLETE: ${moved.length} moved`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`OUTSIDE-LOCKS FAILED: ${err?.message ?? err}`); process.exit(1); });
}
