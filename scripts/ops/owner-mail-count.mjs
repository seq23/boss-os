/**
 * HOW MANY EMAILS REACHED HER THIS WEEK, AND HOW MANY ASKED HER FOR SOMETHING THAT WAS NOT HERS
 * (the measurement promised with the email overhaul, Wave 4, 13 Nov 2026; baseline 55 emails in the
 * 7 days to 13 Nov). Read-only: one SELECT on the live sent log (`boss_sent_mail`); it writes nothing.
 *
 *   npm run vault:run -- npm run -s owner-mail:count [-- --days 7]
 *
 * HOW IT COUNTS, EXACTLY (the sent log holds the subject and the layout, not the body):
 *   · an email TO HER  = a row with delivery_state 'sent' whose recipient is her address
 *     (BOSS_NOTIFY_TO, from the vault). Outreach to prospects, and a test's row to a made-up address,
 *     are not hers and are not counted.
 *   · it ASKED her     = its layout is "approve", or its subject shows a REF code (the layout shows
 *     one only where a reply matters), or its subject is one of the asking kinds from before the
 *     layouts ("Stopped:", "Could not do", "Reminder:", "needs you", "needs a look").
 *   · NOT HERS         = the Wave 2 test, `systemRow` (src/shared/boss/openLoops/openLoops.mjs), on
 *     the subject: it is about the system's own work (a stopped or failed job, a queue, an agent, a
 *     limit, a stop code), which the team checks itself.
 *
 * Rule 0: `OUTPUT <n> emails, <m> asks not hers`; a read that fails or returns no row at all is a
 * NAMED STOP, never "0 emails".
 */
import { execFileSync } from "node:child_process";
import { ownerTo, NO_OWNER_ADDRESS } from "./notify.mjs";
import { systemRow } from "../../src/shared/boss/openLoops/openLoops.mjs";
import { bareSubject } from "../../src/shared/boss/mail/ownerDoor.mjs";
import { REF_CODE_RE } from "../../src/shared/boss/mail/plain.mjs";

const ASK_SUBJECT = /^(?:stopped\b|could not do\b|i could not\b|reminder:)|\bneeds? (?:you|a look)\b/i;

/** Did this sent email ask her for something? From the record only: layout and subject. Pure. */
export const asked = (row) => row.layout === "approve" || REF_CODE_RE.test(String(row.subject ?? "")) || ASK_SUBJECT.test(String(row.subject ?? "").trim());
/** An ask about the system's own work: not hers (Wave 2's test, on the subject). Pure. */
export const askNotHers = (row) => asked(row) && systemRow({ title: bareSubject(row.subject) });

/** The count, from sent-log rows `{ to_addr, subject, layout, delivery_state }`. Pure. */
export function countOwnerMail(rows, owner) {
  const her = String(owner ?? "").trim().toLowerCase();
  const toHer = (rows ?? []).filter((r) => (r.delivery_state ?? "sent") === "sent"
    && String(r.to_addr ?? "").toLowerCase().split(",").map((a) => a.replace(/^.*<|>.*$/g, "").trim()).includes(her));
  const asks = toHer.filter(asked);
  const notHers = asks.filter(askNotHers);
  return { emails: toHer.length, asks: asks.length, asksNotHers: notHers.length, notHers, others: (rows ?? []).length - toHer.length };
}

function main() {
  const di = process.argv.indexOf("--days");
  const days = Math.max(1, Math.min(90, Number(di === -1 ? 7 : process.argv[di + 1]) || 7));
  const owner = ownerTo();
  if (!owner) { console.error(NO_OWNER_ADDRESS); process.exit(2); }
  const since = Date.now() - days * 86_400_000;
  let rows;
  try {
    const out = execFileSync("npx", ["wrangler", "d1", "execute", "boss-os", "--remote", "--env", "production", "--json", "--command",
      `SELECT sent_at, to_addr, subject, layout, delivery_state FROM boss_sent_mail WHERE sent_at > ${since} ORDER BY sent_at`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
    rows = JSON.parse(out)[0].results;
  } catch (e) {
    console.error(`NAMED STOP [SENT_LOG_NOT_READ] the live sent log could not be read: ${String(e?.stderr ?? e?.message ?? e).slice(0, 300)}`);
    process.exit(2);
  }
  if (!Array.isArray(rows) || rows.length === 0) { console.error(`NAMED STOP [SENT_LOG_EMPTY] the sent log holds no row at all for the last ${days} days: the read is wrong, not the inbox quiet.`); process.exit(2); }
  const c = countOwnerMail(rows, owner);
  console.log(`Last ${days} days: ${c.emails} emails to her (${c.others} other rows in the sent log are outreach or not addressed to her, not counted).`);
  console.log(`${c.asks} of them asked her for something; ${c.asksNotHers} of those were about the system's own work, not hers:`);
  for (const r of c.notHers) console.log(`  · ${new Date(r.sent_at).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" })}  ${bareSubject(r.subject)}`);
  console.log(`OUTPUT ${c.emails} emails, ${c.asksNotHers} asks not hers`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
