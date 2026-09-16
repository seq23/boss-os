/**
 * THE LOCAL MIRROR OF HER BOOK, READ BY EVERY HUNT.
 *
 * `capital-book.mjs --pull` writes `book.json` — the live book from D1, with its version and the day
 * it arrived — and for four days NOTHING READ IT. `buyer-hunt.mjs` and `filing-hunt.mjs` each read
 * `book.txt`, a file she typed on 10 September, so on 15 September the weekly hunt ran against six
 * lots that did not include the Databricks she had filed on the 11th, while every signal said the
 * book was current. Two components each keeping their own list with no link, in the one place it
 * costs her a week.
 *
 * One reader, imported by both hunts, so the mirror can never mean two different things. A hand-
 * written `book.txt` stays the OFFLINE path — a book in her own words on a day production cannot be
 * reached — and whichever was used is named in the report header.
 *
 * `scripts/validate/the-hunt-reads-the-mirror.mjs` proves both hunts import this and that the
 * installer pulls before either runs.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const CAPITAL_DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
export const BOOK_JSON = path.join(CAPITAL_DIR, "book.json");
export const BOOK_TEXT = path.join(CAPITAL_DIR, "book.txt");
/** The launchd job pulls right before it hunts; older than this means the pull failed. */
export const MIRROR_MAX_AGE_DAYS = 2;

/** The pulled book as the hunts consume it, or null when no mirror has ever been pulled. */
export function bookFromMirror(file = BOOK_JSON, now = Date.now()) {
  if (!fs.existsSync(file)) return null;
  let mirror;
  try { mirror = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  if (!mirror?.book || !Array.isArray(mirror.lines)) return null;
  const ageDays = Math.floor((now - Number(mirror.pulled_at ?? 0)) / 86_400_000);
  return {
    positions: mirror.lines.map((l) => ({
      asset: String(l.asset ?? ""), side: l.side === "buy" ? "buy" : "sell",
      size_usd: l.size_usd ?? null, size_min_usd: l.size_min_usd ?? null, size_max_usd: l.size_max_usd ?? null,
      size_shares: l.size_shares ?? null, size_text: String(l.size_text ?? ""), source_line: String(l.source_line ?? ""),
    })),
    unparsed: [],
    source: `book v${mirror.book.version} (filed ${new Date(mirror.book.received_at).toISOString().slice(0, 10)}, mirror pulled ${ageDays}d ago)`,
    stale: ageDays > MIRROR_MAX_AGE_DAYS,
    ageDays,
  };
}

/**
 * A STALE MIRROR IS NAMED, NOT SERVED QUIETLY. A hunt on last week's book that looks current is the
 * exact thing the mirror exists to stop, so this exits rather than returns when the pull is old.
 */
export function mirrorOrStop() {
  const mirror = bookFromMirror();
  if (!mirror) return null;
  if (mirror.stale) {
    console.error(`NAMED STOP [MIRROR_STALE] the local mirror of her book is ${mirror.ageDays} day(s) old. Re-pull first: npm run capital:book -- --pull`);
    process.exit(10);
  }
  return mirror;
}
