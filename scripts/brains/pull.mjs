#!/usr/bin/env node
/**
 * THE LOCAL COPY OF EVERY BRAIN (owner, 31 Oct 2026). Fetches all brains from Boss OS and writes
 * ~/Brains/<slug>.md, each headed "Source: Boss OS · pulled <timestamp> · edit in Boss OS, not here".
 * Private spans are KEPT: this is her own disk. Boss OS is the source; this copy is read-only by
 * intent and is overwritten every pull.
 *
 * The passcode comes from BOSS_PASSCODE, injected by whoever runs this (her launchd job, through the
 * vault). This script never reads the vault or the Keychain itself.
 *
 *   npm run brains:pull                         # → ~/Brains
 *   npm run brains:pull -- --out <dir>          # somewhere else
 *   BOSS_ORIGIN=http://localhost:8787 npm run brains:pull   # a local Worker
 *
 * A brain that Boss OS no longer lists (a retired one, e.g. industry-guides on 1 Nov 2026) is never
 * deleted here: its old copy is MOVED into <out>/_retired/. Only files this script wrote (headed
 * "Source: Boss OS") are ever moved; anything else in the folder is left alone.
 *
 * Rule 0: it exits non-zero, with a named stop, when it wrote nothing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ORIGIN = process.env.BOSS_ORIGIN ?? "https://boss.sequoiataylor.com";

export function header(at = new Date()) {
  return `Source: Boss OS · pulled ${at.toISOString()} · edit in Boss OS, not here`;
}

export function fileFor(brain, at = new Date()) {
  return `${header(at)}\n\n${String(brain.body_md ?? "").replace(/\s+$/, "")}\n`;
}

const SLUG = /^[a-z0-9-]{1,60}$/;

export async function pull({ out = join(homedir(), "Brains"), passcode = process.env.BOSS_PASSCODE, fetchImpl = fetch, origin = ORIGIN, now = new Date() } = {}) {
  if (!passcode) throw Object.assign(new Error("NAMED STOP [NO_PASSCODE] BOSS_PASSCODE is not set; the caller injects it from the vault."), { code: 3 });
  const u = await fetchImpl(`${origin}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!u.ok) throw Object.assign(new Error(`NAMED STOP [UNLOCK_REFUSED] Boss OS refused the passcode (${u.status}).`), { code: 3 });
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const get = async (p) => {
    const r = await fetchImpl(`${origin}/api/boss${p}`, { headers: { cookie } });
    if (!r.ok) throw new Error(`${p} answered ${r.status}`);
    return (await r.json()).data;
  };
  const list = (await get("/brains"))?.brains ?? [];
  if (!list.length) throw Object.assign(new Error("NAMED STOP [NO_BRAINS] Boss OS returned no brains, so nothing was written."), { code: 2 });
  mkdirSync(out, { recursive: true });
  const written = [];
  for (const b of list) {
    if (!SLUG.test(String(b.slug))) continue;
    const full = await get(`/brains/${encodeURIComponent(b.slug)}`);
    const path = join(out, `${b.slug}.md`);
    // Written beside, then renamed: a reader never sees half a file.
    writeFileSync(`${path}.tmp`, fileFor(full, now));
    renameSync(`${path}.tmp`, path);
    written.push(path);
  }
  if (!written.length) throw Object.assign(new Error("NAMED STOP [NOTHING_WRITTEN] No brain could be written."), { code: 2 });
  retireStale(out, written, now);
  return written;
}

/** Old copies of brains Boss OS no longer lists → <out>/_retired/ (never deleted). Returns the moved paths. */
export function retireStale(out, written, now = new Date()) {
  const keep = new Set(written.map((p) => p.split("/").pop()));
  const moved = [];
  for (const name of readdirSync(out)) {
    if (!name.endsWith(".md") || keep.has(name) || !SLUG.test(name.slice(0, -3))) continue;
    const from = join(out, name);
    if (!readFileSync(from, "utf8").startsWith("Source: Boss OS")) continue;
    const dir = join(out, "_retired");
    mkdirSync(dir, { recursive: true });
    let to = join(dir, name);
    if (existsSync(to)) to = join(dir, `${name.slice(0, -3)}.${now.toISOString().replace(/[:.]/g, "-")}.md`);
    renameSync(from, to);
    moved.push(to);
  }
  return moved;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--out");
  const out = i > 0 ? process.argv[i + 1] : undefined;
  pull(out ? { out } : {})
    .then((w) => console.log(`brains: pulled ${w.length} into ${w.length ? w[0].replace(/\/[^/]+$/, "") : "-"}`))
    .catch((e) => { console.error(e.message); process.exit(e.code ?? 1); });
}
