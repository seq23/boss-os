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

import { sendersFor, employeeMail, postEmployeeMail, FALLBACK_STOP } from "./notify.mjs";
import { vaultLookup } from "../lib/vault-env.mjs";
import { layoutProblem } from "../../src/shared/boss/mail/plain.mjs";

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

/** The stopped notice as a problem email. Pure; tested. */
export function stoppedEmail(notice, task = null) {
  const body = String(notice.body ?? "");
  const title = String(task?.title ?? /^"([^"]+)"/.exec(body)?.[1] ?? String(notice.subject).replace(/^Stopped:\s*/i, "")).replace(/\s*\[?tsk_[a-z0-9]+\]?\s*$/i, "");
  const tried = /I tried this (.+?) and could not finish/.exec(body)?.[1] ?? "more than once";
  const why = /could not finish:\s*(.+?)\.\s*To clear it by email/s.exec(body)?.[1]?.replace(/\s+/g, " ").slice(0, 240) ?? null;
  return layoutProblem({
    who: notice.from_name,
    subject: `Stopped: ${title}`,
    happened: `"${title}" stopped before it finished${why ? `: ${why.replace(/[.!?]?$/, ".")}` : "."}`,
    did: `Tried it ${tried}, kept everything as it was, and sent nothing to anyone outside Boss OS.`,
    status: "Waiting for your word. Reply to this email with try again, or with drop it to close it.",
    decide: [{ title: "Run it again, change it, or drop it?", body: "Reply to this email with your answer; it goes straight back to this job.", buttons: [{ label: "See the job in Boss OS", url: `${ORIGIN_URL}/` }] }],
    refs: [String(notice.task_id ?? "")].filter((r) => /^tsk_/.test(r)),
  });
}

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";
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

/** The task behind a notice, read fresh: `{ read, task }`. A failed read sends the notice as before. */
async function taskOf(id) {
  if (!id) return { read: false, task: null };
  const res = await fetch(`${ORIGIN}/api/boss/tasks/${encodeURIComponent(id)}`, { headers: { cookie } }).catch(() => null);
  if (res?.status === 404) return { read: true, task: null };
  if (!res?.ok) return { read: false, task: null };
  return { read: true, task: (await res.json().catch(() => ({})))?.data?.task ?? null };
}

/**
 * One notice, sent as the employee who owns the work.
 *
 * Returns the refusal text, or null when it went. Every sender on the roster's list is tried before
 * it is called a failure — the second is The Industry Guides fallback, and using it is itself reported.
 */
export async function sendNotice(notice, { fetchImpl = fetch, to = TO, task = null } = {}) {
  const senders = sendersFor(notice.from_name);
  if (senders.length === 0) return "no Resend key in the environment (BOSS_OS_MAIL_KEY / BOSS_OS_FALLBACK_MAIL_KEY)";
  const prelaid = notice.kind === "stopped" ? stoppedEmail(notice, task) : null;
  let last = "";
  for (const sender of senders) {
    const res = await postEmployeeMail(sender, employeeMail(sender, { to, subject: notice.subject, text: notice.body, prelaid }), fetchImpl);
    if (res.ok) {
      say(`sent "${notice.subject}" from ${sender.from}`);
      if (sender.fallback) say(FALLBACK_STOP);
      return null;
    }
    last = `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
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
  if (gaveUp > 0) {
    // Loud, because these are things she was told about and never was.
    console.error(`NAMED STOP [NOTICES_GAVE_UP] ${gaveUp} notice(s) hit ${pending.data?.max_attempts} failed sends and are no longer offered.`);
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
    let task = null;
    if (notice.kind === "stopped") {
      const t = await taskOf(notice.task_id);
      task = t.task;
      if (t.read && !stillStopped(task)) {
        for (const n of [notice, ...also]) await api(`/${n.id}/sent`, { from: `not sent: the task is ${task?.status ?? "gone"} again` });
        say(`not sent "${notice.subject}": the task is ${task?.status ?? "gone"} now — a false alarm`);
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
    const error = await sendNotice(notice, { task });
    for (const n of [notice, ...also]) {
      const report = error ? await api(`/${n.id}/failed`, { error }) : await api(`/${n.id}/sent`, { from: n === notice ? notice.from_name : `merged into the email for ${notice.id}` });
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
