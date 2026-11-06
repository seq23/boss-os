#!/usr/bin/env node
/**
 * EMAILS TO HER THAT FAIL, IN EVERY APP, SAID OUT LOUD (owner, 6 Nov 2026: "An email to her that
 * fails is an alarm, not a log line"). Duty `duty_owner_mail_watch` (Kendra), launchd
 * `com.seq.boss-owner-mail-watch`, 07:50 and 15:50 Central, through duty-run.sh.
 *
 * Why: Wynn's Resend key was dead 2-6 Nov 2026. West Peek OS recorded 236 owner emails not sent
 * (`deliverable.email_not_sent`, "resend rejected the send (HTTP 401)") and nobody was told.
 *
 * What it reads, read-only, last 7 days:
 *   West Peek OS  D1 `event_record`: `*email_not_sent` (failed) and `*emailed*` (sent), wrangler from
 *                 ~/GitHub/west-peek-os under its vault. Owner-bound = `to` is one of her addresses.
 *   Boss OS       D1 `boss_task_notices` (sent / error), `boss_sent_mail` (sent / failed, to her), and
 *                 the Mac's held mail (~/.boss-os/held-mail: a send the plain-email gate refused).
 *   p-n-p         records no mail failures anywhere durable: named "not read", never counted as clean.
 *
 * Her addresses live in ~/.boss-os/owner-mail/addresses.txt (one per line), never in this public
 * repo. None there = NAMED STOP [NO_OWNER_ADDRESSES] exit 2.
 *
 * A series (app + subject kind) whose newest 2 attempts both failed raises one Kendra alarm through
 * POST /api/boss/alarms with the app, the subject kind and the error class; never a body or an
 * address. An auth failure (401/403) is `hers`: only she can renew the key, so it shows on Today.
 * A series whose newest send went is cleared.
 *
 * Census: `OUTPUT <n> apps read` (the floor is 2). An app it could not read is named.
 *   npm run owner-mail:watch            (live: raises and clears)
 *   npm run owner-mail:watch -- --dry   (prints what it would raise)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bossApi } from "./lib/duty-kit.mjs";
import { ownerMailVerdicts, ownerMailText, outputLine, appSlug } from "../../src/shared/boss/alarms/rules.mjs";

const HOME = os.homedir();
const GITHUB = process.env.BOSS_GITHUB_DIR ?? path.join(HOME, "GitHub");
const ADDRESSES = process.env.OWNER_MAIL_ADDRESSES ?? path.join(HOME, ".boss-os", "owner-mail", "addresses.txt");
const HELD = process.env.BOSS_OS_HELD_MAIL_DIR ?? path.join(HOME, ".boss-os", "held-mail");
const DAYS = 7;

/** Her addresses, lower-cased. Pure over the file's text. */
export function readAddresses(text) {
  return new Set(String(text ?? "").split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#") && l.includes("@")));
}

/** One D1 read through wrangler, JSON rows back. Throws with the reason on any failure. */
function d1(repoDir, db, sql) {
  const out = execFileSync("npm", ["run", "-s", "vault:run", "--", "npx", "wrangler", "d1", "execute", db, "--remote", "--env", "production", "--json", "--command", sql], {
    cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 << 20, timeout: 120_000,
  });
  const i = out.indexOf("[");
  if (i < 0) throw new Error("wrangler returned no JSON");
  return JSON.parse(out.slice(i))[0]?.results ?? [];
}

/** West Peek OS events → attempts. Pure. */
export function wposAttempts(rows, owner) {
  const out = [];
  for (const r of rows ?? []) {
    const to = String(r.to_addr ?? "").toLowerCase();
    if (!owner.has(to)) continue;
    out.push({ app: "West Peek OS", subject: r.subject ?? r.event_type, ok: !/not_sent$/.test(r.event_type), detail: r.detail, at: String(r.created_at) });
  }
  return out;
}

/** Boss OS notices, sent mail and held mail → attempts. Pure. */
export function bossAttempts({ notices = [], sent = [], held = [] }, owner) {
  const out = [];
  for (const n of notices) {
    if (n.sent_at) out.push({ app: "Boss OS", subject: n.subject, ok: true, at: new Date(Number(n.sent_at)).toISOString() });
    else if (n.error) out.push({ app: "Boss OS", subject: n.subject, ok: false, detail: n.error, at: new Date(Number(n.created_at)).toISOString() });
  }
  for (const m of sent) {
    if (!owner.has(String(m.to_addr ?? "").toLowerCase())) continue;
    out.push({ app: "Boss OS", subject: m.subject, ok: m.delivery_state === "sent", detail: m.delivery_state, at: new Date(Number(m.sent_at)).toISOString() });
  }
  for (const h of held) {
    if (h.superseded_at) continue;
    out.push({ app: "Boss OS", subject: h.subject, ok: false, detail: `held by the plain-email gate: ${[].concat(h.problems ?? []).join("; ")}`, at: String(h.at) });
  }
  return out;
}

function readHeld(sinceIso) {
  if (!fs.existsSync(HELD)) return [];
  return fs.readdirSync(HELD).filter((f) => f.endsWith(".json")).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(HELD, f), "utf8")); } catch { return null; }
  }).filter((h) => h && String(h.at) >= sinceIso);
}

async function main() {
  const dry = process.argv.includes("--dry");
  if (!fs.existsSync(ADDRESSES)) {
    console.error(`NAMED STOP [NO_OWNER_ADDRESSES] ${ADDRESSES} is missing. Write her addresses there, one per line (never in the repo), and run again.`);
    process.exit(2);
  }
  const owner = readAddresses(fs.readFileSync(ADDRESSES, "utf8"));
  if (owner.size === 0) {
    console.error(`NAMED STOP [NO_OWNER_ADDRESSES] ${ADDRESSES} holds no address, so no email can be told apart as hers.`);
    process.exit(2);
  }

  const since = Date.now() - DAYS * 86_400_000;
  const sinceIso = new Date(since).toISOString();
  const attempts = [];
  const read = [];
  const unread = [];

  try {
    const rows = d1(path.join(GITHUB, "west-peek-os"), "west-peek-os-db",
      `SELECT event_type, created_at, json_extract(payload_json,'$.to') AS to_addr, json_extract(payload_json,'$.subject') AS subject,
              json_extract(payload_json,'$.detail') AS detail
         FROM event_record WHERE (event_type LIKE '%email_not_sent' OR event_type LIKE '%emailed%') AND created_at >= '${sinceIso}'`);
    attempts.push(...wposAttempts(rows, owner));
    read.push(`West Peek OS (${rows.length} send events)`);
  } catch (e) { unread.push(`West Peek OS: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}`); }

  try {
    const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
    const notices = d1(repo, "boss-os", `SELECT subject, created_at, sent_at, error FROM boss_task_notices WHERE created_at >= ${since}`);
    const sent = d1(repo, "boss-os", `SELECT subject, to_addr, delivery_state, sent_at FROM boss_sent_mail WHERE sent_at >= ${since}`);
    const held = readHeld(sinceIso);
    attempts.push(...bossAttempts({ notices, sent, held }, owner));
    read.push(`Boss OS (${notices.length} notices, ${sent.length} sent, ${held.length} held)`);
  } catch (e) { unread.push(`Boss OS: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}`); }

  // p-n-p sends her to-do email and keeps only a day marker; a failed send is not recorded anywhere.
  unread.push("p-n-p: records no failed sends (its to-do email keeps only a day marker), so its failures cannot be read");

  const verdicts = ownerMailVerdicts(attempts);
  const failingKeys = new Set(verdicts.map((v) => `mail:${v.key}`));
  for (const v of verdicts) console.log(`${dry ? "WOULD RAISE" : "RAISE"} ${ownerMailText(v)}`);

  if (!dry && read.length) {
    const api = await bossApi();
    for (const v of verdicts) {
      const r = await api.post("/alarms/raise", { key: `mail:${v.key}`, kind: "owner_mail", text: ownerMailText(v), hers: v.hers });
      console.log(`  ${r.action}: ${v.app} · ${v.subject}`);
    }
    // A series whose newest attempt went is cleared (one success breaks the run of failures).
    const open = (await api.get("/alarms")).alarms?.filter((a) => a.kind === "owner_mail" && a.status === "open") ?? [];
    for (const a of open) {
      if (failingKeys.has(a.alarm_key)) continue;
      const appRead = read.some((r) => a.alarm_key.startsWith(`mail:${appSlug(r.split(" (")[0])}#`));
      if (!appRead) continue; // an app not read this run is not judged clean
      await api.post("/alarms/clear", { key: a.alarm_key, reason: "the newest owner email in this series went" });
      console.log(`  cleared: ${a.alarm_key}`);
    }
  }

  for (const u of unread) console.log(`not read: ${u}`);
  console.log(`owner-mail-watch: ${attempts.length} owner-bound attempts in ${DAYS} days; ${verdicts.length} failing series; read ${read.join(", ") || "nothing"}.`);
  console.log(outputLine(read.length, "apps read"));
  if (read.length === 0) {
    console.error("NAMED STOP [NOTHING_READ] no app's mail could be read, so nothing can say whether her email is reaching her.");
    process.exit(9);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`NAMED STOP [OWNER_MAIL_WATCH_FAILED] ${e?.message ?? e}`); process.exit(1); });
}
