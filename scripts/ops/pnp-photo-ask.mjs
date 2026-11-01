#!/usr/bin/env node
/**
 * Before every Marketplace listings run (~/bin/pnp-listings.sh): find the newest real-work photos
 * and clips, print one line Camille's run reads, and — when nothing new has come in for two weeks
 * and she has not been asked this week — put ONE item in the owner's morning email asking for more
 * (owner ruling, 1 Nov 2026; the rule is src/shared/boss/pnp/photoAsk.mjs).
 *
 * Read-only on both sources (P&P Studio's D1 and the P&P admin's D1). Prints only dates and counts,
 * never a file name, customer or address.
 *   exit 0  the line was printed (asked, or not due, with why)
 *   exit 2  NAMED STOP [PNP_PHOTOS_NOT_READ]: no source could be read, so nothing was asked
 * Flags: --dry-run (decide and print, write nothing).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { photoAskDue, photoAskItem } from "../../src/shared/boss/pnp/photoAsk.mjs";
import { writeMorningSection } from "../../src/shared/boss/mail/morning.mjs";

const GH = path.join(os.homedir(), "GitHub");
const STATE = path.join(os.homedir(), ".boss-os", "pnp-listings", "photo-ask.json");
const SOURCES = [
  { name: "P&P Studio uploads", cwd: path.join(GH, "creator-studios"), db: "creator-studios-sample1-db",
    sql: "SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM (SELECT created_at FROM assets WHERE upload_status = 'uploaded' AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%') UNION ALL SELECT created_at FROM clips WHERE status IN ('draft','approved'))" },
  { name: "P&P admin job photos", cwd: path.join(GH, "p-n-p"), db: "pnp-admin",
    sql: "SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM (SELECT created_at FROM checklist_photos UNION ALL SELECT created_at FROM inventory_photos)" },
];

function read(src) {
  try {
    const out = execFileSync("npx", ["wrangler", "d1", "execute", src.db, "--remote", "--json", "--command", src.sql],
      { cwd: src.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 90_000 });
    const r = JSON.parse(out)?.[0]?.results?.[0];
    if (!r) return { ...src, error: "no result" };
    // D1 datetime('now') has no zone: it is UTC.
    const iso = r.newest ? (/[zZ]|[+-]\d\d:?\d\d$/.test(r.newest) ? r.newest : `${String(r.newest).replace(" ", "T")}Z`) : null;
    return { ...src, n: Number(r.n ?? 0), newest: iso ? Date.parse(iso) : null };
  } catch (e) {
    return { ...src, error: String(e?.message ?? e).split("\n")[0].slice(0, 120) };
  }
}

const DRY = process.argv.includes("--dry-run");
const now = Date.now();
const got = SOURCES.map(read);
const ok = got.filter((g) => !g.error);
if (!ok.length) {
  console.log(`NAMED STOP [PNP_PHOTOS_NOT_READ]: neither photo source could be read (${got.map((g) => `${g.name}: ${g.error}`).join("; ")}); nothing was asked.`);
  process.exit(2);
}
const newestOf = ok.map((g) => g.newest).filter((x) => x !== null);
const newest = newestOf.length ? Math.max(...newestOf) : null;
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { state = {}; }
const lastAsked = state.last_asked ? Date.parse(state.last_asked) : null;
const due = photoAskDue({ newest, lastAsked, now });
const day = (t) => (t === null ? "none" : new Date(t).toISOString().slice(0, 10));
const where = got.map((g) => (g.error ? `${g.name}: not read` : `${g.name}: ${g.n} on file, newest ${day(g.newest)}`)).join("; ");

if (due.ask && !DRY) {
  writeMorningSection("pnp_marketplace", { decide: [photoAskItem({ days: due.days })] });
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ last_asked: new Date(now).toISOString(), days: due.days }, null, 2));
}
console.log(`Newest real work: ${where}. Morning ask: ${due.ask ? (DRY ? "due (dry run, not written)" : "asked the owner") : "not due"} (${due.why}).`);
