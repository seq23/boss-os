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
import { bossApi } from "./lib/duty-kit.mjs";
import { sendersFor, employeeMail, postEmployeeMail } from "./notify.mjs";
import { noticeArgs } from "./simone-commands.mjs";

async function main() {
  const api = await bossApi();
  const { reminders } = await api.post("/commands/errand-reminders");
  const [simone] = sendersFor("Simone");
  let sent = 0;
  const failed = [];
  for (const r of reminders ?? []) {
    const res = await postEmployeeMail(simone, employeeMail(simone, noticeArgs(r.id, r.notice)));
    if (res.ok) { await api.post(`/commands/${r.id}/reminded`); sent++; }
    else failed.push(`${r.id} (${res.status ?? res.error ?? "refused"})`);
  }
  if (failed.length) { console.error(`NAMED STOP [REMINDER_NOT_SENT] ${failed.join(", ")}`); process.exit(1); }
  console.log(sent ? `ERRAND-REMINDERS: ${sent} reminder(s) sent.` : "ERRAND-REMINDERS: checked; no booking is 28 hours away.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`errand-reminders failed: ${e?.message ?? e}`); process.exit(1); });
}
