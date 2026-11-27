/** Read saved candidate threads and append evidence-backed interests to the existing ledger. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { outputLine } from "../../src/shared/boss/alarms/rules.mjs";
import { readWorkerSource } from "../../src/worker/boss/router/freeModel.ts";
import { readJsonObject } from "../../src/worker/boss/router/types.ts";
import { loadIdentity, RRLIST } from "./interest-grid.mjs";
import { candidateFromMessage, readState, reloadBrokerageThread, writeJson } from "./interest-ledger.mjs";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const LEDGER = path.join(DIR, "ledger.json");
const WRONG_FILE = path.join(DIR, "wrong.json");
const PROMPT = process.env.CAPITAL_PROMPT ?? process.env.BOSS_DUTY_PROMPT_FILE
  ?? new URL("./interest-extract-prompt.md", import.meta.url);
const ARGS = process.argv.slice(2);
const argOf = (name) => ARGS.includes(`--${name}`) ? ARGS[ARGS.indexOf(`--${name}`) + 1] : null;
const REVIEW = ARGS.includes("--review");
const WRONG = argOf("wrong");
const REVIEW_SIZE = Number(process.env.CAPITAL_REVIEW_SIZE ?? 25);

export function senderOf(msg) {
  const to = [...(msg.to ?? []), ...(msg.cc ?? [])].map((a) => String(a).toLowerCase());
  return {
    from: String(msg.from ?? "").toLowerCase() || null,
    from_name: msg.from_name || null,
    to_rrlist: to.includes(RRLIST),
    outbound: Boolean(msg.outbound),
  };
}

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const positive = (value) => value === null || (Number.isFinite(value) && value > 0);

export function admissible(row, msg, source) {
  if (!row || typeof row !== "object" || row.source_message !== msg.source_message) return "source id does not match";
  if (!positive(row.price_usd) || !["share", "valuation", null].includes(row.price_kind)
    || ((row.price_usd === null) !== (row.price_kind === null))) return "invalid price";
  if (typeof row.asset !== "string" || !row.asset.trim() || /@|^https?:/i.test(row.asset)) return "invalid asset";
  if (row.side !== "buy" && row.side !== "sell" && !(row.side === null && clean(row.side_note))) return "no side";
  if (![row.size_usd, row.size_shares].every(positive)) return "invalid size";
  if (typeof row.principal !== "string" || !row.principal.trim()) return "no principal";
  if (String(row.principal_email ?? "").toLowerCase().endsWith("@rainmakersecurities.com")) return "principal is at her own firm";
  if (!["high", "medium", "low"].includes(row.confidence)) return "bad confidence";
  if (![row.hers, row.relayed, row.principal_named].every((value) => typeof value === "boolean")
    || (row.hers && row.relayed)) return "invalid party";
  const quote = clean(row.quote);
  if (!quote || quote.length > 220
    || ![source?.body, source?.headers?.subject].some((text) => clean(text).includes(quote))) return "no quote from the message";
  return null;
}

export const normalise = (row, msg) => ({
  ...senderOf(msg),
  principal: row.hers ? "your client" : row.principal.trim(),
  principal_email: row.principal_email ? String(row.principal_email).toLowerCase().slice(0, 160) : null,
  side: row.side,
  side_note: row.side_note ?? null,
  hers: row.hers === true,
  principal_named: row.principal_named === true,
  relayed: row.relayed === true,
  asset: String(row.asset).trim().slice(0, 80),
  size_usd: Number(row.size_usd) || null,
  size_shares: Number(row.size_shares) || null,
  size_text: String(row.size_text ?? "").slice(0, 60) || null,
  price_text: row.price_text ? String(row.price_text).slice(0, 60) : null,
  price_usd: row.price_usd ?? null,
  price_kind: row.price_kind ?? null,
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
  structure_text: row.structure_text ? String(row.structure_text).slice(0, 60) : null,
});

const nullable = (type) => ({ type: [type, "null"] });
const properties = {
  source_message: { type: "string" }, asset: { type: "string" },
  side: { type: ["string", "null"], enum: ["buy", "sell", null] }, side_note: nullable("string"),
  principal: { type: "string" }, principal_email: nullable("string"), principal_named: { type: "boolean" },
  hers: { type: "boolean" }, relayed: { type: "boolean" }, intermediated_by: nullable("string"),
  size_usd: nullable("number"), size_shares: nullable("number"), size_text: nullable("string"),
  price_text: nullable("string"), price_usd: nullable("number"),
  price_kind: { type: ["string", "null"], enum: ["share", "valuation", null] }, structure_text: nullable("string"),
  durability: { type: "string", enum: ["transacted", "wants_now"] },
  confidence: { type: "string", enum: ["high", "medium", "low"] },
  quote: { type: "string" }, evidence: { type: "string" },
};
const schema = {
  type: "object", required: ["status", "rows"],
  properties: {
    status: { type: "string", enum: ["complete", "uncertain"] },
    rows: { type: "array", items: { type: "object", properties, required: Object.keys(properties) } },
  },
};

function extractionFrom(text, msg, source, identity) {
  const answer = readJsonObject(text);
  if (answer?.status !== "complete" || !Array.isArray(answer.rows)
    || answer.rows.some((row) => admissible(row, msg, source)
      || identity.addresses.includes(String(row.principal_email ?? "").trim().toLowerCase()))) return null;
  return answer.rows;
}

async function readInterest(msg, { read, loadThread, prompt, identity }) {
  const thread = msg.thread ?? await loadThread(msg.source_message);
  const current = thread?.find((item) => item.id === msg.source_message);
  if (!current || typeof current.body !== "string") throw new Error("The candidate has no readable full message");
  const result = await read({
    worker: "monique",
    instruction: `${prompt}

Read the full thread. Only extract what the target message newly expresses or confirms.
Use the other messages to resolve references and interpret short replies. Keep all quoted material in view.
The identity record describes the owner. Report separately whether she directly represents this party
(hers), whether she relays someone else's words (relayed), and whether the principal is named (principal_named).
Use the underlying issuer's established name when the message identifies it through a ticker or vehicle.
Treat direct interest in a named issuer as interest even if they do not state size or price.
One row per issuer and side. Preserve a verbatim quote from the target body or subject.
Return {"status":"complete","rows":[...]} after reading it, including an empty rows list for no interest.
If you cannot complete the reading, return {"status":"uncertain","rows":[]}.`,
    source: JSON.stringify({ targetMessageId: msg.source_message, identity, thread }),
    maxOutputTokens: 4096,
    json: { name: "deal_interest", schema },
    accept: (text) => extractionFrom(text, msg, current, identity) !== null,
  });
  const rows = result.status === "ok" ? extractionFrom(result.text, msg, current, identity) : null;
  if (rows) return { status: "complete", rows: rows.map((row) => normalise(row, msg)) };
  return { status: result.status === "allowance-exhausted" ? result.status : "unavailable", rows: [] };
}

const rowKey = (r) => JSON.stringify([r.source_message, r.side, r.asset.toLowerCase(), r.size_usd ?? r.size_shares ?? null]);

/** The caller holds the existing scan lock. The ledger write precedes its receipt and batch removal. */
export async function extractCandidates({
  directory = DIR, read = (input) => readWorkerSource(input, process.env), loadThread = reloadBrokerageThread,
  prompt = fs.readFileSync(PROMPT, "utf8"), identity = loadIdentity(), limit = 0,
} = {}) {
  const batches = path.join(directory, "candidates");
  fs.mkdirSync(batches, { recursive: true, mode: 0o700 });
  let files = fs.readdirSync(batches).filter((file) => file.endsWith(".json")).sort();
  if (limit > 0) files = files.slice(0, limit);
  const ledgerFile = path.join(directory, "ledger.json");
  const ledger = readState(ledgerFile);
  const checkpointFile = path.join(directory, "extract-checkpoint.json");
  const checkpoint = readState(checkpointFile);
  const done = new Set(checkpoint.messages ?? []);
  const merged = new Map((ledger.interests ?? []).map((row) => [rowKey(row), row]));
  let checked = 0;
  let added = 0;

  for (const file of files) {
    const batchFile = path.join(batches, file);
    const batch = JSON.parse(fs.readFileSync(batchFile, "utf8"));
    const messages = Array.isArray(batch) ? batch : batch.messages;
    if (!Array.isArray(messages) || !messages.length || messages.some((msg) => !msg?.source_message)) {
      throw new Error("Candidate batch has no readable message IDs");
    }
    for (const msg of messages) {
      if (done.has(msg.source_message)) continue;
      const result = await readInterest(msg, { read, loadThread, prompt, identity });
      if (result.status !== "complete") return { status: result.status, checked, added, remaining: true };
      const previousSize = merged.size;
      for (const row of result.rows) {
        if (!merged.has(rowKey(row))) merged.set(rowKey(row), row);
      }
      if (merged.size !== previousSize) {
        writeJson(ledgerFile, { ...ledger, updated_at: new Date().toISOString(), interests: [...merged.values()] });
        added += merged.size - previousSize;
      }
      done.add(msg.source_message);
      writeJson(checkpointFile, { ...checkpoint, messages: [...done] });
      checked += 1;
    }
    fs.unlinkSync(batchFile);
  }
  return { status: "complete", checked, added, remaining: fs.readdirSync(batches).some((file) => file.endsWith(".json")) };
}

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

async function recheck() {
  const ledger = readState(LEDGER);
  const interests = ledger.interests ?? [];
  if (!interests.length) throw new Error("No ledger to recheck");
  const ids = new Set(interests.filter((row) => row.via === "model").map((row) => row.source_message));
  const reread = new Map();
  const dependencies = { read: (input) => readWorkerSource(input, process.env), loadThread: reloadBrokerageThread,
    prompt: fs.readFileSync(PROMPT, "utf8"), identity: loadIdentity() };
  for (const id of ids) {
    const thread = await reloadBrokerageThread(id);
    const source = thread.find((message) => message.id === id);
    const result = await readInterest(candidateFromMessage(source, thread), dependencies);
    if (result.status !== "complete") return result.status;
    reread.set(id, result.rows);
  }
  const rows = interests.map((row) => {
    const found = (reread.get(row.source_message) ?? []).filter((candidate) =>
      candidate.asset.toLowerCase() === row.asset.toLowerCase()
      && (candidate.size_usd ?? candidate.size_shares) === (row.size_usd ?? row.size_shares));
    return found.length === 1 ? { ...row, ...found[0] } : row;
  });
  writeJson(LEDGER, { ...ledger, rechecked_at: new Date().toISOString(), interests: rows });
  console.log(`CAPITAL-RECHECK-COMPLETE: ${ids.size} source message(s) re-read, ${rows.length} ledger interest(s).`);
  return "complete";
}

async function main() {
  if (WRONG) { strike(WRONG); return; }
  if (ARGS.includes("--recheck")) {
    const status = await recheck();
    if (status !== "complete") {
      console.error(`NAMED STOP [CAPITAL_RECHECK_UNREAD] ${status}; the prior ledger is preserved.`);
      process.exitCode = 9;
    }
    return;
  }
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
      console.log(`[${r.source_message}]  ${r.date}  ${String(r.side ?? "unclear").toUpperCase()}  ${r.asset}  ${r.size_text ?? ""}  (${r.confidence})`);
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

  const result = await extractCandidates({ limit: Number(argOf("limit") ?? 0) });
  console.log(outputLine(result.checked, "interests read"));
  if (result.status !== "complete") {
    console.error(result.status === "allowance-exhausted"
      ? "NAMED STOP [FREE_ALLOWANCE_EXHAUSTED] Remaining candidate mail will be retried next run."
      : "NAMED STOP [EXTRACTION_NEVER_RAN] A candidate could not be read; its batch is retained for the next run.");
    process.exitCode = 9;
    return;
  }
  console.log(`CAPITAL-EXTRACT-COMPLETE: ${result.checked} candidate(s) read, ${result.added} new interest(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {
    console.error("NAMED STOP [CAPITAL_EXTRACT_FAILED] Extraction could not finish. Unread candidate batches were retained.");
    process.exitCode = 1;
  });
}
