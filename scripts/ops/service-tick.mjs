#!/usr/bin/env node
/**
 * HER MAC'S PASS OVER THE SERVICE WAITS (docs/SERVICE_RULES.md; 6 Oct 2026).
 *
 * Run by `scripts/ops/agent-claim.sh` on every claim tick (every five minutes, 06:00–22:00), through
 * the vault, over her own unlocked session like every other Mac script. No new launchd job, no mail
 * watcher: the tick that already runs does four small things and exits.
 *
 *   1 · R3  — keys she emailed as `SECRET NAME=value`: each is written into the vault with
 *             `vault.mjs set NAME` reading the value from STDIN (never a command line, never a log),
 *             its NAME is classified for the Worker sync, and the Worker forgets the row;
 *   2 · R27 — DNS records she was asked to add: resolved over DNS-over-HTTPS; the moment one is live
 *             she is emailed once and the wait closes; after seven days it lapses;
 *   3 · R21 — Drive folders named in an ask: pulled read-only; files that arrived are loaded into the
 *             waiting work with no new email from her; "still empty" is said once by the Worker.
 *
 * RULE 0: every pass prints what it did, including "nothing pending"; a refusal exits non-zero.
 *   npm run --silent vault:run -- node scripts/ops/service-tick.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rememberHandedOff } from "../lib/vault-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";
const say = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}] service-tick:`, ...a);

let cookie = "";
async function unlock() {
  if (!process.env.BOSS_PASSCODE) { console.error("NAMED STOP [NO_PASSCODE] run through the vault: npm run vault:run -- node scripts/ops/service-tick.mjs"); process.exit(4); }
  const res = await fetch(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
  if (!res.ok) { console.error(`NAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${res.status}).`); process.exit(5); }
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}
async function api(path, body) {
  const res = await fetch(`${ORIGIN}/api/boss/service${path}`, {
    method: body ? "POST" : "GET",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: json?.data ?? null, error: json?.error ?? null };
}

/** `vault.mjs set NAME` with the value on stdin. Only the exit code comes back. */
export function vaultSet(name, value) {
  const r = spawnSync(process.execPath, [join(REPO, "scripts", "vault", "vault.mjs"), "set", name], { input: value, stdio: ["pipe", "ignore", "ignore"], env: process.env });
  return r.status === 0;
}

export async function pullSecretHandoffs({ setSecret = vaultSet } = {}) {
  const pending = await api("/secret-handoffs/pending");
  if (!pending.ok) { say(`secret hand-offs: could not ask (${pending.status} ${pending.error ?? ""})`); return { vaulted: [], failed: 1 }; }
  const vaulted = [];
  let failed = 0;
  for (const row of pending.data?.handoffs ?? []) {
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(String(row.name))) { failed += 1; continue; }
    if (!setSecret(row.name, String(row.value))) { failed += 1; say(`secret hand-off ${row.name}: the vault write failed; left for the next pass`); continue; }
    rememberHandedOff([row.name]);
    const told = await api(`/secret-handoffs/${row.id}/stored`, {});
    say(`secret hand-off ${row.name}${row.repo ? ` for ${row.repo}` : ""}: in the vault (${told.status})`);
    vaulted.push(row.name);
  }
  if ((pending.data?.unreadable ?? []).length) say(`secret hand-offs: ${pending.data.unreadable.length} row(s) the Worker could not decrypt — BOSS_OS_SECRET_HANDOFF_KEY changed since they were stored`);
  return { vaulted, failed };
}

/** The FQDN a record lives at: "@" is the host, a bare label hangs off the host's zone. */
export function fqdnOf(row) {
  const name = String(row.record_name ?? "").replace(/\.$/, "");
  if (!name || name === "@") return row.host;
  if (name.includes(".")) return name;
  return `${name}.${String(row.host).split(".").slice(-2).join(".")}`;
}

export async function checkDnsWaits({ fetchImpl = fetch, notify = emailHer } = {}) {
  const pending = await api("/dns-waits/pending");
  if (!pending.ok) { say(`dns waits: could not ask (${pending.status})`); return { live: 0, failed: 1 }; }
  let live = 0;
  for (const row of pending.data?.items ?? []) {
    const name = fqdnOf(row);
    const res = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(row.record_type)}`, { headers: { accept: "application/dns-json" } }).catch(() => null);
    const body = res && res.ok ? await res.json().catch(() => null) : null;
    const want = String(row.record_target).toLowerCase().replace(/\.$/, "");
    const isLive = Array.isArray(body?.Answer) && body.Answer.some((a) => String(a.data ?? "").toLowerCase().replace(/^"|"$/g, "").replace(/\.$/, "") === want);
    if (isLive) {
      const told = await notify("Danielle", `Live: ${row.host}`, [
        `${row.host} is live: ${row.record_type} ${name} → ${row.record_target} now resolves.`,
        "", "Nothing is waiting on you for it any more.", "", "— Danielle, Technical Program Manager",
      ].join("\n"));
      await api(`/dns-waits/${row.id}/checked`, { live: 1, told: told ? 1 : 0 });
      live += 1;
      say(`dns ${row.host}: live${told ? ", and she was told" : ", but the email did not go — it is retried on the next pass"}`);
    } else {
      await api(`/dns-waits/${row.id}/checked`, {});
    }
  }
  return { live, failed: 0 };
}

const TEXT_EXT = new Set([".txt", ".md", ".csv", ".json", ".html", ".htm"]);

/** Every file under `dir`, with the readable text of the text-like ones, capped. */
export function readPulled(dir, cap = 40_000) {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(dir);
  let text = "";
  for (const f of files) {
    if (text.length >= cap || !TEXT_EXT.has(extname(f).toLowerCase())) continue;
    text += `\n--- ${f.slice(dir.length + 1)} ---\n${readFileSync(f, "utf8").slice(0, cap - text.length)}`;
  }
  return { files: files.length, text: text.trim() };
}

export async function checkDriveWatches() {
  const pending = await api("/drive-watches/pending");
  if (!pending.ok) { say(`drive watches: could not ask (${pending.status})`); return { loaded: 0, failed: 1 }; }
  const items = pending.data?.items ?? [];
  if (items.length && !process.env.GSC_SERVICE_ACCOUNT_JSON) { say("drive watches: GSC_SERVICE_ACCOUNT_JSON is not in the vault, so no folder can be read this pass"); return { loaded: 0, failed: 1 }; }
  let loaded = 0;
  for (const w of items) {
    const out = mkdtempSync(join(tmpdir(), "boss-drive-"));
    try {
      const pull = spawnSync(process.execPath, [join(HERE, "drive-pull.mjs"), w.folder_id, out], { encoding: "utf8", env: process.env, timeout: 180_000 });
      if (pull.status === 3) { await api(`/drive-watches/${w.id}/status`, { files: 0 }); continue; }
      if (pull.status !== 0) { say(`drive ${w.folder_id}: drive-pull exited ${pull.status}; tried again next pass`); continue; }
      const read = readPulled(out);
      const r = await api(`/drive-watches/${w.id}/status`, { files: read.files, text: read.text });
      if (r.ok) { loaded += 1; say(`drive ${w.folder_id}: ${read.files} file(s) loaded${r.data?.resumed ? ` into ${r.data.resumed}` : ""}`); }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
  return { loaded, failed: 0 };
}

/** One email, signed by the employee, through the one send every Mac lane uses. Returns true when it went. */
async function emailHer(fromName, subject, text) {
  const { sendersFor, employeeMail } = await import("./notify.mjs");
  for (const sender of sendersFor(fromName)) {
    const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sender.key}` }, body: JSON.stringify(employeeMail(sender, { to: TO, subject, text })) });
    if (res.ok) return true;
  }
  return false;
}

async function main() {
  await unlock();
  const s = await pullSecretHandoffs();
  const d = await checkDnsWaits();
  const w = await checkDriveWatches();
  say(`keys vaulted ${s.vaulted.length}, DNS live ${d.live}, Drive folders loaded ${w.loaded}${s.vaulted.length + d.live + w.loaded === 0 ? " — nothing pending" : ""}`);
  if (s.failed || d.failed || w.failed) process.exit(9);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`service-tick failed: ${err?.message ?? err}`); process.exitCode = 1; });
}
