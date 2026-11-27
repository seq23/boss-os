/** Read brokerage mail on the Mac, classify complete threads, and keep candidates for extraction.
 *
 * npm run capital:scan                    # resume the current window, or start after the last one
 * npm run capital:scan -- --backfill      # start with the whole mailbox history
 * npm run capital:scan -- --since 2026/10/01
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { gmailPayloadText } from "../../src/shared/boss/mail/gmailPayload.mjs";
import { CENTRAL, instantAt } from "../../src/shared/boss/schedule/clock.mjs";
import { readWorkerSource } from "../../src/worker/boss/router/freeModel.ts";
import { readJsonObject } from "../../src/worker/boss/router/types.ts";

/**
 * THE MAILBOX IS A NAMED CONSTANT AND IT IS PUT IN THE JWT's `sub` CLAIM, so it cannot silently
 * become a different one. An earlier attempt in this repository routed a brokerage question through
 * the claude.ai connector, which is bound to her PERSONAL account: it searched the wrong mailbox and
 * filed a confident, quiet, wrong answer.
 */
const MAILBOX = process.env.BROKERAGE_MAILBOX ?? "staylor@spry.vc";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");

const ARGS = process.argv.slice(2);
const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : (ARGS[i + 1] ?? null); };
const BACKFILL = ARGS.includes("--backfill");
/** Fill in who sent each ledger row the extract never recorded a sender for (23 Oct 2026). Headers only. */
const SENDERS_BACKFILL = ARGS.includes("--senders");
/** Her firm's internal list. What SHE sends here is her own supply and demand: "Yours" on the grid. */
const RRLIST = (process.env.RRLIST_ADDRESS ?? "rrlist@rainmakersecurities.com").toLowerCase();
const SINCE = argOf("since");
const CONCURRENCY = Number(process.env.CAPITAL_CONCURRENCY ?? 8);
const EXCERPT_BOUND = 6_000; // Existing extractors read this field; the complete thread is also saved.
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

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
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return (await res.json()).access_token;
}

const headerMap = (msg) => Object.fromEntries(
  (msg?.payload?.headers ?? []).map(({ name, value }) => [name.toLowerCase(), value ?? ""]),
);

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

// Gmail mails can take more than an hour to read. Refresh expired credentials and retry throttles.
let CREDS = null;
let TOKEN = { value: null, mintedAt: 0 };
/** Well inside Google's hour, so a long body pass never straddles the expiry. */
const TOKEN_MAX_AGE_MS = 40 * 60 * 1000;

async function liveToken(force = false) {
  if (force || !TOKEN.value || Date.now() - TOKEN.mintedAt > TOKEN_MAX_AGE_MS) {
    TOKEN = { value: await accessToken(CREDS), mintedAt: Date.now() };
  }
  return TOKEN.value;
}

async function api(url, tries = 8) {
  for (let i = 0; i < tries; i += 1) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${await liveToken()}` } });
    if (r.ok) return r.json();
    if (r.status === 401) {
      // Dead credential, not a busy one. Mint a new one and try again at once.
      await liveToken(true);
      continue;
    }
    if (r.status === 403 || r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, Math.min(30_000, 800 * 2 ** i) + Math.random() * 500));
      continue;
    }
    return null;
  }
  return null;
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

function writeJson(file, data) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}

function sinceInstant(date) {
  const [year, month, day] = date.split(/[-/]/).map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (!/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(date) || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day) {
    throw new Error("Pass --since YYYY/MM/DD");
  }
  return instantAt(CENTRAL, year, month, day);
}

async function listThreadTargets(api, query) {
  const threads = new Map();
  let page;
  do {
    const params = new URLSearchParams({ q: query, maxResults: "500" });
    if (page) params.set("pageToken", page);
    const result = await api(`${GMAIL}/messages?${params}`);
    if (!result) throw new Error("Gmail listing was incomplete");
    for (const message of result.messages ?? []) {
      if (!message.threadId || !message.id) throw new Error("Gmail omitted a message identifier");
      if (!threads.has(message.threadId)) threads.set(message.threadId, new Set());
      threads.get(message.threadId).add(message.id);
    }
    page = result.nextPageToken;
  } while (page);
  return [...threads].reverse().map(([thread, ids]) => [thread, [...ids]]);
}

const INSTRUCTION = `Read this brokerage thread. Give one decision per target message ID. Prior messages
and quoted or forwarded text can identify the company and terms a target is responding to. Classify
what the target itself adds. Only classify "candidate" for a new, renewed, relayed or accepted buy
or sell interest in a private company, including short replies whose meaning comes from the thread.
Look for interest even without a stated size or standard terminology. Bulk headers and sender
identities do not disqualify it. Be careful with quoted text: a thank-you that merely repeats an old
interest is not a fresh interest. Use "other" for a clear non-match and "uncertain" when you cannot
decide. Return JSON mapping each target ID to candidate, other or uncertain, with no extra keys.`;

function decisionsOf(text, ids) {
  const decisions = readJsonObject(text);
  if (!decisions || Object.keys(decisions).length !== ids.length) return null;
  return ids.every((id) => ["candidate", "other"].includes(decisions[id])) ? decisions : null;
}

export async function scanBrokerage({ directory, mailbox, api, read, now = Date.now(), since, backfill }) {
  const batchDir = path.join(directory, "candidates");
  const stateFile = path.join(directory, "scan-state.json");
  const scanFile = path.join(directory, "scan.json");
  fs.mkdirSync(batchDir, { recursive: true, mode: 0o700 });
  const state = readState(stateFile);
  const start = since ? sinceInstant(since)
    : backfill ? 0 : state.last_scanned_at ?? (state.last_scanned_date ? sinceInstant(state.last_scanned_date) : 0);
  // Keep both ends fixed even when the next attempt runs on another day. Record completed message
  // IDs inside that window, so a quota stop doesn't make tomorrow reread today's completed work.
  const active = state.active ?? { start, end: Math.floor(now / 1000) * 1000, manual: Boolean(since || backfill), completed: {} };
  if (active.start > active.end) throw new Error("The scan begins after its end");
  if (!state.active) writeJson(stateFile, { ...state, active });
  const query = `in:anywhere -in:drafts -in:chats after:${Math.max(0, active.start / 1000 - 1)} before:${active.end / 1000}`;
  if (!active.targets) {
    active.targets = await listThreadTargets(api, query);
    writeJson(stateFile, { ...state, active });
  }
  const threads = active.targets;
  const completed = new Map(Object.entries(active.completed));
  let census = 0;
  for (const [, ids] of threads) census += ids.length;
  let kept = 0;
  let dropped = 0;
  let status = "complete";
  for (const [threadId, ids] of threads) {
    const remaining = ids.filter((id) => !completed.has(id));
    if (remaining.length) {
      const raw = await api(`${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
      if (!Array.isArray(raw?.messages) || remaining.some((id) => !raw.messages.some((message) => message.id === id))) {
        throw new Error("Gmail thread did not include every listed target");
      }
      const thread = [];
      for (const message of raw.messages) {
        if (!message.payload) throw new Error("Gmail omitted a message payload");
        const body = await gmailPayloadText(message.payload, async (attachmentId) => {
          const attachment = await api(`${GMAIL}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachmentId)}`);
          if (!attachment?.data) throw new Error("Gmail omitted a readable MIME part");
          return attachment.data;
        });
        thread.push({ id: message.id, at: Number(message.internalDate), headers: headerMap(message), body });
      }
      if (thread.some((message) => !message.id || !Number.isFinite(message.at))) throw new Error("Gmail omitted a thread message ID or date");
      const targets = remaining.filter((id) => {
        const { at } = thread.find((message) => message.id === id);
        return at >= active.start && at < active.end;
      });
      if (targets.length) {
        const result = await read({
          worker: "monique",
          instruction: INSTRUCTION,
          source: JSON.stringify({ targetMessageIds: targets, thread }),
          maxOutputTokens: 4096,
          json: {
            name: "deal_mail_decisions",
            schema: {
              type: "object",
              properties: Object.fromEntries(targets.map((id) => [id, { type: "string", enum: ["candidate", "other", "uncertain"] }])),
              required: targets,
            },
          },
          accept: (text) => Boolean(decisionsOf(text, targets)),
        });
        const decisions = result.status === "ok" ? decisionsOf(result.text, targets) : null;
        if (!decisions) {
          status = result.status === "allowance-exhausted" ? result.status : "unavailable";
          break;
        }
        const batch = thread.filter((message) => decisions[message.id] === "candidate").map((message) => {
          const { from: author, to, cc, subject } = message.headers;
          const from = addressIn(author);
          return {
            source_message: message.id,
            date: new Date(message.at).toISOString().slice(0, 10),
            from,
            from_name: (String(author).match(/^\s*"?([^"<]{2,60}?)"?\s*</) ?? ["", ""])[1].trim(),
            to: String(to ?? "").split(",").map(addressIn).filter(Boolean),
            cc: String(cc ?? "").split(",").map(addressIn).filter(Boolean),
            outbound: from === mailbox.toLowerCase(),
            subject: subject ?? "",
            excerpt: message.body.slice(0, EXCERPT_BOUND),
            thread,
          };
        });
        if (batch.length) {
          const key = crypto.createHash("sha256").update(JSON.stringify(batch.map((message) => message.source_message).sort())).digest("hex");
          const file = path.join(batchDir, `thread-${key}.json`);
          if (!fs.existsSync(file)) writeJson(file, batch);
        }
        for (const id of targets) completed.set(id, decisions[id]);
      }
      for (const id of remaining) if (!completed.has(id)) completed.set(id, "outside_window");
      active.completed = Object.fromEntries(completed);
      writeJson(stateFile, { ...state, active });
    }
    for (const id of ids) {
      if (completed.get(id) === "candidate") kept += 1;
      else dropped += 1;
    }
  }
  const report = {
    status, scanned_at: new Date(now).toISOString(), window: { start: active.start, end: active.end },
    census, kept, dropped, never_read: census - kept - dropped,
    drops: { no_new_interest_or_outside_window: dropped },
  };
  writeJson(scanFile, report);
  if (status === "complete") {
    writeJson(stateFile, { last_scanned_at: active.manual && (state.last_scanned_at ?? state.last_scanned_date)
      ? (state.last_scanned_at ?? sinceInstant(state.last_scanned_date)) : active.end });
  }
  return report;
}

/**
 * `--senders`: the ledger rows written before the extract kept a sender. For each one, the From, To
 * and Cc HEADERS only (format=metadata, no body), merged into `senders.json` — so the grid can say who
 * a deal came from and which of her own rows went to rrlist@. Added to, never trimmed.
 */
async function backfillSenders() {
  const LEDGER = path.join(DIR, "ledger.json");
  const SENDERS = path.join(DIR, "senders.json");
  const ids = new Set((JSON.parse(fs.readFileSync(LEDGER, "utf8")).interests ?? []).map((r) => r.source_message).filter(Boolean));
  let have = {};
  try { have = JSON.parse(fs.readFileSync(SENDERS, "utf8")).senders ?? {}; } catch { /* first run */ }
  const todo = [...ids].filter((id) => !have[id]);
  console.log(`${ids.size} ledger message(s), ${todo.length} without a sender.`);
  let failed = 0;
  await pooled(todo, CONCURRENCY, async (id) => {
    const msg = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`);
    if (!msg) { failed += 1; return; }
    const h = headerMap(msg);
    const from = addressIn(h.from);
    const to = [...String(h.to ?? "").split(","), ...String(h.cc ?? "").split(",")].map(addressIn).filter(Boolean);
    have[id] = {
      from,
      from_name: (String(h.from).match(/^\s*"?([^"<]{2,60}?)"?\s*</) ?? ["", ""])[1].trim() || null,
      to_rrlist: to.includes(RRLIST),
      outbound: from === MAILBOX.toLowerCase(),
    };
  });
  fs.writeFileSync(SENDERS, JSON.stringify({ updated_at: new Date().toISOString(), senders: have }), "utf8");
  console.log(`CAPITAL-SENDERS-COMPLETE: ${todo.length - failed} filled, ${failed} could not be read (retried next run).`);
}

async function main() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error("NAMED STOP [NO_SERVICE_ACCOUNT] run through the vault: npm run capital:scan");
    process.exit(4);
  }
  CREDS = JSON.parse(raw);
  if (SENDERS_BACKFILL) { await backfillSenders(); return; }
  const result = await scanBrokerage({
    directory: DIR, mailbox: MAILBOX, api,
    read: (input) => readWorkerSource(input, process.env),
    since: SINCE, backfill: BACKFILL,
  });
  console.log(`OUTPUT ${result.kept + result.dropped} brokerage messages assessed`);
  console.log(`CAPITAL-SCAN ${result.status}: ${result.kept} candidate(s), ${result.dropped} other, ${result.never_read} unread of ${result.census}.`);
  if (result.status !== "complete") {
    console.error(result.status === "allowance-exhausted"
      ? "NAMED STOP [FREE_ALLOWANCE_EXHAUSTED] The open window will resume on the next scan."
      : "NAMED STOP [CAPITAL_SCAN_UNREAD] The open window will resume on the next scan.");
    process.exitCode = 10;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`NAMED STOP [CAPITAL_SCAN_UNREAD] Could not check: ${err?.message ?? err}`); process.exitCode = 1; });
}
