#!/usr/bin/env node
/**
 * THE BOUNCE READ FOR THE WEST PEEK MAILBOX (owner, 24 Oct 2026). Rules and the defect it ends:
 * src/shared/boss/lp/bounces.mjs.
 *
 * Every morning before anything sends from sequoia@westpeek.ventures (lp-daily.mjs at 06:15; Twin's
 * drip runs ~07:30 Central; lp-prospects.mjs at 09:30 runs it again):
 *   1. read every mailer-daemon / postmaster notice of the last LP_BOUNCE_DAYS (default 7; the
 *      first run, `--backfill`, 60) and take the permanently failed addresses;
 *   2. put each one Twin wrote to on Twin's Reply Queue tab (Twin stops the drip for those);
 *   3. put each one Twin or the prospect sequence wrote to on Boss OS suppression (checked before
 *      every prospect touch);
 *   4. append them to ~/.boss-os/lp/suppress.txt (the local list beside the opt-outs).
 * Addresses neither system wrote to are left alone: the mailbox carries other mail.
 *
 * Read-only Gmail; writes only with `--commit` (the launchd path passes it). Nothing is emailed.
 *
 *   npm run lp:bounces                       dry run: counts only
 *   npm run lp:bounces -- --commit           write
 *   npm run lp:bounces -- --commit --backfill   60 days
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hardBouncedAddresses, twinReplyQueueRows, twinReplyQueueFromReplies, sendsAfterBounce } from "../../src/shared/boss/lp/bounces.mjs";

const MAILBOX = "sequoia@westpeek.ventures";
const SHEET = process.env.LP_SOURCE_SHEET ?? "1Riww0SiaLb_vxHjUpruSdkNemBEndcQrDQgu7Ly9rRA";
const SENT_TAB = "Sent Log";
const REPLY_TAB = "Reply Queue";
const COMMIT = process.argv.includes("--commit");
const OUT_DIR = process.env.BOSS_OS_LP_DIR ?? path.join(os.homedir(), ".boss-os", "lp");

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function accessToken(creds, scope, sub) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // Sheets are shared with the service account itself (no `sub`); the mailbox is impersonated.
  const claims = b64url(JSON.stringify({ iss: creds.client_email, ...(sub ? { sub } : {}), scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(signer.sign(creds.private_key))}` }),
  });
  if (!res.ok) throw new Error(`NAMED STOP [NO_GRANT] token for ${scope.split("/").pop()} refused (${res.status})`);
  return (await res.json()).access_token;
}
const get = async (url, tok) => {
  const r = await fetch(url, { headers: { authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
};
const sheet = async (tok, range) => (await get(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(range)}`, tok)).values ?? [];

/** Headers and every text / delivery-status part of a Gmail message, decoded. */
function noticeText(msg) {
  const parts = (msg.payload?.headers ?? []).map((h) => `${h.name}: ${h.value}`);
  const walk = (p) => {
    if (p?.body?.data && /text|delivery-status|rfc822-headers/i.test(p.mimeType ?? "")) parts.push(Buffer.from(p.body.data, "base64").toString("utf8"));
    for (const c of p?.parts ?? []) walk(c);
  };
  walk(msg.payload);
  return parts.join("\n").slice(0, 200_000); // a notice ends long before this
}

async function pool(items, n, f) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await f(items[i++]); }));
}

/** Map(address → first hard-bounce ms) from the mailbox's notices of the last `days`. */
export async function readHardBounces(mailTok, days) {
  const ids = [];
  let page;
  do {
    const q = `in:anywhere newer_than:${days}d (from:mailer-daemon OR from:postmaster)`;
    const j = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500&q=${encodeURIComponent(q)}${page ? `&pageToken=${page}` : ""}`, mailTok);
    ids.push(...(j.messages ?? []).map((m) => m.id));
    page = j.nextPageToken;
  } while (page && ids.length < 5000);
  const hard = new Map();
  await pool(ids, 8, async (id) => {
    const msg = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, mailTok).catch(() => null);
    if (!msg) return;
    const at = Number(msg.internalDate ?? 0);
    for (const a of hardBouncedAddresses(noticeText(msg))) if (!hard.has(a) || hard.get(a) > at) hard.set(a, at);
  });
  return { hard, notices: ids.length };
}

/**
 * The whole read. `api` is bossApi() (null skips Boss OS). Returns counts; throws a NAMED STOP when
 * the Sent Log cannot be read, since then nothing could be matched.
 */
export async function syncBounces({ days = 7, commit = false, api = null, log = console.log } = {}) {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("NAMED STOP [NO_SERVICE_ACCOUNT] run through the vault: npm run lp:bounces");
  const creds = JSON.parse(raw);
  const mailTok = await accessToken(creds, "https://www.googleapis.com/auth/gmail.readonly", MAILBOX);
  const sheetTok = await accessToken(creds, commit ? "https://www.googleapis.com/auth/spreadsheets" : "https://www.googleapis.com/auth/spreadsheets.readonly", null);

  const sent = await sheet(sheetTok, `${SENT_TAB}!A1:J6000`);
  if (sent.length < 2) throw new Error(`NAMED STOP [NO_SENT_ROWS] Twin's ${SENT_TAB} returned ${sent.length} row(s); no bounce can be matched.`);
  const sentRows = sent.slice(1);
  const twin = new Set(sentRows.map((r) => String(r[5] ?? "").trim().toLowerCase()).filter((a) => a.includes("@")));
  const ours = new Set(twin);
  if (api) for (const r of (await api.get("/lp/prospects")).rows ?? []) if (r.email) ours.add(String(r.email).toLowerCase());

  const { hard: all, notices } = await readHardBounces(mailTok, days);
  const hard = new Map([...all].filter(([a]) => ours.has(a)));
  const queued = new Set((await sheet(sheetTok, `${REPLY_TAB}!A1:A3000`)).map((r) => String(r[0] ?? "").trim().toLowerCase()));
  const queueRows = twinReplyQueueRows({ sentRows, hard, queued });

  // The measurement: Twin sends logged after the address had already bounced (in this window).
  const after = sendsAfterBounce(sentRows.map((r) => ({ to: [r[5]], at: Date.parse(r[0]) })), hard);

  log(`bounces: ${notices} notice(s) in ${days} days, ${all.size} hard-bounced address(es), ${hard.size} written to by Twin or Monique; `
    + `${queueRows.length} new for Twin's Reply Queue; ${after.length} Twin send(s) in the window went after a bounce.`);

  const suppressPath = path.join(OUT_DIR, "suppress.txt");
  const existing = new Set(fs.existsSync(suppressPath) ? fs.readFileSync(suppressPath, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean) : []);
  const local = [...hard.keys()].filter((a) => !existing.has(a));
  if (!commit) {
    log(`DRY RUN: would queue ${queueRows.length} for Twin, suppress ${hard.size} in Boss OS, add ${local.length} to ${suppressPath}.`);
    return { notices, hard: hard.size, queued: 0, suppressed: 0, after: after.length };
  }
  if (queueRows.length) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`${REPLY_TAB}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST", headers: { authorization: `Bearer ${sheetTok}`, "content-type": "application/json" }, body: JSON.stringify({ values: queueRows }),
    });
    if (!res.ok) throw new Error(`NAMED STOP [REPLY_QUEUE_WRITE] Twin's Reply Queue refused the append (${res.status}); Twin would keep emailing ${queueRows.length} bounced address(es).`);
  }
  let suppressed = 0;
  if (api && hard.size) suppressed = (await api.post("/lp/prospects/suppress", { emails: [...hard.keys()], reason: "bounced" })).added ?? 0;
  if (local.length) { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.appendFileSync(suppressPath, `${local.join("\n")}\n`, { mode: 0o600 }); }
  log(`bounces written: ${queueRows.length} on Twin's Reply Queue, ${suppressed} newly suppressed in Boss OS, ${local.length} added to ${suppressPath}.`);
  return { notices, hard: hard.size, queued: queueRows.length, suppressed, after: after.length };
}

/**
 * REPLIES ON REPLY QUEUE, EVERY MORNING (1 Nov 2026; rules: twinReplyQueueFromReplies in
 * src/shared/boss/lp/bounces.mjs). `seenAddresses` is refreshPositive's read of the mailbox,
 * `people` its running positive list. Appends only rows not already on the tab; never removes one.
 */
export async function syncReplies({ seenAddresses, people = [], commit = false, log = console.log } = {}) {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("NAMED STOP [NO_SERVICE_ACCOUNT] run through the vault: npm run lp:daily");
  const replies = new Map(seenAddresses ?? []);
  for (const p of people ?? []) {
    const a = String(p.address ?? "").toLowerCase();
    if (a && !["call", "warm"].includes(replies.get(a)?.bucket)) replies.set(a, { bucket: p.bucket, when: p.first_seen, name: p.name });
  }
  const sheetTok = await accessToken(JSON.parse(raw), commit ? "https://www.googleapis.com/auth/spreadsheets" : "https://www.googleapis.com/auth/spreadsheets.readonly", null);
  const sentRows = (await sheet(sheetTok, `${SENT_TAB}!A1:J6000`)).slice(1);
  const queued = new Set((await sheet(sheetTok, `${REPLY_TAB}!A1:A3000`)).map((r) => String(r[0] ?? "").trim().toLowerCase()));
  const rows = twinReplyQueueFromReplies({ sentRows, replies, queued });
  if (!commit) { log(`DRY RUN: would queue ${rows.length} repl(ies) on the drip's Reply Queue.`); return { queued: 0, pending: rows.length }; }
  if (rows.length) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`${REPLY_TAB}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST", headers: { authorization: `Bearer ${sheetTok}`, "content-type": "application/json" }, body: JSON.stringify({ values: rows }),
    });
    if (!res.ok) throw new Error(`NAMED STOP [REPLY_QUEUE_WRITE] the drip's Reply Queue refused the append (${res.status}); ${rows.length} person(s) who wrote back would keep getting the drip.`);
  }
  log(`replies queued: ${rows.length} new on the drip's Reply Queue (counts only; names stay in the sheet).`);
  return { queued: rows.length, pending: 0 };
}

async function main() {
  const { bossApi } = await import("./lib/duty-kit.mjs");
  const commit = COMMIT;
  const days = process.argv.includes("--backfill") ? 60 : Number(process.env.LP_BOUNCE_DAYS ?? 7);
  const r = await syncBounces({ days, commit, api: await bossApi() });
  console.log(`LP-BOUNCES-COMPLETE: ${r.hard} bounced address(es) known, ${r.queued} queued for Twin, ${r.suppressed} newly suppressed.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LP-BOUNCES FAILED: ${err?.message ?? err}`); process.exit(1); });
}
