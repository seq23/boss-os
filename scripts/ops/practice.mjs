#!/usr/bin/env node
/**
 * A PRACTICE RUN OF THE BRANCH'S MAILBOX ON REAL MAIL, WRITING NOTHING (owner, 15 Nov 2026: "stop
 * changes taking hours"). Before a change to how her mail is read lands, run it on the email that
 * prompted it and inspect the queue, brief, and attachment diagnostics.
 *
 *   npm run practice -- <mail id>...          # boss_inbound_mail ids (the arrival rows)
 *   npm run practice -- <mail id> --rung gemma   # walk only the free rung whose id contains "gemma"
 *
 * HOW IT STAYS READ-ONLY. Production is only READ, and only three ways: one SELECT on the arrival
 * rows, one SELECT each on `employees` and `models` (the roster and the free ladder), and an R2 GET of
 * each kept email. Everything else is LOCAL: this checkout's code runs under `wrangler dev --local`
 * against a throwaway D1/R2/KV in a temp folder (the branch's migrations, then those rows copied in),
 * and `POST /api/boss/intake/mail/dry-run` is called with the email whole (intake/dryRun.ts, which
 * writes and sends nothing even there). The local worker is given only the free-ladder keys
 * (OPENROUTER_API_KEY, GEMINI_API_KEY) and the Drive reader (GSC_SERVICE_ACCOUNT_JSON); no mail
 * transport key, no Cloudflare token, sending switched off. The temp folder is deleted at the end.
 * Not reachable locally: Workers AI (the last free rung and voice-note transcription), so those
 * show as not tried / not heard.
 *
 * Exit: 0 every id read · 1 one or more could not be read (named) · 2 NAMED STOP [PRACTICE_NO_TOKEN]
 * no Cloudflare token (run it through `npm run practice`, which goes through the vault).
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROD_DB = "boss-os";
const BUCKET = "boss-os-documents";
const LOCAL_DB = "WP_OS_DB";
const PASSCODE = "local-dev-passcode"; // wrangler.toml [vars], the local worker's own
const MIRRORED = ["employees", "models"];
const PASSED_KEYS = ["OPENROUTER_API_KEY", "GEMINI_API_KEY", "GSC_SERVICE_ACCOUNT_JSON"];
const ID = /^[A-Za-z0-9_-]{1,80}$/;

const wrangler = (args, opts = {}) => execFileSync("npx", ["--no-install", "wrangler", ...args], {
  cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts,
});
const readProd = (sql) => JSON.parse(wrangler(["d1", "execute", PROD_DB, "--remote", "--env", "production", "--json", "--command", sql]))[0]?.results ?? [];
const sqlValue = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** INSERT OR REPLACE statements for rows, keeping only the columns the local table has. Pure. */
export function mirrorSql(table, rows, localColumns) {
  const cols = new Set(localColumns);
  return rows.map((r) => {
    const keys = Object.keys(r).filter((k) => cols.has(k));
    return `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((k) => sqlValue(r[k])).join(", ")});`;
  }).join("\n");
}

/** What she reads from one dry read: the brief, then the reply as it would go. Pure. */
export function printable(id, d) {
  const fr = d.first_read;
  return [
    `═══ ${id} — ${d.subject || "(no subject)"}`,
    `to ${d.to ?? "?"} · ${d.bytes} bytes · ${d.typed_chars} typed characters · intake queue: ${d.would_route_to.join(", ") || "unavailable"}`,
    "",
    "THE BRIEF",
    ...(fr ? [`  first read by ${fr.reader ?? "no rung"}${fr.stop ? ` — stopped: ${fr.stop}` : ""} `, ...(fr.tried.length ? fr.tried.map((t) => `    tried ${String(t).replace(/\s+/g, " ").slice(0, 110)}`) : ["    tried none"])] : ["  no first read (no words of hers)"]),
    ...d.asks.map((a) => `  ask: ${a}`),
    ...(fr ? [`  holds ${fr.holds} · questions ${fr.questions} · unclear ${fr.unclear}`, ...fr.unclear_items.map((u) => `  unclear: "${u.words}" — ${u.missing}`)] : []),
    `  files: heard ${d.files.heard.length} · read ${d.files.read.length} · zips ${d.files.zips.length} · unopened ${d.files.unopened.length}`,
    ...d.files.unopened.map((u) => `  unopened: ${u.filename} — ${u.reason}`),
    "",
  ].join("\n");
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const ri = args.indexOf("--rung");
  const rung = ri >= 0 ? args[ri + 1] : null;
  const ids = args.filter((a, i) => !a.startsWith("--") && !(ri >= 0 && i === ri + 1));
  if (!ids.length || ids.some((i) => !ID.test(i))) { console.error("usage: npm run practice -- <mail id>... [--rung <id part>]"); process.exit(1); }
  if (!process.env.CLOUDFLARE_API_TOKEN) { console.error("NAMED STOP [PRACTICE_NO_TOKEN] no Cloudflare token: run it as npm run practice -- <id> (through the vault)."); process.exit(2); }

  console.log(`practice — reading ${ids.length} email(s) from production (read only)`);
  const arrivals = readProd(`SELECT id, object_key FROM boss_inbound_mail WHERE id IN (${ids.map(sqlValue).join(", ")})`);
  const mirrored = Object.fromEntries(MIRRORED.map((t) => [t, readProd(`SELECT * FROM ${t}`)]));

  const tmp = mkdtempSync(join(tmpdir(), "boss-practice-"));
  const state = join(tmp, "state");
  let dev = null;
  let failed = 0;
  let madeDist = false;
  try {
    const raws = new Map();
    for (const id of ids) {
      const row = arrivals.find((a) => a.id === id);
      if (!row) { console.log(`✗ ${id}: no arrival row has that id`); failed++; continue; }
      if (!row.object_key) { console.log(`✗ ${id}: that email was not kept, so it cannot be read again`); failed++; continue; }
      const file = join(tmp, `${id}.eml`);
      try { wrangler(["r2", "object", "get", `${BUCKET}/${row.object_key}`, "--remote", "--file", file]); raws.set(id, readFileSync(file, "utf8")); }
      catch (e) { console.log(`✗ ${id}: the kept email could not be fetched (${String(e.stderr ?? e.message).trim().split("\n").pop()})`); failed++; }
    }
    if (!raws.size) process.exit(1);

    console.log("practice — building a throwaway local database from this branch's migrations");
    const local = ["--local", "--persist-to", state];
    wrangler(["d1", "migrations", "apply", LOCAL_DB, ...local], { env: { ...process.env, CI: "true" } });
    for (const [table, rows] of Object.entries(mirrored)) {
      const cols = JSON.parse(wrangler(["d1", "execute", LOCAL_DB, ...local, "--json", "--command", `PRAGMA table_info(${table})`]))[0].results.map((c) => c.name);
      const sqlFile = join(tmp, `${table}.sql`);
      writeFileSync(sqlFile, `PRAGMA defer_foreign_keys = true;\n${mirrorSql(table, rows, cols)}\n`);
      if (rows.length) wrangler(["d1", "execute", LOCAL_DB, ...local, "--file", sqlFile]);
    }
    // wrangler needs the assets folder to exist; an empty one made here is removed again (an empty
    // dist/client reads as a broken build to validate:identity).
    if (!existsSync(join(ROOT, "dist", "client"))) { mkdirSync(join(ROOT, "dist", "client"), { recursive: true }); madeDist = true; }

    // Only the keys the read needs, never the vault's whole environment.
    const port = 8790 + Math.floor(Math.random() * 100);
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" };
    for (const k of PASSED_KEYS) if (process.env[k]) env[k] = process.env[k];
    console.log(`practice — starting this branch's worker locally on port ${port}`);
    dev = spawn("npx", ["--no-install", "wrangler", "dev", ...local, "--port", String(port)], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let devLog = "";
    dev.stdout.on("data", (d) => { devLog += d; });
    dev.stderr.on("data", (d) => { devLog += d; });
    const origin = `http://localhost:${port}`;
    if (!(await waitFor(`${origin}/api/health`, 120_000))) { console.log(`✗ the local worker did not start:\n${devLog.slice(-2000)}`); process.exit(1); }

    const unlock = await fetch(`${origin}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: PASSCODE }) });
    const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
    if (!unlock.ok || !cookie) { console.log(`✗ could not unlock the local worker (${unlock.status})`); process.exit(1); }

    for (const [id, raw] of raws) {
      const res = await fetch(`${origin}/api/boss/intake/mail/dry-run`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ raw, rung }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) { console.log(`✗ ${id}: the dry read failed (${res.status}) ${JSON.stringify(body?.error ?? body).slice(0, 400)}`); failed++; continue; }
      console.log(printable(id, body.data));
    }
  } finally {
    if (dev?.pid) { try { process.kill(-dev.pid, "SIGTERM"); } catch { /* already gone */ } }
    rmSync(tmp, { recursive: true, force: true });
    if (madeDist) rmSync(join(ROOT, "dist", "client"), { recursive: true, force: true });
  }
  console.log(`OUTPUT ${ids.length - failed} of ${ids.length} email(s) read; nothing written to production, nothing sent`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
