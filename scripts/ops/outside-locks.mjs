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
 * WHAT SHE SEES (owner, 23 Oct 2026, rule 1): no Toni email. A new lock is a Decide item in Simone's
 * morning email (only she can answer for her own account) with the notice one tap away; a lock that is
 * gone is a "Done for you" line; a mailbox it cannot read is a fix job for the team (`planLocks`).
 * Rule 0: both mailboxes unreadable → exit 3.
 *
 *   npm run risk:locks             # read and email what moved
 *   npm run risk:locks -- --dry    # read and print only
 */
import {
  askClaudeJson, fromDomain, gmailHeaders, googleToken, loadState, movedReadings, readNothingStop,
  saveState, stateMap, toMorning, fixJob, bossApi, gmailSearchLink,
} from "./lib/duty-kit.mjs";

/** Moved lock readings → `{ decide, lines, fixes }`. Pure; tested. */
export function planLocks(moved) {
  const out = { decide: [], lines: [], fixes: [] };
  for (const m of moved) {
    if (m.state === "alert") {
      const subj = /"([^"]+)"/.exec(m.line)?.[1] ?? "";
      const domain = /\s([a-z0-9.-]+\.[a-z]{2,}):/i.exec(` ${m.line}`)?.[1] ?? "an account";
      out.decide.push({ title: `Answer the ${domain} notice on your account?`, body: subj ? `"${subj}"` : "", buttons: [{ label: "Open the email", url: gmailSearchLink(subj) }], priority: 2 });
    } else if (m.state === "cleared" || m.state === "ok") {
      if (m.key.startsWith("lock:")) out.lines.push(`An account notice from ${m.key.split(":")[1]} is no longer showing (resolved or older than 8 days).`);
    } else if (m.state === "stop") {
      out.fixes.push({ title: `Toni cannot check ${m.key.replace("mailbox:", "")} mail for account locks`, prompt: `Toni's weekly outside-locks check (scripts/ops/outside-locks.mjs) could not read ${m.key}: ${m.line} Fix the read. A team chore, never her email.` });
    }
  }
  return out;
}

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
    { model: MODEL, toolSearch: "gmail", requireTool: /gmail/i },
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
    const plan = planLocks(moved);
    if (plan.fixes.length) {
      let api = null;
      try { api = await bossApi(); } catch (e) { console.error(String(e?.message ?? e)); }
      for (const f of plan.fixes) { const why = api ? await fixJob(api, f) : "Boss OS was not reachable"; console.log(`  fix job: ${f.title}${why ? ` — NOT opened (${why})` : ""}`); }
    }
    if ((plan.lines.length || plan.decide.length) && !toMorning("risk", { lines: plan.lines, decide: plan.decide })) {
      console.error("state not saved."); process.exit(8);
    }
  }
  saveState("outside-locks", { at: new Date().toISOString(), states: stateMap(readings) });
  console.log(`OUTSIDE-LOCKS-COMPLETE: ${moved.length} moved`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`OUTSIDE-LOCKS FAILED: ${err?.message ?? err}`); process.exit(1); });
}
