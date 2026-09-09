/**
 * THE LEDGER ITSELF — candidate messages in, structured interests out.
 *
 * ─── Why this is a separate script from the one that reads the mail ─────────
 *
 * `interest-ledger.mjs` calls Gmail and sends nothing to any model. THIS FILE CALLS A MODEL AND
 * NEVER TOUCHES GMAIL. That split is not tidiness: it is what lets the Gmail-side script carry the
 * same invariant every other named content exception in `validate:gmail` carries, so widening the
 * class of thing this repository may do to her mailbox stays a deliberate act rather than a side
 * effect of adding a feature. `validate:gmail` asserts both halves — that one never gains a model
 * call, and that the other never gains a Gmail call.
 *
 * ─── THE MODEL IS NAMED, AND IT IS THE CHEAP ONE ───────────────────────────
 *
 * Haiku. Deciding whether a message contains an asset, a side and a size is CLASSIFICATION, not
 * judgement — the judgement is in the matching, and only the assigned buyer search gets a better
 * brain. `claude -p` with no `--model` runs the most expensive model available; that defect made a
 * single briefing cost $3.88 once, and this runs over tens of thousands of messages.
 *
 * IT RUNS THROUGH HER OWN CLAUDE CODE SESSION, exactly as `kdp-watch.sh` and `mailbox-sweep.sh` do,
 * rather than through a keyed API. Two reasons, and the second is the load-bearing one: there is no
 * `ANTHROPIC_API_KEY` in the vault (a credential gate only she can clear), and this is live
 * transaction data at a FINRA-registered broker-dealer — routing it through an aggregator to save
 * her a step would put a party she never chose between her mailbox and the model.
 *
 * ─── The structured-order fast path, which costs nothing ───────────────────
 *
 * Rainmaker's own order system sends "Sell Order: ByteDance | $ 350.00 M @ $ 590,000 M". The asset,
 * the side and the size are in the SUBJECT LINE, in a fixed machine-written format. Parsing those
 * needs no model, cannot hallucinate, and is more accurate than one.
 *
 * THIS IS NOT A COMPANY LIST IN DISGUISE. It keys off the format of a SENDING SYSTEM, not off a
 * roster of company names, so a company nobody has typed anywhere still comes through it the day it
 * first appears. That distinction is the whole reason there is no name list in this feature: a fixed
 * list is guaranteed to miss next quarter's name, and a missed name is a SILENT miss.
 *
 * ─── The ledger is added to, never trimmed ─────────────────────────────────
 *
 * `~/.boss-os/capital/ledger.json` accumulates by `source_message`. An interest that fell off
 * because a later scan windowed differently is a counterparty she loses with no way to know it
 * happened — the same defect the LP running list exists to prevent.
 *
 * NOTHING HERE REACHES THE CLOUD. Named counterparties, assets and sizes stay on this machine.
 *
 *   npm run capital:extract
 *   npm run capital:extract -- --limit 20      # first 20 batches, for a look
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const BATCH_DIR = path.join(DIR, "candidates");
const LEDGER = path.join(DIR, "ledger.json");
const PROMPT = process.env.CAPITAL_PROMPT
  ?? path.join(path.dirname(new URL(import.meta.url).pathname), "interest-extract-prompt.md");

/** Haiku. Classification, not judgement. Named here and in the duty row, and reconciled by validate:duty-delivery. */
const MODEL = process.env.CAPITAL_MODEL ?? "claude-haiku-4-5";
const CONCURRENCY = Number(process.env.CAPITAL_EXTRACT_CONCURRENCY ?? 10);
const ARGS = process.argv.slice(2);
const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : ARGS[i + 1] ?? null; };
const LIMIT = Number(argOf("limit") ?? 0);

const FIRM = "rainmakersecurities.com";
const VERIFY = ARGS.includes("--verify");

/**
 * ─── THE ONLY HONEST CHECK: DEALS SHE ACTUALLY DID ─────────────────────────
 *
 * EVERY OTHER CHECK THIS SYSTEM COULD RUN IS MARKING ITS OWN HOMEWORK. The extraction can report a
 * confident count of interests, a plausible spread of assets and a tidy discard rate, and be
 * silently missing half the market — and nothing in the output would look different. Plausible
 * output is not evidence.
 *
 * The precedent is three weeks old and it caught a real failure. `lp-positive.mjs` carries twelve
 * replies the owner listed from her own records; the first version of the search found two of them,
 * and reported the other ten as a clean result rather than as a loss. A 10-of-12 recall failure that
 * looked exactly like success.
 *
 * SO: FIVE PAST TRANSACTIONS SHE KNOWS HAPPENED — the counterparty, the company, roughly when. The
 * extraction has to recover them out of her own mailbox. If it cannot find a deal she knows she did,
 * it is not ready, and no amount of good-looking output changes that.
 *
 * THIS LIST IS EMPTY, AND THAT IS A NAMED STOP RATHER THAN A GAP. It is the one thing in this
 * feature that only she can supply, so `--verify` refuses loudly instead of inventing a ground truth
 * for itself. When the list ever goes stale, that is a reason to update it from her records — never
 * a reason to soften the check.
 *
 * Each entry: [counterparty name or address, company, roughly when, one line of what it was]
 */
const KNOWN_DEALS = [
  // e.g. ["daniel@kellscapital.com", "OpenAI", "2026-08", "his buyer took part of the block"],
];

// ─── The structured-order fast path ──────────────────────────────────────────

const UNIT = { k: 1e3, m: 1e6, mm: 1e6, b: 1e9, bn: 1e9, million: 1e6, billion: 1e9, thousand: 1e3 };
const dollars = (n, unit) => Number(String(n).replace(/,/g, "")) * (UNIT[String(unit ?? "").toLowerCase()] ?? 1);

/**
 * "Sell Order: ByteDance | $ 350.00 M @ $ 590,000 M" — the firm's order management system.
 * Returns a row, or null when the subject is not one of those.
 */
export function structuredOrder(msg) {
  const m = /^\s*(buy|sell)\s+order:\s*([^|]+?)\s*\|\s*\$\s*([\d,.]+)\s*([kmb]{1,2})?\s*(?:@\s*(.+))?$/i
    .exec(msg.subject ?? "");
  if (!m) return null;
  const [, side, asset, amount, unit, price] = m;
  const from = String(msg.from ?? "").toLowerCase();
  const internal = from.endsWith(`@${FIRM}`);
  return {
    principal: internal ? `unnamed client of ${from}` : (msg.from_name || from),
    principal_email: internal ? null : from,
    side: side.toLowerCase(),
    asset: asset.trim(),
    size_usd: dollars(amount, unit),
    size_shares: null,
    size_text: `$${amount}${unit ? unit.toUpperCase() : ""}`,
    price_text: price ? price.trim().slice(0, 60) : null,
    /*
     * A LIVE ORDER IS PERISHABLE BY DEFINITION. It fills, or the mark moves, or the mandate closes.
     * Calling it durable would put a filled block in front of her a year later as if it were still
     * open, which is the wrong-match cost this whole design is built to avoid.
     */
    durability: "wants_now",
    // High without a model: a machine wrote this subject in a fixed format and nothing was inferred.
    confidence: "high",
    intermediated_by: internal ? from : null,
    evidence: "firm order-system posting, asset side and size all in the subject",
    source_message: msg.source_message,
    date: msg.date,
    via: "order_system",
  };
}

// ─── The model pass ──────────────────────────────────────────────────────────

function runClaude(input) {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "--model", MODEL, "--max-turns", "1"], {
      cwd: os.homedir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    let out = "", err = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 240_000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", () => { clearTimeout(timer); resolve({ ok: false, out: "", err: "claude not on PATH" }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, err }); });
    child.stdin.end(input);
  });
}

/** The JSON array out of a reply that may be fenced, prefaced, or both. */
export function parseRows(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const rows = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(rows) ? rows : null;
  } catch { return null; }
}

/**
 * Every rule the ledger will not bend, applied to whatever the model returned.
 *
 * A MODEL THAT INVENTS A ROW IS THE MOST EXPENSIVE FAILURE THIS SYSTEM HAS, because the row will
 * eventually become a phone call to someone about stock they never wanted. So a row that does not
 * carry an asset, a side and a size is dropped rather than repaired, and the firm rule is enforced
 * here rather than trusted to the prompt.
 */
export function admissible(row, msg) {
  if (!row || typeof row !== "object") return "not an object";
  if (!row.asset || typeof row.asset !== "string" || row.asset.trim().length < 2) return "no asset";
  if (row.side !== "buy" && row.side !== "sell") return "no side";
  const usd = Number(row.size_usd) || 0;
  const shares = Number(row.size_shares) || 0;
  if (usd <= 0 && shares <= 0) return "no size";
  if (!row.principal || String(row.principal).trim().length < 2) return "no principal";
  /*
   * NOBODY AT HER OWN FIRM IS EVER THE PRINCIPAL. A co-broker's interest is real and belongs in the
   * ledger — as their CLIENT's interest, with the co-broker in `intermediated_by`. Silently
   * swallowing the route would lose the half of a co-brokered deal that makes it a deal.
   */
  const pe = String(row.principal_email ?? "").toLowerCase();
  if (pe.endsWith(`@${FIRM}`)) return "principal is at her own firm";
  if (/@|^https?:/i.test(String(row.asset))) return "asset is an address or a link";
  if (row.confidence && !["high", "medium", "low"].includes(row.confidence)) return "bad confidence";
  if (row.source_message && msg && row.source_message !== msg.source_message) return "source id does not match";
  return null;
}

const normalise = (row, msg) => ({
  principal: String(row.principal).trim().slice(0, 160),
  principal_email: row.principal_email ? String(row.principal_email).toLowerCase().slice(0, 160) : null,
  side: row.side,
  asset: String(row.asset).trim().slice(0, 80),
  size_usd: Number(row.size_usd) || null,
  size_shares: Number(row.size_shares) || null,
  size_text: String(row.size_text ?? "").slice(0, 60) || null,
  price_text: row.price_text ? String(row.price_text).slice(0, 60) : null,
  durability: row.durability === "transacted" ? "transacted" : "wants_now",
  confidence: row.confidence ?? "low",
  intermediated_by: row.intermediated_by ? String(row.intermediated_by).toLowerCase().slice(0, 160) : null,
  evidence: String(row.evidence ?? "").slice(0, 160),
  source_message: msg.source_message,
  date: msg.date,
  via: "model",
});

/**
 * Recall against her own records. Returns the deals the ledger cannot account for.
 *
 * A hit is: the counterparty appears in the ledger, on that company, within four months of when she
 * says it happened. Four months rather than a date match because she is recalling a transaction, not
 * reading a confirm, and a window that demands the day would fail on her memory rather than on the
 * extraction.
 */
export function recall(interests, deals) {
  const missed = [];
  const found = [];
  for (const [whoRaw, company, when, note] of deals) {
    const who = String(whoRaw).toLowerCase();
    const asset = String(company).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const target = Date.parse(`${when.length === 7 ? `${when}-15` : when}T12:00:00Z`);
    const hit = interests.find((r) =>
      String(r.asset ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "") === asset
      && (`${r.principal ?? ""} ${r.principal_email ?? ""} ${r.intermediated_by ?? ""}`).toLowerCase().includes(who)
      && Math.abs(Date.parse(`${r.date}T12:00:00Z`) - target) < 124 * 86_400_000);
    if (hit) found.push([whoRaw, company, when, hit]); else missed.push([whoRaw, company, when, note]);
  }
  return { found, missed };
}

async function main() {
  if (VERIFY) {
    const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")).interests ?? [] : [];
    if (KNOWN_DEALS.length === 0) {
      console.error("NAMED STOP [NO_GROUND_TRUTH] the extraction cannot be verified, and nothing else can verify it.");
      console.error("");
      console.error(`  The ledger holds ${ledger.length} interest(s). That number is plausible and it is not evidence.`);
      console.error("  Every check this system could run on itself is marking its own homework: a scan that");
      console.error("  silently lost half the market would print exactly the same kind of number.");
      console.error("");
      console.error("  WHAT IS NEEDED, AND ONLY SHE HAS IT: five transactions she knows she did.");
      console.error("  For each one — the counterparty, the company, and roughly when. Nothing else.");
      console.error("  They go in KNOWN_DEALS at the top of this file, and `--verify` then fails loudly");
      console.error("  on any the extraction cannot recover out of her own mailbox.");
      console.error("");
      console.error("  This is the same check that caught a 10-of-12 recall failure in the LP scan — a");
      console.error("  failure that looked identical to success until her own list was put against it.");
      process.exit(11);
    }
    const { found, missed } = recall(ledger, KNOWN_DEALS);
    console.log(`=== RECALL AGAINST ${KNOWN_DEALS.length} DEAL(S) SHE KNOWS SHE DID ===`);
    for (const [who, company, when, hit] of found) console.log(`  FOUND    ${String(who).padEnd(34)} ${company} ~${when}  (ledger row ${hit.source_message})`);
    for (const [who, company, when, note] of missed) console.log(`  MISSING  ${String(who).padEnd(34)} ${company} ~${when}  ${note ?? ""}`);
    console.log(`\n  ${found.length} of ${KNOWN_DEALS.length} recovered.`);
    if (missed.length) {
      console.error(`\nNAMED STOP [RECALL_FAILED] the extraction did not recover ${missed.length} deal(s) she knows happened.`);
      console.error("  The filter is too narrow or the extraction is dropping rows. A ledger that");
      console.error("  silently loses a counterparty is worse than no ledger, because she has no way");
      console.error("  to know it happened. Do not soften this check — widen the thing that lost them.");
      process.exit(12);
    }
    console.log("RECALL PASSED");
    return;
  }

  if (!fs.existsSync(BATCH_DIR)) {
    console.error(`NAMED STOP [NO_CANDIDATES] ${BATCH_DIR} does not exist.`);
    console.error("  Run the scan first: npm run capital:scan -- --backfill");
    process.exit(5);
  }
  let files = fs.readdirSync(BATCH_DIR).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error(`NAMED STOP [NO_CANDIDATES] ${BATCH_DIR} is empty. The scan kept nothing, which is`);
    console.error("  its own named stop — read the scan's output rather than this one.");
    process.exit(5);
  }
  if (LIMIT > 0) files = files.slice(0, LIMIT);

  const prompt = fs.readFileSync(PROMPT, "utf8");

  // The fast path first, so the model is never paid to read what a fixed format already answers.
  const rows = [];
  const forModel = [];
  let messages = 0;
  for (const f of files) {
    for (const msg of JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), "utf8"))) {
      messages += 1;
      const fast = structuredOrder(msg);
      if (fast) { rows.push(fast); continue; }
      forModel.push(msg);
    }
  }
  console.log(`${messages} candidate message(s): ${rows.length} answered by the order-system format,`
    + ` ${forModel.length} going to ${MODEL}.`);

  const batches = [];
  for (let i = 0; i < forModel.length; i += 20) batches.push(forModel.slice(i, i + 20));

  let done = 0, failed = 0, rejected = 0;
  const rejectReasons = {};
  const it = batches[Symbol.iterator]();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const next = it.next();
      if (next.done) return;
      const batch = next.value;
      const payload = batch.map((m) => [
        `--- MESSAGE id=${m.source_message} date=${m.date} direction=${m.outbound ? "she wrote" : "they wrote"}`,
        `from: ${m.from}${m.from_name ? ` (${m.from_name})` : ""}`,
        `to: ${m.to.join(", ")}`,
        `subject: ${m.subject}`,
        "",
        m.excerpt.slice(0, 4000),
      ].join("\n")).join("\n\n");

      const res = await runClaude(`${prompt}\n\n=== BATCH OF ${batch.length} MESSAGES ===\n\n${payload}`);
      done += 1;
      process.stdout.write(`  batch ${done}/${batches.length}\r`);
      if (!res.ok) { failed += 1; continue; }
      const parsed = parseRows(res.out);
      if (!parsed) { failed += 1; continue; }
      const byId = new Map(batch.map((m) => [m.source_message, m]));
      for (const r of parsed) {
        const msg = byId.get(r.source_message);
        if (!msg) { rejected += 1; rejectReasons["source id not in this batch"] = (rejectReasons["source id not in this batch"] ?? 0) + 1; continue; }
        const why = admissible(r, msg);
        if (why) { rejected += 1; rejectReasons[why] = (rejectReasons[why] ?? 0) + 1; continue; }
        rows.push(normalise(r, msg));
      }
    }
  }));

  /*
   * RULE 0. A run where every batch failed has extracted nothing and must not look like a market
   * with nothing in it. Those two facts are opposite and the screen shows them identically.
   */
  if (batches.length > 0 && failed === batches.length) {
    console.error(`\nNAMED STOP [EXTRACTION_NEVER_RAN] all ${batches.length} batch(es) failed.`);
    console.error(`  ${MODEL} was not reachable, or every reply was unparseable. This is a broken run,`);
    console.error("  not an empty market. Check that `claude` is on PATH and signed in.");
    process.exit(9);
  }

  // ─── Added to, never trimmed ──────────────────────────────────────────────
  fs.mkdirSync(DIR, { recursive: true });
  const prior = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { interests: [] };
  const key = (r) => `${r.source_message}|${r.side}|${r.asset.toLowerCase()}|${r.size_usd ?? r.size_shares}`;
  const merged = new Map((prior.interests ?? []).map((r) => [key(r), r]));
  let added = 0;
  for (const r of rows) if (!merged.has(key(r))) { merged.set(key(r), r); added += 1; }
  const interests = [...merged.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  fs.writeFileSync(LEDGER, JSON.stringify({
    updated_at: new Date().toISOString(),
    model: MODEL,
    interests,
  }, null, 2), "utf8");

  const principals = new Set(interests.map((r) => (r.principal_email ?? r.principal).toLowerCase()));
  const assets = new Set(interests.map((r) => r.asset.toLowerCase()));
  console.log(`\n${interests.length} interest(s) in the ledger (${added} new this run) — `
    + `${principals.size} distinct principal(s), ${assets.size} distinct asset(s).`);
  console.log(`  buy ${interests.filter((r) => r.side === "buy").length}  |  sell ${interests.filter((r) => r.side === "sell").length}`);
  console.log(`  ${failed} batch(es) failed, ${rejected} model row(s) refused as inadmissible.`);
  for (const [why, n] of Object.entries(rejectReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(5)}  ${why}`);
  }
  console.log(`CAPITAL-EXTRACT-COMPLETE: ${interests.length} interest(s), ${principals.size} principal(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`CAPITAL EXTRACT FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
