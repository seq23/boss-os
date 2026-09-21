/**
 * THE MATCHING — the thing the ledger was built for.
 *
 * Somebody wanted SpaceX in March. Somebody is selling it this week. Nothing has ever connected the
 * two, because the two facts live four hundred messages apart in a mailbox of 104,241. The ledger
 * made them comparable; this puts them next to each other.
 *
 * ─── A WRONG MATCH IS FAR WORSE THAN A MISSED ONE ──────────────────────────
 *
 * This inverts the filter. The pre-filter is deliberately generous, because a dropped message is a
 * deal she never learns she missed and the cost of a borderline one is a fraction of a cent. HERE
 * THE COSTS REVERSE: calling somebody about stock they never wanted costs credibility in a small
 * market where everyone knows everyone. ONE BAD CALL OUTWEIGHS TEN MISSED MATCHES. So the threshold
 * is high, every match shows its evidence and its age, and there is a visible way to say "not this
 * person" that the next run honours.
 *
 * ─── RECOMMEND, NEVER ENUMERATE ────────────────────────────────────────────
 *
 * A list of 340 possible buyers is the People tab she deleted. Five with reasons beats three
 * hundred sorted, and the cap is enforced here rather than left to whoever reads the output.
 *
 * ─── IT IS A REVIVAL ENGINE, NOT A RECONCILIATION ──────────────────────────
 *
 * This was built the wrong way round first. The original design leant on a DURABLE half of the
 * ledger — "has transacted in X", a fact about who somebody is that never expires — and treated a
 * live expression of interest as the perishable, second-class half. She corrected it:
 *
 *   "i havent done any deals in a while thats the whole point of having this agent help me drum up
 *    business"
 *
 * SO THE DURABLE HALF IS THIN, AND THE VALUE MOVES ENTIRELY TO THE CONVERSATIONS. The asset is not
 * completed transactions. It is PEOPLE WHO EXPRESSED INTEREST AND NEVER GOT FILLED — the buyer who
 * wanted SpaceX in March and heard nothing since, the seller who never found a counterparty, the
 * firm that asked what she had and got a vague answer. Every one of those is a live lead sitting in
 * 104,241 messages, not a historical record.
 *
 * AN INTEREST THAT NEVER CLOSED IS MORE ACTIONABLE THAN ONE THAT DID. The closed one is done; the
 * open one is a phone call. So the ranking inverts what a reconciliation would do: unfilled outranks
 * filled, and a specific unanswered ask outranks a general expression of appetite.
 *
 * ─── NO MATCHING WINDOW, BECAUSE A CLIFF LOSES REAL DEALS ──────────────────
 *
 * Asked how far back a match should reach she said "like up to 12 months? i dont know" — and she
 * should not have to pick, because a cutoff means a genuine match silently vanishes on day 366. Age
 * is carried on the face of every match rather than used to delete one.
 *
 * Decay is a curve, never a cliff. A SELLER'S interest decays fastest — inventory moves. A BUYER'S
 * MANDATE PERSISTS. And SIZE PREDICTS DURABILITY: a $2B ByteDance buyer is an institution with a
 * standing mandate, a $2M buyer is often opportunistic.
 *
 * ─── Local, and it stays local ─────────────────────────────────────────────
 *
 * Named counterparties, assets and sizes never reach the Boss OS database — not code-named, not
 * counted. Matches print here and go to her own inbox from monique@sequoiataylor.com. Nothing is
 * ever sent from spry.vc: she can read that mailbox and cannot write from it, which is her rule and
 * is asserted by `validate:no-spry-sender`.
 *
 *   npm run capital:match                          # the standing cross — who fits whom, right now
 *   npm run capital:match -- --send                # ...and email it to her
 *   npm run capital:match -- --send --pointer      # ...and tell today's contract the mail exists,
 *                                                  #    as a count and a clock. No names cross.
 *   npm run capital:match -- --find SpaceX --side buy --size 250000000
 *   npm run capital:match -- --revive              # only the leads: interests that never got filled
 *   npm run capital:match -- --nudge               # the monthly, asset-anchored note — at most three
 *   npm run capital:match -- --not "someone@example.com"      # never recommend this person again
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sendersFor, employeeMail } from "./notify.mjs";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const LEDGER = path.join(DIR, "ledger.json");
const SUPPRESS = path.join(DIR, "not-this-person.json");
const WRONG_FILE = path.join(DIR, "wrong.json");

const ARGS = process.argv.slice(2);
const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : ARGS[i + 1] ?? null; };
const SEND = ARGS.includes("--send");
const FIND = argOf("find");
const WANT_SIDE = argOf("side");
const WANT_SIZE = Number(argOf("size") ?? 0);
const NOT = argOf("not");
const NUDGE = ARGS.includes("--nudge");
const REVIVE = ARGS.includes("--revive");

/**
 * ─── THE POINTER: HOW TODAY'S CONTRACT LEARNS THIS MAIL EXISTS ──────────────
 *
 * The brokerage line in today's contract could not see this ledger, so on most weekdays it fell
 * through to a confirmed crossmatch or an unsized book lot — while the most valuable thing the
 * system knows, two live sides of the same name, sat in an email she might not open until noon.
 *
 * THE LEDGER STILL DOES NOT MOVE. The rule at the top of this file is hers and it stands:
 *
 *   "Named counterparties, assets and sizes never reach the Boss OS database — not code-named,
 *    not counted."
 *
 * So this posts a COUNT, A KIND AND A CLOCK to `POST /api/boss/capital/brokerage-pointer` — the
 * same shape `buyer-hunt.mjs --from-boss` already uses, which computes on her Mac where the data is
 * and reports back only what is safe. The table it lands in has no free TEXT column, so a name
 * cannot be stored there even by a caller that tried; the endpoint refuses any field but those
 * three; and `validate:pointer-has-no-names` asserts both offline on every build.
 *
 * WEEKDAYS ONLY, AND ONLY WHEN THERE IS SOMETHING. Her instruction on the contract is M-F, and her
 * standing rule on this lane is that empty-handed beats noise — a pointer to a mail that says
 * "nothing today" is noise with a count on it. A quiet day posts nothing and the contract says
 * nothing, which is the correct outcome and the common one.
 *
 * AND IT ONLY POSTS WHAT WAS ACTUALLY SENT. The post happens after the Resend call succeeds, never
 * before and never on a dry run — a pointer to an email that does not exist is worse than no
 * pointer, because she goes looking and finds nothing.
 */
const POINTER = ARGS.includes("--pointer");

async function postPointer(kind, crossings, sentAt) {
  const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
  if (!process.env.BOSS_PASSCODE) {
    console.error("  pointer NOT posted [NO_PASSCODE] — the mail went, today's contract will not know.");
    console.error("  Run under the vault: npm run vault:run -- npm run capital:match -- --pointer --send");
    return false;
  }
  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  }).catch(() => null);
  if (!unlock?.ok) {
    console.error(`  pointer NOT posted [UNLOCK_FAILED] — Boss OS refused the passcode (${unlock?.status ?? "no response"}).`);
    return false;
  }
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
  /*
   * THE BODY IS BUILT HERE, LITERALLY, FROM THREE PRIMITIVES. Not spread from a match object, not
   * assembled from a summary — because a spread is how the asset field arrives one day without
   * anybody deciding it should.
   */
  const res = await fetch(`${ORIGIN}/api/boss/capital/brokerage-pointer`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind, crossings, sent_at: sentAt }),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`  pointer NOT posted [${res?.status ?? "no response"}] — the mail went, today's contract will not know.`);
    return false;
  }
  console.log(`  Pointer posted: ${crossings} ${kind}(s), no names. Today's contract will say the mail is there.`);
  return true;
}

/** Five, with reasons. Never a directory. */
const CAP = Number(process.env.CAPITAL_MATCH_CAP ?? 5);
/** Below this a pairing is not shown at all. Precision first — silence beats a bad call. */
const FLOOR = Number(process.env.CAPITAL_MATCH_FLOOR ?? 0.30);

const DAY = 86_400_000;

// ─── Identity and asset keys ─────────────────────────────────────────────────

/**
 * Two spellings of one company are one company. `Bytedance` and `ByteDance` appeared in the first
 * live ledger within three rows of each other.
 *
 * NORMALISED, NEVER FUZZY. Case and punctuation are noise; anything cleverer merges two real firms
 * with similar names, and a match built on a merge like that is precisely the wrong call this file
 * exists to avoid.
 */
export const assetKey = (a) => String(a ?? "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "")
  .replace(/(inc|corp|corporation|ltd|llc|labs?|technologies|holdings)$/, "");

export const whoKey = (r) => String(r.principal_email ?? r.principal ?? "").toLowerCase().trim();

// ─── Decay: a curve, never a cliff ───────────────────────────────────────────

/**
 * How long this interest stays half as interesting, in days.
 *
 * `transacted` returns Infinity — a durable fact about who somebody is does not rot. Everything else
 * decays, and the three inputs are the ones the market actually has: side, size, and nothing else.
 */
export function halfLifeDays(r) {
  const size = Number(r.size_usd) || (Number(r.size_shares) || 0) * 50; // a rough share mark, only for ranking
  /*
   * A SELL ALWAYS DECAYS, INCLUDING A TRANSACTED ONE. `transacted` means "this is who they are" —
   * a durable fact about a person, and the reason a buyer's mandate never expires. It does NOT mean
   * the inventory is still there. Before this ordering, `transacted` was checked first and returned
   * Infinity on either side, so eleven blocks sold in March 2026 scored freshness 1.0 forever and
   * crossed against fresh buyers as live supply. Her rule, in her words: deals go stale, something
   * over six months old is likely stale and the matchup will not work — but the same person is
   * still someone worth calling about something new.
   *
   * That second half is why this is safe. `revivals` excludes transacted rows outright and
   * `assignedSearch` floors freshness at 0.4 with no cutoff, so decaying a sell here dims a stale
   * CROSS and takes nothing away from OUTREACH, which still reaches back as far as the ledger goes.
   */
  if (r.side === "sell") {
    // Inventory moves. A block offered nine months ago is usually gone, and saying so is honest.
    return size >= 100e6 ? 90 : 45;
  }
  if (r.durability === "transacted") return Infinity;
  // A BUYER'S MANDATE PERSISTS, and size is the best available proxy for whether it is institutional.
  if (size >= 1e9) return 540;
  if (size >= 100e6) return 365;
  if (size >= 10e6) return 180;
  return 120;
}

export const freshness = (r, now = Date.now()) => {
  const age = Math.max(0, (now - Date.parse(`${r.date}T12:00:00Z`)) / DAY);
  const hl = halfLifeDays(r);
  return { ageDays: Math.round(age), score: hl === Infinity ? 1 : 0.5 ** (age / hl) };
};

const CONF = { high: 1, medium: 0.6, low: 0.25 };

/** How well two sizes sit together. A partial fill is a real deal, so this never disqualifies. */
export function sizeFit(a, b) {
  const x = Number(a.size_usd) || 0, y = Number(b.size_usd) || 0;
  if (!x || !y) return 0.6;
  const ratio = Math.min(x, y) / Math.max(x, y);
  return 0.5 + 0.5 * ratio;
}

// ─── The "not this person" control ───────────────────────────────────────────

/**
 * Rows she has read against their own sentence and called wrong, in `npm run capital:review`.
 *
 * A STRUCK ROW LEAVES EVERY RECOMMENDATION, not just the review set. Showing her a match built on a
 * row she has already told us is wrong is the fastest way to lose the whole surface.
 */
const loadWrongRows = () => {
  try { return new Set(JSON.parse(fs.readFileSync(WRONG_FILE, "utf8")).rows ?? []); } catch { return new Set(); }
};

const loadSuppressed = () => {
  try { return new Set(JSON.parse(fs.readFileSync(SUPPRESS, "utf8")).people ?? []); } catch { return new Set(); }
};

function suppress(who) {
  const set = loadSuppressed();
  set.add(String(who).toLowerCase().trim());
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(SUPPRESS, JSON.stringify({ updated_at: new Date().toISOString(), people: [...set] }, null, 2), "utf8");
  console.log(`"${who}" will not be recommended again. ${set.size} name(s) suppressed.`);
  console.log(`  The list is ${SUPPRESS}; delete a line to undo it.`);
}

// ─── Her own firm, on both sides ─────────────────────────────────────────────

/**
 * SHE IS A REGISTERED PERSON AT RAINMAKER SECURITIES, SO A RAINMAKER-TO-RAINMAKER CROSS IS NOT A
 * DEAL SHE BROKERS.
 *
 * Her words, 10 September 2026: "monique should not send me cross connections between 2 disparate
 * emails @rainmakersecurities — those are 2 brokers at my brokerage firm who can cross trades on
 * their own."
 *
 * That is not a taste preference, it is what the pairing IS. Two reps at the same broker-dealer
 * with the opposite side of one name do not need an introduction — they are down the same hall, on
 * the same blotter, under the same supervision. Printing it as a "cross worth a call" spends one of
 * five slots telling her about a trade her own firm can do without her, and does it while looking
 * exactly like the real thing.
 *
 * CONFIRMED ON THE LIVE LEDGER, not reasoned about: the run of 10 Sep returned five crosses and one
 * of them — Kalshi, mgrosman@ against shamedanchi@ — was precisely this. It scored 0.710, third of
 * five, so it was not a fringe case being tidied away; it was pushing a genuine pairing off the list.
 *
 * ─── ONE SIDE IS STILL A REAL RELATIONSHIP ─────────────────────────────────
 *
 * A Rainmaker rep on ONE side is the ordinary shape of her business: her firm holds the paper and
 * somebody outside wants it, or the reverse. Suppressing those would delete the job. So this fires
 * only when BOTH sides resolve to the firm, and the same run's other two Rainmaker pairings —
 * OpenAI and Bytedance, each with an outside counterparty — are untouched.
 *
 * ─── WHERE THE ADDRESS ACTUALLY LIVES, AND WHY THIS IS NOT `principal_email` ─
 *
 * Not one of the 545 ledger rows carries a `@rainmakersecurities.com` PRINCIPAL address, and 242
 * carry one as `intermediated_by`. That is correct and permanent: a rep never sends his client's
 * address, so the ledger records "unnamed client of dknorowski@rainmakersecurities.com". The rep IS
 * the reachable counterparty for this purpose, which is exactly why the pairing needs no
 * introduction. Keying this on `principal_email` alone would have matched nothing, passed every
 * test, and suppressed nothing — this repo's "runs but inert" defect, in one field name.
 *
 * `rainmakerapac.com` is deliberately NOT included. It is an affiliate, not the broker-dealer she is
 * registered with, and she named one domain. Widening it is her call, not a guess made here.
 */
export const HER_BROKERAGE_DOMAIN = "rainmakersecurities.com";

/** True when this side of a pairing is reachable through her own broker-dealer. */
export function atHerBrokerage(r) {
  const at = new RegExp(`@${HER_BROKERAGE_DOMAIN.replace(/\./g, "\\.")}\\b`, "i");
  return at.test(String(r?.principal_email ?? "")) || at.test(String(r?.intermediated_by ?? ""));
}

/** Two brokers at her own firm, either side of one name. Not a cross she is needed for. */
export const isInternalCoBrokerCross = (b, s) => atHerBrokerage(b) && atHerBrokerage(s);

// ─── The standing cross ──────────────────────────────────────────────────────

export function standingMatches(interests, suppressed, now = Date.now()) {
  const byAsset = new Map();
  for (const r of interests) {
    if (suppressed.has(whoKey(r))) continue;
    const k = assetKey(r.asset);
    if (!k) continue;
    if (!byAsset.has(k)) byAsset.set(k, []);
    byAsset.get(k).push(r);
  }

  const out = [];
  let coBroker = 0;
  for (const [, rows] of byAsset) {
    const buys = rows.filter((r) => r.side === "buy");
    const sells = rows.filter((r) => r.side === "sell");
    for (const b of buys) {
      for (const s of sells) {
        // The same person on both sides of one name is a position change, not a trade she can broker.
        if (whoKey(b) && whoKey(b) === whoKey(s)) continue;
        const fb = freshness(b, now), fs_ = freshness(s, now);
        const score = fb.score * fs_.score
          * CONF[b.confidence ?? "low"] * CONF[s.confidence ?? "low"]
          * sizeFit(b, s);
        if (score < FLOOR) continue;
        /*
         * COUNTED AFTER THE FLOOR, ON PURPOSE, because the honest number is "what was taken off
         * your list" and not "how many internal pairs exist in the ledger". Those are 34 and 416
         * respectively on the 10 Sep run — and reporting 416 beside "477 considered" would compare
         * a pre-floor count against a post-floor one and read as though nine tenths of the market
         * had been hidden from her. A control she cannot audit is a control she stops trusting.
         */
        if (isInternalCoBrokerCross(b, s)) { coBroker += 1; continue; }
        out.push({ asset: s.asset, buy: b, sell: s, score, buyAge: fb.ageDays, sellAge: fs_.ageDays });
      }
    }
  }
  out.sort((a, b) => b.score - a.score);

  /*
   * ONE APPEARANCE PER PERSON PER NAME, ON EITHER SIDE.
   *
   * The first live run returned five crosses and three of them were the same $2B ByteDance buyer
   * paired with three different sellers. That is ONE recommendation printed three times, and it
   * pushed two genuinely different names off a list of five — the exact shape of a screen she stops
   * opening. Deduplicating on the PAIR was not enough; it has to be on each side separately.
   */
  const seenBuy = new Set();
  const seenSell = new Set();
  const picked = [];
  for (const m of out) {
    const a = assetKey(m.asset);
    const kb = `${whoKey(m.buy)}|${a}`;
    const ks = `${whoKey(m.sell)}|${a}`;
    if (seenBuy.has(kb) || seenSell.has(ks)) continue;
    seenBuy.add(kb); seenSell.add(ks);
    picked.push(m);
    if (picked.length >= CAP) break;
  }
  return { picked, considered: out.length, coBroker };
}

// ─── The assigned question ───────────────────────────────────────────────────

/**
 * "find me someone for $250M of SpaceX" · "help me find buyers for up to $2B of ByteDance stock".
 *
 * The counterparty side is what she asks for, so `--side buy` means SHE IS LOOKING FOR BUYERS. The
 * ledger is asked for people who have wanted or transacted that name on that side, ranked by
 * durability first and recency second — because "has actually traded ByteDance at size" outranks
 * "mentioned it last week" when the question is who can absorb $2B.
 */
export function assignedSearch(interests, asset, side, size, suppressed, now = Date.now()) {
  const k = assetKey(asset);
  const rows = interests.filter((r) => assetKey(r.asset) === k && r.side === side && !suppressed.has(whoKey(r)));
  const byWho = new Map();
  for (const r of rows) {
    const who = whoKey(r) || r.principal;
    const f = freshness(r, now);
    const capacity = size > 0 ? Math.min(1, (Number(r.size_usd) || 0) / size) : 1;
    /*
     * UNFILLED OUTRANKS FILLED, and this weight is the inversion in one line. The question is "who
     * do I call", not "who has a track record": somebody who wanted this name and never got filled
     * is a conversation waiting to be resumed, while somebody who transacted has what they came for.
     * The transacted row still counts — it is evidence they are real at this size — it simply does
     * not outrank the open one.
     */
    const score = (r.durability === "transacted" ? 0.75 : 1) * CONF[r.confidence ?? "low"]
      * (0.4 + 0.6 * f.score) * (0.4 + 0.6 * capacity);
    const prior = byWho.get(who);
    if (!prior || score > prior.score) byWho.set(who, { row: r, score, ageDays: f.ageDays, times: 0 });
  }
  for (const r of rows) {
    const who = whoKey(r) || r.principal;
    if (byWho.has(who)) byWho.get(who).times += 1;
  }
  return [...byWho.values()].sort((a, b) => b.score - a.score).slice(0, CAP);
}

// ─── The revival list: interests that were expressed and never filled ────────

/**
 * THE LEADS. Not a record of what happened — a list of conversations that stopped mid-sentence.
 *
 * Every row here is somebody who said what they wanted, at a size, and as far as this mailbox shows
 * never got it. That is a phone call with an opening line already written, which is exactly what
 * "help me drum up business" asks for.
 *
 * THREE THINGS RANK IT, and none of them is how long ago it was:
 *
 *   1. UNFILLED. A `transacted` row is somebody who got what they came for; it is excluded here on
 *      purpose. This list is the open half of the ledger and nothing else.
 *   2. SPECIFIC. "I want $50m of OpenAI" outranks "we look at secondaries" — a named principal and
 *      an explicit size are what make the call easy to open and hard to get wrong.
 *   3. UNANSWERED. When the correspondence record shows she has not written to them since, the ask
 *      is still hanging. That is the single strongest reason to go back, and it is read from her own
 *      mailbox rather than assumed — where the record cannot say, the row still stands, ranked
 *      lower, rather than being invented into a grievance.
 *
 * Age is shown and never used as a cutoff, for the same reason as everywhere else: a cliff means a
 * real lead silently vanishes on day 366.
 */
export function revivals(interests, contacts, suppressed, now = Date.now(), cap = 5) {
  const byEmail = new Map((contacts ?? []).map((c) => [String(c.email ?? "").toLowerCase(), c]));
  const scored = [];
  for (const r of interests) {
    if (r.durability === "transacted") continue;
    const who = whoKey(r);
    if (!who || suppressed.has(who)) continue;
    const f = freshness(r, now);
    const named = r.principal_email ? 1 : 0.7;
    const sized = (Number(r.size_usd) || Number(r.size_shares)) ? 1 : 0.6;
    const c = byEmail.get(String(r.principal_email ?? "").toLowerCase());
    const sinceSheWrote = c && c.days_since_she_wrote != null ? Number(c.days_since_she_wrote) : null;
    // Hanging: she has not written since they asked. Unknown is neither rewarded nor punished hard.
    const hanging = sinceSheWrote === null ? 0.8 : Math.min(1, 0.6 + sinceSheWrote / 365);
    scored.push({
      row: r, ageDays: f.ageDays, sinceSheWrote,
      score: CONF[r.confidence ?? "low"] * named * sized * hanging * (0.35 + 0.65 * f.score),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  // One per person: five rows about the same buyer is one lead printed five times.
  const seen = new Set();
  const picked = [];
  for (const x of scored) {
    const k = `${whoKey(x.row)}|${assetKey(x.row.asset)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(x);
    if (picked.length >= cap) break;
  }
  return { picked, considered: scored.length };
}

function renderRevivals({ picked, considered }) {
  if (picked.length === 0) {
    return `No open interest worth reviving out of ${considered} considered.`;
  }
  const lines = [`${picked.length} conversation${picked.length === 1 ? "" : "s"} that stopped, out of ${considered} still open.`, ""];
  for (const x of picked) {
    const r = x.row;
    lines.push(`  ${r.asset.toUpperCase()}  —  ${r.principal}${r.principal_email ? ` <${r.principal_email}>` : ""}`);
    lines.push(`     Wanted to ${r.side} ${r.size_text ?? ""}, ${ageWords(x.ageDays)}. Never filled.`);
    lines.push(`     "${r.quote ?? r.evidence}"`);
    if (x.sinceSheWrote !== null) lines.push(`     You have not written to them in ${x.sinceSheWrote} days.`);
    if (r.intermediated_by) lines.push(`     Came through ${r.intermediated_by}.`);
    lines.push(`     ${r.source_message}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ─── The monthly nudge ───────────────────────────────────────────────────────

/**
 * ─── CADENCE IS ALLOWED, AND SHE SAID EXACTLY HOW ──────────────────────────
 *
 *   "cadence is fine - if its few and far between and not intrusive and its someone meaningful.
 *    not everyone."
 *
 * Four constraints, and every one of them is enforced here rather than intended:
 *
 *   1. ONLY WHERE A RHYTHM ACTUALLY EXISTS. Never inferred from two emails — that is precisely what
 *      produced "469 days late" against a fourteen-day cadence nobody had ever kept. A rhythm needs
 *      BOTH SIDES writing, enough messages to be a pattern, and enough span to be a habit.
 *   2. ONLY MEANINGFUL PEOPLE. Someone who has TRANSACTED outranks someone with a long thread, and
 *      somebody who appears nowhere in the ledger is not raised at all however chatty the thread.
 *   3. A HARD VOLUME CAP. Three a month. A monthly list of twenty is the People tab again.
 *   4. IT SAYS WHY, NOT HOW LONG. "You and X exchanged 129 messages through last November, then it
 *      stopped" is an observation she can act on. "61 days since contact" is a timer she ignores.
 *
 * ASSET-ANCHORED, because that is the form she asked for: "three people who wanted SpaceX haven't
 * heard from you since the mark moved." The company is the reason to write, not the calendar.
 */
export function nudges(interests, contacts, suppressed, now = Date.now(), cap = 3) {
  const byEmail = new Map((contacts ?? []).map((c) => [String(c.email ?? "").toLowerCase(), c]));
  const seen = new Map();

  for (const r of interests) {
    const email = String(r.principal_email ?? "").toLowerCase();
    if (!email || suppressed.has(email)) continue;
    const c = byEmail.get(email);
    if (!c) continue;

    /*
     * A RHYTHM, NOT A COINCIDENCE. Both sides must have written, at least eight times between them,
     * across at least ninety days. Anything less is two emails and an invented cadence.
     */
    const sent = Number(c.sent) || 0, received = Number(c.received) || 0;
    const total = sent + received;
    if (sent < 3 || received < 3 || total < 8) continue;
    const spanDays = (Date.parse(c.last_at) - Date.parse(c.first_at)) / DAY;
    if (!(spanDays >= 90)) continue;

    // Their own normal gap, never a fixed threshold. A twice-a-year correspondent is not cold at
    // four months, and treating them as if they were is how a nudge becomes noise.
    const normalGap = spanDays / total;
    const quiet = (now - Date.parse(c.last_at)) / DAY;
    if (quiet < Math.max(45, normalGap * 3)) continue;

    const prior = seen.get(email);
    const rank = (r.durability === "transacted" ? 2 : 1) * CONF[r.confidence ?? "low"];
    if (!prior || rank > prior.rank) {
      seen.set(email, {
        email, name: c.name || r.principal, asset: r.asset, row: r, rank,
        total, sent, received, quietDays: Math.round(quiet), normalGap: Math.round(normalGap),
        lastAt: String(c.last_at).slice(0, 10),
      });
    }
  }

  // Transacted first, then the strongest rhythm. Three, and the asset is the headline.
  const picked = [...seen.values()].sort((a, b) => (b.rank - a.rank) || (b.total - a.total)).slice(0, cap);
  const byAsset = new Map();
  for (const n of picked) {
    const k = assetKey(n.asset);
    if (!byAsset.has(k)) byAsset.set(k, []);
    byAsset.get(k).push(n);
  }
  return { picked, byAsset };
}

function renderNudge({ picked, byAsset }) {
  if (picked.length === 0) {
    return ["Nobody this month.",
      "",
      "That is a real answer, not an empty run. A nudge is only raised where a rhythm actually",
      "existed — both of you writing, at least eight messages, across at least three months — and",
      "where the person appears in the ledger on a name. Nobody currently clears both.",
    ].join("\n");
  }
  const lines = [];
  for (const [, group] of byAsset) {
    const asset = group[0].asset;
    lines.push(`${group.length === 1 ? "One person" : `${group.length} people`} on ${asset}:`);
    for (const n of group) {
      const month = new Date(`${n.lastAt}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      lines.push(`  ${n.name} <${n.email}>`);
      lines.push(`     You exchanged ${n.total} messages — ${n.sent} from you, ${n.received} from them — through ${month}, then it stopped.`);
      lines.push(`     ${n.row.side === "buy" ? "Wanted" : "Was selling"} ${n.row.size_text ?? ""} ${n.row.asset}${n.row.durability === "transacted" ? ", and has transacted in it" : ""}.`);
      lines.push(`     ${n.row.evidence}`);
      lines.push(`     ${n.row.source_message}`);
      lines.push("");
    }
  }
  lines.push('Not this person? npm run capital:match -- --not "<their address>".');
  return lines.join("\n");
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const money = (r) => r.size_text || (r.size_usd ? `$${(r.size_usd / 1e6).toFixed(1)}M` : `${r.size_shares} shares`);
const ageWords = (d) => (d < 14 ? `${d}d ago` : d < 90 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`);
const who = (r) => `${r.principal}${r.principal_email && r.principal_email !== r.principal ? ` <${r.principal_email}>` : ""}`;

/**
 * THE FILTER SAYS WHAT IT DROPPED. `validate:filter-accounts` exists because a silent filter in this
 * codebase has twice been indistinguishable from a broken one — and a suppression she cannot see is
 * a suppression she cannot correct.
 */
const coBrokerLine = (n) => (n > 0
  ? [`${n} pairing(s) were internal to ${HER_BROKERAGE_DOMAIN} on BOTH sides and are not shown — `
     + "two brokers at your own firm can cross that themselves.", ""]
  : []);

function renderStanding(picked, considered, coBroker = 0) {
  if (picked.length === 0) {
    return ["No cross worth a call today.",
      `${considered} pairing(s) were considered and none cleared the bar. That is a real answer:`,
      "the ledger holds both sides of a market and today they do not meet on the same name.",
      ...coBrokerLine(coBroker),
    ].join("\n");
  }
  const lines = [`${picked.length} cross${picked.length === 1 ? "" : "es"} worth a call, out of ${considered} pairing(s) considered.`,
    "", ...coBrokerLine(coBroker)];
  for (const m of picked) {
    lines.push(`${m.asset.toUpperCase()}`);
    lines.push(`  BUY   ${money(m.buy)}   ${who(m.buy)}   ${ageWords(m.buyAge)}${m.buy.durability === "transacted" ? " · has transacted" : ""}`);
    lines.push(`        "${m.buy.quote ?? m.buy.evidence}"${m.buy.intermediated_by ? `  — via ${m.buy.intermediated_by}` : ""}`);
    lines.push(`  SELL  ${money(m.sell)}   ${who(m.sell)}   ${ageWords(m.sellAge)}${m.sell.durability === "transacted" ? " · has transacted" : ""}`);
    lines.push(`        "${m.sell.quote ?? m.sell.evidence}"${m.sell.intermediated_by ? `  — via ${m.sell.intermediated_by}` : ""}`);
    lines.push(`  open  ${m.buy.source_message} and ${m.sell.source_message} in Gmail to read both.`);
    lines.push("");
  }
  lines.push('Wrong person? npm run capital:match -- --not "<their address>" and they never appear again.');
  return lines.join("\n");
}

function renderAssigned(hits, asset, side, size) {
  const ask = `${size ? `$${(size / 1e6).toFixed(0)}M of ` : ""}${asset}`;
  if (hits.length === 0) {
    return [`NONE FOUND — no ${side === "buy" ? "buyer" : "seller"} in the ledger for ${ask}.`,
      "Nobody in eighteen months of your mail has taken that side of that name at a size worth calling.",
      "That is an answer: go and ask, rather than working a list that was invented to look full.",
    ].join("\n");
  }
  const lines = [`${hits.length} name(s) for ${ask}, ${side === "buy" ? "buy" : "sell"} side, best first.`, ""];
  for (const h of hits) {
    lines.push(`  ${who(h.row)}`);
    lines.push(`     ${money(h.row)} ${h.row.side}  ·  ${ageWords(h.ageDays)}  ·  ${h.row.durability === "transacted" ? "has transacted in it" : "wanted it and was never filled"}  ·  seen ${h.times}x`);
    lines.push(`     "${h.row.quote ?? h.row.evidence}"${h.row.intermediated_by ? `  — via ${h.row.intermediated_by}` : ""}`);
    lines.push(`     ${h.row.source_message}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ─── The run ─────────────────────────────────────────────────────────────────

async function main() {
  if (NOT) { suppress(NOT); return; }

  if (!fs.existsSync(LEDGER)) {
    console.error(`NAMED STOP [NO_LEDGER] ${LEDGER} does not exist.`);
    console.error("  Build it first: npm run capital:scan -- --backfill && npm run capital:extract");
    process.exit(5);
  }
  const { interests = [] } = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  if (interests.length === 0) {
    console.error("NAMED STOP [EMPTY_LEDGER] the ledger exists and holds no interests.");
    console.error("  Matching an empty ledger would report 'no matches' from a market that was never read.");
    process.exit(6);
  }
  const suppressed = loadSuppressed();
  const wrongRows = loadWrongRows();
  const usable = interests.filter((r) => !wrongRows.has(r.source_message));

  let body, subject;
  /*
   * WHAT THE POINTER WILL SAY, DECIDED HERE WHERE THE COUNTS ARE REAL.
   *
   * A CROSS OUTRANKS A REVIVAL, and only one kind is pointed at. Two pointers for one email would
   * put two brokerage lines in a contract that has one slot, and the cross is the rarer and more
   * valuable of the two: two live sides of one name today, against a conversation that stopped.
   * Only the standing run posts one — `--find` is her own ad-hoc question and `--nudge` is a
   * monthly note, and neither is the morning mail the contract is pointing at.
   */
  let pointerKind = null;
  let pointerCount = 0;
  if (NUDGE) {
    const CONTACTS = process.env.BOSS_OS_CONTACTS_FILE
      ?? path.join(os.homedir(), ".boss-os", "sourcing", "CONTACTS.json");
    if (!fs.existsSync(CONTACTS)) {
      /*
       * WITHOUT THE CORRESPONDENCE RECORD THERE IS NO RHYTHM, AND WITHOUT A RHYTHM THERE IS NO
       * NUDGE. Running anyway would mean inventing a cadence out of the ledger dates alone, which
       * is exactly the defect that produced "469 days late" against a fourteen-day habit nobody had.
       */
      console.error(`NAMED STOP [NO_CORRESPONDENCE_RECORD] ${CONTACTS} is missing.`);
      console.error("  A nudge is only honest where a rhythm actually existed, and that file is the");
      console.error("  only thing that knows how often two people wrote to each other.");
      console.error("  Run: npm run contacts:extract");
      process.exit(7);
    }
    const contacts = JSON.parse(fs.readFileSync(CONTACTS, "utf8")).contacts ?? [];
    const result = nudges(usable, contacts, suppressed);
    body = renderNudge(result);
    subject = result.picked.length
      ? `${result.picked.length} worth a note — ${[...new Set(result.picked.map((n) => n.asset))].join(", ")}`
      : "Nobody worth a note this month";
  } else if (FIND) {
    const side = WANT_SIDE === "sell" ? "sell" : "buy";
    const hits = assignedSearch(usable, FIND, side, WANT_SIZE, suppressed);
    body = renderAssigned(hits, FIND, side, WANT_SIZE);
    subject = `${FIND} — ${hits.length} ${side === "buy" ? "buyer" : "seller"}(s) from your own mail`;
  } else {
    /*
     * ONE EMAIL, TWO SECTIONS, AND THE LEADS COME SECOND ONLY BECAUSE A CROSS IS RARER.
     *
     * A cross is two people who can trade with each other today and is the highest-value thing this
     * ledger can find. Most days there is not one. The revival list is what makes the other days
     * worth opening — open interest that never got filled, which is the business she is trying to
     * drum up. Sending them as two emails would train her to ignore whichever arrived first.
     */
    const contactsPath = process.env.BOSS_OS_CONTACTS_FILE
      ?? path.join(os.homedir(), ".boss-os", "sourcing", "CONTACTS.json");
    const contacts = fs.existsSync(contactsPath)
      ? JSON.parse(fs.readFileSync(contactsPath, "utf8")).contacts ?? [] : [];
    const rev = revivals(usable, contacts, suppressed);
    if (REVIVE) {
      body = renderRevivals(rev);
      subject = rev.picked.length
        ? `${rev.picked.length} unfilled — ${[...new Set(rev.picked.map((x) => x.row.asset))].join(", ")}`
        : "No open interest worth reviving";
    } else {
      const { picked, considered, coBroker } = standingMatches(usable, suppressed);
      body = [renderStanding(picked, considered, coBroker), "",
        "─────────────────────────────────────────────────────────────",
        "", "WORTH GOING BACK TO — they said what they wanted and never got it", "",
        renderRevivals(rev)].join("\n");
      subject = picked.length
        ? `${picked.length} cross${picked.length === 1 ? "" : "es"} in your inbox — ${picked.map((m) => m.asset).join(", ")}`
        : (rev.picked.length ? `${rev.picked.length} conversation(s) worth restarting` : "No cross and no lead worth a call today");
      if (picked.length) { pointerKind = "cross"; pointerCount = picked.length; }
      else if (rev.picked.length) { pointerKind = "revival"; pointerCount = rev.picked.length; }
    }
  }

  console.log(`Ledger: ${usable.length} usable interest(s) of ${interests.length}, `
    + `${new Set(usable.map(whoKey)).size} principal(s), ${new Set(usable.map((r) => assetKey(r.asset))).size} asset(s). `
    + `${suppressed.size} name(s) suppressed, ${wrongRows.size} row(s) struck as wrong.\n`);
  console.log(body);

  if (!SEND) { console.log("\nRe-run with --send to email it."); return; }

  const SENDERS = sendersFor("Monique");
  if (SENDERS.length === 0) {
    console.error("NAMED STOP [NO_MAIL_KEY] the matches are above and no email could be sent.");
    process.exit(8);
  }
  const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";
  const text = ["Sequoia,", "", "This is Monique. Both sides of this were already in your mailbox.", "", body, "",
    "— Monique, Director of Relationships"].join("\n");
  for (const sender of SENDERS) {
    const { from, key } = sender;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(employeeMail(sender, { to: TO, subject, text })),
    });
    if (res.ok) {
      const sentAt = Date.now();
      console.log(`\nEmailed ${TO} from ${from}.`);
      /*
       * ─── AND THE POINTER, AFTER THE MAIL AND NEVER BEFORE ──────────────────
       *
       * Three gates, and each one is a different way this could become noise:
       *
       *   · `--pointer` was asked for. The daily launchd job passes it; a hand-run does not, so
       *     checking her matches at four in the afternoon does not rewrite her morning.
       *   · There is something to point AT. A mail saying "no cross and no lead today" is a fine
       *     mail and a terrible pointer — empty-handed beats noise.
       *   · It is a weekday. Her instruction on the contract is M-F, and the line is weekday-gated
       *     at the other end too; posting on a Saturday would only leave a row that goes stale
       *     unread, which is a worse record than none.
       *
       * A FAILED POST DOES NOT FAIL THE RUN. The email is the deliverable and it has already
       * arrived; refusing to exit 0 because a convenience line did not post would turn a delivered
       * piece of work into a red duty. It says so, loudly, on stderr where the duty log keeps it.
       */
      /*
       * THE DAY IN HER TIMEZONE, NOT THE MACHINE'S. Read as a weekday NAME rather than by parsing a
       * formatted date string back into a Date — that round trip reinterprets the result in the
       * local zone and silently returns the wrong day for anything near midnight, which is exactly
       * the boundary a Friday-evening or Sunday-night run sits on.
       */
      const dayName = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(sentAt);
      const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(dayName);
      if (POINTER && pointerKind && isWeekday) {
        await postPointer(pointerKind, pointerCount, sentAt);
      } else if (POINTER && !pointerKind) {
        console.log("  No pointer: nothing crossed and nothing was worth reviving. Silence is the answer.");
      }
      return;
    }
    console.error(`  ${from} refused: ${res.status} ${(await res.text()).slice(0, 140)}`);
  }
  console.error("NAMED STOP [SEND_REFUSED] every sender was refused.");
  process.exit(9);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`CAPITAL MATCH FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
