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
 *   npm run capital:sellers -- --asset OpenAI --size 1000000000   # the other direction
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
import { loadContacts, reachFor } from "./lib/reach.mjs";
import { researchLot, renderFilings, renderReach } from "./filing-hunt.mjs";
import { mirrorOrStop } from "./lib/book-mirror.mjs";

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

/**
 * ─── WHICH SIDE IS BEING HUNTED ────────────────────────────────────────────
 *
 * `--side buy` (the default, and everything this file did before) hunts BUYERS for what she holds.
 * `--side sell` hunts SELLERS for something she wants — "please help me find a seller of $1B+ of
 * OpenAI shares", her own words on 12 September 2026.
 *
 * THE EDGAR HALF IS UNCHANGED AND THAT IS THE POINT. A fund that reports a position in OpenAI is
 * evidence of the same three things either way: a mandate that permits private paper, an existing
 * position in this specific issuer, and a balance sheet. A holder is a plausible seller exactly as
 * it is a plausible buyer — what changes is the ARITHMETIC. Hunting a buyer asks "can they absorb
 * this?" against total net assets; hunting a seller asks "do they HAVE this?" against the position
 * they marked. Same filing, read the other way round.
 *
 * The ledger half flips with it: `assignedSearch` already takes a side, so the sellers in her own
 * mail come out of the same ranking her buyers do rather than a second one.
 */
const SIDE = (argOf("side") ?? "buy").toLowerCase() === "sell" ? "sell" : "buy";
/** The side SHE is on, which is the opposite of the one being hunted. */
const HER_SIDE = SIDE === "sell" ? "buy" : "sell";
const HUNTING = SIDE === "sell" ? "seller" : "buyer";
const BOOK_FILE = argOf("book") ?? BOOK_TEXT;

/*
 * THE SEC CONSTANTS MOVED WITH THE WORK. `USER_AGENT`, the full-text-search host, the per-name
 * filing budget, the holder cap and the lookback window all belong to the half that reads EDGAR,
 * which is `filing-hunt.mjs` now. Leaving copies here would be two files each holding their own idea
 * of how many filings to read — the defect this repository names most often, in the file that says
 * so at the top.
 */

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
    return { positions: [{ asset: ONE_ASSET, side: HER_SIDE, size_usd: ONE_SIZE || null, size_min_usd: null, size_max_usd: null, size_shares: null, size_text: ONE_SIZE ? money(ONE_SIZE) : "", source_line: `--asset ${ONE_ASSET}` }], unparsed: [], source: "the command line" };
  }
  // The pulled mirror is the book when there is one — see lib/book-mirror.mjs for the week this cost.
  if (!argOf("book")) {
    const mirror = mirrorOrStop();
    if (mirror) return mirror;
  }
  if (!fs.existsSync(BOOK_FILE)) return null;
  const parsed = parseLiveBook(fs.readFileSync(BOOK_FILE, "utf8"));
  return { ...parsed, source: `${BOOK_FILE} (a local file, not production's book)` };
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
  const hits = assignedSearch(usable, asset, SIDE, size || 0, suppressed)
    // Precision bar: a candidate with no sentence behind it is not a candidate.
    .filter((h) => h.row?.quote || h.row?.evidence);
  return { hits, considered: usable.filter((r) => assetKey(r.asset) === assetKey(asset)).length };
}

// ─── Source 2: the filings, which are DANIELLE'S half ────────────────────────
//
//   "Danielle finds, Monique relates."
//
// The 170 lines that used to sit here — N-PORT search, the XML position parser, the capacity
// arithmetic, the reach rendering — moved to `scripts/ops/filing-hunt.mjs` and are IMPORTED rather
// than copied. The seam is not workload: reading eight XML filings and pulling Schedule A off Form
// ADV is research, and knowing which broker in her own ledger is already working a name is a
// relationship. This file keeps the second.
//
// A SINGLE REQUEST STILL PRODUCES BOTH HALVES. `renderAsset` below calls `researchLot` and
// `renderFilings`, so one ask produces one email carrying both people's work under their own
// bylines — two people's work reported together, not two separate asks.

function renderAsset(lot, inbox, filings, contacts) {
  const size = lot.size_usd ?? 0;
  const want = describeLot(lot).split(" — ").slice(2).join(" — ") || lot.size_text;
  const lines = [
    `${String(lot.asset).toUpperCase()}  —  you ${SIDE === "sell" ? "want" : "have"} ${want}`,
    "",
  ];

  lines.push("  FROM YOUR OWN MAIL — Monique");
  if (inbox.hits.length === 0) {
    lines.push(`    Nobody. ${inbox.considered ?? 0} row(s) in the ledger touch this name and none is a ${SIDE} side`);
    lines.push("    with a sentence behind it. That is an answer, not an empty run.");
  } else {
    for (const h of inbox.hits) {
      const r = h.row;
      lines.push(`    ${r.principal}${r.principal_email ? ` <${r.principal_email}>` : ""}  ·  wanted ${r.size_text ?? money(r.size_usd)}  ·  ${h.ageDays}d ago`);
      lines.push(`      "${r.quote ?? r.evidence}"`);
      lines.push(`      ${r.source_message}${r.intermediated_by ? `  — via ${r.intermediated_by}` : ""}`);
      renderReach(lines, reachFor({ rows: [r], contacts, handle: "the message in your archive" }), "      ");
    }
  }
  lines.push("");

  renderFilings(lines, lot, filings, contacts, SIDE);
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
  /*
   * A SIZELESS LOT IS HUNTED TOO. "Databricks — size TBD" was filed on 11 September with the
   * promise "no size yet; I hunt buyers anyway" — and this filter dropped it for four runs. The
   * filings half already answers a null size honestly (`capacity` returns UNVERIFIED, "no size to
   * test against"), so the name is searched and the arithmetic is simply not claimed.
   */
  const priced = book.positions.filter((p) => p.side === HER_SIDE);
  if (priced.length === 0) {
    console.error(`NAMED STOP [EMPTY_BOOK] the book was read and holds no ${HER_SIDE}-side line.`);
    process.exit(6);
  }

  /*
   * READ ONCE, FOR THE WHOLE RUN. 553 correspondents with an address each, and the only place in
   * this system where a way to actually speak to somebody exists.
   */
  const contacts = loadContacts();

  const sections = [];
  for (const lot of priced) {
    const inbox = fromHerInbox(lot.asset, lot.size_usd);
    /*
     * DANIELLE'S HALF, RUN INSIDE MONIQUE'S REQUEST. `researchLot` does the N-PORT read, the capacity
     * arithmetic, the Form ADV lookup and the contact discovery. One ask, both halves, one email.
     */
    const filings = await researchLot(lot.asset, lot.size_usd, SIDE);
    sections.push({ lot, inbox, filings, count: inbox.hits.length + (filings.holders?.length ?? 0) });
  }

  const total = sections.reduce((n, s) => n + s.count, 0);
  const header = [
    // LOTS, NOT LINES. Her Anthropic line is two separate blocks and they get separate answers:
    // Fidelity can write $500M comfortably and $2B only as a real decision. Collapsing them would
    // hide the one distinction that decides who to call about which block.
    `${HUNTING === "seller" ? "Seller" : "Buyer"} hunt against ${priced.length} lot(s) across `
      + `${new Set(priced.map((p) => assetKey(p.asset))).size} name(s), read from ${book.source}.`,
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

  const body = header
    + sections.map((s) => renderAsset(s.lot, s.inbox, s.filings, contacts)).join("\n");
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
    ? `${total} possible ${HUNTING}(s) — ${priced.map((p) => p.asset).join(", ")}`
    : `No ${HUNTING} clears the bar this week — ${priced.map((p) => p.asset).join(", ")}`;
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

/**
 * ─── HER SENTENCE, RUN AS A HUNT ───────────────────────────────────────────
 *
 * `--from-boss` reads the open tasks Boss OS has admitted that carry `input.hunt` — the asset, the
 * size and the side, parsed deterministically out of her own words by `shared/boss/intake/handoff.mjs`
 * — and runs each one here, on her Mac, where EDGAR and `~/.boss-os/capital` actually are.
 *
 * WHY HERE AND NOT IN THE WORKER. The hunt is SEC full-text search plus eight XML filings per name
 * plus her local ledger. None of that fits a Worker invocation and none of her ledger exists in one.
 * A version of this that "ran" in the Worker would be the defect this repo names most: exists, runs,
 * and does nothing.
 *
 * RULE 0: no open hunt request is a NAMED STOP, not a silent success. It exits 7 saying so, because
 * "nothing was queued" and "the queue was never read" are opposite facts.
 */
async function fromBoss() {
  const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
  if (!process.env.BOSS_PASSCODE) {
    console.error("NAMED STOP [NO_PASSCODE] --from-boss reads her task queue, which needs the vault: npm run vault:run -- node scripts/ops/buyer-hunt.mjs --from-boss");
    process.exit(4);
  }
  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) {
    console.error(`NAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${unlock.status}).`);
    process.exit(5);
  }
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/tasks?status=queued`, { headers: { cookie } });
  if (!res.ok) {
    console.error(`NAMED STOP [TASKS_UNREADABLE] ${res.status} reading the task queue.`);
    process.exit(6);
  }
  const rows = (await res.json())?.data ?? [];
  const queued = [];
  for (const t of rows) {
    let input = {};
    try { input = typeof t.input === "string" ? JSON.parse(t.input) : (t.input ?? {}); } catch { /* a task with unreadable input is not a hunt */ }
    if (input?.hunt?.asset && input.hunt.size_usd && input.hunt.side) queued.push({ task: t, hunt: input.hunt });
  }
  if (queued.length === 0) {
    console.error("NAMED STOP [NO_HUNT_QUEUED] no open task carries a hunt request.");
    console.error("  Email boss@sequoiataylor.com, e.g. \"#monique find me a seller of $1B+ OpenAI\".");
    process.exit(7);
  }

  console.log(`${queued.length} queued hunt(s) from her own mail.\n`);
  for (const { task, hunt } of queued) {
    console.log(`── ${task.id}: ${hunt.side === "sell" ? "sellers" : "buyers"} of ${hunt.asset} at ${money(hunt.size_usd)}`);
    const args = [process.argv[1], "--asset", hunt.asset, "--size", String(hunt.size_usd), "--side", hunt.side, ...(SEND ? ["--send"] : [])];
    const { spawnSync } = await import("node:child_process");
    const run = spawnSync(process.execPath, args, { encoding: "utf8", env: process.env });
    process.stdout.write(run.stdout ?? "");
    if (run.status !== 0) {
      console.error(`  the hunt for ${hunt.asset} exited ${run.status}. ${((run.stderr ?? "").trim().split("\n").pop() ?? "")}`);
      continue;
    }
    /*
     * ─── A DRY RUN MUST NOT CONSUME HER REQUEST ───────────────────────────────
     *
     * Recording the result CLOSES the task. Without `--send` nothing was emailed, so closing it
     * would mean her request is gone and she never received the answer — the hunt printed to a
     * terminal she is not watching, and the on-demand poller (which always sends) would then find
     * nothing queued and correctly report NO_HUNT_QUEUED for a request that was never delivered.
     *
     * Caught on 12 September by running this by hand to check the output; it silently ate a live
     * request. The task is complete when SHE HAS THE RESULT, not when the hunt has been performed,
     * and those are the same thing only when the mail actually goes.
     *
     * So a dry run prints and leaves the task exactly where it was, and says so.
     */
    if (!SEND) {
      console.log(`  ${task.id} LEFT QUEUED — nothing was emailed, so this request is not finished.`);
      console.log("  Re-run with --send to deliver it and close the task.");
      continue;
    }

    /*
     * THE RESULT GOES BACK ONTO HER CARD. A hunt that ran and left no trace on the task that asked
     * for it is the same lost work in a new place — and the task would sit queued for ever.
     */
    const note = (run.stdout ?? "").trim();
    const back = await fetch(`${ORIGIN}/api/boss/tasks/${task.id}/hunt-result`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ asset: hunt.asset, side: hunt.side, size_usd: hunt.size_usd, result: note.slice(0, 60_000) }),
    });
    if (!back.ok) {
      console.error(`NAMED STOP [RESULT_NOT_RECORDED] ${back.status} — the hunt ran and ${task.id} was not told.`);
      process.exitCode = 8;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const run = ARGS.includes("--from-boss") ? fromBoss() : main();
  run.catch((err) => { console.error(`BUYER HUNT FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
