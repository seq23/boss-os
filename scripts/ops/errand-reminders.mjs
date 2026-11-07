#!/usr/bin/env node
/**
 * SIMONE: "DO YOU STILL WANT TO GO?" (owner, 26 Oct 2026: "Simone needs to send a reminder 28 hrs
 * before to ask if i still want to go"). Every 10 minutes 06:00–23:00, launchd
 * com.seq.boss-errand-reminders through duty-run.sh → duty_errand_reminders.
 *
 * Asks Boss OS which bookings are 28 hours away (`POST /commands/errand-reminders`: the true instant
 * of each booking, New York time, minus 28 hours), sends each one email from Simone — what, where,
 * when, their rules and cancellation terms, "Yes, keep it" / "Cancel it" — and marks it sent so it
 * never goes twice. Her "cancel" (tap or reply) has Simone cancel with the business in their thread.
 * A run with nothing due says so by name and exits 0: the check itself is the work.
 */
import { bossApi, OWNER_TO } from "./lib/duty-kit.mjs";
import { sendersFor, employeeMail, postEmployeeMail } from "./notify.mjs";
import { noticeArgs } from "./simone-commands.mjs";
import { practiceNudges } from "./practice-nudges.mjs";

async function main() {
  const api = await bossApi();
  const { reminders } = await api.post("/commands/errand-reminders");
  const [simone] = sendersFor("Simone");
  let sent = 0;
  const failed = [];
  for (const r of reminders ?? []) {
    if ((await api.get(`/commands/${r.id}`)).result?.owner_handling) continue;
    const res = await postEmployeeMail(simone, employeeMail(simone, noticeArgs(r.id, r.notice, OWNER_TO, { layout: "note" })));
    if (res.ok) { await api.post(`/commands/${r.id}/reminded`); sent++; }
    else failed.push(`${r.id} (${res.status ?? res.error ?? "refused"})`);
  }
  const ancestral = await ancestralReminder(api);
  if (ancestral.failed) failed.push(ancestral.failed);
  // The practice emails (the lapse ladder, the midday push, the ancestral hour's 6pm warning) ride this tick too.
  const practice = await practiceNudges(api);
  failed.push(...practice.failed);
  const hicks = await hicksUpdateNotice(api);
  if (hicks.failed) failed.push(hicks.failed);
  if (failed.length) { console.error(`NAMED STOP [REMINDER_NOT_SENT] ${failed.join(", ")}`); process.exit(1); }
  console.log(`${sent ? `ERRAND-REMINDERS: ${sent} reminder(s) sent.` : "ERRAND-REMINDERS: checked; no booking is 28 hours away."} ${ancestral.line} ${practice.line} ${hicks.line}`);
}

/** The ancestral hour's reminder, in the owner layout (7 Nov 2026): a Note with one tap. Pure. */
export function ancestralMail(notice) {
  return { to: OWNER_TO, subject: notice.subject, layout: { happened: notice.happened, details: notice.details ?? [], decide: notice.decide ?? [] }, owner: { layout: "note", why: notice.happened } };
}

/** The Hicks update for her approval, in the owner layout (7 Nov 2026): approve this (A), vN on the draft. Pure. */
export function hicksMail(notice, version = null) {
  return { to: OWNER_TO, subject: notice.subject, layout: { happened: notice.happened, details: notice.details ?? [], decide: notice.decide ?? [] }, owner: { layout: "approve", why: notice.happened, version: version ?? null } };
}

/**
 * THE ANCESTRAL HOUR (owner, 31 Oct 2026: "on the last day of the month and 3 days before ... maybe
 * email a reminder"). Rides this tick rather than a scheduler of its own. Boss OS decides whether one
 * is due — the first and last day of the end-of-month window, from 10:00 Central, never when the
 * month's hour is done, never twice for one day (`POST /spirit/ancestral-hour/reminder` claims the
 * day) — and this sends it from Imani, who owns the practice, to the owner only, then reports it sent.
 */
export async function ancestralReminder(api, fetchImpl = fetch, senders = sendersFor) {
  const r = await api.post("/spirit/ancestral-hour/reminder");
  if (!r?.due) return { line: `Ancestral hour: no reminder due (${r?.reason ?? "no answer"}).`, sent: false };
  const [imani] = senders("Imani");
  const res = await postEmployeeMail(imani, employeeMail(imani, ancestralMail(r.notice)), fetchImpl);
  if (!res.ok) return { line: "Ancestral hour: reminder NOT sent.", failed: `ancestral-hour ${r.day} (${res.status ?? res.error ?? "refused"})`, sent: false };
  await api.post(`/spirit/ancestral-hour/reminder/${r.day}/sent`);
  return { line: `Ancestral hour: reminder sent for ${r.day}.`, sent: true };
}

/**
 * THE HICKS QUARTERLY UPDATE'S APPROVAL EMAIL (owner, 3 Nov 2026). Boss OS drafts it on the first Monday
 * of Feb/May/Aug/Nov (src/worker/boss/clients/hicksUpdate.ts); this sends the waiting draft to HER only,
 * from Camille, word for word with Approve / Change the words / Skip, then reports it emailed. It never
 * emails the client: the only way the words reach them is her Approve, which opens her own Gmail.
 */
export async function hicksUpdateNotice(api, fetchImpl = fetch, senders = sendersFor) {
  /*
   * 3 Nov 2026, 13:47 and 13:57 UTC: main ran this before production served the route (land promotes
   * only after e2e on main, ~25 minutes), the 404 threw, and the whole tick went red. A route this
   * Worker does not serve yet is a named note the next run retries, never a red tick; any other
   * failure is still a failure by name, and the errands and practice emails above have already gone.
   */
  let r;
  try { r = await api.post("/clients/hicks-update/notice"); } catch (e) {
    const why = String(e?.message ?? e);
    if (/→ 404\b/.test(why)) return { line: "NAMED STOP [HICKS_ROUTE_NOT_LIVE] Boss OS does not serve the Hicks update yet (deploy pending); the next run retries.", sent: false };
    return { line: "Hicks update: NOT checked.", failed: `hicks-update notice (${why.slice(0, 120)})`, sent: false };
  }
  if (!r?.due) return { line: `Hicks update: nothing waiting (${r?.reason ?? "no answer"}).`, sent: false };
  const [camille] = senders("Camille");
  const res = await postEmployeeMail(camille, employeeMail(camille, hicksMail(r.notice, r.version)), fetchImpl);
  if (!res.ok) return { line: "Hicks update: approval email NOT sent.", failed: `hicks-update ${r.id} (${res.status ?? res.error ?? "refused"})`, sent: false };
  await api.post(`/clients/hicks-update/${r.id}/emailed?version=${r.version ?? 0}`);
  return { line: "Hicks update: approval email sent to you.", sent: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`errand-reminders failed: ${e?.message ?? e}`); process.exit(1); });
}
