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
import { createHash } from "node:crypto";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const BATCH_DIR = path.join(DIR, "candidates");
const LEDGER = path.join(DIR, "ledger.json");
const CHECKPOINT = path.join(DIR, "extract-checkpoint.json");

/*
 * RESUMABLE, BECAUSE A CRASH AT 87% USED TO COST 87%.
 *
 * Every extracted row lived in memory until the very last statement of the run, and the
 * ledger was written once at the end. So a crash threw away the whole run: on
 * 2026-09-10 this failed twice on the same backfill - once on `fetch failed`, once on
 * `spawn ENOEXEC` at batch 1,251 of 1,442 - and each retry started again at zero. The
 * transient failures were survivable; losing five hours of work to them was not.
 *
 * A batch is identified by the MESSAGES IN IT, not by its index. Index is not stable:
 * re-run the scan, or filter one message differently, and batch 900 is a different batch.
 * Hashing the source ids means a completed batch stays completed across runs, and a
 * batch whose contents changed is correctly treated as new work.
 *
 * Rows are flushed into the ledger as they are produced. That is safe without any new
 * reconciliation because the merge below is already keyed and additive - "added to,
 * never trimmed" - so writing the same row twice is a no-op, and a crash mid-flush
 * leaves a ledger that is short, never wrong.
 */
const batchKey = (batch) => createHash("sha256")
  .update(batch.map((m) => m.source_message).join("|"))
  .digest("hex")
  .slice(0, 16);

function readCheckpoint() {
  try {
    const j = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    return new Set(Array.isArray(j.done) ? j.done : []);
  } catch { return new Set(); }
}

/*
 * One writer at a time. CONCURRENCY workers finish batches in parallel, and two
 * simultaneous read-modify-write cycles over the same two files would lose one of them.
 * The chain is the mutex: each flush waits on the previous one.
 */
let flushChain = Promise.resolve();
function flush(rows, key, done) {
  flushChain = flushChain.then(() => {
    fs.mkdirSync(DIR, { recursive: true });
    if (rows.length) {
      const prior = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { interests: [] };
      const k = (r) => `${r.source_message}|${r.side}|${r.asset.toLowerCase()}|${r.size_usd ?? r.size_shares}`;
      const merged = new Map((prior.interests ?? []).map((r) => [k(r), r]));
      for (const r of rows) if (!merged.has(k(r))) merged.set(k(r), r);
      const interests = [...merged.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      fs.writeFileSync(LEDGER, JSON.stringify({ ...prior, updated_at: new Date().toISOString(), interests }, null, 2), "utf8");
    }
    done.add(key);
    fs.writeFileSync(CHECKPOINT, JSON.stringify({ updated_at: new Date().toISOString(), done: [...done] }, null, 2), "utf8");
  }).catch((e) => { console.error("checkpoint flush failed:", e.message); });
  return flushChain;
}
const PROMPT = process.env.CAPITAL_PROMPT
  ?? path.join(path.dirname(new URL(import.meta.url).pathname), "interest-extract-prompt.md");

/** Haiku. Classification, not judgement. Named here and in the duty row, and reconciled by validate:duty-delivery. */
const MODEL = process.env.CAPITAL_MODEL ?? "claude-haiku-4-5";
const CONCURRENCY = Number(process.env.CAPITAL_EXTRACT_CONCURRENCY ?? 10);
/** A batch that has not answered in this long is hung, not slow. Killed, unbanked, retried next run. */
const TIMEOUT_MS = Number(process.env.CAPITAL_EXTRACT_TIMEOUT_MS ?? 240_000);
const ARGS = process.argv.slice(2);
const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : ARGS[i + 1] ?? null; };
const LIMIT = Number(argOf("limit") ?? 0);

const FIRM = "rainmakersecurities.com";
/**
 * SHE IS NEVER THE PRINCIPAL IN HER OWN LEDGER, and the first live review set showed why this has to
 * be enforced here rather than asked for in the prompt. One row read `principal: Sequoia Taylor
 * <staylor@spry.vc>` on a sell of OpenAI — her own outbound mail relaying somebody else's block.
 * Left in, the matcher would eventually recommend that she call herself, or count her as a
 * counterparty at size she does not hold.
 */
const HERSELF = /staylor@spry\.vc|sequoia@westpeek\.ventures|seq\.taylor@gmail\.com/i;

/**
 * ─── HOW THIS IS ACTUALLY VERIFIED, AND WHY IT IS NOT RECALL ───────────────
 *
 * The first version of this file carried a list of five past transactions and refused to run until
 * she supplied them — recall against her own book, the same check that caught a 10-of-12 failure in
 * the LP scan. IT WAS BUILT ON AN ASSUMPTION NOBODY CHECKED, and she corrected it:
 *
 *   "i havent done any deals in a while thats the whole point of having this agent help me drum up
 *    business"
 *
 * There is no book of closed trades to reconcile against, so recall is not a test that exists here.
 *
 * PRECISION IS, AND IT IS THE ONE THAT MATTERS MORE ANYWAY. A wrong row eventually becomes a phone
 * call to somebody about stock they never wanted, which costs credibility in a market where
 * everybody knows everybody — one bad call outweighs ten missed matches. So the acceptance test is:
 * twenty-five rows, highest confidence first, each with THE SENTENCE OUT OF THE MESSAGE that
 * produced it, and she says which are wrong.
 *
 * THE QUOTE IS WHAT MAKES IT A TEST RATHER THAN A MATTER OF TRUST. Without it she is being asked to
 * agree with a summary of a message she cannot see. With it, twenty rows take a few minutes and the
 * errors show their own pattern — over-reading vague language, mistaking a co-broker for a
 * principal, catching a discussion about a company rather than an interest in its stock.
 *
 *   npm run capital:review                       # the review set
 *   npm run capital:review -- --wrong <id>       # that row was wrong: struck, and counted
 */
const REVIEW = ARGS.includes("--review");
const WRONG = argOf("wrong");
const REVIEW_SIZE = Number(process.env.CAPITAL_REVIEW_SIZE ?? 25);
const WRONG_FILE = path.join(DIR, "wrong.json");

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
    quote: String(msg.subject ?? "").slice(0, 220),
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

/*
 * THE TIMEOUT FIRED AND NOTHING WAS LISTENING TO IT.
 *
 * This already killed the child after 240s, and the 24-month backfill still hung for
 * SEVENTEEN HOURS AND FIFTY-SIX MINUTES at 0.0% CPU on 2026-09-11, blocked in exactly
 * this function. The kill was not the problem; the resolve was.
 *
 * The promise settled only on `close`, and node fires `close` when the process has
 * exited AND every stdio pipe is closed. `claude` spawns its own children, and they
 * inherit these pipes. SIGKILL to the parent leaves a grandchild holding stdout open,
 * so `close` never arrives, the promise never settles, and the worker waits forever -
 * with the timer already discharged and nothing left to rescue it. A retry wrapper
 * cannot help: the process never exits, so it never gets to retry.
 *
 * So the timeout now RESOLVES, rather than only killing, and `settle` makes the first
 * outcome win whichever arrives. A hung batch is reported failed, goes unbanked, and is
 * retried by the next run - which is what the checkpoint is for. The child is killed
 * with a process-group kill first so grandchildren go with it, falling back to the
 * direct kill if the group is unavailable.
 */
function runClaude(input) {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "--model", MODEL, "--max-turns", "1"], {
      cwd: os.homedir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      detached: true, // its own process group, so the kill below reaches grandchildren
    });
    let out = "", err = "", settled = false;
    const settle = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
      settle({ ok: false, out: "", err: `timed out after ${TIMEOUT_MS / 1000}s and was killed` });
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", () => settle({ ok: false, out: "", err: "claude not on PATH" }));
    child.on("close", (code) => settle({ ok: code === 0, out, err }));
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
  if (HERSELF.test(pe) || HERSELF.test(String(row.principal))) return "principal is the owner herself";
  if (/@|^https?:/i.test(String(row.asset))) return "asset is an address or a link";
  if (row.confidence && !["high", "medium", "low"].includes(row.confidence)) return "bad confidence";
  if (row.source_message && msg && row.source_message !== msg.source_message) return "source id does not match";
  /*
   * A ROW WITHOUT THE SENTENCE THAT PRODUCED IT IS AN UNCHECKABLE ROW, and an uncheckable ledger is
   * one she has to take on trust. Recall against her own book is not available here — she has not
   * closed a deal in a while, which is the whole reason this exists — so PRECISION judged on real
   * sentences is the only acceptance test there is. No quote, no row.
   */
  if (!row.quote || String(row.quote).trim().length < 8) return "no quote from the message";
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
  // BOUNDED, like every other quote this repository persists. A sentence is a reason; a paragraph
  // is a mail archive assembling itself one row at a time.
  quote: String(row.quote ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
  source_message: msg.source_message,
  date: msg.date,
  via: "model",
});

const CONF_ORDER = { high: 0, medium: 1, low: 2 };

/** The rows she has struck. A struck row is wrong, so it leaves the ledger's recommendations for good. */
export const loadWrong = () => {
  try { return new Set(JSON.parse(fs.readFileSync(WRONG_FILE, "utf8")).rows ?? []); } catch { return new Set(); }
};

/**
 * The review set: the rows most likely to be acted on, so the ones whose correctness matters most.
 *
 * HIGHEST CONFIDENCE FIRST, NOT A RANDOM SAMPLE. A random sample measures the ledger; this measures
 * the part of it that will reach her. A `low` row she will never see being wrong costs nothing; a
 * `high` row being wrong is the phone call.
 */
export function reviewSet(interests, wrong, n) {
  return interests
    .filter((r) => !wrong.has(r.source_message) && r.quote)
    .sort((a, b) => (CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence])
      || String(b.date).localeCompare(String(a.date)))
    .slice(0, n);
}

function strike(id) {
  const set = loadWrong();
  set.add(String(id).trim());
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(WRONG_FILE, JSON.stringify({ updated_at: new Date().toISOString(), rows: [...set] }, null, 2), "utf8");
  console.log(`Row ${id} struck. ${set.size} row(s) marked wrong.`);
  console.log("  It will not appear in any match or recommendation again.");
  console.log(`  The list is ${WRONG_FILE}; delete a line to undo it.`);
}

async function main() {
  if (WRONG) { strike(WRONG); return; }

  if (REVIEW) {
    if (!fs.existsSync(LEDGER)) {
      console.error(`NAMED STOP [NO_LEDGER] ${LEDGER} does not exist. Build it first: npm run capital:extract`);
      process.exit(5);
    }
    const all = JSON.parse(fs.readFileSync(LEDGER, "utf8")).interests ?? [];
    const wrong = loadWrong();
    const set = reviewSet(all, wrong, REVIEW_SIZE);
    /*
     * RULE 0. An empty review set from a non-empty ledger means every row lost its quote, which is
     * the one thing that makes a row checkable. Printing "nothing to review" would report a clean
     * bill of health on an unverifiable ledger.
     */
    if (all.length > 0 && set.length === 0) {
      console.error(`NAMED STOP [NOTHING_CHECKABLE] the ledger holds ${all.length} row(s) and none carries a quote.`);
      console.error("  Without the sentence out of the message there is nothing to check a row against,");
      console.error("  and the ledger's correctness becomes a matter of trust. Re-run the extraction.");
      process.exit(13);
    }
    console.log(`=== REVIEW SET — ${set.length} row(s), highest confidence first ===`);
    console.log(`Ledger: ${all.length} interest(s). ${wrong.size} already struck as wrong.\n`);
    console.log("Read the sentence. If it does not say what the row says, the row is wrong:");
    console.log("  npm run capital:review -- --wrong <id>\n");
    for (const r of set) {
      console.log(`[${r.source_message}]  ${r.date}  ${r.side.toUpperCase()}  ${r.asset}  ${r.size_text ?? ""}  (${r.confidence})`);
      console.log(`   principal:  ${r.principal}${r.principal_email ? ` <${r.principal_email}>` : ""}`);
      if (r.intermediated_by) console.log(`   via:        ${r.intermediated_by}`);
      console.log(`   said:       "${r.quote}"`);
      console.log("");
    }
    const struck = wrong.size;
    if (struck) {
      const judged = struck + set.length;
      console.log(`So far: ${struck} of ${judged} judged rows were wrong — ${((1 - struck / judged) * 100).toFixed(0)}% precision on what you have read.`);
      console.log("  A third wrong is a failing extraction, and the errors will show their own pattern.");
    }
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

  // Resume: drop batches whose exact message set has already been extracted and banked.
  const doneKeys = readCheckpoint();
  const all = batches.length;
  const pending = batches.filter((b) => !doneKeys.has(batchKey(b)));
  const skipped = all - pending.length;
  if (skipped) {
    console.log(`resuming: ${skipped} of ${all} batch(es) already banked from an earlier run; ${pending.length} to go.`);
  } else if (doneKeys.size) {
    console.log(`checkpoint holds ${doneKeys.size} batch(es) from an earlier run, none matching this batching; starting fresh.`);
  }

  let done = 0, failed = 0, rejected = 0;
  const rejectReasons = {};
  const it = pending[Symbol.iterator]();
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
      process.stdout.write(`  batch ${done}/${pending.length}\r`);
      /*
       * A FAILED BATCH IS NOT CHECKPOINTED. It gets retried on the next run, which is
       * the whole point - banking a failure as done would make a transient `fetch
       * failed` permanently silent data loss.
       */
      if (!res.ok) { failed += 1; continue; }
      const parsed = parseRows(res.out);
      if (!parsed) { failed += 1; continue; }
      const banked = [];
      const byId = new Map(batch.map((m) => [m.source_message, m]));
      for (const r of parsed) {
        const msg = byId.get(r.source_message);
        if (!msg) { rejected += 1; rejectReasons["source id not in this batch"] = (rejectReasons["source id not in this batch"] ?? 0) + 1; continue; }
        const why = admissible(r, msg);
        if (why) { rejected += 1; rejectReasons[why] = (rejectReasons[why] ?? 0) + 1; continue; }
        const row = normalise(r, msg);
        rows.push(row);
        banked.push(row);
      }
      // Banked before the next batch starts. A crash now costs this batch, not the run.
      await flush(banked, batchKey(batch), doneKeys);
    }
  }));
  await flushChain;

  /*
   * RULE 0. A run where every batch failed has extracted nothing and must not look like a market
   * with nothing in it. Those two facts are opposite and the screen shows them identically.
   */
  /*
   * Counted against PENDING, not against every batch ever. On a resumed run most batches
   * are already banked and never execute; comparing failures to the full count would let
   * a run where every executed batch failed slip past this stop, which is the exact
   * "broken run that looks like an empty market" it exists to catch. A resumed run with
   * nothing pending is not a failure - there was nothing to do.
   */
  if (pending.length > 0 && failed === pending.length) {
    console.error(`\nNAMED STOP [EXTRACTION_NEVER_RAN] all ${pending.length} pending batch(es) failed.`);
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
