/**
 * MONIQUE RECOMMENDS A HANDFUL OF PEOPLE TO SPEAK TO, BY NAME, WITH A REASON EACH.
 *
 * ─── Her words, 9 September 2026 ───────────────────────────────────────────
 *
 *   "i dont like this people tab at all id rather just scrap it. id rather monique just send me
 *    deliverables she suggests about people to speak to (no codenames needed)"
 *
 * ─── What was on the screen she scrapped ───────────────────────────────────
 *
 * Two hundred and sixty-seven rows of birds. SANDPIPER, HERON, ROOK — code names, because Boss OS
 * deliberately never learns who anybody is. Sorted by how late they were. Twenty-five of them read
 * "469d late", "467d late", "459d late". A directory, in a private language, ordered by an
 * arithmetic nobody asked for.
 *
 * THE TAB WAS NOT UNDER-BUILT, IT WAS THE WRONG SHAPE. A list of two hundred people to call is the
 * thing she stops reading in week two. A recommendation is five people with a reason each — why this
 * person, why now, what to say — and the discipline that makes it a recommendation is that anyone
 * this cannot argue for does not appear.
 *
 * ─── Why it is a script on her Mac and not an endpoint ─────────────────────
 *
 * REAL NAMES ARE THE WHOLE POINT and they exist in exactly one place: `~/.boss-os/sourcing/
 * CONTACTS.json`, on this machine, written by her own mailbox extraction. Boss OS holds code names
 * and must go on holding them. So the reasoning runs here, the email carries the names, and the only
 * thing that reaches the Worker is a count and a sentence — which is the same boundary
 * `contacts-sync.mjs` has kept since it was written, read in the same direction.
 *
 * The sync endpoint's guard is untouched and this never posts to it.
 *
 * ─── Weekly, on a Monday, and not daily ────────────────────────────────────
 *
 * A daily list of people to ring is the exact artefact she just deleted. Relationship decay is
 * measured in weeks and months, so a week is the shortest interval at which the answer is even
 * different, and Monday morning is when a conversation can still happen inside the same week.
 *
 * ─── RULE 0 ─────────────────────────────────────────────────────────────────
 *
 * It may not finish having done nothing invisible. No extraction is a named stop with a non-zero
 * exit. A week where nobody qualifies still posts the notice saying she looked and how far she
 * looked, because "ran and found nobody" and "never ran" are opposite facts and the second one is a
 * broken job.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sendersFor, employeeMail } from "./notify.mjs";
import { observedCadence } from "./lib/cadence.mjs";

const IN_DIR = process.env.BOSS_OS_SOURCING_WORKSPACE ?? path.join(os.homedir(), ".boss-os", "sourcing");
const OUT_DIR = process.env.BOSS_OS_PEOPLE_DIR ?? path.join(os.homedir(), ".boss-os", "people");
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const SEND = process.argv.includes("--send");

/** How many make the note. A handful, because the list of two hundred is what she deleted. */
const HOW_MANY = 5;

/**
 * Do not recommend the same person again for this long.
 *
 * IDEMPOTENCE IS WHAT KEEPS A WEEKLY NOTE READ. The Reply Queue in the LP tracker was abandoned the
 * first time precisely because it repeated itself, and a recommendation she has already seen and not
 * acted on is not new information — it is the same nudge wearing this week's date.
 */
const COOLDOWN_DAYS = 56;

const DAY = 86_400_000;

/**
 * Addresses that are a system, not a person.
 *
 * MATCHED ON THE LOCAL PART ONLY. A domain tells you nothing — `operations@rainmakersecurities.com`
 * is the busiest correspondent in the whole extraction at 670 messages and is a notifications robot,
 * while a real broker at the same firm would be worth a call. The test is who the address belongs
 * to, and a mailbox called "operations" belongs to nobody.
 */
const ROBOT = /^(no-?reply|donotreply|do-not-reply|notifications?|alerts?|mailer|postmaster|bounce|support|help|info|hello|contact|admin|billing|invoices?|accounts?|operations|ops|team|sales|marketing|newsletter|news|updates?|calendar|invite|security|feedback|careers|jobs|press|legal|compliance|service|customer)([-.+].*)?$/i;

const isRobot = (email) => ROBOT.test(String(email).split("@")[0] ?? "");

const onDay = (iso) => new Date(iso).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round(Math.abs(a - b) / DAY);

/**
 * The three reasons a person is worth a conversation this week, strongest first.
 *
 * EACH ONE NAMES AN ACTION AND CARRIES ITS OWN EVIDENCE. A reason that reads the same for everybody
 * is not a reason; it is a category, and a list sorted by category is the roster again.
 *
 * The order is not a weighting exercise. "They wrote and you did not answer" is a live obligation and
 * outranks everything; a rhythm that has slipped is a task; a relationship that has lapsed is a
 * decision, and decisions belong at the bottom of a Monday list.
 */
function reasonFor(c, now) {
  const exchanges = c.sent + c.received;
  const cadence = observedCadence(c);
  const last = Date.parse(c.last_at);
  const mine = c.last_outbound_at ? Date.parse(c.last_outbound_at) : null;
  const quietDays = Math.round((now - last) / DAY);

  /*
   * 1. THE BALL IS WITH HER. They wrote after she last did, and enough time has passed that it is no
   *    longer simply the other half of a live thread. This is the only class here that is an
   *    obligation rather than an opportunity, so it outranks both of the others outright.
   */
  if (mine !== null && last - mine > 2 * DAY && quietDays >= 5) {
    return {
      rank: 0,
      why:
        `They wrote to you on ${onDay(c.last_at)} and you last wrote on ${onDay(c.last_outbound_at)} — ` +
        `${daysBetween(last, mine)} days before that. It has been ${quietDays} days and the reply is still yours to send.`,
      say: `Apologise for the gap in one clause, answer the thing they actually asked, and give them a date.`,
    };
  }

  /*
   * 2. A RHYTHM THAT HAS SLIPPED, measured against THEIR pace rather than a fixed number. Someone you
   *    speak to fortnightly is late at three weeks; someone you speak to twice a year is not late at
   *    three months, and treating the two the same is what produced twenty-five people at "469d late".
   */
  if (quietDays > cadence * 1.5 && quietDays <= 210) {
    return {
      rank: 1,
      why:
        `You two normally exchange mail about every ${cadence} days and it has been ${quietDays}. ` +
        `${exchanges} exchanges between you since ${onDay(c.first_at)}, so this is a real correspondence that has slipped, not a cold contact.`,
      say: `No agenda. Tell them what you are working on now and ask what they are seeing.`,
    };
  }

  /*
   * 3. A SUBSTANTIAL RELATIONSHIP THAT HAS LAPSED. Bounded at both ends on purpose: under seven
   *    months is covered by the rhythm test above, and over eighteen is not a lapse, it is a
   *    different life. Volume is required because restarting a thin tie is a cold email with extra
   *    steps.
   */
  if (quietDays > 210 && quietDays <= 550 && exchanges >= 12) {
    return {
      rank: 2,
      why:
        `${exchanges} exchanges between you and then nothing since ${onDay(c.last_at)} — ${Math.round(quietDays / 30)} months. ` +
        "That is a relationship that lapsed rather than ended, and restarting one is a decision worth making on purpose.",
      say: `Say plainly that it has been a while, name the last thing you worked on together, and ask for twenty minutes.`,
    };
  }

  return null;
}

/** Everyone worth recommending, ranked, minus anyone recommended recently. */
export function pickPeople(contacts, alreadyRecommended, now) {
  const picks = [];
  for (const c of contacts) {
    if (!c.email || isRobot(c.email)) continue;
    // TWO-WAY, AND ENOUGH OF IT. Anyone can email her; the ones she wrote back to are the real ones.
    if (!(c.sent > 0 && c.received > 0 && c.sent + c.received >= 3)) continue;
    const seen = alreadyRecommended[c.email.toLowerCase()];
    if (seen && now - seen < COOLDOWN_DAYS * DAY) continue;

    const reason = reasonFor(c, now);
    if (!reason) continue;
    picks.push({
      email: c.email,
      name: c.name || c.email,
      exchanges: c.sent + c.received,
      ...reason,
    });
  }
  // Rank class first, then weight of relationship — a bigger correspondence is a better use of the
  // same twenty minutes, and it is the only tiebreak here that is measured rather than invented.
  picks.sort((a, b) => a.rank - b.rank || b.exchanges - a.exchanges);
  return picks;
}

/**
 * At most three from any one class, so the note spans the reasons it found.
 *
 * WITHOUT THIS IT IS AN UNREAD-MAIL LIST. On the first real run, 171 people qualified and the five
 * strongest were all "you owe them a reply" — which Gmail already tells her, in a worse format, every
 * day. The whole value of the other two classes is that nothing else in her life surfaces them: a
 * correspondence that has quietly slowed, and a substantial relationship that lapsed a year ago.
 * Letting one class fill the note would bury exactly the recommendations she cannot get elsewhere.
 *
 * It is a CAP, not a quota. A week with only one class produces a note of one class rather than a
 * note padded with people this could not argue for.
 */
export function spread(picks, howMany) {
  const byClass = [[], [], []];
  for (const p of picks) byClass[p.rank].push(p);

  const out = [];
  // ROUND ROBIN RATHER THAN A PER-CLASS CAP. A cap of three still let the strongest class plus one
  // other fill five slots, so the lapsed relationships — the class nothing else in her life
  // surfaces — never appeared at all. Taking one from each class in turn guarantees every reason
  // that HAS a candidate gets a place, while the order inside each class stays strongest-first.
  for (let round = 0; out.length < howMany; round += 1) {
    let tookAny = false;
    for (const cls of byClass) {
      if (out.length >= howMany) break;
      if (round < cls.length) { out.push(cls[round]); tookAny = true; }
    }
    if (!tookAny) break;
  }
  // Strongest class first in the finished note: the order she reads is the order of obligation.
  out.sort((a, b) => a.rank - b.rank || b.exchanges - a.exchanges);
  return out;
}

const CLASS_LABEL = ["You owe them a reply", "Your rhythm has slipped", "The relationship lapsed"];

/**
 * The note itself. Real names, real addresses, real dates — on her machine, to her own inbox.
 *
 * The addresses are allowed HERE and nowhere else, exactly as in `lp-outcomes.mjs`: Boss OS refuses
 * any payload containing an `@` and that guard is not weakened, it is simply not on this path.
 */
async function emailHer(picks, examined, considered) {
  const SENDERS = sendersFor("Monique");
  if (SENDERS.length === 0) {
    console.error("NAMED STOP [NO_RESEND_KEY] neither BOSS_OS_MAIL_KEY nor RESEND_API_KEY is set.");
    console.error("  Run this through the vault: npm run people:recommend -- --send");
    return false;
  }
  const RECIPIENTS = [process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com", "sequoia@westpeek.ventures"];

  const body = [
    "Sequoia,",
    "",
    "This is Monique. Once a week I read your correspondence and pick out the people worth a",
    `conversation — not everyone who has gone quiet, only the ones I can argue for. I looked at`,
    `${examined} correspondents this week; ${considered} of them had a reason attached. Here are ${picks.length}.`,
    "",
    "Nothing here needs a decision from you and nothing has been sent to anybody. These are yours",
    "to write, or to ignore — I will not raise the same person again for eight weeks either way.",
    "",
    "— Monique, Director of Relationships",
    "",
    "---",
    "",
    ...picks.flatMap((p, i) => [
      `${i + 1}. ${p.name}  <${p.email}>`,
      `   ${CLASS_LABEL[p.rank]}`,
      "",
      `   Why now: ${p.why}`,
      `   What to say: ${p.say}`,
      "",
    ]),
  ].join("\n");

  let lastErr = "";
  for (const sender of SENDERS) {
    const { from, key } = sender;
    for (const TO of RECIPIENTS) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(employeeMail(sender, { to: TO, subject: `${picks.length} people worth a conversation this week`, text: body })),
      });
      if (res.ok) {
        console.log(`Emailed ${TO} from ${from}: ${picks.length} recommendation(s).`);
        if (from.includes("westpeek.ventures")) {
          console.log("  NAMED STOP [WRONG_SENDING_IDENTITY] Monique is a Boss OS employee and just");
          console.log("  emailed from a West Peek domain. Check BOSS_OS_MAIL_KEY.");
        }
        return true;
      }
      lastErr = `${res.status} ${(await res.text()).slice(0, 160)}`;
      console.error(`  ${from} -> ${TO} refused: ${lastErr}`);
    }
  }
  console.error(`NAMED STOP [SEND_REFUSED] every sender was refused. Last: ${lastErr}`);
  return false;
}

/**
 * The trace in the place she actually looks — and it is a NOTICE, not an approval.
 *
 * There is nothing here to approve: the recommendation is hers to act on or drop, and a card asking
 * her to Approve / Reject a piece of information devalues every real approval beside it. `kind:
 * "notice"` is what the Inbox reads to render it as something she has been told rather than
 * something she owes an answer to.
 *
 * NO NAME AND NO ADDRESS IS IN THIS PAYLOAD. Counts and one sentence. The names are in the email.
 */
async function noteInInbox({ count, examined, considered }) {
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

    const summary = count === 0
      ? [
          `Monique read ${examined} of your correspondents this week and could not argue for a single`,
          "conversation, so she has not sent you a list.",
          "",
          "This is the job having run, not the job having failed. A week with nobody in it is a normal",
          "week; a week where nothing looked would be a broken one, and this note is how you tell them",
          "apart.",
        ].join("\n")
      : [
          `Monique emailed you ${count} ${count === 1 ? "person" : "people"} worth a conversation this week,`,
          "by name, with why each one and what to say.",
          "",
          `She read ${examined} correspondents; ${considered} had a reason attached and she sent the strongest ${count}.`,
          "Nothing here needs a decision and nothing was sent to anybody. Names stay on your Mac —",
          "Boss OS still holds only code names.",
        ].join("\n");

    const res = await fetch(`${ORIGIN}/api/boss/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: count === 0
          ? "Monique found nobody worth a call this week"
          : `Monique emailed you ${count} ${count === 1 ? "person" : "people"} worth a conversation`,
        summary, lane: "ops", kind: "notice", risk: "low",
        origin_type: "duty", origin_id: "duty_people_worth_a_call",
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    console.log("Posted a notice to the Boss OS inbox.");
    return true;
  } catch (err) {
    console.error(`  NOTE NOT POSTED: ${err?.message ?? err}`);
    return false;
  }
}

async function main() {
  const now = Date.now();
  const file = path.join(IN_DIR, "CONTACTS.json");
  if (!fs.existsSync(file)) {
    console.error(`NAMED STOP [NO_EXTRACTION] ${file} does not exist, so there is nobody to read.`);
    console.error("  Run: npm run contacts:extract");
    process.exit(4);
  }
  const extract = JSON.parse(fs.readFileSync(file, "utf8"));
  const contacts = extract.contacts ?? [];
  if (contacts.length === 0) {
    console.error(`NAMED STOP [EMPTY_EXTRACTION] ${file} holds zero contacts.`);
    console.error("  An empty mailbox read is a broken extraction, not a quiet week.");
    process.exit(5);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const seenPath = path.join(OUT_DIR, "recommended.json");
  const seen = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, "utf8")) : {};

  const all = pickPeople(contacts, seen, now);
  const picks = spread(all, HOW_MANY);

  console.log(`Read ${contacts.length} correspondents from ${extract.mailbox ?? "the extraction"}.`);
  console.log(`${all.length} had a reason attached; recommending ${picks.length}.`);
  for (const p of picks) console.log(`  ${CLASS_LABEL[p.rank]} — ${p.name}: ${p.why}`);

  if (!SEND) {
    console.log("");
    console.log("DRY RUN. No email was sent and no notice was posted. Re-run with --send.");
    return;
  }

  /*
   * THE COOLDOWN IS WRITTEN BEFORE THE SEND, not after.
   *
   * If the send fails, the worst outcome is that five people wait a week. If the write is skipped
   * because the send failed and a retry then goes out, she gets the same five names twice — and a
   * weekly note that repeats itself is a weekly note she stops opening.
   */
  if (picks.length > 0) {
    for (const p of picks) seen[p.email.toLowerCase()] = now;
    fs.writeFileSync(seenPath, JSON.stringify(seen, null, 2), "utf8");
  }

  const sent = picks.length > 0
    ? await emailHer(picks, contacts.length, all.length)
    : true;
  await noteInInbox({ count: picks.length, examined: contacts.length, considered: all.length });

  console.log(`PEOPLE-WORTH-A-CALL-COMPLETE: ${picks.length} recommended${sent ? "" : " (email not sent — see above)"}`);
  if (!sent) process.exit(8);
}

main().catch((err) => {
  console.error(`people-worth-a-call failed: ${err?.message ?? err}`);
  process.exit(1);
});
