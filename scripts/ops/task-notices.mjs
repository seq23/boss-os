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

import { sendersFor, employeeMail } from "./notify.mjs";
import { vaultLookup } from "../lib/vault-env.mjs";

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

/**
 * One notice, sent as the employee who owns the work.
 *
 * Returns the refusal text, or null when it went. Every sender on the roster's list is tried before
 * it is called a failure — the second is the West Peek fallback, and using it is itself reported.
 */
export async function sendNotice(notice, { fetchImpl = fetch, to = TO } = {}) {
  const senders = sendersFor(notice.from_name);
  if (senders.length === 0) return "no Resend key in the environment (BOSS_OS_MAIL_KEY / RESEND_API_KEY)";
  let last = "";
  for (const sender of senders) {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sender.key}` },
      body: JSON.stringify(employeeMail(sender, { to, subject: notice.subject, text: notice.body })),
    });
    if (res.ok) {
      say(`sent "${notice.subject}" from ${sender.from}`);
      if (sender.from.includes("westpeek.ventures")) {
        say("NAMED STOP [WRONG_SENDING_IDENTITY] the Boss OS sender was refused; this went from a West Peek domain.");
      }
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
  for (const notice of items) {
    if (DRY) { say(`DRY RUN — would send "${notice.subject}" as ${notice.from_name}`); continue; }
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
    const error = await sendNotice(notice);
    const report = error ? await api(`/${notice.id}/failed`, { error }) : await api(`/${notice.id}/sent`, { from: notice.from_name });
    if (!report.ok) say(`could not record the outcome of ${notice.id}: ${report.status} ${report.error ?? ""}`);
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
