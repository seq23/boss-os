#!/usr/bin/env node
/**
 * "CATCH UP WITH" — ONLY WHEN THERE IS A LIVE REASON (owner, 23 Oct 2026, ruling 14 as revised:
 * "do not track catch ups… make it opportunistic but not repetitive"). duty_catchups, 06:20.
 *
 * NO tracker, NO tab, NO quota. 0–3 people in the morning email, each with one "why" line and a
 * drafted note, and only when a deal gives a reason today:
 *   unfilled_ask_matched   they asked for a company (≤6 months ago) that is available now — a new
 *                          sell in her inbox or on her own list
 *   holds_or_wants         they offered a company (≤6 months ago) that a new buyer is asking for
 *   past_partner_moving    reserved for D's deal history (a past deal partner in a name moving now)
 *
 * Not repetitive: an internal record (catchup_suggestions, never shown to her) — nobody more than
 * twice ever unless they have written to her since, never twice in a week, reason types rotate.
 * Never Rainmaker, never on her do-not-suggest list; if those lists cannot be read, nobody is
 * suggested (fail closed).
 *
 * THE BUTTON IS "Write to them", NOT A ONE-TAP SEND. Deal counterparties write to her Rainmaker
 * mailbox, and Boss OS never sends from it (validate:no-spry-sender). The link opens her own mail app
 * with the note filled in; ignoring it is the skip.
 *
 *   npm run lp:catchups
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bossApi } from "./lib/duty-kit.mjs";
import { writeMorning } from "./lp-daily.mjs";
import { newerSections } from "../../src/shared/boss/mail/morningSections.mjs";
import { catchupNote, pickCatchups } from "../../src/shared/boss/lp/plan.mjs";

const MORNING_DIR = process.env.BOSS_OS_MORNING_DIR ?? path.join(os.homedir(), ".boss-os", "morning");
const DAY = 86_400_000;

/** Candidates from the deal grid rows: an older row of theirs that today's new rows make live. Pure. */
export function catchupCandidates(rows, now = Date.now()) {
  const at = (r) => Date.parse(r.when ?? r.date ?? "");
  const fresh = (rows ?? []).filter((r) => now - at(r) <= 2 * DAY);
  const wantNow = new Set(fresh.filter((r) => /^buy/i.test(String(r.side))).map((r) => String(r.company).toLowerCase()));
  const haveNow = new Set(fresh.filter((r) => /^(sell|yours)/i.test(String(r.side))).map((r) => String(r.company).toLowerCase()));
  const lastWrote = new Map();
  for (const r of rows ?? []) {
    const e = String(r.from_email ?? "").toLowerCase();
    if (e) lastWrote.set(e, Math.max(lastWrote.get(e) ?? 0, at(r) || 0));
  }
  const out = new Map();
  for (const r of rows ?? []) {
    const email = String(r.from_email ?? "").toLowerCase();
    const t = at(r);
    if (!email || !Number.isFinite(t) || now - t < 14 * DAY || r.rainmaker) continue;
    const co = String(r.company ?? "").toLowerCase();
    const day = new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric" });
    let c = null;
    if (/^buy/i.test(String(r.side)) && haveNow.has(co)) c = { reason_type: "unfilled_ask_matched", reason: `You asked about ${r.company} on ${day}; ${r.company} is available now.` };
    else if (/^sell/i.test(String(r.side)) && wantNow.has(co)) c = { reason_type: "holds_or_wants", reason: `You mentioned ${r.company} on ${day}; someone is asking for it now.` };
    if (!c || out.has(email)) continue;
    out.set(email, { email, name: r.from_name ?? null, firm: r.from_firm ?? null, company: r.company, ...c, reason_at: t, last_wrote_at: lastWrote.get(email) ?? t, score: Number(r.size_usd ?? 0) });
  }
  return [...out.values()];
}

export function mailto(email, subject, body) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function catchupsMorning(picked, now = Date.now()) {
  return {
    section: "catchups",
    updated_at: new Date(now).toISOString(),
    title: "Catch up with",
    decide: picked.map((p) => ({
      title: `Catch up with ${p.name || "a contact"}${p.firm ? ` at ${p.firm}` : ""}`,
      body: p.reason,
      buttons: [{ label: "Edit, then send", url: mailto(p.email, `Catching up${p.company ? ` on ${p.company}` : ""}`, catchupNote({ name: p.name, reason: p.reason })) }],
    })),
    rows: [],
    lines: [],
  };
}

async function main() {
  const DRY = process.argv.includes("--dry");
  const api = await bossApi();
  const lists = await api.get("/lp/exclusions");
  let picked = [];
  if (!lists.established) {
    console.log(`held: ${lists.note}; nobody suggested today.`);
  } else {
    // Monique's deals section: the Mac file and/or Boss OS's copy (1 Nov 2026: this job may run on a
    // cloud runner, where only Boss OS has it); the newer copy wins. Neither readable is a named stop.
    let file = null;
    try { file = JSON.parse(fs.readFileSync(path.join(MORNING_DIR, "deals.json"), "utf8")); } catch { /* not written yet */ }
    const store = await api.get("/morning/sections").then((d) => d?.rows ?? []).catch((e) => { if (!file) throw new Error(`NAMED STOP [DEALS_NOT_READ] no deals file here and Boss OS's morning sections not read (${e.message})`); return []; });
    const kept = store.find((r) => r.section === "deals")?.body ?? null;
    const deals = newerSections(file ? { deals: file } : {}, kept ? { deals: kept } : {}).deals ?? null;
    const history = (await api.get("/lp/catchups/history")).rows ?? [];
    picked = pickCatchups(catchupCandidates(deals?.rows ?? []), history, lists);
    // --dry (the first cloud run's proof, 1 Nov 2026): picks and says how many; records and writes nothing.
    if (DRY) { console.log(`LP-CATCHUPS-DRY: ${picked.length} would be suggested (deals section ${deals ? "read" : "absent"}); nothing recorded or written.`); return; }
    if (picked.length) await api.post("/lp/catchups/record", { rows: picked.map((p) => ({ person_key: p.email, reason_type: p.reason_type })) });
  }
  if (DRY) { console.log(`LP-CATCHUPS-DRY: held; nothing recorded or written.`); return; }
  const file = writeMorning("catchups", catchupsMorning(picked));
  console.log(`LP-CATCHUPS-COMPLETE: ${picked.length} suggested; ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LP-CATCHUPS FAILED: ${err?.message ?? err}`); process.exit(1); });
}
