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
 * ─── NO MATCHING WINDOW, BECAUSE A CLIFF LOSES REAL DEALS ──────────────────
 *
 * Asked how far back a match should reach she said "like up to 12 months? i dont know" — and she
 * should not have to pick, because a cutoff means a genuine match silently vanishes on day 366.
 * The ledger holds two things that behave differently and the age is carried on the face of every
 * match rather than used to delete one:
 *
 *   · HAS TRANSACTED IN X — a durable fact about who somebody is. It never expires. This is what
 *     answers "find me someone for $250M of SpaceX".
 *   · WANTS X RIGHT NOW — perishable. They fill, the mark moves, the mandate closes.
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
 *   npm run capital:match -- --find SpaceX --side buy --size 250000000
 *   npm run capital:match -- --nudge               # the monthly, asset-anchored note — at most three
 *   npm run capital:match -- --not "someone@example.com"      # never recommend this person again
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sendersFor } from "./notify.mjs";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const LEDGER = path.join(DIR, "ledger.json");
const SUPPRESS = path.join(DIR, "not-this-person.json");

const ARGS = process.argv.slice(2);
const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : ARGS[i + 1] ?? null; };
const SEND = ARGS.includes("--send");
const FIND = argOf("find");
const WANT_SIDE = argOf("side");
const WANT_SIZE = Number(argOf("size") ?? 0);
const NOT = argOf("not");
const NUDGE = ARGS.includes("--nudge");

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
  if (r.durability === "transacted") return Infinity;
  const size = Number(r.size_usd) || (Number(r.size_shares) || 0) * 50; // a rough share mark, only for ranking
  if (r.side === "sell") {
    // Inventory moves. A block offered nine months ago is usually gone, and saying so is honest.
    return size >= 100e6 ? 90 : 45;
  }
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
  return { picked, considered: out.length };
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
    const score = (r.durability === "transacted" ? 1 : 0.7) * CONF[r.confidence ?? "low"]
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

function renderStanding(picked, considered) {
  if (picked.length === 0) {
    return ["No cross worth a call today.",
      `${considered} pairing(s) were considered and none cleared the bar. That is a real answer:`,
      "the ledger holds both sides of a market and today they do not meet on the same name.",
    ].join("\n");
  }
  const lines = [`${picked.length} cross${picked.length === 1 ? "" : "es"} worth a call, out of ${considered} pairing(s) considered.`, ""];
  for (const m of picked) {
    lines.push(`${m.asset.toUpperCase()}`);
    lines.push(`  BUY   ${money(m.buy)}   ${who(m.buy)}   ${ageWords(m.buyAge)}${m.buy.durability === "transacted" ? " · has transacted" : ""}`);
    lines.push(`        ${m.buy.evidence}${m.buy.intermediated_by ? `  — via ${m.buy.intermediated_by}` : ""}`);
    lines.push(`  SELL  ${money(m.sell)}   ${who(m.sell)}   ${ageWords(m.sellAge)}${m.sell.durability === "transacted" ? " · has transacted" : ""}`);
    lines.push(`        ${m.sell.evidence}${m.sell.intermediated_by ? `  — via ${m.sell.intermediated_by}` : ""}`);
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
    lines.push(`     ${money(h.row)} ${h.row.side}  ·  ${ageWords(h.ageDays)}  ·  ${h.row.durability === "transacted" ? "has transacted in it" : "wanted it then"}  ·  seen ${h.times}x`);
    lines.push(`     ${h.row.evidence}${h.row.intermediated_by ? `  — via ${h.row.intermediated_by}` : ""}`);
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

  let body, subject;
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
    const result = nudges(interests, contacts, suppressed);
    body = renderNudge(result);
    subject = result.picked.length
      ? `${result.picked.length} worth a note — ${[...new Set(result.picked.map((n) => n.asset))].join(", ")}`
      : "Nobody worth a note this month";
  } else if (FIND) {
    const side = WANT_SIDE === "sell" ? "sell" : "buy";
    const hits = assignedSearch(interests, FIND, side, WANT_SIZE, suppressed);
    body = renderAssigned(hits, FIND, side, WANT_SIZE);
    subject = `${FIND} — ${hits.length} ${side === "buy" ? "buyer" : "seller"}(s) from your own mail`;
  } else {
    const { picked, considered } = standingMatches(interests, suppressed);
    body = renderStanding(picked, considered);
    subject = picked.length
      ? `${picked.length} cross${picked.length === 1 ? "" : "es"} in your inbox — ${picked.map((m) => m.asset).join(", ")}`
      : "No cross worth a call today";
  }

  console.log(`Ledger: ${interests.length} interest(s), ${new Set(interests.map(whoKey)).size} principal(s), `
    + `${new Set(interests.map((r) => assetKey(r.asset))).size} asset(s). ${suppressed.size} name(s) suppressed.\n`);
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
  for (const { from, key } of SENDERS) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [TO], subject: subject.slice(0, 200), text }),
    });
    if (res.ok) { console.log(`\nEmailed ${TO} from ${from}.`); return; }
    console.error(`  ${from} refused: ${res.status} ${(await res.text()).slice(0, 140)}`);
  }
  console.error("NAMED STOP [SEND_REFUSED] every sender was refused.");
  process.exit(9);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`CAPITAL MATCH FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
