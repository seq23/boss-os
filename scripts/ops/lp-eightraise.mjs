#!/usr/bin/env node
/**
 * MONIQUE'S 8RAISE CREDITS — read, budgeted, logged (owner, 23 Oct 2026, ruling 12; Boss fix L).
 * duty_eightraise_budget, 06:25: reads the balance (free) and writes the morning footer line
 * "8Raise: Monique used N of her 75 credits this month (30 always kept for you)".
 *
 * The month (calendar, Central) on the 165-credit plan: prospecting ≤60, buyers for her supply ≤15;
 * a hard stop when the balance would fall below 30; ≤5 contacts per search; one search per company
 * per month. NEVER buys credits, never upgrades: the only tools this file may call are on READ_TOOLS
 * and SPEND_TOOLS below, and none of them is billing (tests/boss/lpProspects.test.ts pins that).
 *
 * THE KEY NEVER APPEARS. 8r.sh (outside the repo) takes a header FILE. The file is
 * EIGHTRAISE_HDR (default ~/8raise-tools/.hdr-seq-taylor, 0600, outside the repo), or, when the vault
 * injects EIGHTRAISE_API_KEY, a 0600 temp file written here and deleted in `finally`. Nothing prints it.
 *
 *   npm run lp:eightraise              read the balance, write the footer
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bossApi } from "./lib/duty-kit.mjs";
import { writeMorning } from "./lp-daily.mjs";
import { EIGHTRAISE_BUDGET, eightRaiseFooter, monthOf } from "../../src/shared/boss/lp/plan.mjs";

const HELPER = process.env.EIGHTRAISE_HELPER ?? path.join(os.homedir(), "8raise-tools", "8r.sh");
export const READ_TOOLS = Object.freeze(["get_usage", "check_enrichment_status", "refine_query"]);
export const SPEND_TOOLS = Object.freeze(["enrich_companies", "search_investors", "find_firms", "approve_discovery"]);
const NEVER = /billing|subscription|upgrade|purchase|buy|checkout|top.?up/i;

function withHeader(fn) {
  const given = process.env.EIGHTRAISE_HDR ?? path.join(os.homedir(), "8raise-tools", ".hdr-seq-taylor");
  if (fs.existsSync(given)) return fn(given);
  const key = process.env.EIGHTRAISE_API_KEY;
  if (!key) throw new Error("NAMED STOP [NO_8RAISE_KEY] no header file and no injected key; 8Raise is not called today.");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e8r-"));
  const file = path.join(tmp, "h");
  try {
    fs.writeFileSync(file, `Authorization: Bearer ${key}\n`, { mode: 0o600 });
    return fn(file);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** One MCP tool call through 8r.sh. Refuses anything that is not a known read or spend tool. */
export function call8r(tool, args = {}) {
  if (NEVER.test(tool) || ![...READ_TOOLS, ...SPEND_TOOLS].includes(tool)) throw new Error(`refused: ${tool} is not a tool Monique may call`);
  return withHeader((hdr) => {
    const r = spawnSync("zsh", [HELPER, hdr, tool, JSON.stringify(args)], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error(`8Raise ${tool} failed (${r.status})`);
    return r.stdout;
  });
}

/** The balance from get_usage's text, whichever field name it uses. Null when unreadable. */
export function balanceIn(text) {
  const t = String(text ?? "");
  try {
    const j = JSON.parse(t);
    for (const k of ["credits_remaining", "remaining_credits", "balance", "credits"]) if (Number.isFinite(Number(j?.[k]))) return Number(j[k]);
  } catch { /* text, not JSON */ }
  const m = /(?:credits?\s*(?:remaining|left|balance)|balance|remaining)\D{0,12}(\d+(?:\.\d+)?)/i.exec(t);
  return m ? Number(m[1]) : null;
}

/**
 * Spend credits under the budget: check first (server side, against the ledger), call, then log.
 * Every refusal names its reason; nothing is called on a refusal.
 */
export async function spend8r(api, { purpose, tool, args, credits, company = null, contacts = 0 }) {
  if (!SPEND_TOOLS.includes(tool)) throw new Error(`refused: ${tool} is not a spend tool`);
  if (contacts > EIGHTRAISE_BUDGET.per_search_contacts) return { ok: false, why: `cap is ${EIGHTRAISE_BUDGET.per_search_contacts} contacts per search` };
  const balance = balanceIn(call8r("get_usage"));
  const check = await api.post("/lp/eightraise", { purpose, credits, contacts, company, balance, dry: true });
  if (!check.allowed) return { ok: false, why: check.why };
  const out = call8r(tool, args);
  const after = balanceIn(call8r("get_usage"));
  await api.post("/lp/eightraise", { purpose, tool, credits: after !== null && balance !== null ? Math.max(credits, balance - after) : credits, contacts, company, balance, balance_after: after });
  return { ok: true, out };
}

async function main() {
  const api = await bossApi();
  let balance = null;
  try {
    balance = balanceIn(call8r("get_usage"));
    await api.post("/lp/eightraise", { purpose: "balance_read", tool: "get_usage", balance });
  } catch (e) {
    console.log(String(e.message).replace(/Bearer\s+\S+/g, "Bearer •••"));
  }
  const led = await api.get(`/lp/eightraise?month=${monthOf()}`);
  const lines = [eightRaiseFooter(led.used ?? 0)];
  if (balance !== null && balance < EIGHTRAISE_BUDGET.floor) lines.push(`The 8Raise balance is ${balance}, under the ${EIGHTRAISE_BUDGET.floor} kept for you, so Monique is not using it.`);
  const file = writeMorning("eightraise", { section: "eightraise", updated_at: new Date().toISOString(), decide: [], rows: [], lines });
  console.log(`LP-EIGHTRAISE-COMPLETE: ${led.used ?? 0} used this month; balance ${balance ?? "unread"}; ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LP-EIGHTRAISE FAILED: ${String(err?.message ?? err).replace(/Bearer\s+\S+/g, "Bearer •••")}`); process.exit(1); });
}
