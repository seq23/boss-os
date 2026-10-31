#!/usr/bin/env node
/**
 * THE PRACTICE EMAILS (owner, 31 Oct 2026). Rides the errand-reminders tick (every 10 minutes,
 * 06:00–23:00, launchd com.seq.boss-errand-reminders) rather than a scheduler of its own.
 *
 * Boss OS decides what is due and claims it, so nothing goes twice (`POST /practice/nudges/due`,
 * src/worker/boss/practice/lapse.ts):
 *   - the lapse ladder: day 2 a firm nudge, day 4 tough love, day 7 and every 3 days after a hard
 *     truth, from 10:00 Central, at most one a day, reset the moment she opens the app, talks to the
 *     coach or closes a gate;
 *   - the midday push: today's law and the Midday gate, once, while the gate is open;
 *   - the ancestral hour's last-day warning, at 6pm Central, when the month's hour is not done.
 * This sends each from Imani, Director of Practice, to the owner ONLY (`OWNER_TO`), then says it went.
 */
import { OWNER_TO } from "./lib/duty-kit.mjs";
import { sendersFor, employeeMail, postEmployeeMail } from "./notify.mjs";

/**
 * Every practice email goes to her and to nobody else: `OWNER_TO`, never an address from the notice,
 * which carries none. Signed "Imani, Director of Practice", who owns Body and Spirit.
 */
export function practiceLayout(notice) {
  return { to: OWNER_TO, subject: notice.subject, layout: { happened: notice.happened, details: notice.details ?? [], decide: notice.decide ?? [] } };
}

export async function practiceNudges(api, deliver = (imani, notice) => postEmployeeMail(imani, employeeMail(imani, practiceLayout(notice))), senders = sendersFor) {
  const r = await api.post("/practice/nudges/due");
  const due = r?.due ?? [];
  if (!due.length) return { line: `Practice: nothing due (${(r?.lines ?? []).join("; ") || "no answer"}).`, failed: [] };
  const [found] = senders("Imani");
  const imani = { ...found, name: "Imani, Director of Practice" };
  const sent = [];
  const failed = [];
  for (const n of due) {
    const res = await deliver(imani, n.notice);
    if (!res.ok) { failed.push(`practice ${n.kind} ${n.day} (${res.status ?? res.error ?? "refused"})`); continue; }
    await api.post(`/practice/nudges/${n.day}/${n.kind}/sent`);
    sent.push(n.kind === "lapse" ? `lapse day ${n.streak_days} (${n.tier})` : n.kind);
  }
  return { line: `Practice: ${sent.length ? `sent ${sent.join(", ")}` : "nothing sent"}.`, failed };
}
