/**
 * WHAT ACTUALLY HAPPENED TO EVERY EMAIL TWIN SENT.
 *
 * "making sure our spreadsheet accurately captures what twin has done and the outcome"
 *
 * ─── The defect this exists to end ──────────────────────────────────────────
 *
 * The Sent Log holds 571 rows and every one of them said `Status: sent`. It had said that since the
 * first row was written in July. "Sent" is not an outcome — it is the absence of one, recorded at
 * the moment of sending and never revisited. A tracker where every row carries the same value in its
 * status column is not tracking anything; it is a list with a decorative last field.
 *
 * The tabs to hold the real answer ALREADY EXISTED — Reply Queue, Block Queue, Blocked – Do Not
 * Contact, Reply Log — and every one was empty or last touched in August. The mailbox knew what
 * happened, the spreadsheet had a column for what happened, and nothing ever carried a fact from one
 * to the other.
 *
 * Her own Open Items tab called it before anybody looked: OI-02, "Zero hard bounces across 217
 * pattern-guessed addresses is not plausible." It was right. There are 88.
 *
 * ─── It reads the RIGHT mailbox, which the previous attempt did not ─────────
 *
 * `lp-replies.sh` routes through the claude.ai Gmail connector, and that connector is bound to her
 * PERSONAL account. It searched seq.taylor@gmail.com and reported the result as West Peek: three
 * inbound where there were 123, twelve bounces where there were 72. It did not error. It filed a
 * confident, wrong, quiet answer — the worst failure shape there is, because a crash is visible.
 *
 * This impersonates sequoia@westpeek.ventures directly through domain-wide delegation. The mailbox
 * is named in the JWT, so it cannot silently become a different one.
 *
 * ─── Attribution by address set, not by parsing bounce formats ──────────────
 *
 * A delivery-status notification can be formatted a dozen ways and every provider does it
 * differently; a parser for them is a parser you maintain forever. So this does not parse them. It
 * takes the addresses the Sent Log already knows about and searches each raw message for any of
 * them. A bounce contains the address it failed for no matter which provider wrote it. The
 * known-address set is the schema, and it comes from the spreadsheet itself.
 *
 * ─── DRY RUN BY DEFAULT ─────────────────────────────────────────────────────
 *
 * The first thing this does to a spreadsheet should be printable. `--commit` is required to write.
 * `--email-only` re-sends the last result without touching mail or sheets.
 *
 * ─── RULE 0 ─────────────────────────────────────────────────────────────────
 *
 * It may not exit 0 having done nothing. Zero sent rows, or zero inbound messages, is a non-zero
 * exit with a named reason — because a run that found nothing and a run that could not look are
 * otherwise indistinguishable, and one of them is a broken campaign.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sendersFor, employeeMail } from "./notify.mjs";

const SOURCE_ID = process.env.LP_SOURCE_SHEET ?? "1Riww0SiaLb_vxHjUpruSdkNemBEndcQrDQgu7Ly9rRA";
const SENT_TAB = process.env.LP_SOURCE_TAB ?? "Sent Log";
/**
 * THE SHEET HER PARTNER ACTUALLY READS, WHICH IS THE ONE THAT MATTERS.
 *
 * Twin writes outcomes into its own log; Scooter opens a different document. Updating only the
 * source produced a technically-correct sheet nobody looks at, while the sheet in the meeting still
 * said "sent" on every row — the same two-lists-with-no-link defect, one layer up. Both are updated
 * in the same run from the same computed outcome, so they cannot disagree.
 */
const DEST_ID = process.env.LP_DEST_SHEET ?? "1ksPqkry_mu3DwPj4zvgAKimzHnNAhNVi8y-9Q-gken0";
const DEST_TAB = process.env.LP_DEST_TAB ?? "AI Outreach";
const BLOCKED_TAB = "Blocked – Do Not Contact";
const REPLY_TAB = "Reply Queue";
const MAILBOX = process.env.LP_MAILBOX ?? "sequoia@westpeek.ventures";
const SINCE = process.env.LP_SINCE ?? "2026/07/01";
const OUT_DIR = process.env.BOSS_OS_LP_DIR ?? path.join(os.homedir(), ".boss-os", "lp");
const COMMIT = process.argv.includes("--commit");
/**
 * `--email-only` re-sends the last result without touching the mailbox or the spreadsheets.
 *
 * The send failed three times on Resend configuration while the reconciliation itself was already
 * correct, and each retry meant re-reading 261 messages for five minutes to rebuild lists that had
 * not changed. Reading `outcomes.json` back is the whole point of having written it.
 */
const EMAIL_ONLY = process.argv.includes("--email-only");

const SHEETS = "https://www.googleapis.com/auth/spreadsheets";
const GMAIL = "https://www.googleapis.com/auth/gmail.readonly";

/** Column positions, matching the header row the Sent Log actually has. */
const COL_EMAIL = 5;
const COL_STATUS = 9;

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * `sub` is passed for Gmail and omitted for Sheets, and that difference is load-bearing.
 *
 * A mailbox belongs to a user, so reading one requires impersonating that user. The spreadsheets are
 * owned by other accounts and were SHARED with the service account directly — impersonating anyone
 * there would make the call act as a person who was never given access, and fail with a 404 that
 * reads exactly like a wrong file id. This cost real debugging in lp-tracker-sync.mjs.
 */
async function accessToken(creds, scope, sub) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email, ...(sub ? { sub } : {}), scope,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(creds.private_key));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 240)}`);
  return (await res.json()).access_token;
}

const api = async (url, token) => {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j?.error?.message ?? j).slice(0, 200)}`);
  return j;
};

async function sheetValues(token, range, id = SOURCE_ID) {
  const j = await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`,
    token,
  );
  return j.values ?? [];
}

/**
 * OPT-OUT WORDING, DELIBERATELY BROAD.
 *
 * The cost of a false positive is one LP who would have been happy to hear from you not hearing from
 * you. The cost of a false negative is emailing somebody who asked twice to stop. Not symmetric, so
 * this errs toward suppression and says so on the row.
 */
const OPT_OUT = /\b(unsubscribe|remove me|take me off|opt.?out|stop (emailing|contacting)|do not (contact|email)|no longer (wish|want)|please stop|not interested)\b/i;
const AUTO = /\b(out of (the )?office|automatic reply|auto.?reply|autoresponder|on (annual )?leave|vacation (auto)?reply|thank you for (your|contacting))\b/i;
const BOUNCE_FROM = /(mailer-daemon|postmaster|no-?reply.*(delivery|bounce)|mail delivery (subsystem|system))/i;
const BOUNCE_SUBJ = /(delivery status notification|undelivered mail|delivery has failed|returned mail|failure notice|address not found|mail delivery failed)/i;

/**
 * SHE IS TOLD, IN THE PLACE SHE ACTUALLY LOOKS, THAT AN EMAIL WAS SENT.
 *
 * "the employee should put a note in my inbox each time saying she sent me an email from resend"
 *
 * The Inbox is the channel of RECORD — a screen she opens every morning, it keeps the history, and
 * it does not depend on a message arriving. The email is the PUSH. Today the push went to a fallback
 * address because of a Resend configuration, which is exactly the failure this note covers: an email
 * she never saw still leaves a visible trace saying it exists and where.
 *
 * It is posted only if the send SUCCEEDED. A note saying "I emailed you" when nothing was emailed is
 * worse than no note — it sends her looking for something that is not there.
 *
 * No address is in the payload. Boss OS refuses anything containing an `@` and that guard is not
 * being bent: the recipient is described, never written out.
 */
async function noteInInbox({ recipientLabel, optedOut, replied, bounced, senderNote }) {
  const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
  if (!process.env.BOSS_PASSCODE) {
    console.error("  NOTE NOT POSTED: BOSS_PASSCODE is not in the environment.");
    return false;
  }
  try {
    const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
    });
    if (!unlock.ok) throw new Error(`unlock ${unlock.status}`);
    const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

    const summary = [
      `Monique sent you an email, to ${recipientLabel}, with the LP outreach outcomes in it.`,
      "",
      `${bounced} bounced, ${replied} replied, ${optedOut} asked to be removed.`,
      "",
      "Both spreadsheets already carry these outcomes in their Status column, so nothing here needs a",
      "decision. The email repeats the lists so they can be pasted straight into Twin.",
      optedOut === 0
        ? "Nobody has asked to be removed, so there is nothing to suppress this time."
        : "The addresses to suppress are in the email and in the suppression file Twin reads.",
      ...(senderNote ? ["", senderNote] : []),
    ].join("\n");

    const res = await fetch(`${ORIGIN}/api/boss/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: `Monique emailed you the LP outcomes — ${bounced} bounced, ${replied} replied`,
        summary, lane: "ops", kind: "notice", risk: "low",
        origin_type: "duty", origin_id: "duty_lp_replies",
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    console.log("Posted a note to the Boss OS inbox.");
    return true;
  } catch (err) {
    // The email is already sent and both sheets are already correct. A failed note is a lost
    // breadcrumb, not lost work, and saying so plainly beats failing the whole run over it.
    console.error(`  NOTE NOT POSTED: ${err?.message ?? err}`);
    return false;
  }
}

/**
 * THE EMAIL SHE ASKED FOR, WITH REAL ADDRESSES IN IT.
 *
 * "monique needs to send me an email with each bounced email and each replied email and each ask to
 *  be removed so i can feed the twin agent"
 *
 * The addresses are allowed HERE and nowhere else. Boss OS refuses any payload containing an `@`,
 * and that guard is not weakened — it is simply not in this path. This runs on her Mac, reads her
 * mailbox, and sends to an inbox she owns. Nothing with an address reaches the Worker.
 *
 * Resend rather than Gmail, deliberately: through the Google connector this would share a failure
 * mode with the thing it reports on, and the day the mail credential dies is the day she most needs
 * the message. Resend has its own key and Google cannot revoke it.
 *
 * Formatted to be pasted, not read: each section is bare addresses, one per line, with nothing
 * between them a paste would carry across. The prose sits above each block, never inside it.
 */
async function emailHer({ optedOut, replied, bounced, tally, scanned, sentRows }) {
  /*
   * TWO RECIPIENTS, TRIED IN ORDER.
   *
   * A verified sender can reach any address, so the first entry normally wins. The West Peek address
   * remains as a fallback because an unverified account may only deliver to its own registered
   * address — and an email in the second-choice inbox beats a 403 in a log file.
   */
  const RECIPIENTS = [
    process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com",
    "sequoia@westpeek.ventures",
  ];
  /*
   * SIGNED BY THE EMPLOYEE WHO OWNS THE WORK, FROM THE SAME ROSTER EVERY OTHER MAIL USES.
   *
   * Monique is Director of Relationships on the Boss OS roster — Sequoia's personal OS. West Peek is
   * a separate business with its own OS and the two are never blended, so Boss OS employees write
   * from sequoiataylor.com.
   *
   * The roster lives in notify.mjs and is imported rather than repeated. A second copy of a list is
   * the defect this whole repository keeps producing: the day an employee is renamed, one copy is
   * updated and the other quietly sends from an address belonging to nobody, because a verified
   * domain signs any local part and an invented address delivers perfectly.
   *
   * TWO RESEND ACCOUNTS, EACH WITH ITS OWN KEY. The original holds the West Peek domains and had
   * reached its plan's domain limit; a second under her personal address holds sequoiataylor.com.
   * A key from one cannot send from the other's domains and the refusal reads like a verification
   * problem rather than a wrong-key problem — so the key travels with the sender rather than being
   * ambient. The West Peek address stays only as a last resort, and says so loudly if ever used.
   */
  const SENDERS = sendersFor("Monique");
  //
  // `onboarding@resend.dev` WAS a third fallback and has been removed on purpose.
  //
  // It is Resend's shared testing sender, and an unverified account may only deliver to its own
  // registered address — so the single thing it could ever do was drop an unattributed email into
  // the West Peek inbox instead of hers. It did that five times before the real sender existed, and
  // the result was five confusing messages from a vendor address in the wrong mailbox.
  //
  // A fallback that always delivers to the wrong place is not a fallback. If both real senders fail,
  // this now fails loudly with a named stop, and the Boss OS inbox note is unaffected because it
  // never depended on the email.
  if (!process.env.BOSS_OS_MAIL_KEY && !process.env.RESEND_API_KEY) {
    console.error("NAMED STOP [NO_RESEND_KEY] the sheet was updated but no email could be sent.");
    console.error("  The spreadsheet is now correct either way — this is the push, not the record.");
    return false;
  }

  const block = (list) => (list.length ? list.join("\n") : "(none)");
  /*
   * THE NOTE AT THE TOP SAYS WHO SENT IT AND WHAT IT COMPLETES.
   *
   * An email that opens with a table of addresses makes her reconstruct what it is, why it arrived,
   * and whether anything is expected of her. Three sentences at the top remove all three questions,
   * and naming the duty means a future one is recognisable as the same recurring thing rather than
   * a surprise.
   */
  const body = [
    "Sequoia,",
    "",
    "This is Monique. I own the West Peek LP mailbox and this is the daily outcome read for the",
    "AI outreach — duty `duty_lp_replies`, the deliverable being: every reply read and categorised",
    "within a day, and anyone who asked to be removed handed to Twin as something Twin can act on",
    "rather than a line you have to relay.",
    "",
    "It is done. Both spreadsheets already carry these outcomes in their Status column — Twin's",
    "Sent Log and the AI Outreach tab on the Fund I Tracker. Nothing here needs a decision from you.",
    "The lists are repeated below only so you can paste them straight into Twin.",
    "",
    "I have also left a note in your Boss OS inbox saying I sent this.",

    "",
    "— Monique, Director of Relationships",
    "",
    "---",
    "",
    `LP outreach outcomes — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `${sentRows} emails sent. ${scanned} inbound messages read from ${MAILBOX}.`,
    `${tally["opted-out"]} opted out, ${tally.replied} replied, ${tally.bounced} bounced.`,
    "",
    "",
    `ASKED TO BE REMOVED (${optedOut.length}) - suppress these first`,
    "",
    block(optedOut),
    "",
    "",
    `REPLIED (${replied.length}) - a human or an autoresponder answered`,
    "",
    block(replied),
    "",
    "",
    `BOUNCED (${bounced.length}) - the address did not accept mail`,
    "",
    block(bounced),
    "",
  ].join("\n");

  let lastErr = "";
  const attempts = [];
  for (const sx of SENDERS) for (const to of RECIPIENTS) attempts.push([sx, to]);
  for (const [sender, TO] of attempts) {
    const { from, key } = sender;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(employeeMail(sender, { to: TO, subject: `LP outcomes: ${optedOut.length} to suppress, ${replied.length} replied, ${bounced.length} bounced`, text: body })),
    });
    if (res.ok) {
      console.log(`Emailed ${TO} from ${from}: ${optedOut.length} to suppress, ${replied.length} replied, ${bounced.length} bounced.`);
      await noteInInbox({
        recipientLabel: TO.endsWith("westpeek.ventures") ? "your West Peek inbox" : "your personal inbox",
        optedOut: optedOut.length, replied: replied.length, bounced: bounced.length,
      });
      if (from.includes("westpeek.ventures")) {
        console.log("  NAMED STOP [WRONG_SENDING_IDENTITY] Monique is a Boss OS employee and just");
        console.log("  emailed from a West Peek domain. The Boss OS sender was unavailable — check");
        console.log("  BOSS_OS_MAIL_KEY and that sequoiataylor.com is verified on that account.");
        console.log("  The mail is correct; the identity on it is not.");
      } else if (TO !== RECIPIENTS[0]) {
        console.log(`  NOTE: delivered to the fallback recipient rather than the preferred one.`);
      }
      return true;
    }
    lastErr = `${res.status} ${(await res.text()).slice(0, 160)}`;
    console.error(`  ${from} -> ${TO} refused: ${lastErr}`);
  }
  console.error(`NAMED STOP [SEND_REFUSED] every sender was refused. Last: ${lastErr}`);
  console.error("  The spreadsheet is already correct — this is the push, not the record.");
  return false;
}

async function main() {
  if (EMAIL_ONLY) {
    const file = path.join(OUT_DIR, "outcomes.json");
    if (!fs.existsSync(file)) {
      console.error(`NAMED STOP [NO_PRIOR_RESULT] ${file} does not exist, so there is nothing to re-send.`);
      console.error("  Run a full reconciliation first: npm run lp:outcomes -- --commit");
      process.exit(7);
    }
    const prior = JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(`Re-sending the result generated at ${prior.generated_at}.`);
    const sent = await emailHer({
      optedOut: prior.opted_out ?? [],
      replied: prior.replied ?? [],
      bounced: prior.bounced ?? [],
      tally: prior.tally ?? { "opted-out": 0, replied: 0, bounced: 0 },
      scanned: prior.scanned ?? 0,
      sentRows: prior.sent_rows ?? 0,
    });
    if (!sent) process.exit(8);
    console.log("LP-OUTCOMES-COMPLETE: emailed");
    return;
  }

  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error("NAMED STOP [NO_SERVICE_ACCOUNT] GSC_SERVICE_ACCOUNT_JSON is not in the environment.");
    console.error("  Run this through the vault: npm run lp:outcomes");
    process.exit(4);
  }
  const creds = JSON.parse(raw);

  const sheetTok = await accessToken(creds, SHEETS, null);
  const mailTok = await accessToken(creds, GMAIL, MAILBOX);

  // ─── The sent list, which is also the address schema ───────────────────────
  const rows = await sheetValues(sheetTok, `${SENT_TAB}!A1:J5000`);
  if (rows.length < 2) {
    console.error(`NAMED STOP [NO_SENT_ROWS] ${SENT_TAB} returned ${rows.length} row(s). Nothing to reconcile.`);
    process.exit(5);
  }
  const header = rows[0];
  const data = rows.slice(1);

  /** address -> [row indexes], because the same LP is emailed at several drip stages. */
  const byAddress = new Map();
  for (let i = 0; i < data.length; i += 1) {
    const addr = String(data[i][COL_EMAIL] ?? "").trim().toLowerCase();
    if (!addr.includes("@")) continue;
    if (!byAddress.has(addr)) byAddress.set(addr, []);
    byAddress.get(addr).push(i);
  }
  console.log(`${SENT_TAB}: ${data.length} sent rows, ${byAddress.size} distinct addresses.`);

  // ─── Everything that came back ─────────────────────────────────────────────
  const q = `after:${SINCE} in:anywhere -from:${MAILBOX}`;
  const ids = [];
  let page;
  do {
    const j = await api(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500&q=${encodeURIComponent(q)}`
        + (page ? `&pageToken=${page}` : ""),
      mailTok,
    );
    for (const m of j.messages ?? []) ids.push(m.id);
    page = j.nextPageToken;
  } while (page && ids.length < 4000);

  if (ids.length === 0) {
    console.error(`NAMED STOP [NO_INBOUND] the mailbox returned zero messages for "${q}".`);
    console.error("  571 emails went out. Zero inbound is not a quiet campaign, it is a broken read.");
    process.exit(6);
  }
  console.log(`Mailbox ${MAILBOX}: ${ids.length} inbound message(s) since ${SINCE}.`);

  /** address -> { bounced, replied, optedOut, when } */
  const outcome = new Map();
  const note = (addr, kind, when) => {
    const cur = outcome.get(addr) ?? { bounced: 0, replied: 0, optedOut: 0, when: null };
    cur[kind] += 1;
    if (when && (!cur.when || when > cur.when)) cur.when = when;
    outcome.set(addr, cur);
  };

  const addresses = [...byAddress.keys()];
  let scanned = 0;
  let unattributed = 0;

  for (const id of ids) {
    const msg = await api(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=raw`,
      mailTok,
    ).catch(() => null);
    if (!msg?.raw) continue;
    scanned += 1;
    // 200KB is well past where a bounce report or a reply body ends, and bounds a mailbox that
    // contains the occasional multi-megabyte deck.
    const body = Buffer.from(msg.raw, "base64").toString("utf8").slice(0, 200_000);
    const lower = body.toLowerCase();
    const when = new Date(Number(msg.internalDate ?? Date.now())).toISOString().slice(0, 10);

    /**
     * THE BODY, SEPARATED FROM THE HEADERS AND FROM THE QUOTED ORIGINAL.
     *
     * Two ways this gets the wrong answer if it is skipped. First, the first few kilobytes of a raw
     * message are almost entirely headers, so a regex over "the start of the message" is a regex
     * over Received: lines and never reaches a word the sender wrote. Second, a reply quotes the
     * email it is replying to — and Twin's own footer is inside that quote. Matching opt-out wording
     * against the quoted original would mark every single person who ever replied as having asked to
     * be removed.
     *
     * So: drop the headers, decode quoted-printable enough to rejoin words split across soft line
     * breaks, cut at the first attribution line, and drop any line that is quoted. What is left is
     * what this person actually typed.
     */
    const afterHeaders = body.replace(/^[\s\S]*?\r?\n\r?\n/, "");
    const decoded = afterHeaders
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const written = decoded
      .split(/\r?\n/)
      .filter((l) => !/^\s*>/.test(l))
      .join("\n")
      .split(/^\s*(on .{0,80}wrote:|-+\s*original message\s*-+|from:\s)/im)[0]
      .slice(0, 8000)
      .toLowerCase();

    const fromLine = (body.match(/^From:.*$/mi) ?? [""])[0];
    const subjLine = (body.match(/^Subject:.*$/mi) ?? [""])[0];
    const isBounce = BOUNCE_FROM.test(fromLine) || BOUNCE_SUBJ.test(subjLine);

    // Which of the known LP addresses does this message concern? A bounce names the address it
    // failed for; a reply comes FROM it. Both are found the same way.
    const hits = addresses.filter((a) => lower.includes(a));
    if (hits.length === 0) { unattributed += 1; continue; }

    for (const addr of hits) {
      if (isBounce) { note(addr, "bounced", when); continue; }
      // A reply must plausibly be FROM that person, not merely mention them — otherwise one
      // forwarded thread would mark twenty people as having replied.
      if (!fromLine.toLowerCase().includes(addr)) continue;
      if (AUTO.test(subjLine) || AUTO.test(written)) { note(addr, "replied", when); continue; }
      if (OPT_OUT.test(written)) note(addr, "optedOut", when);
      else note(addr, "replied", when);
    }
  }

  console.log(`Scanned ${scanned} message(s); ${unattributed} matched no address on the Sent Log.`);

  // ─── Turn outcomes into cell values ────────────────────────────────────────
  //
  // PRECEDENCE, AND IT IS NOT ALPHABETICAL. An opt-out outranks a reply outranks a bounce. Somebody
  // who bounced at stage 1 and then wrote back from a corrected address has replied; somebody who
  // replied and later asked to be removed has asked to be removed. The strongest instruction wins.
  const statusFor = (o) => (o.optedOut ? "opted-out" : o.replied ? "replied" : o.bounced ? "bounced" : null);

  const updates = [];
  const tally = { "opted-out": 0, replied: 0, bounced: 0, unchanged: 0 };
  for (let i = 0; i < data.length; i += 1) {
    const addr = String(data[i][COL_EMAIL] ?? "").trim().toLowerCase();
    const o = outcome.get(addr);
    const want = o ? statusFor(o) : null;
    const have = String(data[i][COL_STATUS] ?? "").trim();
    if (!want || want === have) { tally.unchanged += 1; continue; }
    tally[want] += 1;
    updates.push({ range: `${SENT_TAB}!J${i + 2}`, values: [[want]] });
  }

  const optedOut = [...outcome.entries()].filter(([, o]) => o.optedOut > 0).map(([a]) => a);
  const replied = [...outcome.entries()].filter(([, o]) => o.optedOut === 0 && o.replied > 0);
  // Same precedence as the Status column: an address that also replied or opted out is not listed
  // here, so the three lists in her email never name the same person twice.
  const bouncedOnly = [...outcome.entries()]
    .filter(([, o]) => o.optedOut === 0 && o.replied === 0 && o.bounced > 0)
    .map(([a]) => a);

  console.log("");
  console.log("OUTCOME", JSON.stringify(tally));
  console.log(`  rows whose Status would change: ${updates.length}`);
  console.log(`  addresses that asked to be removed: ${optedOut.length}`);
  console.log(`  addresses that replied (human or auto): ${replied.length}`);

  // ─── The suppression list, which is the point ──────────────────────────────
  //
  // Real addresses, on this machine only. Twin reads this file directly. APPEND, never rewrite: a
  // suppression that gets dropped is somebody emailed again after asking you not to be.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const suppressPath = path.join(OUT_DIR, "suppress.txt");
  const existing = new Set(
    fs.existsSync(suppressPath)
      ? fs.readFileSync(suppressPath, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean)
      : [],
  );
  const toAdd = optedOut.filter((a) => !existing.has(a));

  // Already on the Do-Not-Contact tab? Then it is not new, and adding it twice makes the tab
  // untrustworthy in the one way that matters.
  const blockedRows = await sheetValues(sheetTok, `${BLOCKED_TAB}!A1:E2000`);
  const alreadyBlocked = new Set(blockedRows.map((r) => String(r[0] ?? "").trim().toLowerCase()).filter(Boolean));
  const blockAppend = optedOut
    .filter((a) => !alreadyBlocked.has(a))
    .map((a) => {
      const idx = (byAddress.get(a) ?? [])[0];
      const r = idx == null ? [] : data[idx];
      return [a, `${r[1] ?? ""} ${r[2] ?? ""}`.trim(), r[3] ?? "", "Asked to be removed", outcome.get(a)?.when ?? ""];
    });

  /*
   * IDEMPOTENT, BECAUSE THIS RUNS EVERY DAY.
   *
   * The first version appended every replier on every run. Day two would have listed the same eight
   * people twice, day three three times, and a queue that repeats itself is a queue nobody trusts —
   * which is how this tab ended up abandoned the first time. An address already on the tab is not
   * appended again.
   */
  const replyRows = await sheetValues(sheetTok, `${REPLY_TAB}!A1:F2000`);
  const alreadyQueued = new Set(replyRows.map((r) => String(r[0] ?? "").trim().toLowerCase()).filter(Boolean));

  const replyAppend = replied.filter(([a]) => !alreadyQueued.has(a)).map(([a, o]) => {
    const idx = (byAddress.get(a) ?? [])[0];
    const r = idx == null ? [] : data[idx];
    return [a, `${r[1] ?? ""} ${r[2] ?? ""}`.trim(), r[3] ?? "", o.when ?? "", `${o.replied} reply/replies read from the mailbox`, "new"];
  });

  /*
   * HIS TAB, UPDATED THE SAME WAY AND WITH THE SAME RESTRAINT.
   *
   * This writes to a document another person owns and edits. It touches exactly one column of one
   * named tab, and has no code path that deletes, clears, reorders or rewrites anything else. Rows
   * he added by hand are matched by email like any other and left alone if their status is already
   * right.
   *
   * A row on his tab whose address never appears in the mailbox keeps whatever it says now. Absence
   * of a bounce is not evidence of delivery, and overwriting his cell with a guess would be worse
   * than leaving it.
   */
  const destRows = await sheetValues(sheetTok, `${DEST_TAB}!A1:J5000`, DEST_ID);
  const destUpdates = [];
  const destTally = { "opted-out": 0, replied: 0, bounced: 0 };
  for (let i = 1; i < destRows.length; i += 1) {
    const addr = String(destRows[i][COL_EMAIL] ?? "").trim().toLowerCase();
    const o = outcome.get(addr);
    const want = o ? statusFor(o) : null;
    const have = String(destRows[i][COL_STATUS] ?? "").trim();
    if (!want || want === have) continue;
    destTally[want] += 1;
    destUpdates.push({ range: `${DEST_TAB}!J${i + 1}`, values: [[want]] });
  }
  console.log(`  ${DEST_TAB} (partner's tracker): ${destRows.length - 1} rows, ${destUpdates.length} Status cell(s) to change ${JSON.stringify(destTally)}`);


  if (!COMMIT) {
    console.log("");
    console.log("DRY RUN. Nothing was written to the spreadsheet and no suppression file was changed.");
    console.log(`  would update ${updates.length} Status cell(s) in "${SENT_TAB}"`);
    console.log(`  would append ${blockAppend.length} row(s) to "${BLOCKED_TAB}"`);
    console.log(`  would append ${replyAppend.length} row(s) to "${REPLY_TAB}"`);
    console.log(`  would add ${toAdd.length} address(es) to ${suppressPath}`);
    console.log(`  would email ${process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com"} with `
      + `${optedOut.length} to suppress, ${replied.length} replied, ${bouncedOnly.length} bounced`);
    console.log("");
    console.log("Re-run with --commit to write.");
    return;
  }

  if (updates.length > 0) {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SOURCE_ID}/values:batchUpdate`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${sheetTok}`, "content-type": "application/json" },
        body: JSON.stringify({ valueInputOption: "RAW", data: updates }),
      },
    );
    if (!res.ok) throw new Error(`status update failed (${res.status}): ${(await res.text()).slice(0, 240)}`);
    console.log(`Updated ${updates.length} Status cell(s).`);
  }

  if (COMMIT && destUpdates.length > 0) {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${DEST_ID}/values:batchUpdate`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${sheetTok}`, "content-type": "application/json" },
        body: JSON.stringify({ valueInputOption: "RAW", data: destUpdates }),
      },
    );
    if (!res.ok) throw new Error(`partner tracker update failed (${res.status}): ${(await res.text()).slice(0, 240)}`);
    console.log(`Updated ${destUpdates.length} Status cell(s) in the partner's "${DEST_TAB}".`);
  }


  const append = async (tab, values) => {
    if (values.length === 0) return;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SOURCE_ID}/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${sheetTok}`, "content-type": "application/json" },
        body: JSON.stringify({ values }),
      },
    );
    if (!res.ok) throw new Error(`append to ${tab} failed (${res.status}): ${(await res.text()).slice(0, 240)}`);
    console.log(`Appended ${values.length} row(s) to "${tab}".`);
  };
  await append(BLOCKED_TAB, blockAppend);
  await append(REPLY_TAB, replyAppend);

  if (toAdd.length > 0) {
    fs.appendFileSync(suppressPath, `${toAdd.join("\n")}\n`, "utf8");
    console.log(`Added ${toAdd.length} address(es) to ${suppressPath}.`);
  }

  /*
   * THE LISTS ARE WRITTEN DOWN BEFORE THE EMAIL IS ATTEMPTED.
   *
   * The send failed once on a DNS record, and re-running to retry it meant re-reading 261 messages
   * for five minutes. A result that only exists inside a running process cannot be retried.
   */
  fs.writeFileSync(
    path.join(OUT_DIR, "outcomes.json"),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      sent_rows: data.length,
      scanned,
      tally,
      opted_out: optedOut,
      replied: replied.map(([a]) => a),
      bounced: bouncedOnly,
    }, null, 2),
    "utf8",
  );

  // The email goes LAST, after the spreadsheet is already correct. If the send fails she has lost a
  // push, not a record — and the failure is named rather than swallowed.
  const sent = await emailHer({
    optedOut,
    replied: replied.map(([a]) => a),
    bounced: bouncedOnly,
    tally,
    scanned,
    sentRows: data.length,
  });

  console.log(`LP-OUTCOMES-COMPLETE: written${sent ? " and emailed" : " (email not sent — see above)"}`);
}

main().catch((err) => {
  console.error(`LP-OUTCOMES FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
