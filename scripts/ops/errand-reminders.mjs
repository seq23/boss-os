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

async function main() {
  const api = await bossApi();
  const { reminders } = await api.post("/commands/errand-reminders");
  const [simone] = sendersFor("Simone");
  let sent = 0;
  const failed = [];
  for (const r of reminders ?? []) {
    if ((await api.get(`/commands/${r.id}`)).result?.owner_handling) continue;
    const res = await postEmployeeMail(simone, employeeMail(simone, noticeArgs(r.id, r.notice)));
    if (res.ok) { await api.post(`/commands/${r.id}/reminded`); sent++; }
    else failed.push(`${r.id} (${res.status ?? res.error ?? "refused"})`);
  }
  const ancestral = await ancestralReminder(api);
  if (ancestral.failed) failed.push(ancestral.failed);
  if (failed.length) { console.error(`NAMED STOP [REMINDER_NOT_SENT] ${failed.join(", ")}`); process.exit(1); }
  console.log(`${sent ? `ERRAND-REMINDERS: ${sent} reminder(s) sent.` : "ERRAND-REMINDERS: checked; no booking is 28 hours away."} ${ancestral.line}`);
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
  const res = await postEmployeeMail(imani, employeeMail(imani, { to: OWNER_TO, subject: r.notice.subject, layout: { happened: r.notice.happened, details: r.notice.details ?? [], decide: r.notice.decide ?? [] } }), fetchImpl);
  if (!res.ok) return { line: "Ancestral hour: reminder NOT sent.", failed: `ancestral-hour ${r.day} (${res.status ?? res.error ?? "refused"})`, sent: false };
  await api.post(`/spirit/ancestral-hour/reminder/${r.day}/sent`);
  return { line: `Ancestral hour: reminder sent for ${r.day}.`, sent: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`errand-reminders failed: ${e?.message ?? e}`); process.exit(1); });
}
