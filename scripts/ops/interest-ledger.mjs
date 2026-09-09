/**
 * THE INTEREST LEDGER — the market that is already in her mailbox, made structured.
 *
 * ─── What this is for ───────────────────────────────────────────────────────
 *
 * She brokers late-stage private secondaries at Rainmaker Securities. Supply and demand both arrive
 * in `staylor@spry.vc` and nothing connects them: somebody wanted SpaceX in March, somebody is
 * selling it this week, and the two facts sit four hundred messages apart in a mailbox of 104,241.
 *
 * THE MONITORING IS INCIDENTAL. THE MATCHING IS THE PRODUCT. And you cannot match on prose, so what
 * this produces is a structured ledger — principal, side, asset, size, date, confidence, the
 * co-broker who surfaced it, and the message it came from. Once that exists the matching is
 * arithmetic. Until it exists there is no product at all.
 *
 * ─── THIS FILE READS. IT DOES NOT DECIDE. ───────────────────────────────────
 *
 * The split between this script and `interest-extract.mjs` is deliberate and is the reason this one
 * can carry the same invariants its neighbours in `validate:gmail` carry. THIS FILE SENDS NOTHING TO
 * ANY MODEL. It reads the mailbox, applies a structural filter and a shape filter, and writes the
 * survivors to candidate batches on her Mac. `interest-extract.mjs` reads those batches and never
 * touches Gmail. Neither half can become the other, and each is checked for it.
 *
 * ─── The filter: two stages, and the order matters ──────────────────────────
 *
 * STAGE 1 THROWS AWAY BULK STRUCTURALLY, not by guessing at wording. The most reliable marker of a
 * marketing send is a HEADER: every legitimate bulk sender sets `List-Unsubscribe`, and a person
 * writing to her does not. Same for `List-Id`, `Precedence: bulk`, `Auto-Submitted`, no-reply
 * senders and out-of-office subjects. These are facts about the message, not judgements about it,
 * and they are read from headers alone — this stage never asks for a body.
 *
 * STAGE 2 REQUIRES THE SHAPE OF A TRADE: a SIZE and a SIDE.
 *   · SIZE is a dollar figure OR A SHARE COUNT. The share count is not an embellishment — "I have
 *     40k shares of X available" is exactly the inbound supply she wants and contains no dollars.
 *   · SIDE is the vocabulary of a secondary: buy, sell, shares, stock, secondary, block, allocation,
 *     tender, bid, ask.
 *
 * THERE IS NO LIST OF COMPANY NAMES ANYWHERE IN THIS FILE, and that is a design decision rather than
 * an omission. SpaceX, ByteDance, Stripe, Anthropic — a fixed list is guaranteed to miss next
 * quarter's name, and a missed name is a SILENT miss, which is the failure mode that has cost this
 * owner most. Money-plus-side-words catches companies nobody typed into a config. After one pass the
 * ledger itself becomes the name source, which sharpens later runs without the filter ever having
 * depended on it.
 *
 * ─── FILTER LOOSE, CLASSIFY TIGHT ──────────────────────────────────────────
 *
 * The pre-filter is nearly free, so borderline messages are let through and the model decides. A
 * regex tuned for precision silently drops real deals — that is exactly how a mailbox containing
 * "Happy to connect in the coming weeks" once reported zero positive replies. So the shape test is
 * generous, and the accounting below is what makes that safe: every message is accounted for by a
 * NAMED REASON, and the counts are printed.
 *
 * RULE 0, AND ITS SHARPEST EDGE. A discard rate near 100% is a bug wearing the costume of
 * efficiency. If this examines a mailbox with messages in it and keeps nothing, it exits non-zero
 * and says so, rather than reporting a clean sweep of an empty result.
 *
 * ─── What it writes, and where ─────────────────────────────────────────────
 *
 * `~/.boss-os/capital/` on her Mac. NOTHING GOES TO THE CLOUD. This is live transaction data at a
 * FINRA-registered broker-dealer and it is materially more sensitive than anything else in this
 * system: named counterparties, assets and sizes never reach the Boss OS database, not code-named
 * and not counted. The sync endpoint refuses any payload containing an `@` and that guard is not
 * bent here — it is simply not in this path.
 *
 * ─── NEVER SEND FROM spry.vc ───────────────────────────────────────────────
 *
 * Her instruction: "monique can read spry.vc she just cant send from it". No send scope was ever
 * granted and spry.vc is not verified in either Resend account, so it is already true by
 * construction — and `validate:no-spry-sender` fails the build if it ever stops being, because a
 * rule that lives only in someone's memory is a rule with a six-month expiry.
 *
 *   npm run capital:scan                     # incremental — since the last scan
 *   npm run capital:scan -- --backfill       # the whole history, however far back
 *   npm run capital:scan -- --since 2025/01/01
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * THE MAILBOX IS A NAMED CONSTANT AND IT IS PUT IN THE JWT's `sub` CLAIM, so it cannot silently
 * become a different one. An earlier attempt in this repository routed a brokerage question through
 * the claude.ai connector, which is bound to her PERSONAL account: it searched the wrong mailbox and
 * filed a confident, quiet, wrong answer.
 */
const MAILBOX = process.env.BROKERAGE_MAILBOX ?? "staylor@spry.vc";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const BATCH_DIR = path.join(DIR, "candidates");
const SCAN_FILE = path.join(DIR, "scan.json");
const STATE_FILE = path.join(DIR, "scan-state.json");

const ARGS = process.argv.slice(2);
const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : (ARGS[i + 1] ?? null); };
const BACKFILL = ARGS.includes("--backfill");
const SINCE = argOf("since");
const CONCURRENCY = Number(process.env.CAPITAL_CONCURRENCY ?? 12);
const MAX_FETCH = Number(process.env.CAPITAL_MAX_FETCH ?? 200_000);
const BATCH_SIZE = Number(process.env.CAPITAL_BATCH_SIZE ?? 12);

/** How much of one message is ever held in memory. A pitch deck must not be read whole. */
const BODY_BOUND = 200_000;
/** How much of one message is ever written to a candidate batch. */
const EXCERPT_BOUND = 6_000;

// ─── Google, impersonating the named mailbox ─────────────────────────────────

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email, sub: MAILBOX, scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(signer.sign(creds.private_key))}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

// ─── The two stages, as pure functions so the validator's self-test can reach them ───

/**
 * STAGE 1 — structural bulk. Facts about the message, never a judgement about its wording.
 *
 * Returns a NAMED REASON or null. The name is what lets the run report what it dropped: "99.9%
 * discarded" is only a bug you can see if the discard is itemised.
 */
export function bulkReason(headers) {
  const h = (name) => headers[name.toLowerCase()] ?? "";
  if (h("list-unsubscribe")) return "bulk_list_unsubscribe";
  if (h("list-id")) return "bulk_list_id";
  if (/\bbulk\b|\blist\b|\bjunk\b/i.test(h("precedence"))) return "bulk_precedence";
  if (h("auto-submitted") && !/^no$/i.test(h("auto-submitted").trim())) return "bulk_auto_submitted";
  if (h("x-autoreply") || h("x-autorespond")) return "bulk_autoresponder";
  const from = h("from").toLowerCase();
  if (/(^|<)\s*(no-?reply|do-?not-?reply|donotreply|notifications?|mailer-daemon|postmaster|bounce)[.\-+_a-z0-9]*@/i.test(from)) {
    return "bulk_noreply_sender";
  }
  if (/@(mailchimp|sendgrid|substack|beehiiv|hubspot|constantcontact|mailgun|salesforce|marketo)\b/i.test(from)) {
    return "bulk_marketing_platform";
  }
  const subject = h("subject");
  if (/\b(out of (the )?office|automatic reply|auto.?reply|autoresponder|undeliverable|delivery status notification|undelivered mail|returned mail|failure notice)\b/i.test(subject)) {
    return "bulk_auto_subject";
  }
  return null;
}

/**
 * SIZE — a dollar figure OR a share count.
 *
 * The share count is half of this test, not a nicety. "I have 40k shares of X available" is inbound
 * supply with no dollars in it anywhere, and a money-only filter loses every one of them.
 */
export const SIZE_RE = new RegExp(
  [
    // $250M, $2.5bn, $1,200,000, USD 40m
    String.raw`(?:\$|\busd\b|\beur\b|\bgbp\b)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|mm|bn|b|million|billion|thousand)?`,
    // 40k shares, 500,000 shares, 1.2m shares, 12,000 sh
    String.raw`\b\d[\d,]*(?:\.\d+)?\s?(?:k|m|mm|bn|b|million|billion|thousand)?\s*(?:shares?|sh\b|units?)`,
    // "up to 2bn of", "$250m block" written as "250mm of"
    String.raw`\b\d[\d,]*(?:\.\d+)?\s?(?:mm|bn|million|billion)\b`,
  ].join("|"),
  "i",
);

/** SIDE — the vocabulary of a secondary. Not company names: those are what we are trying to learn. */
export const SIDE_RE =
  /\b(buy(?:er|ers|ing|side)?|sell(?:er|ers|ing|side)?|shares?|stock|secondar(?:y|ies)|block|allocation|alloc\b|tender|bid|ask|offer|indication of interest|\bIOI\b|SPV|forward(?: contract)?|cap table|common|preferred|mandate|inventory|available)\b/i;

/**
 * STAGE 2 — the shape of a trade. Returns a named reason for a drop, or null to keep.
 *
 * DELIBERATELY GENEROUS. A borderline message costs a fraction of a cent at the model; a dropped one
 * costs a deal she never learns she missed. Precision is the matcher's job, not the filter's.
 */
export function shapeReason(text) {
  const t = text.slice(0, 20_000);
  const hasSize = SIZE_RE.test(t);
  const hasSide = SIDE_RE.test(t);
  if (!hasSize && !hasSide) return "shape_no_size_no_side";
  if (!hasSize) return "shape_no_size";
  if (!hasSide) return "shape_no_side";
  return null;
}

// ─── Reading a message ───────────────────────────────────────────────────────

const headerMap = (msg) => {
  const out = {};
  for (const h of msg?.payload?.headers ?? []) out[h.name.toLowerCase()] = h.value ?? "";
  return out;
};

/** The readable text of a MIME tree, preferring text/plain, honouring the part's own encoding. */
export function textOf(payload, depth = 0) {
  if (!payload || depth > 8) return "";
  const mime = payload.mimeType ?? "";
  if (payload.body?.data && /^text\/(plain|html)/.test(mime)) {
    const raw = Buffer.from(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64")
      .toString("utf8").slice(0, BODY_BOUND);
    return mime.includes("html")
      ? raw.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      : raw;
  }
  const parts = payload.parts ?? [];
  const plain = parts.filter((p) => (p.mimeType ?? "").startsWith("text/plain"));
  const chosen = plain.length ? plain : parts;
  return chosen.map((p) => textOf(p, depth + 1)).join("\n").slice(0, BODY_BOUND);
}

/**
 * Her own quoted mail, removed before the shape test.
 *
 * Every reply carries her previous message underneath it. A thread where she once wrote "$250m of
 * SpaceX" would then match the shape test for ever, on every reply, including "thanks" — and the
 * ledger would fill with interests nobody expressed.
 */
export function withoutQuoted(text) {
  return text
    .split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join("\n")
    .split(/^\s*(on .{0,120}wrote:|-+\s*original message\s*-+|from:\s.*sent:\s)/im)[0]
    .replace(/[ \t]+/g, " ")
    .trim();
}

const addressIn = (raw) => (String(raw).match(/[\w.+'-]+@[\w.-]+\.\w+/) ?? [""])[0].toLowerCase();

// ─── Concurrency, bounded and polite ─────────────────────────────────────────

async function pooled(items, limit, worker) {
  const it = items[Symbol.iterator]();
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    for (;;) {
      const next = it.next();
      if (next.done) return;
      await worker(next.value);
    }
  });
  await Promise.all(runners);
}

async function api(url, token, tries = 4) {
  for (let i = 0; i < tries; i += 1) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 400 * 2 ** i + Math.random() * 300));
      continue;
    }
    return null;
  }
  return null;
}

async function listIds(token, q, cap) {
  const ids = [];
  let page;
  do {
    const j = await api(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500&q=${encodeURIComponent(q)}`
      + (page ? `&pageToken=${page}` : ""), token);
    if (!j) break;
    for (const m of j.messages ?? []) ids.push(m.id);
    page = j.nextPageToken;
  } while (page && ids.length < cap);
  return ids;
}

// ─── The run ─────────────────────────────────────────────────────────────────

/**
 * The Gmail-side half of stage 2, run in Gmail's own index so that 104,241 messages do not have to
 * be fetched to discover that most of them are not about a trade.
 *
 * IT IS THE LOOSE HALF ON PURPOSE — side vocabulary only, no company names, no money (Gmail's index
 * does not tokenise `$`). The tight half runs locally over the body, where a share count is legible.
 * The count it discards is reported as its own named reason, because a filter whose largest drop is
 * invisible is a filter nobody can audit.
 */
const GMAIL_SHAPE =
  '{secondary secondaries block allocation tender bid ask shares stock SPV "cap table" indication buyer seller buying selling mandate}';

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}

async function main() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error("NAMED STOP [NO_SERVICE_ACCOUNT] run through the vault: npm run capital:scan");
    process.exit(4);
  }
  const token = await accessToken(JSON.parse(raw));

  const state = loadState();
  const since = SINCE ?? (BACKFILL ? null : state.last_scanned_date ?? null);
  const window = since ? `after:${since}` : "";
  const scope = `in:anywhere -in:chats -in:drafts ${window}`.trim();

  console.log(`Mailbox ${MAILBOX} — ${since ? `since ${since}` : "the whole history"}.`);

  // ─── Stage 0: the census. Everything the window contains, before any judgement. ───
  const census = (await listIds(token, scope, MAX_FETCH)).length;
  if (census === 0) {
    console.error(`NAMED STOP [EMPTY_CENSUS] "${scope}" returned no messages at all.`);
    console.error("  A mailbox of 104,241 messages does not become empty. This is a broken read —");
    console.error("  a revoked delegation, a changed address, or a malformed query — not a quiet week.");
    process.exit(6);
  }

  // ─── Stage A: side vocabulary, in Gmail's index ───
  const candidateIds = await listIds(token, `${scope} ${GMAIL_SHAPE}`, MAX_FETCH);
  const drops = { gmail_no_trade_vocabulary: census - candidateIds.length };
  console.log(`census ${census}  →  ${candidateIds.length} carry secondary-market vocabulary`);

  // ─── Stage 1: structural bulk, from HEADERS ONLY. This pass never asks for a body. ───
  const survivors = [];
  let headerFailures = 0;
  const HDRS = ["From", "To", "Cc", "Date", "Subject", "List-Unsubscribe", "List-Id",
                "Precedence", "Auto-Submitted", "X-Autoreply", "X-Autorespond", "Message-Id"];
  const metaUrl = (id) =>
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&`
    + HDRS.map((h) => `metadataHeaders=${h}`).join("&");

  let seen = 0;
  await pooled(candidateIds, CONCURRENCY, async (id) => {
    const msg = await api(metaUrl(id), token);
    seen += 1;
    if (seen % 2000 === 0) process.stdout.write(`  headers ${seen}/${candidateIds.length}\r`);
    if (!msg) { headerFailures += 1; return; }
    const h = headerMap(msg);
    const reason = bulkReason(h);
    if (reason) { drops[reason] = (drops[reason] ?? 0) + 1; return; }
    survivors.push({ id, h, ts: Number(msg.internalDate ?? 0) });
  });
  if (headerFailures) drops.header_fetch_failed = headerFailures;
  console.log(`\nstage 1 (headers only, structural): ${survivors.length} of ${candidateIds.length} are not bulk`);

  // ─── Stage 2: the shape of a trade, over the decoded body ───
  const kept = [];
  let bodyFailures = 0;
  let done = 0;
  await pooled(survivors, CONCURRENCY, async (s) => {
    const msg = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${s.id}?format=full`, token);
    done += 1;
    if (done % 1000 === 0) process.stdout.write(`  bodies ${done}/${survivors.length}\r`);
    if (!msg) { bodyFailures += 1; return; }
    const body = withoutQuoted(textOf(msg.payload));
    const subject = s.h.subject ?? "";
    const reason = shapeReason(`${subject}\n${body}`);
    if (reason) { drops[reason] = (drops[reason] ?? 0) + 1; return; }
    const from = addressIn(s.h.from);
    kept.push({
      // The Gmail id is the source of record. It says nothing to anyone who cannot already read the
      // mailbox, and it lets her open the real thread on this machine in one click.
      source_message: s.id,
      date: new Date(s.ts || Date.now()).toISOString().slice(0, 10),
      from,
      from_name: (String(s.h.from).match(/^\s*"?([^"<]{2,60}?)"?\s*</) ?? ["", ""])[1].trim(),
      to: String(s.h.to ?? "").split(",").map(addressIn).filter(Boolean).slice(0, 8),
      cc: String(s.h.cc ?? "").split(",").map(addressIn).filter(Boolean).slice(0, 8),
      outbound: from === MAILBOX.toLowerCase(),
      subject: subject.slice(0, 200),
      excerpt: body.slice(0, EXCERPT_BOUND),
    });
  });
  if (bodyFailures) drops.body_fetch_failed = bodyFailures;

  // ─── The accounting. Every message ends in exactly one named bucket. ───
  const dropped = Object.values(drops).reduce((a, b) => a + b, 0);
  const pct = ((dropped / census) * 100).toFixed(2);
  console.log(`\nstage 2 (size AND side, over the body): ${kept.length} candidate interest(s)\n`);
  console.log(`WHAT THE FILTER DISCARDED — ${dropped} of ${census} (${pct}%)`);
  for (const [reason, n] of Object.entries(drops).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(7)}  ${reason}`);
  }
  console.log(`  ${String(kept.length).padStart(7)}  KEPT — passed to extraction`);
  if (dropped + kept.length !== census) {
    console.error(`\nNAMED STOP [UNACCOUNTED] ${census - dropped - kept.length} message(s) are in no bucket.`);
    console.error("  A filter that cannot say where every message went cannot be audited, and an");
    console.error("  unaudited filter is how a real deal disappears without anyone noticing.");
    process.exit(7);
  }

  /*
   * RULE 0, ITS SHARPEST EDGE. A discard rate at or near 100% is a bug wearing the costume of
   * efficiency: it looks like a clean, fast run and it is a mailbox that was never read.
   */
  if (kept.length === 0) {
    console.error("\nNAMED STOP [FILTER_DISCARDED_EVERYTHING] the filter kept nothing out of "
      + `${census} message(s).`);
    console.error("  This is a broken filter, not an empty market. The reasons above say which stage");
    console.error("  ate everything. Do not soften the model's threshold to compensate — fix the stage.");
    process.exit(8);
  }

  // ─── Written locally, in batches, and nowhere else ───
  fs.rmSync(BATCH_DIR, { recursive: true, force: true });
  fs.mkdirSync(BATCH_DIR, { recursive: true });
  kept.sort((a, b) => a.date.localeCompare(b.date));
  let batches = 0;
  for (let i = 0; i < kept.length; i += BATCH_SIZE) {
    const name = `batch-${String(batches).padStart(5, "0")}.json`;
    fs.writeFileSync(path.join(BATCH_DIR, name), JSON.stringify(kept.slice(i, i + BATCH_SIZE)), "utf8");
    batches += 1;
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  fs.writeFileSync(SCAN_FILE, JSON.stringify({
    scanned_at: new Date().toISOString(),
    mailbox: MAILBOX,
    window: since ? `after:${since}` : "the whole history",
    census, kept: kept.length, dropped, discard_pct: Number(pct), drops, batches,
  }, null, 2), "utf8");
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    last_scanned_date: today, last_census: census, last_kept: kept.length,
  }, null, 2), "utf8");

  console.log(`\n${batches} batch(es) in ${BATCH_DIR}. Nothing was sent anywhere.`);
  console.log(`CAPITAL-SCAN-COMPLETE: ${kept.length} candidate(s) from ${census} message(s), ${pct}% discarded`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`CAPITAL SCAN FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
