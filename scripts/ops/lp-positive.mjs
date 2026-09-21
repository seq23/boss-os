/**
 * THE LPs WHO SAID YES, KEPT IN ONE PLACE AND SENT ONCE A MONTH.
 *
 * "i want her to go back through all the LP drip twin campaign emails and find the replies only. and
 *  out of all the replies i want her to find the ones that either want to have a call with us or
 *  keep in touch. all the positive replies. she needs to email me at sequoia@westpeek.ventures a
 *  list of all the positive replies. she should give me a running list and send me a note 1x per
 *  month"
 *
 * Monique's duty. She is Director of Relationships on the Boss OS roster and already owns this
 * mailbox; this is the same work as the daily outcome read, asking a different question of it.
 *
 * ─── Why this is not just a filter over the daily digest ───────────────────
 *
 * The daily read answers "what happened to the mail" — bounced, replied, opted out. It buckets an
 * enthusiastic "send me the deck" and a retirement autoresponder identically as `replied`, because
 * for deliverability purposes they are the same event. THEY ARE NOT THE SAME EVENT FOR A RAISE.
 *
 * A yes that nobody reads decays. "Happy to chat, but not until October" is worth exactly as much as
 * whoever remembers it in October, and until today nothing remembered anything: 123 inbound messages
 * to that address had never been read by any human or system.
 *
 * ─── MIME IS DECODED PROPERLY, AND THAT IS THE WHOLE BALLGAME ──────────────
 *
 * The first pass at classification searched the RAW message text. That silently misses every reply
 * whose body is base64 — which, in this mailbox, is a large share of them, because Outlook and
 * several corporate gateways encode by default. A regex over base64 finds nothing and reports
 * cleanly that nothing was found.
 *
 * That is how a mailbox containing "Happy to connect in the coming weeks" reported zero positive
 * replies. NOT A CRASH, NOT AN ERROR — a confident wrong answer, which is the failure mode this
 * whole system exists to eliminate. So this walks the MIME tree, prefers text/plain, and honours
 * Content-Transfer-Encoding rather than hoping the body happens to be readable.
 *
 * ─── A running list, because a monthly email is not a record ───────────────
 *
 * `positive.json` on her Mac accumulates. Each run adds who is new and never drops anyone: a warm LP
 * that fell off a list because a later scan windowed differently is a lost LP, and she would have no
 * way to know. The monthly email is a VIEW of that file, not the file itself.
 *
 * ─── Addresses stay here ───────────────────────────────────────────────────
 *
 * Real names and addresses live in this file on this machine and in the email to her own inbox.
 * Boss OS gets counts. The sync endpoint refuses anything containing an `@` and that guard is not
 * being bent — it is simply not in this path.
 *
 *   npm run lp:positive              # scan, update the running list, print it
 *   npm run lp:positive -- --email   # ...and send the monthly note
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sendersFor, employeeMail } from "./notify.mjs";

const MAILBOX = process.env.LP_MAILBOX ?? "sequoia@westpeek.ventures";
/** The campaign's first send was 23 July 2026. July 1 is a deliberate margin, not a guess. */
const SINCE = process.env.LP_SINCE ?? "2026/07/01";
const OUT_DIR = process.env.BOSS_OS_LP_DIR ?? path.join(os.homedir(), ".boss-os", "lp");
const LIST = path.join(OUT_DIR, "positive.json");
const SEND = process.argv.includes("--email");
const VERIFY = process.argv.includes("--verify");

/**
 * GROUND TRUTH, SUPPLIED BY THE OWNER FROM HER OWN RECORDS ON 2026-09-09.
 *
 * Twelve replies she knows exist. This is a RECALL TEST, and it is the only honest way to answer
 * "did the search actually find everything" — every other check this script could run would be
 * marking its own homework. A scan that finds eleven of twelve is not 92% correct; it is a scan
 * that lost a warm LP, and the whole point of the list is that nobody falls off it.
 *
 * `--verify` fails LOUDLY on a miss rather than reporting a percentage. If this list ever goes
 * stale, that is a reason to update it from her records, never a reason to soften the check.
 */
const KNOWN_REPLIES = [
  ["ccrow@trinity.edu", "Craig Crow, Trinity University Endowment", "2026-07-25"],
  ["amartin@wesleyan.edu", "Anne Martin, Wesleyan University Endowment", "2026-08-02"],
  ["wes@astera.org", "Wes Panek, Astera Institute", "2026-08-12"],
  ["trecker@irvine.org", "Tim Recker, The James Irvine Foundation", "2026-08-15"],
  ["lcenter@rockefeller.edu", "Rockefeller University", "2026-08-20"],
  ["jun.yang@rockefeller.edu", "Jun Yang, Rockefeller University Endowment", "2026-08-20"],
  ["award@inv.uchicago.edu", "Andy Ward, University of Chicago Office of Investments", "2026-08-21"],
  ["kirk.sims@trs.texas.gov", "Kirk Sims, Teacher Retirement System of Texas", "2026-08-26"],
  ["breay@bushfoundation.org", "Brendon Reay, Bush Foundation", "2026-08-30"],
  ["ksimpson@globalendowment.com", "Kate Simpson, Global Endowment Management", "2026-09-01"],
  ["regina@catalyze.community", "Regina Green, Catalyze", "2026-09-01"],
  ["lisa@screendoor.co", "Lisa Cawley, Screendoor Partners", "2026-09-09"],
];

/**
 * ─── TWO OF THE TWELVE ARE NOT IN ANY MAILBOX WE CAN READ ──────────────────
 *
 * CONFIRMED, by method rather than by assertion: a Gmail search for each of these addresses returns
 * ZERO messages in `sequoia@westpeek.ventures` and zero in `staylor@spry.vc`, while Twin's own
 * "Reply Log" tab records both — 2026-08-20 and 2026-08-21, "Reply received — suppressed from all
 * future sends". So the replies exist and they are somewhere neither readable mailbox contains.
 *
 * THAT IS A COVERAGE GAP, NOT A SEARCH BUG, AND THE DIFFERENCE MATTERS. A search bug is fixed by
 * widening the query; a coverage gap is fixed by gaining access to a mailbox, and no amount of
 * regex will ever find a message that is not there. Reporting them as a plain recall failure every
 * week would train her to ignore the one alarm that is supposed to mean something.
 *
 * SO THEY ARE A NAMED STOP — green and self-explaining — RATHER THAN A PERMANENT RED. The check is
 * NOT weakened: a miss that is not on this list still fails hard, and the run says out loud, every
 * time, which two it cannot see and where the evidence that they exist actually lives.
 */
const UNREACHABLE = new Map([
  ["jun.yang@rockefeller.edu",
   "In Twin's Reply Log 2026-08-20. Zero messages in westpeek.ventures and zero in spry.vc — it landed in a mailbox neither credential can read."],
  ["award@inv.uchicago.edu",
   "In Twin's Reply Log 2026-08-21. Zero messages in westpeek.ventures and zero in spry.vc — it landed in a mailbox neither credential can read."],
]);

const GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken(creds, scope, sub) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email, sub, scope,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(signer.sign(creds.private_key))}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

/**
 * The readable text of a message, whatever a corporate gateway did to it on the way out.
 *
 * Walks the MIME tree, prefers text/plain over text/html, and decodes per the part's own
 * Content-Transfer-Encoding. Falls back to stripping tags out of HTML when there is no plain part,
 * because a reply that exists only as HTML is still a reply.
 */
export function readableText(raw) {
  const decodePart = (headers, body) => {
    const enc = (headers.match(/^content-transfer-encoding:\s*(\S+)/mi) ?? ["", ""])[1].toLowerCase();
    if (enc === "base64") {
      return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64").toString("utf8");
    }
    if (enc === "quoted-printable") {
      return body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    return body;
  };

  const split = (text) => {
    const i = text.search(/\r?\n\r?\n/);
    return i === -1 ? [text, ""] : [text.slice(0, i), text.slice(i).replace(/^\r?\n\r?\n/, "")];
  };

  const [topHeaders, topBody] = split(raw);
  const boundary = (topHeaders.match(/boundary="?([^";\r\n]+)"?/i) ?? [])[1];

  /** Collected as {type, text} so text/plain can win even when it is not the first part. */
  const found = [];
  const walk = (headers, body, bound) => {
    const type = (headers.match(/^content-type:\s*([^;\r\n]+)/mi) ?? ["", ""])[1].toLowerCase();
    if (bound) {
      for (const chunk of body.split(new RegExp(`--${bound.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))) {
        const trimmed = chunk.replace(/^\r?\n/, "");
        if (!trimmed || trimmed.startsWith("--")) continue;
        const [h, b] = split(trimmed);
        const inner = (h.match(/boundary="?([^";\r\n]+)"?/i) ?? [])[1];
        walk(h, b, inner);
      }
      return;
    }
    if (type.startsWith("text/") || type === "") found.push({ type: type || "text/plain", text: decodePart(headers, body) });
  };
  walk(topHeaders, topBody, boundary);

  const plain = found.find((f) => f.type.startsWith("text/plain"));
  const chosen = plain ?? found.find((f) => f.type.startsWith("text/html"));
  let text = chosen ? chosen.text : decodePart(topHeaders, topBody);
  if (!plain && chosen) {
    text = text.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  }
  // Drop the quoted original: her own email is quoted underneath most replies, and matching intent
  // against her own copy would mark every replier as enthusiastic about her own pitch.
  return text
    .split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join("\n")
    .split(/^\s*(on .{0,90}wrote:|-+\s*original message\s*-+|from:\s)/im)[0]
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * POSITIVE MEANS SHE WOULD WANT TO ACT ON IT. Two shapes, both wanted, kept apart because they need
 * different follow-up: one is a call to book now, the other is a name to keep warm.
 *
 * Order matters. The disqualifiers run FIRST, because an out-of-office that happens to contain
 * "happy to help" is not an LP saying yes, and a retirement notice reading "please contact my
 * successor" is a dead end wearing friendly words. Getting this backwards produces a list she stops
 * trusting after the first false name on it.
 */
const AUTO = /\b(out of (the )?office|away from (the )?office|automatic reply|auto.?reply|autoresponder|currently out of|will (be )?return(ing)?|on (annual |parental )?leave|vacation)\b/i;
const DEPARTED = /\b(no longer (with|at)|has left|have retired|i have retired|retired as|transitioned out|is no longer|departed the firm)\b/i;
const NEGATIVE = /\b(not a fit|no longer investing|we (are |'re )?not (currently )?(investing|looking|taking)|pass on this|unable to (invest|participate)|not interested|unsubscribe|remove me|take me off)\b/i;

const WANTS_CALL = /\b(happy to (connect|chat|talk|speak)|find time on my calendar|calendly|book a (call|time)|set up a (call|time|meeting)|schedule a (call|time)|let'?s (connect|chat|talk|set)|open to a (call|conversation)|would be glad to (chat|connect|speak)|call next week|jump on a call)\b/i;
const KEEP_WARM = /\b(keep (me |us )?(in the loop|posted|in mind)|stay in touch|keep in touch|circle back|reach out (again|later|in the)|follow up (in|next)|not until|revisit in|check back|send (me |us )?(your |the )?(materials|deck|memo|info)|send (it |them )?to|happy to (review|take a look)|add (me|us) to your)\b/i;

const classify = (text) => {
  const t = text.slice(0, 6000);
  if (NEGATIVE.test(t)) return { bucket: "negative", why: "declined or asked to be removed" };
  if (DEPARTED.test(t)) return { bucket: "departed", why: "the person has left the firm or retired" };
  if (AUTO.test(t)) return { bucket: "auto", why: "autoresponder" };
  if (WANTS_CALL.test(t)) return { bucket: "call", why: "wants to talk" };
  if (KEEP_WARM.test(t)) return { bucket: "warm", why: "wants materials or to be kept in touch" };
  return { bucket: "other", why: "a human reply that is neither a yes nor a no" };
};

/** One or two sentences of what they actually said, so she does not have to open the mailbox. */
const quoteOf = (text) => {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 12);
  const best = sentences.find((s) => WANTS_CALL.test(s)) ?? sentences.find((s) => KEEP_WARM.test(s)) ?? sentences[0] ?? "";
  return best.replace(/^(hi|hello|hey|dear)\b[^,]{0,40},\s*/i, "").slice(0, 220).trim();
};

const api = async (url, token) => {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j?.error?.message ?? j).slice(0, 160)}`);
  return j;
};

async function emailHer(list, counts) {
  const TO = process.env.LP_POSITIVE_TO ?? "sequoia@westpeek.ventures";
  const SENDERS = sendersFor("Monique");
  if (SENDERS.length === 0) {
    console.error("NAMED STOP [NO_MAIL_KEY] the list is written but no email could be sent.");
    return false;
  }
  const line = (p) => `${p.name ? `${p.name}  ` : ""}${p.address}\n    ${p.first_seen}  ${p.quote}`;
  const calls = list.filter((p) => p.bucket === "call");
  const warm = list.filter((p) => p.bucket === "warm");

  const body = [
    "Sequoia,",
    "",
    "This is Monique. Once a month I re-read every reply to the LP outreach and pull out the",
    "positive ones — the people who want a call, and the people who want to be kept in touch.",
    "",
    `This is the running list, not just this month's: ${list.length} positive repl${list.length === 1 ? "y" : "ies"}`,
    `out of ${counts.replies} human replies across ${counts.scanned} inbound messages. Nobody ever`,
    "drops off this list once they are on it.",
    "",
    `Nothing here needs a decision from me — these are yours to answer.`,
    "",
    "",
    `WANTS A CALL (${calls.length})`,
    "",
    calls.length ? calls.map(line).join("\n\n") : "(none yet)",
    "",
    "",
    `KEEP WARM — asked for materials, or to be contacted later (${warm.length})`,
    "",
    warm.length ? warm.map(line).join("\n\n") : "(none yet)",
    "",
    "",
    "Not counted as positive: " +
      `${counts.auto} autoresponders, ${counts.departed} people who have left their firm, ` +
      `${counts.negative} declines, ${counts.other} replies that were neither.`,
    "",
    "— Monique, Director of Relationships",
  ].join("\n");

  for (const sender of SENDERS) {
    const { from, key } = sender;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(employeeMail(sender, { to: TO, subject: `LP positive replies — ${calls.length} want a call, ${warm.length} to keep warm`, text: body })),
    });
    if (res.ok) { console.log(`Emailed ${TO} from ${from}.`); return true; }
    console.error(`  ${from} refused: ${res.status} ${(await res.text()).slice(0, 140)}`);
  }
  return false;
}

async function main() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error("NAMED STOP [NO_SERVICE_ACCOUNT] run through the vault: npm run lp:positive");
    process.exit(4);
  }
  const token = await accessToken(JSON.parse(raw), GMAIL, MAILBOX);

  const q = `after:${SINCE} in:anywhere to:${MAILBOX} -from:${MAILBOX}`;
  const ids = [];
  let page;
  do {
    const j = await api(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500&q=${encodeURIComponent(q)}`
        + (page ? `&pageToken=${page}` : ""), token);
    for (const m of j.messages ?? []) ids.push(m.id);
    page = j.nextPageToken;
  } while (page && ids.length < 4000);

  if (ids.length === 0) {
    console.error(`NAMED STOP [NO_INBOUND] zero messages for "${q}". 571 emails went out; this is a broken read, not a quiet campaign.`);
    process.exit(6);
  }
  console.log(`${ids.length} inbound message(s) in ${MAILBOX} since ${SINCE}.`);

  const counts = { scanned: 0, replies: 0, call: 0, warm: 0, auto: 0, departed: 0, negative: 0, other: 0 };
  const found = new Map();
  const seenAddresses = new Map();

  for (const id of ids) {
    const msg = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=raw`, token).catch(() => null);
    if (!msg?.raw) continue;
    counts.scanned += 1;
    // BOUNDED. A mailbox holding a multi-megabyte deck must not be read whole into memory, and a
    // reply saying "happy to connect" ends long before this. Same bound lp-outcomes.mjs carries.
    const raw = Buffer.from(msg.raw, "base64").toString("utf8").slice(0, 200_000);
    const fromLine = (raw.match(/^From:.*$/mi) ?? [""])[0];
    const address = (fromLine.match(/[\w.+-]+@[\w.-]+\.\w+/) ?? [""])[0].toLowerCase();
    if (!address || address.includes("westpeek.ventures")) continue;
    // Bounces are not replies. A delivery failure names the address it failed for, so it would
    // otherwise enter the list as if that person had written back.
    if (/(mailer-daemon|postmaster|no-?reply|do-?not-?reply)/i.test(fromLine)) continue;
    if (/(delivery status notification|undelivered mail|delivery has failed|returned mail|failure notice|address not found)/i
      .test((raw.match(/^Subject:.*$/mi) ?? [""])[0])) continue;

    const text = readableText(raw);
    if (text.length < 8) continue;
    counts.replies += 1;

    const { bucket } = classify(text);
    counts[bucket] += 1;
    seenAddresses.set(address, { bucket, when: new Date(Number(msg.internalDate ?? Date.now())).toISOString().slice(0, 10) });
    if (bucket !== "call" && bucket !== "warm") continue;

    const name = (fromLine.match(/From:\s*"?([^"<@]{2,60}?)"?\s*</i) ?? ["", ""])[1].trim();
    const when = new Date(Number(msg.internalDate ?? Date.now())).toISOString().slice(0, 10);
    const prior = found.get(address);
    // The strongest signal a person ever gave is the one that matters: someone who asked for
    // materials in July and offered a call in September is a call.
    if (!prior || (prior.bucket === "warm" && bucket === "call")) {
      found.set(address, { address, name, bucket, first_seen: prior?.first_seen ?? when, quote: quoteOf(text) });
    }
  }

  // ─── The running list: added to, never trimmed ────────────────────────────
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const existing = fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, "utf8")) : { people: [] };
  const byAddress = new Map((existing.people ?? []).map((p) => [p.address, p]));
  let added = 0;
  let promoted = 0;
  for (const [address, p] of found) {
    const was = byAddress.get(address);
    if (!was) { byAddress.set(address, p); added += 1; continue; }
    if (was.bucket === "warm" && p.bucket === "call") { byAddress.set(address, { ...was, bucket: "call", quote: p.quote }); promoted += 1; }
  }
  const people = [...byAddress.values()].sort((a, b) => String(a.first_seen).localeCompare(String(b.first_seen)));
  fs.writeFileSync(LIST, JSON.stringify({ updated_at: new Date().toISOString(), counts, people }, null, 2), "utf8");

  console.log(`replies read: ${counts.replies}  |  call: ${counts.call}  warm: ${counts.warm}  auto: ${counts.auto}  departed: ${counts.departed}  declined: ${counts.negative}  other: ${counts.other}`);
  console.log(`running list: ${people.length} positive (${added} new this run, ${promoted} promoted warm->call)`);
  for (const p of people) console.log(`  [${p.bucket === "call" ? "CALL" : "warm"}] ${p.name || p.address} — ${p.quote.slice(0, 90)}`);

  if (VERIFY) {
    console.log("\n=== RECALL AGAINST HER OWN LIST OF 12 KNOWN REPLIES ===");
    const missed = [];
    for (const [addr, who, when] of KNOWN_REPLIES) {
      const hit = seenAddresses.get(addr.toLowerCase());
      if (hit) console.log(`  FOUND    ${addr.padEnd(30)} ${hit.bucket.padEnd(9)} ${hit.when}  ${who}`);
      else { console.log(`  MISSING  ${addr.padEnd(30)} ${"".padEnd(9)} ${when}  ${who}`); missed.push(addr); }
    }
    const known = missed.filter((m) => UNREACHABLE.has(m));
    const unexplained = missed.filter((m) => !UNREACHABLE.has(m));
    console.log(`\n  ${KNOWN_REPLIES.length - missed.length} of ${KNOWN_REPLIES.length} found.`);
    if (known.length) {
      console.log(`\nNAMED STOP [MAILBOX_NOT_COVERED] ${known.length} of them are not in any mailbox this can read:`);
      for (const m of known) console.log(`    ${m}\n      ${UNREACHABLE.get(m)}`);
      console.log("  This is a coverage gap, not a search bug: the replies exist and are recorded in Twin's");
      console.log("  Reply Log, and no query can find a message that is not in the mailbox being searched.");
      console.log("  It is named here rather than reported as a failure so that a REAL miss still means something.");
    }
    if (unexplained.length) {
      console.error(`\nNAMED STOP [RECALL_FAILED] the search did not find ${unexplained.length} repl(ies) she knows exist:`);
      for (const m of unexplained) console.error(`    ${m}`);
      console.error("  The search is too narrow. A list that silently loses a warm LP is worse than no list,");
      console.error("  because she would have no way to know it happened.");
      console.error("  These are NOT the two known coverage gaps — this is a search that has broken.");
      process.exit(9);
    }
  }

  if (SEND) {
    const sent = await emailHer(people, counts);
    if (!sent) process.exit(8);
  } else {
    console.log("\nList updated. Re-run with --email to send the monthly note.");
  }
  console.log("LP-POSITIVE-COMPLETE: filed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LP-POSITIVE FAILED: ${err?.message ?? err}`); process.exit(1); });
}
