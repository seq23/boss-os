/**
 * THE LOCAL MIRROR OF HER LIVE BOOK.
 *
 * D1 IS AUTHORITATIVE. The book arrives by email at `boss@sequoiataylor.com`, the Worker parses it
 * with `src/shared/boss/intake/liveBook.mjs` and stores it versioned. This pulls that down so the
 * buyer hunt on her Mac works from the same inventory — the link that stops the Worker's book and
 * Monique's book becoming two lists nobody reconciles.
 *
 * IT SAYS HOW OLD THE MIRROR IS, ALWAYS. A cached copy that looks identical to a fresh one is how
 * she would end up being shown buyers for a block she sold last week.
 *
 *   npm run capital:book                  # show what is on disk, and how stale it is
 *   npm run capital:book -- --pull        # fetch the live book from production
 *   npm run capital:book -- --file b.txt  # parse a book in her own words, offline
 *
 * OFFLINE PARSING GOES THROUGH THE SAME PARSER as the Worker, deliberately. `--file` is for the days
 * before Email Routing is switched on and for the case where she would rather paste than send; it
 * must never mean a second reading of what a line says.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseLiveBook, describeLot } from "../../src/shared/boss/intake/liveBook.mjs";

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const BOOK_TEXT = path.join(DIR, "book.txt");
const BOOK_JSON = path.join(DIR, "book.json");
const BASE = process.env.BOSS_OS_BASE_URL ?? "https://boss.sequoiataylor.com";

const ARGS = process.argv.slice(2);
const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : ARGS[i + 1] ?? null; };
const PULL = ARGS.includes("--pull");
const FILE = argOf("file");

const DAY = 86_400_000;

async function pull() {
  const passcode = process.env.BOSS_PASSCODE;
  if (!passcode) {
    /*
     * A NAMED STOP, NOT A FALLBACK TO THE LOCAL FILE. Silently serving a stale mirror when the pull
     * could not authenticate is the exact failure this file exists to prevent: she would be told
     * her book was current by a command whose whole job is to say when it is not.
     */
    console.error("NAMED STOP [NO_PASSCODE] BOSS_PASSCODE is not set, so production cannot be read.");
    console.error("  Run it through the vault: npm run vault:run -- node scripts/ops/capital-book.mjs --pull");
    process.exit(4);
  }
  const session = await fetch(`${BASE}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
  const cookie = session.headers.get("set-cookie");
  if (!session.ok || !cookie) {
    console.error(`NAMED STOP [LOCKED] Boss OS refused the passcode: ${session.status}.`);
    process.exit(5);
  }
  const res = await fetch(`${BASE}/api/boss/capital/book`, { headers: { cookie: cookie.split(";")[0] } });
  if (!res.ok) {
    console.error(`NAMED STOP [PULL_FAILED] /api/boss/capital/book answered ${res.status}.`);
    process.exit(6);
  }
  const body = await res.json();
  const data = body?.data ?? body;
  if (!data?.book) {
    console.error("NAMED STOP [NO_BOOK_FILED] production holds no live book.");
    console.error(`  ${data?.why ?? "Email it to boss@sequoiataylor.com with #monique."}`);
    process.exit(7);
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(BOOK_JSON, JSON.stringify({ pulled_at: Date.now(), ...data }, null, 2), "utf8");
  console.log(`Pulled book v${data.book.version}, filed ${new Date(data.book.received_at).toISOString().slice(0, 10)}`
    + ` (${data.book.age_days}d ago), ${data.lines.length} lot(s) -> ${BOOK_JSON}`);
  for (const l of data.lines) console.log(`  ${describeLot(l)}`);
  return data;
}

function fromFile(file) {
  if (!fs.existsSync(file)) {
    console.error(`NAMED STOP [NO_FILE] ${file} does not exist.`);
    process.exit(8);
  }
  const parsed = parseLiveBook(fs.readFileSync(file, "utf8"));
  const priced = parsed.positions.filter((p) => p.size_usd !== null);
  if (priced.length === 0) {
    console.error(`NAMED STOP [EMPTY_BOOK] no priced line could be read out of ${file}.`);
    process.exit(9);
  }
  console.log(`${priced.length} lot(s) read from ${file}:`);
  for (const p of priced) console.log(`  ${describeLot(p)}`);
  // WHAT COULD NOT BE READ IS SAID OUT LOUD, on the day she can still fix it.
  for (const u of parsed.unparsed) console.log(`  COULD NOT READ: "${u.line}" — ${u.why}`);
  return parsed;
}

function show() {
  const local = fs.existsSync(BOOK_JSON) ? JSON.parse(fs.readFileSync(BOOK_JSON, "utf8")) : null;
  if (local?.book) {
    const mirrorAge = Math.floor((Date.now() - local.pulled_at) / DAY);
    console.log(`Mirror of book v${local.book.version}, pulled ${mirrorAge}d ago, ${local.lines.length} lot(s):`);
    for (const l of local.lines) console.log(`  ${describeLot(l)}`);
    if (mirrorAge >= 1) console.log(`\n  This mirror is ${mirrorAge} day(s) old. Re-pull before trusting it: --pull`);
    return;
  }
  if (fs.existsSync(BOOK_TEXT)) {
    console.log(`No mirror from production. Reading the local book at ${BOOK_TEXT}:`);
    fromFile(BOOK_TEXT);
    console.log("\n  This is a local file, not production's book. --pull once Email Routing is live.");
    return;
  }
  console.error("NAMED STOP [NO_BOOK] there is no book here and none has been pulled.");
  console.error(`  Email it to boss@sequoiataylor.com with #monique, or write it to ${BOOK_TEXT}.`);
  process.exit(3);
}

async function main() {
  if (PULL) { await pull(); return; }
  if (FILE) { fromFile(FILE); return; }
  show();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`CAPITAL BOOK FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
