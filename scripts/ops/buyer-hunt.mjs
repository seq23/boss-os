/**
 * THE BUYER HUNT — start from what she has to SELL and go looking for the other side.
 *
 * Owner, 10 September 2026, on what she wants added: candidates from her own inbox — "principals who
 * have wanted a comparable name at a comparable size" — and candidates from the world: "look thru
 * filings or whatever to find out if they are holders of similar companies and if they can afford to
 * write a check for a deal the size i have".
 *
 * IT ADDS, IT DOES NOT REPLACE. `npm run capital:match` is untouched. That runs the cross — two
 * people in her mailbox who can trade with each other today — and this runs the opposite direction,
 * from her book outward. Replacing one with the other would trade a working surface for a new one.
 *
 * ─── THE BAR, IN HER WORDS ─────────────────────────────────────────────────
 *
 *   "if she comes up empty handed its fine. better than giving me trash."
 *
 * So EVERY candidate carries its evidence — the accession number of a filing, or the sentence out of
 * an email — the way the revival list already does. A name with no citation is not printed at any
 * confidence. Zero results with a stated method is a good week, and the empty render says what was
 * searched so that a miss is a fact rather than a shrug.
 *
 * ─── 13F IS NEARLY USELESS HERE. N-PORT IS THE ONE THAT WORKS. ─────────────
 *
 * CONFIRMED against EDGAR full-text search on 10 Sep 2026, not assumed — the counts are the reason
 * this file queries what it queries, and they are stark:
 *
 *     name        NPORT-P   13F-HR
 *     Anthropic       663        0
 *     OpenAI          464        0
 *     ByteDance       595        0
 *     Kalshi           10        0
 *     Erebor            3        0
 *
 * Form 13F covers section 13(f) securities — exchange-traded equities. Her entire book is private,
 * so 13F is structurally blind to all of it and returns nothing for every single name. N-PORT is
 * filed monthly by registered funds and reports EVERY position including private ones, with a
 * dollar mark and a percentage of net assets. That is how Fidelity's, T. Rowe's, BlackRock's and
 * ARK Venture's positions in exactly her names become public and citable.
 *
 * ─── WHAT A HOLDER IS AND IS NOT ───────────────────────────────────────────
 *
 * A fund holding Anthropic is NOT a buyer. It is evidence of three things a buyer needs and most
 * names do not have: a mandate that permits private paper, an existing position in this specific
 * issuer, and — from `totAssets` on the same filing — a balance sheet that can or cannot absorb the
 * size she has out. That is the honest claim, and it is the claim the output makes.
 *
 * ─── COMPLIANCE. NOT OPTIONAL. ─────────────────────────────────────────────
 *
 * She is a registered representative of Rainmaker Securities, a FINRA broker-dealer. THIS PRODUCES A
 * LIST FOR HER. It does not contact anybody, it does not draft outreach to a stranger, and it sends
 * only to her own address, from monique@sequoiataylor.com, never from spry.vc — asserted on every
 * build by `validate:no-spry-sender`.
 *
 *   npm run capital:buyers                       # from the current book
 *   npm run capital:buyers -- --book ./book.txt  # from a book in her own words
 *   npm run capital:buyers -- --asset Anthropic --size 2000000000
 *   npm run capital:buyers -- --send             # ...and email it to her
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseLiveBook, describeLot } from "../../src/shared/boss/intake/liveBook.mjs";
import { assignedSearch, assetKey, atHerBrokerage } from "./interest-match.mjs";
import { sendersFor } from "./notify.mjs";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const LEDGER = path.join(DIR, "ledger.json");
const BOOK_TEXT = path.join(DIR, "book.txt");
const SUPPRESS = path.join(DIR, "not-this-person.json");
const WRONG_FILE = path.join(DIR, "wrong.json");

const ARGS = process.argv.slice(2);
const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : ARGS[i + 1] ?? null; };
const SEND = ARGS.includes("--send");
const ONE_ASSET = argOf("asset");
const ONE_SIZE = Number(argOf("size") ?? 0);
const BOOK_FILE = argOf("book") ?? BOOK_TEXT;

/** SEC Fair Access requires a descriptive agent with a contact address. It is a condition, not a nicety. */
const USER_AGENT = process.env.SEC_USER_AGENT ?? "Boss OS capital research (seq.taylor@gmail.com)";
const FTS = "https://efts.sec.gov/LATEST/search-index";

/** Filings read per name. Enough to see who the holders are, far inside SEC's 10/second. */
const FILINGS_PER_ASSET = Number(process.env.BUYER_HUNT_FILINGS ?? 8);
/** Named holders printed per name. A directory is the People tab she deleted. */
const CAP = Number(process.env.BUYER_HUNT_CAP ?? 6);
/** How far back a filing may be and still describe a position that plausibly still exists. */
const FILING_LOOKBACK_DAYS = Number(process.env.BUYER_HUNT_LOOKBACK_DAYS ?? 400);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => (n == null ? "unknown"
  : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString("en-US")}`);

// ─── The book ────────────────────────────────────────────────────────────────

/**
 * READ THROUGH THE SAME PARSER THE INTAKE USES. `src/shared/boss/intake/liveBook.mjs` is imported
 * rather than reimplemented, so a book filed by the Worker and a book read off disk can never mean
 * two different things — "two components each keeping their own list with no link" is the defect
 * this repo names most often, and a book is the worst possible place for it.
 */
function loadBook() {
  if (ONE_ASSET) {
    return { positions: [{ asset: ONE_ASSET, side: "sell", size_usd: ONE_SIZE || null, size_min_usd: null, size_max_usd: null, size_shares: null, size_text: ONE_SIZE ? money(ONE_SIZE) : "", source_line: `--asset ${ONE_ASSET}` }], unparsed: [], source: "the command line" };
  }
  if (!fs.existsSync(BOOK_FILE)) return null;
  const parsed = parseLiveBook(fs.readFileSync(BOOK_FILE, "utf8"));
  return { ...parsed, source: BOOK_FILE };
}

// ─── Source 1: her own mailbox ───────────────────────────────────────────────

const loadJson = (p, key) => { try { return JSON.parse(fs.readFileSync(p, "utf8"))[key] ?? []; } catch { return []; } };

/**
 * Who in her own mail has wanted this name, on the buy side, at a size that matters.
 *
 * `assignedSearch` is reused rather than rewritten: it already encodes the ranking she agreed to —
 * unfilled outranks filled, durability outranks recency, capacity against the size asked for — and
 * a second implementation of that ranking would drift from the one she has been reading.
 *
 * A RAINMAKER REP IS EXCLUDED HERE, for the same reason a Rainmaker-to-Rainmaker cross is
 * suppressed: a colleague at her own firm holding the other side is not a buyer she introduces. She
 * is already down the hall from them.
 */
function fromHerInbox(asset, size) {
  if (!fs.existsSync(LEDGER)) return { hits: [], note: "the ledger does not exist — run npm run capital:scan" };
  const { interests = [] } = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  const wrong = new Set(loadJson(WRONG_FILE, "rows"));
  const suppressed = new Set(loadJson(SUPPRESS, "people"));
  const usable = interests.filter((r) => !wrong.has(r.source_message) && !atHerBrokerage(r));
  const hits = assignedSearch(usable, asset, "buy", size || 0, suppressed)
    // Precision bar: a candidate with no sentence behind it is not a candidate.
    .filter((h) => h.row?.quote || h.row?.evidence);
  return { hits, considered: usable.filter((r) => assetKey(r.asset) === assetKey(asset)).length };
}

// ─── Source 2: N-PORT ────────────────────────────────────────────────────────

async function sec(url) {
  const r = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json, text/xml, */*" } });
  if (!r.ok) throw new Error(`SEC ${r.status} for ${url}`);
  return r;
}

/** Recent N-PORT filings whose text names this issuer. */
async function nportFilings(asset) {
  const startdt = new Date(Date.now() - FILING_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const url = `${FTS}?${new URLSearchParams({ q: `"${asset}"`, forms: "NPORT-P", startdt, enddt: new Date().toISOString().slice(0, 10) })}`;
  const j = await (await sec(url)).json();
  const seen = new Set();
  const out = [];
  for (const h of j?.hits?.hits ?? []) {
    const s = h._source ?? {};
    const cik = String(s.ciks?.[0] ?? "").replace(/^0+/, "");
    if (!cik || seen.has(cik)) continue;
    // `_id` is "accession:filename". The accession is what makes this citable.
    const [accRaw, file] = String(h._id ?? "").split(":");
    if (!accRaw) continue;
    seen.add(cik);
    out.push({
      cik,
      filer: String(s.display_names?.[0] ?? "").replace(/\s+\(CIK.*$/, "").trim(),
      accession: accRaw,
      file: file ?? "primary_doc.xml",
      filed: s.file_date ?? null,
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accRaw.replace(/-/g, "")}/${file ?? "primary_doc.xml"}`,
    });
    if (out.length >= FILINGS_PER_ASSET) break;
  }
  return { filings: out, total: j?.hits?.total?.value ?? 0 };
}

/**
 * The position itself, out of the filing.
 *
 * WITHOUT THIS THE WHOLE THING WOULD BE A LIST OF FUND NAMES, which is the trash she asked not to
 * be given. "Fidelity holds Anthropic" is a fact she already assumes; "this Fidelity fund marks
 * $412M of Anthropic against $28B of net assets" is what tells her whether a $2B block is even a
 * conversation. So the XML is read for the matched holding's `valUSD` and the fund's `totAssets`,
 * and where either cannot be read it is reported as unknown rather than estimated.
 */
function positionFromXml(xml, asset) {
  const key = assetKey(asset);
  const totAssets = Number(/<totAssets>\s*([0-9.]+)\s*<\/totAssets>/i.exec(xml)?.[1] ?? NaN);
  let best = null;
  for (const m of xml.matchAll(/<invstOrSec>([\s\S]*?)<\/invstOrSec>/gi)) {
    const block = m[1];
    const name = /<name>([\s\S]*?)<\/name>/i.exec(block)?.[1]?.trim() ?? "";
    const title = /<title>([\s\S]*?)<\/title>/i.exec(block)?.[1]?.trim() ?? "";
    if (!assetKey(name).includes(key) && !assetKey(title).includes(key)) continue;
    const val = Number(/<valUSD>\s*(-?[0-9.]+)\s*<\/valUSD>/i.exec(block)?.[1] ?? NaN);
    const pct = Number(/<pctVal>\s*(-?[0-9.]+)\s*<\/pctVal>/i.exec(block)?.[1] ?? NaN);
    if (!best || (Number.isFinite(val) && val > (best.valUSD ?? -1))) {
      best = { holding: name || title, valUSD: Number.isFinite(val) ? val : null, pctVal: Number.isFinite(pct) ? pct : null };
    }
  }
  return best ? { ...best, totAssets: Number.isFinite(totAssets) ? totAssets : null } : null;
}

/**
 * Can they write this check?
 *
 * A JUDGEMENT WITH ITS ARITHMETIC ON THE FACE OF IT, never a score. The test is whether the block
 * would be a sane position for this fund: against total net assets, and against what they already
 * hold in the name. Anything that cannot be computed says so — an unverified capacity is printed as
 * unverified and ranked below a verified one, because inventing it is exactly the failure mode this
 * whole file is written against.
 */
export function capacity(position, size) {
  if (!position || !size) return { verdict: "UNVERIFIED", why: "no size to test against" };
  const { totAssets, valUSD } = position;
  if (!totAssets) return { verdict: "UNVERIFIED", why: "the filing did not state total net assets" };
  const pct = (size / totAssets) * 100;
  if (pct <= 2) {
    return { verdict: "COMFORTABLY", why: `${money(size)} is ${pct.toFixed(2)}% of ${money(totAssets)} in net assets` };
  }
  if (pct <= 10) {
    return { verdict: "PLAUSIBLY", why: `${money(size)} is ${pct.toFixed(1)}% of ${money(totAssets)} in net assets — a real decision for them, not a routine add` };
  }
  return {
    verdict: "NO",
    why: `${money(size)} is ${pct.toFixed(0)}% of ${money(totAssets)} in net assets${valUSD ? `, against ${money(valUSD)} they already hold` : ""} — not a check this fund writes`,
  };
}

const RANK = { COMFORTABLY: 3, PLAUSIBLY: 2, UNVERIFIED: 1, NO: 0 };

async function fromFilings(asset, size) {
  let found;
  try { found = await nportFilings(asset); }
  catch (err) { return { holders: [], note: `EDGAR could not be read: ${err.message}` }; }

  const holders = [];
  for (const f of found.filings) {
    await sleep(150); // Well inside SEC's 10 requests/second.
    let position = null;
    try {
      const xml = await (await sec(f.url)).text();
      position = positionFromXml(xml, asset);
    } catch { /* One unreadable filing must not end the hunt for the other seven. */ }
    if (!position) continue;
    const cap = capacity(position, size);
    // HER BAR: a holder who cannot write the cheque is not a candidate, it is a distraction.
    if (cap.verdict === "NO") continue;
    holders.push({ ...f, ...position, capacity: cap });
  }
  holders.sort((a, b) => (RANK[b.capacity.verdict] - RANK[a.capacity.verdict]) || ((b.valUSD ?? 0) - (a.valUSD ?? 0)));
  return { holders: holders.slice(0, CAP), scanned: found.filings.length, total: found.total };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderAsset(lot, inbox, filings) {
  const size = lot.size_usd ?? 0;
  const lines = [`${String(lot.asset).toUpperCase()}  —  you have ${describeLot(lot).split(" — ").slice(2).join(" — ") || lot.size_text}`, ""];

  lines.push("  FROM YOUR OWN MAIL");
  if (inbox.hits.length === 0) {
    lines.push(`    Nobody. ${inbox.considered ?? 0} row(s) in the ledger touch this name and none is a buy side`);
    lines.push("    with a sentence behind it. That is an answer, not an empty run.");
  } else {
    for (const h of inbox.hits) {
      const r = h.row;
      lines.push(`    ${r.principal}${r.principal_email ? ` <${r.principal_email}>` : ""}  ·  wanted ${r.size_text ?? money(r.size_usd)}  ·  ${h.ageDays}d ago`);
      lines.push(`      "${r.quote ?? r.evidence}"`);
      lines.push(`      ${r.source_message}${r.intermediated_by ? `  — via ${r.intermediated_by}` : ""}`);
    }
  }
  lines.push("");

  lines.push("  FROM FILINGS (N-PORT — funds that report this position)");
  if (filings.note) {
    lines.push(`    ${filings.note}`);
  } else if (filings.holders.length === 0) {
    lines.push(`    Nobody who could write ${money(size)}. ${filings.total ?? 0} N-PORT filing(s) name this issuer;`);
    lines.push(`    ${filings.scanned ?? 0} were read and none had both a readable position and the balance sheet for it.`);
  } else {
    for (const h of filings.holders) {
      lines.push(`    ${h.filer}`);
      lines.push(`      Holds ${money(h.valUSD)}${h.pctVal != null ? ` (${h.pctVal.toFixed(2)}% of the fund)` : ""} of "${h.holding}"`);
      lines.push(`      Can write it: ${h.capacity.verdict} — ${h.capacity.why}`);
      lines.push(`      ${h.filed ?? ""} N-PORT ${h.accession}  ${h.url}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ─── The run ─────────────────────────────────────────────────────────────────

async function main() {
  const book = loadBook();
  if (!book) {
    /*
     * NO BOOK IS A NAMED STOP, NOT AN EMPTY RESULT. Hunting buyers for nothing would print "no
     * candidates" from a search that was never run — the empty-loop pass, and the one failure that
     * would look exactly like a quiet week.
     */
    console.error(`NAMED STOP [NO_BOOK] no live book at ${BOOK_FILE}.`);
    console.error("  Email it to boss@sequoiataylor.com with #monique, or put it in that file in your");
    console.error("  own words — one line per name, e.g. 'Anthropic IPO shares $2B, and separately $500M'.");
    process.exit(5);
  }
  const priced = book.positions.filter((p) => p.side === "sell" && p.size_usd);
  if (priced.length === 0) {
    console.error("NAMED STOP [EMPTY_BOOK] the book was read and holds no priced sell-side line.");
    process.exit(6);
  }

  const sections = [];
  for (const lot of priced) {
    const inbox = fromHerInbox(lot.asset, lot.size_usd);
    const filings = await fromFilings(lot.asset, lot.size_usd);
    sections.push({ lot, inbox, filings, count: inbox.hits.length + (filings.holders?.length ?? 0) });
  }

  const total = sections.reduce((n, s) => n + s.count, 0);
  const header = [
    // LOTS, NOT LINES. Her Anthropic line is two separate blocks and they get separate answers:
    // Fidelity can write $500M comfortably and $2B only as a real decision. Collapsing them would
    // hide the one distinction that decides who to call about which block.
    `Buyer hunt against ${priced.length} lot(s) across ${new Set(priced.map((p) => assetKey(p.asset))).size} name(s), read from ${book.source}.`,
    `${total} candidate(s), every one with a filing or a sentence behind it.`,
    "",
    ...(book.unparsed.length
      ? [`I could NOT read ${book.unparsed.length} line(s) of the book: ${book.unparsed.map((u) => `"${u.line}"`).join(", ")}.`, ""]
      : []),
    "13F is not consulted and that is deliberate: it covers exchange-traded securities only and",
    "returns zero for every name you hold. N-PORT is where a fund reports a private position.",
    "",
    "This is a list for you. Nobody here has been contacted.",
    "",
    "─────────────────────────────────────────────────────────────",
    "",
  ].join("\n");

  const body = header + sections.map((s) => renderAsset(s.lot, s.inbox, s.filings)).join("\n");
  console.log(body);

  if (!SEND) { console.log("\nRe-run with --send to email it."); return; }
  const SENDERS = sendersFor("Monique");
  if (SENDERS.length === 0) {
    console.error("NAMED STOP [NO_MAIL_KEY] the list is above and no email could be sent.");
    process.exit(8);
  }
  const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";
  const text = ["Sequoia,", "", "This is Monique. I worked outward from your book rather than across your mailbox.", "",
    body, "", "— Monique, Director of Relationships"].join("\n");
  const subject = total
    ? `${total} possible buyer(s) — ${priced.map((p) => p.asset).join(", ")}`
    : `No buyer clears the bar this week — ${priced.map((p) => p.asset).join(", ")}`;
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
  main().catch((err) => { console.error(`BUYER HUNT FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
