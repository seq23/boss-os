#!/usr/bin/env node
/**
 * TONI'S WEEKLY OUTSIDE-LOCKS CHECK (owner, 22 Oct 2026).
 *
 * duty_outside_locks (migration 0288), Mondays 08:40 CT on her Mac through duty-run.sh, `ops` lane —
 * Toni's trading lane is untouched. A lock someone else put on one of her accounts — a LinkedIn
 * restriction, a KDP title review, a suspension at Google, YouTube, Pinterest, Etsy or Meta — arrives
 * as an email and sits there. This reads for those notices in the last 8 days:
 *
 *   spry.vc mailbox    the service account (gmail.readonly), headers only, never a body
 *   personal Gmail     her Claude session's Gmail connector (one short Haiku run), headers only
 *
 * A mailbox it cannot read is a NAMED STOP line, said once. It emails her as Toni only when a lock
 * appears or one it reported is gone. Rule 0: both mailboxes unreadable → exit 3.
 *
 *   npm run risk:locks             # read and email what moved
 *   npm run risk:locks -- --dry    # read and print only
 */
import {
  askClaudeJson, fromDomain, gmailHeaders, googleToken, loadState, movedReadings, readNothingStop,
  saveState, sendAs, stateMap,
} from "./lib/duty-kit.mjs";

const DRY = process.argv.includes("--dry");
/** The one model this duty names (its duty row says the same): a short Haiku run on her Claude seat, mail headers or the gallery only. */
export const MODEL = "claude-haiku-4-5-20251001";

/** The senders whose notices are locks, and the words that make one a lock. */
export const LOCK_SENDERS = Object.freeze([
  "linkedin.com", "amazon.com", "kdp.amazon.com", "google.com", "youtube.com", "pinterest.com", "etsy.com",
  "facebookmail.com", "meta.com", "stripe.com", "cloudflare.com", "github.com",
]);
export const LOCK_RE = /\b(restrict(?:ed|ion)|suspend(?:ed|ion)|locked|disabled|under review|in review|policy violation|violat(?:es|ion)|blocked|terminated|limited|action required|appeal)\b/i;

export const LOCK_QUERY =
  `newer_than:8d (from:(${LOCK_SENDERS.join(" OR ")})) (subject:(restricted OR restriction OR suspended OR suspension OR locked OR disabled OR "under review" OR "policy" OR violation OR blocked OR terminated OR limited OR "action required" OR appeal))`;

/** One header row → a lock reading, or null when the subject is not a lock. Pure. */
export function lockReading(m, mailbox) {
  const domain = m.from_domain ?? fromDomain(m.from);
  const subject = String(m.subject ?? "").slice(0, 140);
  if (!LOCK_RE.test(subject)) return null;
  if (!LOCK_SENDERS.some((d) => domain === d || domain.endsWith(`.${d}`))) return null;
  return { key: `lock:${domain}:${subject.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60)}`, state: "alert", line: `${m.date ?? ""} ${domain}: "${subject}" (${mailbox}).`.trim() };
}

async function readSpry() {
  try {
    const token = await googleToken("https://www.googleapis.com/auth/gmail.readonly", "staylor@spry.vc");
    const hits = await gmailHeaders(token, LOCK_QUERY, 30);
    return [{ key: "mailbox:spry", state: "ok", line: `spry.vc read: ${hits.length} candidate notice(s).` }, ...hits.map((m) => lockReading(m, "spry.vc")).filter(Boolean)];
  } catch (e) {
    return [{ key: "mailbox:spry", state: "stop", line: `The spry.vc mailbox could not be read (${String(e?.message ?? e).slice(0, 120)}).` }];
  }
}

function readPersonal() {
  const a = askClaudeJson(
    `Use the Gmail tool on my mailbox. Search exactly: ${LOCK_QUERY}. Do not open bodies. ` +
    "Reply with ONLY a JSON array, one object per message: {\"from_domain\":\"<sender domain>\",\"subject\":\"<subject, max 140 chars>\",\"date\":\"YYYY-MM-DD\"}. No results is [].",
    { model: MODEL },
  );
  if (!a.ok || !Array.isArray(a.json)) return [{ key: "mailbox:personal", state: "stop", line: `Her personal Gmail could not be read: ${a.ok ? "the answer was not a list" : a.why}.` }];
  return [{ key: "mailbox:personal", state: "ok", line: `Personal Gmail read: ${a.json.length} candidate notice(s).` }, ...a.json.map((m) => lockReading(m, "personal Gmail")).filter(Boolean)];
}

async function main() {
  const prev = loadState("outside-locks");
  const readings = [...(await readSpry()), ...readPersonal()];
  for (const r of readings) console.log(`  [${r.state}] ${r.line}`);
  const stop = readNothingStop(readings, "LOCKS_READ_NOTHING");
  if (stop) { console.error(stop); process.exit(3); }
  const moved = movedReadings(readings, prev.states ?? {});
  console.log(`outside locks: ${readings.filter((r) => r.key.startsWith("lock:")).length} lock notice(s), ${moved.length} moved.`);
  if (DRY) { console.log("OUTSIDE-LOCKS-COMPLETE: dry"); return; }
  if (moved.length) {
    const locks = moved.filter((m) => m.state === "alert");
    const gone = moved.filter((m) => m.state === "cleared" || m.state === "ok");
    const stops = moved.filter((m) => m.state === "stop");
    const text = [
      "Sequoia,", "",
      locks.length ? `${locks.length} new lock notice${locks.length === 1 ? "" : "s"} on your accounts this week.` : "No new locks this week; this is what changed.", "",
      ...(locks.length ? ["NEW", ...locks.map((m) => `- ${m.line}`), ""] : []),
      ...(gone.length ? ["NO LONGER SEEN (older than 8 days or resolved)", ...gone.map((m) => `- ${m.line}`), ""] : []),
      ...(stops.length ? ["I COULD NOT READ (said once)", ...stops.map((m) => `- ${m.line}`), ""] : []),
      "— Toni, Chief Risk Officer",
    ].join("\n");
    if (!(await sendAs("Toni", { subject: locks.length ? `Locks: ${locks.length} new — ${locks[0].line.slice(0, 60)}` : "Locks: changes this week", text }))) {
      console.error("NAMED STOP [NO_MAIL_SENT] locks moved and no email could be sent; state not saved."); process.exit(8);
    }
  }
  saveState("outside-locks", { at: new Date().toISOString(), states: stateMap(readings) });
  console.log(`OUTSIDE-LOCKS-COMPLETE: ${moved.length} moved`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`OUTSIDE-LOCKS FAILED: ${err?.message ?? err}`); process.exit(1); });
}
