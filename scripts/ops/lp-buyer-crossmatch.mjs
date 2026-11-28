/**
 * WHERE THE LP LIST AND THE BUYER LIST ARE THE SAME PEOPLE.
 *
 * She is raising West Peek Fund I from family offices, endowments, foundations and pensions. She is
 * also brokering late-stage secondaries TO family offices, endowments, foundations and pensions.
 * That is one universe addressed twice, in two systems that have never spoken: the LP tracker is a
 * Google Sheet on her Mac, and the buyer candidates are `sourcing_candidates` in D1.
 *
 * This runs on her Mac because the sheet is unreachable from the Worker — the runner strips every
 * credential — and posts only firms and aggregate counts back. LP individuals never leave this
 * machine: names, addresses and drip detail go to a local file under ~/.boss-os/crossmatch, and the
 * endpoint refuses any batch with an '@' in a firm field.
 *
 *   npm run crossmatch                # match and post
 *   npm run crossmatch -- --dry-run   # print, write the local file, post nothing
 *
 * ─── The two hats, and why the output says which is which ────────────────────
 *
 * "This firm is on both lists" is not yet useful. What she needs before picking up a phone is which
 * relationship already exists and in what state, because the sentence is different in each case:
 *
 *   in the LP sequence, drip stage 2   →  "I'm already in their inbox about the fund. Raising the
 *                                          brokerage separately risks two threads at one firm."
 *   on the do-not-contact list         →  "They are suppressed AS AN LP. That says nothing about
 *                                          approaching them as a buyer, and it is exactly the fact
 *                                          she would otherwise never connect."
 *
 * ─── Precision over recall, and near-misses reported separately ──────────────
 *
 * The free reader compares names and available identity evidence. The rule it applies: a false match has her open a call with a stranger she believes she knows, and there is
 * no recovering that, so anything short of certain is reported as a near-miss for her eye and never
 * promoted to a match.
 */

import { createSign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { readDealObject } from "./lib/deal-reading.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const LP_SHEET = process.env.LP_SOURCE_SHEET ?? "1Riww0SiaLb_vxHjUpruSdkNemBEndcQrDQgu7Ly9rRA";
const OUT_DIR = join(homedir(), ".boss-os", "crossmatch");
const DRY = process.argv.includes("--dry-run");

const b64 = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({
    iss: creds.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const s = createSign("RSA-SHA256");
  s.update(`${h}.${claim}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${h}.${claim}.${b64(s.sign(creds.private_key))}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return (await res.json()).access_token;
}

async function tab(token, name) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${LP_SHEET}/values/${encodeURIComponent(name)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  return (await res.json()).values ?? [];
}

/**
 * Both LP lists, folded to one firm per entry.
 *
 * THE SUPPRESSED TAB IS READ ON PURPOSE, and leaving it out was the first version's mistake. Her
 * active sequence contains 202 firms and not one of them overlaps the buyer candidates, so a run
 * over the Sent Log alone finds nothing and reports "no overlap" — which is false. The two real
 * overlaps in her data are both on the do-not-contact tab, because they were contacted for the fund
 * before this sequence began. That is the most interesting state a firm can be in and it is
 * invisible from the active list.
 */
function lpFirms(sentRows, blockedRows) {
  const firms = new Map();

  const touch = (name, list) => {
    const firm = String(name ?? "").trim();
    if (!firm || firm.toLowerCase() === "firm") return null;
    if (!firms.has(firm)) {
      firms.set(firm, { firm, list, contacts: 0, type: null, dripStages: new Set(), tiers: new Set(), first: null, last: null, notes: new Set(), addresses: [] });
    }
    const row = firms.get(firm);
    // A firm in the active sequence is described as such even if it also appears suppressed:
    // "I am emailing them right now" outranks "someone here was suppressed once".
    if (list === "sequence") row.list = "sequence";
    return row;
  };

  for (const r of sentRows) {
    const row = touch(r[3], "sequence");
    if (!row) continue;
    row.contacts++;
    if (String(r[5] ?? "").includes("@")) row.addresses.push(String(r[5]).trim());
    row.type ??= (r[4] ?? "").trim() || null;
    if ((r[7] ?? "").trim()) row.dripStages.add(String(r[7]).trim());
    if ((r[6] ?? "").trim()) row.tiers.add(String(r[6]).trim());
    const day = /^(\d{4}-\d{2}-\d{2})/.exec(String(r[0] ?? ""))?.[1] ?? null;
    if (day) {
      if (!row.first || day < row.first) row.first = day;
      if (!row.last || day > row.last) row.last = day;
    }
  }

  for (const r of blockedRows) {
    const row = touch(r[2], "suppressed");
    if (!row) continue;
    if (String(r[1] ?? "").includes("@")) row.addresses.push(String(r[1]).trim());
    if ((r[3] ?? "").trim()) row.notes.add(String(r[3]).trim());
    const day = /^(\d{4}-\d{2}-\d{2})/.exec(String(r[4] ?? ""))?.[1] ?? null;
    if (day && !row.last) row.last = day;
  }

  return [...firms.values()];
}

/**
 * The one sentence that says why this overlap matters.
 *
 * IT IS COMPOSED, NOT GENERATED BY A MODEL. Both jobs in this batch are computed and cost nothing
 * to run; a sentence worth $0.15 that says what four fields already say is not a better sentence.
 * It joins the two hats explicitly, because "same firm" without "and here is which side you are
 * already on" is a fact she still has to think about before it becomes useful.
 */
function why(candidate, lp) {
  const buyerSide = candidate.ticket_floor_usd
    ? `buys at $${Math.round(candidate.ticket_floor_usd / 1_000_000)}M and up`
    : "reads as a plausible buyer of late-stage secondaries";

  if (lp.list === "sequence") {
    const stage = [...lp.dripStages].sort().pop();
    const tier = [...lp.tiers].sort()[0];
    return (
      `Already in your LP sequence${stage ? ` at drip stage ${stage}` : ""}${tier ? `, signal tier ${tier}` : ""} — ` +
      `${lp.contacts} email${lp.contacts === 1 ? "" : "s"}${lp.last ? ` to ${lp.last}` : ""} — and on the buyer list because it ${buyerSide}. ` +
      `One firm, two asks: decide which thread goes first rather than running both into the same inbox.`
    );
  }

  const reason = [...lp.notes][0] ?? "suppressed";
  return (
    `On your LP do-not-contact list (${reason.toLowerCase()}), so West Peek cannot approach them for the fund — ` +
    `but it is on the buyer list because it ${buyerSide}, and the suppression is an LP decision that says ` +
    `nothing about a brokerage conversation. This is the warm-adjacent name the two lists were hiding from each other.`
  );
}

/** Candidate and firm positions are the only references a model may return. */
export async function readFirmCrossmatch(candidates, firms, { read } = {}) {
  const confirmed = [];
  const near = [];
  for (let start = 0; start < candidates.length; start += 20) {
    const buyers = candidates.slice(start, start + 20);
    for (let offset = 0; offset < firms.length; offset += 100) {
      const lpFirms = firms.slice(offset, offset + 100);
      const { matches } = await readDealObject({
        name: "firm_crossmatch",
        instruction: `Compare every buyer with every LP firm in the supplied page. Identify the
same entity even when its name, spelling, legal suffix or domain is different. Use confirmed only
where the evidence establishes the same entity. Use near for credible but uncertain overlap.
Return indexes into buyers and lpFirms (zero-based), and the label. Return an empty list for none.
Never infer a person's identity from the same first or last name or treat distinct affiliates as one.`,
        source: {
          buyers: buyers.map(({ name, domain, website, email }) => ({ name, domain, website, email })),
          lpFirms: lpFirms.map(({ firm, addresses }) => ({ firm, addresses })),
        },
        schema: { type: "object", required: ["matches"], properties: { matches: { type: "array", items: {
          type: "object", required: ["buyer", "lp", "confidence"], properties: {
            buyer: { type: "integer" }, lp: { type: "integer" },
            confidence: { type: "string", enum: ["confirmed", "near"] },
          },
        } } } },
        validate: ({ matches }) => Array.isArray(matches) && matches.every((match) => match
          && Number.isSafeInteger(match.buyer) && match.buyer >= 0 && match.buyer < buyers.length
          && Number.isSafeInteger(match.lp) && match.lp >= 0 && match.lp < lpFirms.length
          && ["confirmed", "near"].includes(match.confidence))
          && new Set(matches.map(({ buyer, lp }) => `${buyer}|${lp}`)).size === matches.length,
        read,
      });
      for (const { buyer, lp, confidence } of matches) {
        const row = { candidate: buyers[buyer], lp: lpFirms[lp], confidence, method: "source identity review", core: lpFirms[lp].firm };
        (confidence === "confirmed" ? confirmed : near).push(row);
      }
    }
  }
  return { confirmed, near };
}

async function main() {
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) throw new Error("No service account in the environment. Run this through `npm run crossmatch`.");

  const token = await accessToken(creds);
  const sent = await tab(token, "Sent Log");
  const blocked = await tab(token, "Blocked – Do Not Contact");
  if (!sent || !blocked) throw new Error("Could not read both LP source tabs; crossmatch is incomplete.");

  const firms = lpFirms(sent.slice(1), (blocked ?? []).slice(0));

  const cookie = await unlock();
  const sourcing = await getJson(`${ORIGIN}/api/boss/wealth/sourcing`, cookie);
  const candidates = sourcing.data.candidates ?? [];

  /*
   * RULE 0. An empty list on either side makes every comparison below vacuous, and a run over
   * nothing would exit 0 having reported "no overlaps found" — which is the same output as a real
   * clean run and would be believed.
   */
  if (candidates.length === 0 || firms.length === 0) {
    console.error(`Nothing to compare: ${candidates.length} buyer candidates against ${firms.length} LP firms.`);
    process.exitCode = 1;
    return;
  }

  const { confirmed, near } = await readFirmCrossmatch(candidates, firms);

  console.log(`${candidates.length} buyer candidates × ${firms.length} LP firms\n`);
  console.log(`CONFIRMED (${confirmed.length}) — same firm, safe to treat as one relationship`);
  for (const m of confirmed) console.log(`  ${m.candidate.name}\n    ↔ ${m.lp.firm} [${m.lp.list}]\n    ${why(m.candidate, m.lp)}`);
  console.log(`\nNEAR (${near.length}) — similar, NOT promoted, check by hand before assuming`);
  for (const m of near) console.log(`  ${m.candidate.name}  ≈  ${m.lp.firm}   (${m.method}, core "${m.core}")`);

  /*
   * The local file is the only place person-level detail is allowed to exist. It is written even on
   * a dry run, because the point of a dry run is to inspect what was found.
   */
  await mkdir(OUT_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const path = join(OUT_DIR, `${day}-lp-buyer-crossmatch.json`);
  await writeFile(path, JSON.stringify({
    generated_at: new Date().toISOString(),
    candidates: candidates.length,
    lp_firms: firms.length,
    confirmed: confirmed.map((m) => ({ candidate: m.candidate.name, lp_firm: m.lp.firm, list: m.lp.list, contacts: m.lp.contacts, method: m.method })),
    near: near.map((m) => ({ candidate: m.candidate.name, lp_firm: m.lp.firm, method: m.method, core: m.core })),
  }, null, 2));
  console.log(`\nLocal detail written to ${path}`);

  const runId = `xmr_${Date.now().toString(36)}`;
  const payload = [...confirmed, ...near].map((m) => ({
    candidate_id: m.candidate.id,
    candidate_name: m.candidate.name,
    lp_firm: m.lp.firm,
    matched_core: m.core,
    confidence: m.confidence,
    method: m.method,
    lp_list: m.lp.list,
    lp_contacts: m.lp.contacts,
    lp_type: m.lp.type,
    lp_drip_stage: [...m.lp.dripStages].sort().pop() ?? null,
    lp_signal_tier: [...m.lp.tiers].sort()[0] ?? null,
    lp_first_sent: m.lp.first,
    lp_last_sent: m.lp.last,
    lp_status_note: [...m.lp.notes][0] ?? null,
    why: m.confidence === "confirmed"
      ? why(m.candidate, m.lp)
      : `The available identity evidence is inconclusive for "${m.lp.firm}" (${m.method}). Check it yourself before treating it as one firm — a wrong warm intro costs more than a cold call.`,
  }));

  if (payload.length === 0) {
    console.log("\nNo overlaps at all. That is a real answer: her LP universe is endowments, foundations and pensions, and the buyer sweep hunts secondaries platforms.");
    return;
  }

  if (DRY) { console.log(`\nDRY RUN. ${payload.length} rows would be sent to ${ORIGIN}.`); return; }

  let recorded = 0;
  for (let offset = 0; offset < payload.length; offset += 200) {
    const res = await fetch(`${ORIGIN}/api/boss/wealth/crossmatches`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ matches: payload.slice(offset, offset + 200), run_id: runId }),
    });
    if (!res.ok) throw new Error(`cross-match post refused (${res.status})`);
    recorded += (await res.json()).data.recorded;
  }
  console.log(`\nRecorded ${recorded} rows. Review them on Capital → Buyers.`);
}

async function unlock() {
  const res = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!res.ok) throw new Error(`unlock failed (${res.status})`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function getJson(url, cookie) {
  const res = await fetch(url, { headers: { cookie } });
  if (!res.ok) throw new Error(`${url} failed (${res.status})`);
  return res.json();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => {
  console.error(`cross-match failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
