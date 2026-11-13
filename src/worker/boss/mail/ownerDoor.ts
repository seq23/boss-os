/**
 * THE WORKER'S SIDE OF THE ONE DOOR (Wave 4, 13 Nov 2026; rules in src/shared/boss/mail/ownerDoor.mjs).
 *
 * Every place the Worker sends mail calls `throughOwnerDoor` on what it is about to send. Mail to
 * anyone else passes untouched. Mail to HER is read against the required minimum and repaired where
 * the repair is mechanical (line 1, the plain-text part, the subject, a stray "needs you").
 *
 * THE WORKER NEVER HOLDS: each of its sends answers her own word (the reply to an email she just
 * wrote, the Send she pressed, the card she tapped), so silence would be the worse failure. What the
 * repair could not fix goes out as it is, and is logged by name for the team (`owner_mail_below_minimum`,
 * shown on Systems). Guard: tests/ownerDoor.test.ts fails on a Worker send that does not come through here.
 */
import type { Env } from "../env";
import { logEvent } from "../lib/log";
import { isOwner, extractAddress } from "../../../shared/boss/intake/mail.mjs";
import { ownerDoor } from "../../../shared/boss/mail/ownerDoor.mjs";
import type { OwnerMinimum } from "../../../shared/boss/mail/ownerLayout.mjs";

export interface DoorMail { to: string; subject: string; text: string; html?: string | null }

/**
 * `where` names the send for the log. `repair: false` is for a send whose bytes are already composed
 * (a raw MIME outreach message): it is read and logged, never rewritten.
 */
export async function throughOwnerDoor<T extends DoorMail>(env: Pick<Env, "DB"> & { BOSS_EXTRA_OWNER_SENDERS?: string }, mail: T, opts: { where: string; replyTo?: string | null; minimum?: OwnerMinimum | null; repair?: boolean }): Promise<T> {
  const to = extractAddress(mail.to) ?? String(mail.to ?? "").trim().toLowerCase();
  if (!isOwner(to, env.BOSS_EXTRA_OWNER_SENDERS ?? "")) return mail;
  const door = ownerDoor({ subject: mail.subject, text: mail.text, html: mail.html ?? null, to: [to], reply_to: opts.replyTo ?? null }, { minimum: opts.minimum ?? null, replyTo: opts.replyTo ?? null });
  const repair = opts.repair !== false;
  if (door.repaired.length && repair) console.error(`REPAIRED "${mail.subject}" before sending (${opts.where}): ${door.repaired.join("; ")}`);
  const wrong = repair ? door.problems : [...door.repaired, ...door.problems];
  if (wrong.length) {
    console.error(`NAMED STOP [SENT_BELOW_MINIMUM] "${mail.subject}" (${opts.where}) went to her below the required minimum: ${wrong.join("; ")}`);
    await logEvent(env.DB, { level: "error", scope: "mail", event: "owner_mail_below_minimum", detail: { where: opts.where, problems: wrong } }).catch(() => {});
  }
  if (!repair) return mail;
  return { ...mail, subject: String(door.payload.subject ?? mail.subject), text: String(door.payload.text ?? mail.text), ...(mail.html !== undefined ? { html: door.payload.html ?? mail.html } : {}) };
}
