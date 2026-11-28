/**
 * THE LEDGER HUNT — the other side of TODAY'S mail, not her book.
 *
 * `buyer-hunt.mjs` starts from what SHE holds or wants and goes looking outward. This starts from
 * what SOMEBODY ELSE told her mailbox they want, TODAY, and goes looking for whoever could be the
 * other side of it — a broker's "our institutional client wants $7M of Periodic Labs at a $7B
 * valuation, are you direct to firm sellers" is not a line in her book, it is a line in her ledger,
 * and nothing has ever hunted from there before.
 *
 * ─── WHY THIS IS NOT A SECOND COPY OF THE HUNT ─────────────────────────────
 *
 * It imports, never reimplements: `assignedSearch`/`assetKey`/`atHerBrokerage` from
 * `interest-match.mjs`, `researchLot`/`renderFilings`/`renderReach`/`pressPodcastLeads`/
 * `renderPressPodcast` from `filing-hunt.mjs`, `loadContacts`/`reachFor` from `lib/reach.mjs`,
 * `sendersFor`/`employeeMail` from `notify.mjs`. The only thing new here is WHICH lots to hunt and
 * WHEN a lot counts as already handled — everything that decides whether a candidate is real is the
 * same code `buyer-hunt.mjs` already uses.
 *
 * ─── WHICH SIDE IS BEING HUNTED ─────────────────────────────────────────────
 *
 * The ledger entry names ITS OWN side — somebody else wants to buy, or somebody else wants to sell.
 * The side to hunt is always the opposite: a buy inquiry needs a seller, a sell inquiry needs a
 * buyer. There is no `--side` flag here the way there is in `buyer-hunt.mjs`, because the ledger
 * already says which way each entry runs; guessing wrong would mean asking whether a fund can absorb
 * a block when the real question was whether they already hold one.
 *
 * ─── ONLY NEW, ONLY ONCE ────────────────────────────────────────────────────
 *
 * `~/.boss-os/capital/ledger-hunt-state.json` remembers every row already hunted, keyed by the original ledger row.
 * A row is marked hunted only after its research has been kept for the morning: a dry run, or
 * a day every sender refuses, must not make tomorrow's run believe today's mail already went. That
 * cost a live request once in `buyer-hunt.mjs --from-boss` and is not repeated here.
 *
 * Completed findings are kept for the morning view.
 *   npm run capital:ledger-hunt                   # print results
 *   npm run capital:ledger-hunt -- --send          # keep results and record a receipt
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveIssuers } from "./lib/deal-reading.mjs";
import { readState, writeJson } from "./interest-ledger.mjs";
import { assignedSearch, assetKey, atHerBrokerage, keyOfInterest } from "./interest-match.mjs";
import { researchLot, renderFilings, renderReach, pressPodcastLeads, renderPressPodcast, money, recordFound } from "./filing-hunt.mjs";
import { withinLookback } from "../../src/shared/boss/capital/partyLists.mjs";
import { loadContacts, reachFor } from "./lib/reach.mjs";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const LEDGER = path.join(DIR, "ledger.json");
const SUPPRESS = path.join(DIR, "not-this-person.json");
const WRONG_FILE = path.join(DIR, "wrong.json");
const HUNTED_FILE = path.join(DIR, "ledger-hunt-state.json");

const ARGS = process.argv.slice(2);
const SEND = ARGS.includes("--send");

const loadJson = (p, key) => { try { return JSON.parse(fs.readFileSync(p, "utf8"))[key] ?? []; } catch { return []; } };

/** Preserve keys from existing hunt receipts. */
const rowKey = (r) => `${r.source_message}|${r.side}|${assetKey(r.asset).replace(/(inc|corp|corporation|ltd|llc|labs?|technologies|holdings)$/, "")}|${r.size_usd ?? r.size_shares}`;

function loadHunted() {
  return new Set(readState(HUNTED_FILE).hunted ?? []);
}

function markHunted(keys) {
  if (keys.length === 0) return;
  const set = loadHunted();
  for (const k of keys) set.add(k);
  fs.mkdirSync(DIR, { recursive: true });
  writeJson(HUNTED_FILE, { updated_at: new Date().toISOString(), hunted: [...set] });
}

/**
 * New rows since the last hunt: not wrong, not already hunted.
 *
 * A ROW SHE STRUCK AS WRONG IS NOT HUNTED. Hunting a counterparty for an interest she has already
 * told this system was misread would waste the search and, worse, could surface a real name against
 * a request that was never really made.
 */
function newEntries() {
  if (!fs.existsSync(LEDGER)) return { entries: [], reason: "the ledger does not exist — run npm run capital:scan && npm run capital:extract first" };
  const { interests = [] } = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  const wrong = new Set(loadJson(WRONG_FILE, "rows"));
  const hunted = loadHunted();
  // Inside her ~6-month window only (owner, 23 Oct 2026), hers included.
  const entries = interests.filter((r) => r.source_message && r.side && r.asset && withinLookback(r.date)
    && !wrong.has(r.source_message) && !hunted.has(rowKey(r)));
  return { entries, reason: null };
}

/**
 * Somebody ELSE in her own mail, on the opposite side of this name — the same ranking
 * `buyer-hunt.mjs` reads, run against the rest of the ledger instead of against her book.
 *
 * THE TRIGGERING ROW ITSELF IS EXCLUDED, so a buy inquiry can never be reported as its own answer.
 * A RAINMAKER COLLEAGUE IS EXCLUDED from the candidates for the same reason `buyer-hunt.mjs`
 * excludes one: two reps at her own firm cross that themselves. The entry that TRIGGERED this hunt
 * is hunted regardless of whether it came in through a Rainmaker rep — that is the ordinary shape of
 * her business, not a reason to skip it.
 */
function fromRestOfLedger(all, entry, huntSide, suppressed) {
  const wrong = new Set(loadJson(WRONG_FILE, "rows"));
  const usable = all.filter((r) => r.source_message !== entry.source_message
    && !wrong.has(r.source_message) && !atHerBrokerage(r));
  const hits = assignedSearch(usable, entry.issuer ?? entry.asset, huntSide, entry.size_usd ?? entry.size_shares ?? 0, suppressed)
    .filter((h) => h.row?.quote || h.row?.evidence);
  return { hits, considered: usable.filter((r) => keyOfInterest(r) === keyOfInterest(entry)).length };
}

function describeEntry(entry) {
  const size = entry.size_text ?? money(entry.size_usd ?? null);
  return `${entry.principal ?? "somebody"} wants to ${entry.side} ${size} of ${entry.asset}`;
}

function renderEntry(entry, huntSide, inbox, filings, press, contacts) {
  const lines = [
    `${String(entry.asset)}  —  ${describeEntry(entry)}`,
    `  "${entry.quote ?? entry.evidence ?? ""}"${entry.intermediated_by ? `  — via ${entry.intermediated_by}` : ""}`,
    `  ${entry.source_message}`,
    "",
  ];

  lines.push("  FROM THE REST OF YOUR MAIL — Monique");
  if (inbox.hits.length === 0) {
    lines.push(`    Nobody else. ${inbox.considered} other row(s) in the ledger touch this name and none is a`);
    lines.push(`    ${huntSide} side with a sentence behind it. That is an answer, not an empty run.`);
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

  renderFilings(lines, { asset: entry.asset, size_usd: entry.size_usd }, filings, contacts, huntSide);
  lines.push("");
  renderPressPodcast(lines, press);
  lines.push("");
  return lines.join("\n");
}

// ─── The run ─────────────────────────────────────────────────────────────────

export async function completeHunt(entry, { research = researchLot, pressResearch = pressPodcastLeads, keep, mark } = {}) {
  const huntSide = entry.side === "buy" ? "sell" : "buy";
  const issuer = entry.issuer ?? entry.asset;
  const filings = await research(issuer, entry.size_usd ?? 0, huntSide);
  if (filings.note) throw new Error(filings.note);
  const press = await pressResearch(issuer, huntSide);
  if (press.note) throw new Error(press.note);
  if (keep) {
    await keep(issuer, { holders: filings.holders ?? [], spvs: filings.spvs ?? [], press: press.leads });
    await mark(entry);
  }
  return { filings, press, huntSide };
}

async function main() {
  const { entries, reason } = newEntries();
  if (reason) {
    console.error(`NAMED STOP [NO_LEDGER] ${reason}`);
    process.exit(5);
  }
  if (entries.length === 0) {
    /*
     * NOTHING NEW IS A NAMED STOP, NOT A SILENT PASS — the same shape as `NO_BOOK` and `EMPTY_BOOK`
     * in `buyer-hunt.mjs`. "Nothing new arrived" and "this never ran" must not look the same, and a
     * plain exit 0 here would let the second one hide behind the first.
     */
    console.error("NAMED STOP [NO_NEW_ENTRIES] the ledger holds no row that is new, unhunted, and not struck as wrong.");
    process.exit(6);
  }

  const { interests: allEntries = [] } = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  const active = allEntries.filter((entry) => withinLookback(entry.date));
  const issuer = await resolveIssuers(active.map((entry) => entry.asset));
  const resolved = active.map((entry) => ({ ...entry, issuer: issuer(entry.asset) }));
  const suppressed = new Set(loadJson(SUPPRESS, "people"));
  const contacts = loadContacts();

  const sections = [];
  for (const item of entries) {
    const entry = { ...item, issuer: issuer(item.asset) };
    const { huntSide, filings, press } = await completeHunt(entry, SEND ? {
      keep: recordFound, mark: (row) => markHunted([rowKey(row)]),
    } : {});
    const inbox = fromRestOfLedger(resolved, entry, huntSide, suppressed);
    sections.push({ entry, huntSide, inbox, filings, press,
      count: inbox.hits.length + (filings.holders?.length ?? 0) + press.leads.length });
  }

  const total = sections.reduce((n, s) => n + s.count, 0);
  const header = [
    `I read ${entries.length} new message${entries.length === 1 ? "" : "s"} that named something to buy or sell `
      + `(${new Set(entries.map((e) => assetKey(e.asset))).size} compan${new Set(entries.map((e) => assetKey(e.asset))).size === 1 ? "y" : "ies"}) and looked for the other side.`,
    `I found ${total} people worth a look, each one backed by a filing, a quote from your own mail, or a`,
    "press or podcast link.",
    "",
    "This is a list for you. Nobody here has been contacted.",
    "",
    "─────────────────────────────────────────────────────────────",
    "",
  ].join("\n");

  const body = header + sections.map((s) => renderEntry(s.entry, s.huntSide, s.inbox, s.filings, s.press, contacts)).join("\n");
  console.log(body);

  if (!SEND) {
    console.log("\nRe-run with --send to keep it for the morning email. Nothing above has been marked as hunted.");
    return;
  }

  console.log(`Kept for the morning email: ${sections.length} completed hunt(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LEDGER HUNT FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
