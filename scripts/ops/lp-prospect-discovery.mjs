#!/usr/bin/env node
/**
 * NEW PROSPECTS EACH WEEK, FREE SOURCES FIRST (owner, 23 Oct 2026, ruling 11; Boss fix L).
 * duty_prospect_discovery, Mondays 07:00.
 *
 * Her words: "using as many free sources as possible to find good prospects (family offices,
 * sovereign wealth funds, fund of funds, etc...)". Published addresses only, never a guessed
 * pattern; every prospect carries its source. In order, cheapest first:
 *
 *   1. inbox        people who wrote to her about a buy or a sell in the last ~6 months
 *                   (D's deal grid, morning/deals.json) and are not yet prospects — their address is
 *                   the one they wrote from, which is as published as an address gets.
 *   2. sec_form_d   SEC EDGAR full-text search, Form D: the SPV vehicles raised for the names on her
 *                   list. A vehicle has no email, so it is a LEAD (firm + filing link), kept on her Mac.
 *   3. sec_13f      SEC EDGAR 13F-HR filers whose names say family office / endowment / foundation /
 *                   pension / sovereign: institutions that hold public positions. Also leads.
 *   4. 8raise       only within the month's prospecting budget (≤60 credits, ≤5 contacts per search,
 *                   one search per firm per month, never below 30): the leads above, enriched to a
 *                   published contact, then LP-mode searches for family offices, sovereign wealth
 *                   funds and funds of funds. Without `--live` no credit is spent.
 *
 * SEC fair access: a descriptive User-Agent and at most ~6 requests a second.
 * Leads (firm names, no person) are kept at ~/.boss-os/lp/prospect-leads.json, never in the repo.
 *
 *   npm run lp:discover            dry run: free sources only, no credit spent
 *   npm run lp:discover -- --live  the launchd job
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bossApi } from "./lib/duty-kit.mjs";
import { OUR_DOMAINS } from "./mail-bulk.mjs";
import { INBOX_LOOKBACK_DAYS, excluded } from "../../src/shared/boss/lp/plan.mjs";

const LIVE = process.argv.includes("--live");
const MORNING_DIR = process.env.BOSS_OS_MORNING_DIR ?? path.join(os.homedir(), ".boss-os", "morning");
const LEADS = path.join(os.homedir(), ".boss-os", "lp", "prospect-leads.json");
const UA = process.env.SEC_USER_AGENT ?? "Boss OS prospect research (westpeek.ventures)";
const DAY = 86_400_000;
const WEEKLY_NEW_CAP = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Source 1, pure: inbox counterparties from the deal grid rows, ~6 months back. */
export function inboxProspects(dealRows, { known = new Set(), lists = {}, now = Date.now() } = {}) {
  const out = new Map();
  for (const r of dealRows ?? []) {
    const email = String(r.from_email ?? "").toLowerCase();
    const at = Date.parse(r.when ?? r.date ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) || known.has(email) || out.has(email)) continue;
    if (!Number.isFinite(at) || now - at > INBOX_LOOKBACK_DAYS * DAY) continue;
    if (OUR_DOMAINS.includes(email.split("@")[1]) || /^yours/i.test(String(r.side))) continue;
    if (r.rainmaker || excluded({ email, name: r.from_name }, lists)) continue;
    out.set(email, {
      email, name: r.from_name ?? null, firm: r.from_firm ?? null, kind: "inbox_buyer", source: "inbox",
      source_ref: `${/^sell/i.test(String(r.side)) ? "offered" : "asked about"} ${r.company ?? "a company"} on ${new Date(at).toISOString().slice(0, 10)}`,
    });
  }
  return [...out.values()];
}

const LEAD_KIND = [
  [/\bfamily office\b|\bfamily (holdings|investments)\b/i, "family_office"],
  [/\b(endowment|foundation|pension|retirement|university)\b/i, "pension_endowment_foundation"],
  [/\b(sovereign|investment authority)\b/i, "sovereign_wealth"],
  [/\bfund of funds\b/i, "fund_of_funds"],
  [/\bsecondar(y|ies)\b/i, "secondary_fund"],
];
export function leadKind(name) {
  for (const [re, k] of LEAD_KIND) if (re.test(name)) return k;
  return null;
}

/**
 * Published contacts in an 8Raise answer, kept only when the address is at the firm's own domain
 * (11 Oct 2026 lesson: on obscure firms the match is often a person at ANOTHER company — never
 * emailed). Pure.
 */
export function contactsIn(text, firm) {
  const words = String(firm).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !/^(capital|partners|group|holdings|management|investments?|family|office|fund|llc|the)$/.test(w));
  const out = [];
  for (const m of String(text ?? "").matchAll(/([A-Z][a-z'’-]+(?: [A-Z][a-z'’-]+){0,2})?[^@\n]{0,80}?\b([\w.+-]+@([\w-]+)\.[\w.-]+)/g)) {
    const email = m[2].toLowerCase();
    const label = m[3].toLowerCase();
    if (out.some((o) => o.email === email)) continue;
    if (!words.some((w) => label.includes(w.slice(0, 6)) || w.includes(label))) continue;
    out.push({ email, name: m[1] ?? null });
  }
  return out;
}

async function efts(params) {
  const u = new URL("https://efts.sec.gov/LATEST/search-index");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json" } });
  await sleep(170);
  if (!r.ok) throw new Error(`EDGAR ${r.status}`);
  return r.json();
}

/** Sources 2 and 3: SEC leads (firms, no people). */
async function secLeads(companies, now) {
  const leads = [];
  const startdt = new Date(now - 365 * DAY).toISOString().slice(0, 10);
  const enddt = new Date(now).toISOString().slice(0, 10);
  for (const c of companies.slice(0, 10)) {
    try {
      const j = await efts({ q: `"${c}"`, forms: "D", dateRange: "custom", startdt, enddt });
      for (const h of (j.hits?.hits ?? []).slice(0, 10)) {
        const name = String(h._source?.display_names?.[0] ?? "").replace(/\s*\(CIK.*$/, "");
        if (name) leads.push({ firm: name, kind: "spv_manager", source: "sec_form_d", source_ref: `https://www.sec.gov/Archives/edgar/data/${String(h._source?.ciks?.[0] ?? "").replace(/^0+/, "")}/${String(h._id ?? "").split(":")[0].replace(/-/g, "")}/`, company: c });
      }
    } catch (e) { console.log(`Form D search for one name failed (${e.message}); carrying on.`); }
  }
  for (const q of ['"family office"', "endowment", "foundation", "pension", "sovereign"]) {
    try {
      const j = await efts({ q, forms: "13F-HR", dateRange: "custom", startdt: new Date(now - 120 * DAY).toISOString().slice(0, 10), enddt });
      for (const h of (j.hits?.hits ?? []).slice(0, 20)) {
        const name = String(h._source?.display_names?.[0] ?? "").replace(/\s*\(CIK.*$/, "");
        const kind = leadKind(name);
        if (name && kind) leads.push({ firm: name, kind, source: "sec_13f", source_ref: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(h._source?.ciks?.[0] ?? "")}&type=13F-HR` });
      }
    } catch (e) { console.log(`13F search failed (${e.message}); carrying on.`); }
  }
  const seen = new Set();
  return leads.filter((l) => !seen.has(l.firm.toLowerCase()) && seen.add(l.firm.toLowerCase()));
}

async function main() {
  const api = await bossApi();
  const now = Date.now();
  const lists = await api.get("/lp/exclusions");
  if (!lists.established) {
    console.log(`NAMED STOP [LISTS_UNREADABLE] ${lists.note}; no prospect added this week rather than risk someone she ruled out.`);
    console.log("LP-DISCOVERY-COMPLETE: held");
    return;
  }
  const known = new Set(((await api.get("/lp/prospects")).rows ?? []).map((r) => r.email));
  let deals = null;
  try { deals = JSON.parse(fs.readFileSync(path.join(MORNING_DIR, "deals.json"), "utf8")); } catch { /* D's file not written yet */ }

  const inbox = inboxProspects(deals?.rows ?? [], { known, lists, now }).slice(0, WEEKLY_NEW_CAP);
  if (inbox.length) {
    const r = await api.post("/lp/prospects/import", { rows: inbox });
    console.log(`inbox: ${r.added} new prospects (source recorded on each).`);
  } else console.log(`inbox: no new counterparties in the last ${INBOX_LOOKBACK_DAYS} days${deals ? "" : " (the deal grid file is not there yet)"}.`);

  const supplyNames = [...new Set((deals?.rows ?? []).filter((r) => /^yours/i.test(String(r.side))).map((r) => r.company).filter(Boolean))];
  const leads = await secLeads(supplyNames, now);
  fs.mkdirSync(path.dirname(LEADS), { recursive: true });
  const prev = (() => { try { return JSON.parse(fs.readFileSync(LEADS, "utf8")).leads ?? []; } catch { return []; } })();
  const merged = [...prev, ...leads.filter((l) => !prev.some((p) => p.firm.toLowerCase() === l.firm.toLowerCase()))];
  fs.writeFileSync(LEADS, JSON.stringify({ updated_at: new Date(now).toISOString(), leads: merged }, null, 2), { mode: 0o600 });
  console.log(`SEC: ${leads.length} firm leads this week (${merged.length} on file). A lead becomes a prospect only with a published address.`);

  if (!LIVE) {
    console.log("DRY RUN: no 8Raise credit spent.");
  } else {
    const { spend8r, call8r } = await import("./lp-eightraise.mjs");
    const fresh = merged.filter((l) => !l.enriched_month).slice(0, 5);
    const found = [];
    for (const l of fresh) {
      const r = await spend8r(api, { purpose: "prospecting", tool: "enrich_companies", args: { companies: [l.firm], max_per_firm: 1, tier: 1 }, credits: 1, company: l.firm, contacts: 1 })
        .catch((e) => ({ ok: false, why: e.message }));
      if (!r.ok) { console.log(`8Raise: stopped — ${r.why}`); break; }
      l.enriched_month = new Date(now).toISOString().slice(0, 7);
      // Enrichment can be a job: poll its status (free) a few times for the delivered contact.
      let text = String(r.out ?? "");
      const job = /"?(?:job_id|enrichment_id|id)"?\s*[:=]\s*"?([0-9a-f-]{8,})/i.exec(text)?.[1];
      for (let i = 0; job && i < 8 && !contactsIn(text, l.firm).length; i++) {
        await sleep(15_000);
        text = call8r("check_enrichment_status", { job_id: job });
      }
      for (const c of contactsIn(text, l.firm)) found.push({ ...c, firm: l.firm, kind: l.kind, source: `8raise_via_${l.source}`, source_ref: l.source_ref });
    }
    // One LP-mode search a week for the types she named, 5 contacts, inside the same budget.
    const brief = "Family offices, sovereign wealth funds and funds of funds that invest directly in late-stage private technology companies, including secondaries. 5 contacts.";
    try {
      const refined = JSON.parse(call8r("refine_query", { query: brief }) || "{}");
      const query = refined.structured_query ?? refined.query ?? null;
      if (query) {
        const r = await spend8r(api, { purpose: "prospecting", tool: "search_investors", args: { query, lead_count: 5, user_confirmed: true }, credits: 5, company: `lp-mode ${new Date(now).toISOString().slice(0, 10)}`, contacts: 5 });
        if (r.ok) for (const m of String(r.out).matchAll(/([A-Z][a-z'’-]+(?: [A-Z][a-z'’-]+){0,2})?[^@\n]{0,80}?\b([\w.+-]+@[\w-]+\.[\w.-]+)/g)) {
          if (!/@(gmail|yahoo|outlook|hotmail|icloud|aol)\./i.test(m[2])) found.push({ email: m[2].toLowerCase(), name: m[1] ?? null, kind: "family_office", source: "8raise_lp_mode", source_ref: brief.slice(0, 80) });
        }
        else console.log(`8Raise LP mode: not run — ${r.why}`);
      } else console.log("8Raise LP mode: the brief needs a choice 8Raise asked about; not run.");
    } catch (e) { console.log(`8Raise LP mode: ${e.message}`); }
    if (found.length) {
      const r = await api.post("/lp/prospects/import", { rows: found });
      console.log(`8Raise: ${r.added} published contacts added.`);
    }
    fs.writeFileSync(LEADS, JSON.stringify({ updated_at: new Date(now).toISOString(), leads: merged }, null, 2), { mode: 0o600 });
  }
  console.log("LP-DISCOVERY-COMPLETE: filed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LP-DISCOVERY FAILED: ${err?.message ?? err}`); process.exit(1); });
}
