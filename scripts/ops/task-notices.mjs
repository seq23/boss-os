#!/usr/bin/env node
/**
 * AN OPS TASK THAT COULD NOT DO WHAT SHE ASKED TELLS HER SO, BY EMAIL.
 *
 * ─── The gap this closes ────────────────────────────────────────────────────
 *
 * Nothing in Boss OS has ever sent a completion email for a generic `ops` / `one_off` task.
 * `#danielle` repo changes get one (`repo-change.mjs`), the KDP watch gets one (`notify.mjs`), the
 * capital and people duties get one — and every single one of those runs HERE, on her Mac, because
 * the Worker's only outbound mail capability is `message.reply()` on a live inbound Email Routing
 * event and a queue consumer twenty minutes later has no such event to reply to.
 *
 * So on 22 September 2026, when `tsk_m351xejbtekke2cb` answered "I do not have direct access to…"
 * and sat in `awaiting_approval`, there was no mechanism by which she could have learned that
 * except opening a screen and noticing. `queue/consumer.ts` now recognises that reply and writes
 * the message down in `boss_task_notices`; this drains it.
 *
 * ─── IT SENDS THROUGH `notify.mjs` AND HOLDS NO ROSTER OF ITS OWN ───────────
 *
 * `sendersFor` refuses a name that is not on the roster rather than turning it into an address,
 * because a verified domain signs any local part and an invented sender would deliver perfectly and
 * belong to nobody. The row carries the employee's NAME for exactly that reason; the address is
 * derived here, once, by the module that owns it.
 *
 * ─── Rule 0: IT MAY NOT EXIT 0 HAVING DONE NOTHING SILENTLY ─────────────────
 *
 * Nothing pending is a legitimate no-op and says so on stdout. A refused send is recorded on the
 * row through `/failed` and exits non-zero, so the log line in `~/Library/Logs/boss-os/agent.err`
 * is the trace. A notice that failed quietly would be this script's own defect — the same silence
 * one level up.
 *
 *   npm run notices:send            # through the vault, from com.seq.boss-agent
 *   node scripts/ops/task-notices.mjs --dry-run
 */

import { sendersFor, employeeMail, postEmployeeMail, FALLBACK_STOP, ownerTo } from "./notify.mjs";
import { vaultLookup } from "../lib/vault-env.mjs";
import { legacyParts } from "../../src/shared/boss/mail/plain.mjs";
import { ownerEmail } from "../../src/shared/boss/mail/ownerLayout.mjs";
import { researchFullEmail, researchPageIdIn } from "../../src/shared/boss/research/doneEmail.mjs";
import { researchPageUrl, markdownToHtml } from "../../src/shared/boss/research/page.mjs";
import { emailsHer, needsHer } from "../../src/shared/boss/mail/noticeGate.mjs";

/*
 * ─── A "STOPPED" EMAIL IS A PROBLEM EMAIL, AND ONLY WHILE IT IS TRUE (owner, 23 Oct 2026, rule 3) ───
 *
 * Her inbox, 22 Oct: a "Stopped" email arrived three hours AFTER the tail said the job was fixed. So
 * before a stopped notice goes, the task is read again (`stillStopped`): a task that is running, done
 * or back in the queue is a false alarm and is closed without an email. Two notices with the same
 * sender and subject in one drain are one email (`mergeNotices`). A stopped notice is laid out as
 * What happened → What we did → Status, with one Decide item, because only she can say run it again
 * or drop it (`stoppedEmail`).
 */
const ORIGIN_URL = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";

/** A task in one of these is still stopped; anything else means the notice is a false alarm. */
export const STOPPED_STATES = new Set(["failed", "awaiting_approval", "dead_letter", "blocked"]);
export function stillStopped(task) {
  return Boolean(task) && STOPPED_STATES.has(String(task.status));
}

/** Same sender, same subject → one email; the rest ride along and are marked sent with it. */
export function mergeNotices(items) {
  const groups = new Map();
  for (const n of items) {
    const k = `${n.from_name}\u0000${String(n.subject).replace(/\s*\[?tsk_[a-z0-9]+\]?\s*$/i, "").trim().toLowerCase()}`;
    if (!groups.has(k)) groups.set(k, { first: n, also: [] });
    else groups.get(k).also.push(n);
  }
  return [...groups.values()];
}

/**
 * THE ROUTER'S REFUSAL IN HER WORDS (6 Nov 2026 live read: "No model on this place satisfied policy: 8
 * of 15 refused at capability — model is cleared to low risk, task is high"). Pure.
 */
export function plainStopWhy(why) {
  const w = String(why ?? "").replace(/^NAMED STOP \[[A-Z_]+\]\s*/, "").trim();
  if (!w) return null;
  if (/satisf(?:y|ied) policy|refused at capability|cleared to \w+ risk/i.test(w)) {
    return "none of the AI models this job is allowed to use was cleared for work this important";
  }
  if (/usage limit|CODEX_LIMIT|out of usage/i.test(w)) return "the AI it was given had run out of usage";
  // The reaper's two log sentences (backends/reap.ts), said to her (7 Nov 2026 live read: "The
  // claimer on her Mac (com.seq.boss-agent) is not picking work up").
  if (/No device claimed this run/i.test(w)) return "your Mac did not pick the work up, so it never started";
  if (/claimed this run .* and never reported/i.test(w)) return "the Mac running it stopped before it finished";
  return w;
}

/** The stopped notice as a problem email. Pure; tested. */
export function stoppedEmail(notice, task = null) {
  const body = String(notice.body ?? "");
  const title = String(task?.title ?? /^"([^"]+)"/.exec(body)?.[1] ?? String(notice.subject).replace(/^Stopped:\s*/i, "")).replace(/\s*\[?tsk_[a-z0-9]+\]?\s*$/i, "");
  const tried = /I tried this (.+?) and could not finish/.exec(body)?.[1] ?? "more than once";
  const why = plainStopWhy(/could not finish:\s*(.+?)\.\s*To clear it by email/s.exec(body)?.[1]?.replace(/\s+/g, " ").slice(0, 240));
  const taskId = /^tsk_[a-z0-9]+$/.test(String(notice.task_id ?? "")) ? String(notice.task_id) : null;
  // The owner layout (7 Nov 2026): a stop on her work is an alarm (C), the REF in the subject.
  return ownerEmail({
    who: notice.from_name,
    layout: "alarm",
    why: `"${title}" stopped before it finished, and only you can say whether it runs again`,
    act: "Reply try again, or drop it",
    subject: `Stopped: ${title}`,
    broke: `"${title}" stopped before it finished${why ? `: ${why.replace(/[.!?]?$/, ".")}` : "."}`,
    lost: "Nothing. Everything was kept as it was.",
    doing: `Tried it ${tried}, and sent nothing to anyone outside Boss OS.`,
    status: "Waiting for your word. Reply to this email with try again, or with drop it to close it.",
    decide: [{ title: "Run it again, change it, or drop it?", body: "Reply to this email with your answer; it goes straight back to this job.", buttons: [{ label: "See the job in Boss OS", url: taskId ? `${ORIGIN_URL}/?task=${taskId}` : `${ORIGIN_URL}/` }] }],
    refs: [String(notice.task_id ?? "")].filter((r) => /^tsk_/.test(r)),
  });
}

/**
 * KENDRA'S TWO ALARMS THAT REACH HER (owner, 13 Nov 2026): a duty that has not run 2 days running
 * (`duty_not_running`, written by queue/consumer.ts `dutyNotRunning`) and a morning email that did not
 * go (`morning_missing`, alarms/kendra.ts `morningEmailCheck`). The Worker writes the three parts as
 * labelled lines; this lays them out as an alarm with nothing for her to do. Null for any other notice
 * or one without its parts (it then goes as the plain note it always did). Pure; tested.
 */
export const ALARM_KINDS = Object.freeze(["duty_not_running", "morning_missing"]);
export function alarmNoticeEmail(notice) {
  if (!ALARM_KINDS.includes(String(notice?.kind ?? ""))) return null;
  const part = (label) => new RegExp(`^${label}:[ \\t]*(.+)$`, "m").exec(String(notice.body ?? ""))?.[1]?.trim() ?? null;
  const broke = part("What broke");
  const doing = part("What is being done");
  if (!broke || !doing) return null;
  return ownerEmail({
    who: notice.from_name,
    layout: "alarm",
    why: broke.split(/(?<=[.!?])\s+/)[0],
    act: "Nothing to do",
    subject: String(notice.subject ?? "").replace(/\s*\[?tsk_[a-z0-9]+\]?\s*$/i, ""),
    broke,
    lost: part("What was lost") ?? "Nothing.",
    doing,
    status: notice.kind === "morning_missing" ? "Being fixed. You will get the morning email itself as soon as it works." : "Waiting to run again. You will not hear about this again unless it changes.",
    decide: [],
  });
}

/** The Central day a morning_missing notice is about, from its key ("morning-2026-11-13"); null otherwise. Pure. */
export function morningDayOf(notice) {
  return notice?.kind === "morning_missing" ? (/^morning-(\d{4}-\d{2}-\d{2})$/.exec(String(notice.task_id ?? ""))?.[1] ?? null) : null;
}

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const TO = ownerTo();
const DRY = process.argv.includes("--dry-run");

const say = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const stop = (code, tag, why) => { console.error(`NAMED STOP [${tag}] ${why}`); process.exit(code); };

let cookie = "";

async function unlock() {
  if (!process.env.BOSS_PASSCODE) {
    stop(4, "NO_PASSCODE", "this runs through the vault: npm run vault:run -- node scripts/ops/task-notices.mjs");
  }
  const res = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!res.ok) stop(5, "UNLOCK_FAILED", `Boss OS refused the passcode (${res.status}).`);
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function api(path, body) {
  const res = await fetch(`${ORIGIN}/api/boss/task-notices${path}`, {
    method: body ? "POST" : "GET",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: json?.data ?? null, error: json?.error ?? null };
}

/**
 * A RESEARCH PAGE'S DONE NOTICE IS LAID OUT FROM THE PAGE (repair, 6 Nov 2026): the answer, the
 * 1-minute summary, the key numbers and the gaps in the body, one "Open the full report ›" link
 * (`researchDoneLayout`). Pure: `page` is the filed page as data, or null to send the row's own text.
 */
export function researchDoneEmail(notice, page, who) {
  if (!String(notice?.kind ?? "").startsWith("done") || !page || page.state !== "delivered") return null;
  const id = researchPageIdIn(notice.body);
  if (!id || id !== page.id) return null;
  // The whole report, not a summary (owner, 6 Nov 2026: the summary email "wasnt helpful").
  return researchFullEmail({ who: who ?? notice.from_name ?? "Camille", subject: notice.subject, page, url: researchPageUrl(id), refs: [String(notice.task_id ?? "")].filter((r) => /^tsk_/.test(r)), markdownToHtml });
}

/** The filed page behind a research Done notice, as data; null when it is not one or cannot be read. */
async function researchPageOf(notice) {
  const id = String(notice?.kind ?? "").startsWith("done") ? researchPageIdIn(notice.body) : null;
  if (!id) return null;
  const res = await fetch(`${ORIGIN}/api/boss/research/pages/${encodeURIComponent(id)}?format=json`, { headers: { cookie } }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => ({})))?.data ?? null;
}

/** The task behind a notice, read fresh: `{ read, task }`. A failed read sends the notice as before. */
async function taskOf(id) {
  if (!id) return { read: false, task: null };
  const res = await fetch(`${ORIGIN}/api/boss/tasks/${encodeURIComponent(id)}`, { headers: { cookie } }).catch(() => null);
  if (res?.status === 404) return { read: true, task: null };
  if (!res?.ok) return { read: false, task: null };
  return { read: true, task: (await res.json().catch(() => ({})))?.data?.task ?? null };
}

/**
 * A GATE HOLD IS NOT A FAILED SEND (repair, 6 Nov 2026). `postEmployeeMail` answers a held email
 * with 422 `{ held: true, problems }` after writing the held copy and opening a fix job. The drain
 * reports that as a hold (`/failed` with `held: true`), which keeps the notice's send attempts for
 * the run after the sender is fixed. Pure: the problems as one line, or null when it was not a hold.
 */
export const GATE_HOLD = "held by the plain-email gate:";
export function gateHoldOf(status, text) {
  if (status !== 422) return null;
  let body = null;
  try { body = JSON.parse(String(text ?? "")); } catch { return null; }
  if (body?.held !== true) return null;
  const problems = Array.isArray(body.problems) ? body.problems.map(String).filter(Boolean) : [];
  return (problems.join("; ") || "no problems named").slice(0, 400);
}
export const isGateHold = (error) => typeof error === "string" && error.startsWith(GATE_HOLD);

/**
 * One notice, sent as the employee who owns the work.
 *
 * Returns the refusal text, or null when it went. Every sender on the roster's list is tried before
 * it is called a failure — the second is The Industry Guides fallback, and using it is itself reported.
 */
/**
 * THE OWNER LAYOUT FOR A NOTICE WITHOUT ITS OWN BUILDER (owner, 7 Nov 2026). Its kind picks the
 * layout, never its words: a Done for work she asked for is "here's what you asked for" (D); anything
 * else is a Note, and a could-not-do, a missing key or an empty folder says she must reply. Line 1 is the notice's own first sentence, then whether she must act. Pure.
 */
export function noticeOwner(notice) {
  const kind = String(notice?.kind ?? "");
  // A could-not-do or a missing key arrives as one block of words, not the alarm's parts: a Note, counted.
  const layout = /^done(#|$)/.test(kind) ? "delivered" : "note";
  const hers = ["could_not_do", "missing_secret", "drive_empty"].includes(kind) || kind.startsWith("stop:");
  const why = legacyParts({ who: notice?.from_name ?? "Simone", subject: notice?.subject ?? "", text: String(notice?.body ?? "") }).happened;
  const ref = /^tsk_[a-z0-9]+$/i.test(String(notice?.task_id ?? "")) ? String(notice.task_id).toLowerCase() : null;
  return hers ? { layout, why, ref, act: "Reply to this email with what it needs; your reply goes straight back to the job" } : { layout, why, ref };
}

/** A task Boss OS opened itself to repair something (its input says origin "repair"; a waiting-on check-in is hers). Pure. */
export function repairTask(task) {
  let input = task?.input ?? null;
  if (typeof input === "string") { try { input = JSON.parse(input); } catch { input = null; } }
  return input?.origin === "repair" && input?.repair_kind !== "waiting_on";
}

/**
 * A STOP THAT NEVER STARTED IS THE TEAM'S (owner via the coordinator, 7 Nov 2026): no device claimed
 * the run (backends/reap.ts), so nothing ran and there is nothing for her to decide. The drain runs on
 * her Mac, so the Mac is back: it requeues the task and leaves one Updates row. Only a stop after the
 * work ran reaches her email. Pure.
 */
export function neverStarted(task) {
  return /No device claimed this run/i.test(String(task?.error ?? ""));
}

/** What sendNotice answers for a notice that belongs on the Updates page: never an email. */
export const ON_PAGE = "on the Updates page: nothing here needs her, so it is not emailed";

export async function sendNotice(notice, { fetchImpl = fetch, to = TO, task = null, page = null } = {}) {
  /*
   * THE ONE GATE (owner, 7 Nov 2026: email only when she must act). `needs_her` is set where the
   * notice was written (src/shared/boss/mail/noticeGate.mjs); 0 never reaches the mail sender.
   */
  if (!emailsHer(notice)) return ON_PAGE;
  // A REPAIR NEVER EMAILS HER (job 1, 7 Nov 2026), even on a row written before needs_her existed (its
  // default is 1): the task read here decides, through the same rule the Worker uses.
  if (repairTask(task) && !needsHer({ kind: notice.kind, repair: true })) return ON_PAGE;
  if (notice.kind === "stopped" && neverStarted(task)) return ON_PAGE;
  const senders = sendersFor(notice.from_name);
  if (senders.length === 0) return "no Resend key in the environment (BOSS_OS_MAIL_KEY / BOSS_OS_FALLBACK_MAIL_KEY)";
  const prelaid = notice.kind === "stopped" ? stoppedEmail(notice, task) : (alarmNoticeEmail(notice) ?? researchDoneEmail(notice, page, senders[0]?.name));
  let last = "";
  for (const sender of senders) {
    const res = await postEmployeeMail(sender, employeeMail(sender, { to, subject: notice.subject, text: notice.body, prelaid, owner: prelaid ? null : noticeOwner(notice) }), fetchImpl);
    if (res.ok) {
      say(`sent "${notice.subject}" from ${sender.from}`);
      if (sender.fallback) say(FALLBACK_STOP);
      return null;
    }
    const said = await res.text().catch(() => "");
    const hold = gateHoldOf(res.status, said);
    if (hold) {
      // The same words would be held from every sender: stop here, and say it was a hold, not a refusal.
      say(`held by the plain-email gate, not sent: "${notice.subject}" (${hold}); a repair job is open for its sender`);
      return `${GATE_HOLD} ${hold}`;
    }
    last = `${res.status} ${said.slice(0, 200)}`;
    say(`${sender.from} refused: ${last}`);
  }
  return last || "every sender was refused with no message";
}

/** For a `missing_secret` notice: resolve from the vault, or return the body with the search stated. */
export async function askOrResolve(notice, { lookup = vaultLookup, resolve = resolveFromVault } = {}) {
  if (notice?.kind !== "missing_secret" || !notice?.secret_name) return { resolved: false, body: null };
  const look = lookup([notice.secret_name]);
  const searched = look.searched.join(", ");
  if (!look.missing.length) {
    const ok = await resolve(notice.secret_name);
    if (ok) return { resolved: true, searched, body: null };
  }
  return { resolved: false, body: `${notice.body}\n\nThe vault on your Mac was checked first — looked for: ${searched}. Nothing there.` };
}

async function resolveFromVault(name) {
  const res = await fetch(`${ORIGIN}/api/boss/service/secret-waits/resolve`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

async function main() {
  await unlock();
  const pending = await api("/pending");
  if (!pending.ok) stop(6, "PENDING_REFUSED", `Boss OS refused the pending list (${pending.status}): ${pending.error ?? ""}`);

  const items = pending.data?.items ?? [];
  const gaveUp = pending.data?.gave_up ?? 0;
  const heldNow = pending.data?.held ?? 0;
  if (heldNow > 0) say(`${heldNow} notice(s) are held by the plain-email gate and wait for their sender's repair (up to ${pending.data?.max_holds} tries each)`);
  if (gaveUp > 0) {
    // Loud, because these are things she was told about and never was.
    console.error(`NAMED STOP [NOTICES_GAVE_UP] ${gaveUp} notice(s) hit ${pending.data?.max_attempts} failed sends or ${pending.data?.max_holds} gate holds (${pending.data?.gave_up_held ?? 0} of them holds) and are no longer offered.`);
    console.error("  Read boss_task_notices.error for the last refusal. She has NOT been told about those tasks.");
  }
  if (items.length === 0) {
    say(`nothing to send${gaveUp ? ` (${gaveUp} given up)` : ""}`);
    // A given-up notice is a live fault even on a tick with nothing new to send.
    process.exit(gaveUp > 0 ? 8 : 0);
  }

  let failed = 0;
  for (const { first: notice, also } of mergeNotices(items)) {
    if (DRY) { say(`DRY RUN — would send "${notice.subject}" as ${notice.from_name}${also.length ? ` (and ${also.length} duplicate(s) with it)` : ""}`); continue; }
    // Kill false alarms: a stopped task that is running or done again gets no "Stopped" email.
    // The task is read for every notice that would email her: a repair's never does (sendNotice).
    let task = null;
    if (emailsHer(notice) && notice.task_id) {
      const t = await taskOf(notice.task_id);
      task = t.task;
      if (notice.kind === "stopped" && t.read && !stillStopped(task)) {
        for (const n of [notice, ...also]) await api(`/${n.id}/sent`, { from: `not sent: the task is ${task?.status ?? "gone"} again` });
        say(`not sent "${notice.subject}": the task is ${task?.status ?? "gone"} now — a false alarm`);
        continue;
      }
    }
    // The morning email went after all (a later tick sent it before this drain ran): no alarm about it.
    const morningDay = morningDayOf(notice);
    if (morningDay) {
      const m = await fetch(`${ORIGIN}/api/boss/morning/${morningDay}`, { headers: { cookie } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (m?.data?.sent_at) {
        for (const n of [notice, ...also]) await api(`/${n.id}/sent`, { from: "not sent: the morning email went" });
        say(`not sent "${notice.subject}": the morning email for ${morningDay} has gone — a false alarm`);
        continue;
      }
    }
    /*
     * R5 — THE VAULT IS CHECKED BEFORE SHE IS ASKED FOR A KEY (docs/SERVICE_RULES.md). A run that
     * wrote `Missing key: NAME` could not see this Mac's vault; this can. Held by exact name or by
     * vendor prefix → the work that waited resumes and she is never asked. Absent → the ask goes,
     * carrying every name and prefix the vault was searched for.
     */
    const ask = await askOrResolve(notice);
    if (ask.resolved) {
      const report = await api(`/${notice.id}/sent`, { from: `vault: ${ask.searched}` });
      if (!report.ok) say(`could not record the vault resolution of ${notice.id}: ${report.status}`);
      say(`${notice.secret_name} is in the vault (${ask.searched}); the work resumed and she was not asked`);
      continue;
    }
    if (ask.body) notice.body = ask.body;
    if (notice.kind === "stopped" && neverStarted(task)) {
      const rq = await fetch(`${ORIGIN}/api/boss/tasks/${encodeURIComponent(notice.task_id)}/requeue`, { method: "POST", headers: { cookie } }).catch(() => null);
      const line = rq?.ok ? "It never started because your Mac was not picking work up. The Mac is back, so it is running again; nothing for you." : "It never started because your Mac was not picking work up. The team is starting it again; nothing for you.";
      await fetch(`${ORIGIN}/api/boss/task-notices/update`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ key: `requeued-${notice.task_id}`, from_name: ["Simone", "Kendra", "Danielle", "Camille", "Monique"].includes(notice.from_name) ? notice.from_name : "Kendra", subject: `Started again: ${String(notice.subject ?? "").replace(/^Stopped:\s*/i, "").slice(0, 120)}`, body: line }) }).catch(() => null);
      for (const n of [notice, ...also]) await api(`/${n.id}/sent`, { from: `${ON_PAGE} (never started; ${rq?.ok ? "requeued" : "requeue refused, the team has it"})` });
      say(`not emailed "${notice.subject}": it never started; ${rq?.ok ? "requeued now the Mac is back" : `requeue refused (${rq?.status ?? "no answer"})`}`);
      continue;
    }
    if (!emailsHer(notice) || (repairTask(task) && !needsHer({ kind: notice.kind, repair: true }))) {
      // /pending already leaves these out; a row that slips through (or a repair's, written before
      // needs_her existed) is closed as a page row, not sent.
      for (const n of [notice, ...also]) await api(`/${n.id}/sent`, { from: ON_PAGE });
      say(`not emailed "${notice.subject}": ${ON_PAGE}`);
      continue;
    }
    const page = await researchPageOf(notice);
    const error = await sendNotice(notice, { task, page });
    for (const n of [notice, ...also]) {
      const report = error ? await api(`/${n.id}/failed`, isGateHold(error) ? { error, held: true } : { error }) : await api(`/${n.id}/sent`, { from: n === notice ? notice.from_name : `merged into the email for ${notice.id}` });
      if (!report.ok) say(`could not record the outcome of ${n.id}: ${report.status} ${report.error ?? ""}`);
    }
    if (error) failed += 1;
  }

  say(`${items.length - failed} sent, ${failed} refused`);
  if (failed > 0) process.exit(9);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`task-notices failed: ${err?.message ?? err}`);
    process.exitCode = 1;
  });
}
