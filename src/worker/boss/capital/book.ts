import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { parseLiveBook, bookFingerprint, describeLot, isSizeless, usd } from "../../../shared/boss/intake/liveBook.mjs";
import type { BookLot } from "../../../shared/boss/intake/liveBook.mjs";

/**
 * HER LIVE BOOK, VERSIONED.
 *
 * Owner, 10 September 2026: she will email her live sell-side inventory to `boss@sequoiataylor.com`
 * with `#monique`, and Monique works from it. "Versioned, so a later email supersedes an earlier one
 * and the history survives."
 *
 * ─── SUPERSEDED, NEVER OVERWRITTEN ──────────────────────────────────────────
 *
 * Overwriting in place would be one line shorter and would destroy the only thing that makes this
 * auditable: what she actually had out on the day she made a call. A broker's book is a record, and
 * a record you can only see the latest state of is not a record.
 *
 * ─── AN IDENTICAL RESEND IS NOT A NEW VERSION ──────────────────────────────
 *
 * She forwards, replies-all and sends a second copy from her phone. Each of those creating a version
 * would make the history unreadable AND would silently reset the 7-day nag against a book that had
 * not changed — the nag would then be measuring "did she press send" rather than "is what I am
 * working from still true", which is the question that matters. So identity is the CONTENT.
 */

export interface StoredBook {
  bookId: string | null;
  version: number;
  changed: boolean;
  /**
   * DID THE THING SHE ASKED FOR ACTUALLY HAPPEN?
   *
   * `changed: false` has always meant two completely different things — "the same book, confirmed"
   * and "I could not read this" — and the caller could not tell them apart. That ambiguity is what
   * let an unreadable message fall onwards into the generic model path. A failure is now a distinct
   * fact, and the intake refuses to open model work on top of one.
   */
  failed: boolean;
  /** One sentence for the reply and the audit row. Always says what happened, including "nothing". */
  note: string;
}

/** The lots of a book, in the shape both the parser and D1 use. */
type Lot = BookLot;

/** A D1 row read back as a lot, so an amendment can rebuild the book from what is already filed. */
function lotOf(row: Record<string, unknown>): Lot {
  return {
    asset: String(row.asset ?? ""),
    side: (String(row.side ?? "sell") === "buy" ? "buy" : "sell"),
    size_usd: (row.size_usd ?? null) as number | null,
    size_min_usd: (row.size_min_usd ?? null) as number | null,
    size_max_usd: (row.size_max_usd ?? null) as number | null,
    size_shares: (row.size_shares ?? null) as number | null,
    size_text: String(row.size_text ?? ""),
    source_line: String(row.source_line ?? ""),
  };
}

/** Two lots are the same lot when they name the same thing at the same size. */
function lotKey(p: Partial<Lot>): string {
  return `${String(p.asset ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")}|${p.side}`
    + `|${p.size_usd ?? ""}|${p.size_min_usd ?? ""}|${p.size_max_usd ?? ""}|${p.size_shares ?? ""}`;
}

/**
 * WRITE A NEW VERSION, OR SAY IT IS THE SAME ONE. The one place a book version is created.
 *
 * `book`, `add` and `remove` all end here, so superseding, the identical-resend rule and the history
 * cannot drift apart between them — three writers each keeping their own idea of what a version is
 * would be this repo's favourite defect installed in the one table where it is least recoverable.
 */
async function fileVersion(
  env: Env,
  lots: Lot[],
  input: { mailId: string | null; now: number; unparsed?: Array<{ line: string; why: string }>; what: string },
): Promise<StoredBook> {
  const { now } = input;
  const fingerprint = bookFingerprint(lots);
  const live = await currentBook(env);

  if (live) {
    const same = await env.DB
      .prepare(`SELECT fingerprint FROM capital_book WHERE id = ?`).bind(live.id)
      .first<{ fingerprint: string }>();
    if (same?.fingerprint === fingerprint) {
      /*
       * THE ARRIVAL IS STILL RECORDED, on the version she is already on. Otherwise "she has not sent
       * a book in 7 days" would fire at somebody who sends the same unchanged book every Monday,
       * which is a perfectly reasonable thing for a book to do.
       */
      await env.DB.prepare(`UPDATE capital_book SET received_at = ? WHERE id = ?`).bind(now, live.id).run();
      return {
        bookId: live.id, version: live.version, changed: false, failed: false,
        note: `Same book as v${live.version} — nothing changed, and I have marked it as confirmed today.`,
      };
    }
  }

  const version = (live?.version ?? 0) + 1;
  const bookId = newId("bok");
  const unparsed = input.unparsed ?? [];
  const statements = [
    ...(live ? [env.DB.prepare(`UPDATE capital_book SET superseded_at = ? WHERE id = ?`).bind(now, live.id)] : []),
    env.DB.prepare(
      `INSERT INTO capital_book (id, version, received_at, mail_id, fingerprint, unparsed, superseded_at)
       VALUES (?,?,?,?,?,?,NULL)`,
    ).bind(bookId, version, now, input.mailId, fingerprint,
      unparsed.length ? JSON.stringify(unparsed) : null),
    ...lots.map((p) => env.DB.prepare(
      `INSERT INTO capital_book_line
         (id, book_id, asset, side, size_usd, size_min_usd, size_max_usd, size_shares, size_text, source_line)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      newId("bkl"), bookId, p.asset, p.side,
      p.size_usd ?? null, p.size_min_usd ?? null, p.size_max_usd ?? null, p.size_shares ?? null,
      p.size_text ?? null, p.source_line,
    )),
  ];
  await env.DB.batch(statements);

  await audit(env.DB, {
    actor: "boss", lane: "ops", entityType: "capital_book", entityId: bookId,
    action: "filed", detail: { version, lines: lots.length, unparsed: unparsed.length, mail_id: input.mailId, what: input.what },
  });

  /*
   * WHAT COULD NOT BE READ IS SAID OUT LOUD, in the same breath as what could.
   *
   * A line she meant as inventory and this could not parse is a hole in her book, and the only
   * moment she can cheaply fix it is the day she sent it. Discovered a month later it is a name she
   * thought was being worked and never was.
   */
  const unread = unparsed.length
    ? ` I could NOT read ${unparsed.length} line(s): ${unparsed.map((u) => `"${u.line}"`).join(", ")}.`
    : "";
  const tbd = lots.filter((p) => isSizeless(p)).length;
  const noSize = tbd ? ` ${tbd} of them carry no size yet, which I have kept as stated rather than guessed.` : "";

  return {
    bookId, version, changed: true, failed: false,
    note: `${input.what} as book v${version}, ${lots.length} lot(s): ${lots.map((p) => describeLot(p)).join("; ")}.${unread}${noSize}`,
  };
}

/** A refusal that is a REPLY, never a fall-through into some other handler's guess. */
function refused(note: string): StoredBook {
  return { bookId: null, version: 0, changed: false, failed: true, note };
}

/** What she could not have a lot read out of, quoted back so the next send is right first time. */
function couldNotRead(verb: string, text: string, unparsed: Array<{ line: string; why: string }>): string {
  const shown = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6);
  return [
    `You wrote \`${verb}\`, and I could not read a single lot out of what followed it — so your book is`,
    "UNCHANGED and I have not opened any work for this.",
    "",
    shown.length ? `What I read after \`${verb}\`:` : `There was nothing after \`${verb}\` at all.`,
    ...shown.map((l) => `  ${l}`),
    ...(unparsed.length ? ["", "Lines I could not take a lot from:", ...unparsed.map((u) => `  "${u.line}" — ${u.why}`)] : []),
    "",
    "One lot per line, either way round:",
    "  Databricks — $20M",
    "  Databricks — size TBD",
  ].join("\n");
}

/** The version she is on now, and when it arrived. Null when she has never sent one. */
export async function currentBook(
  env: Env,
): Promise<{ id: string; version: number; received_at: number } | null> {
  return env.DB
    .prepare(`SELECT id, version, received_at FROM capital_book WHERE superseded_at IS NULL ORDER BY version DESC LIMIT 1`)
    .first<{ id: string; version: number; received_at: number }>();
}

/** Every lot of the live book. Empty when she has never sent one — which the caller must not hide. */
export async function currentBookLines(env: Env): Promise<Array<Record<string, unknown>>> {
  const live = await currentBook(env);
  if (!live) return [];
  const { results } = await env.DB
    .prepare(`SELECT asset, side, size_usd, size_min_usd, size_max_usd, size_shares, size_text, source_line
                FROM capital_book_line WHERE book_id = ? ORDER BY rowid`)
    .bind(live.id)
    .all<Record<string, unknown>>();
  return results ?? [];
}

/**
 * File a book out of the text of one email.
 *
 * REFUSES AN EMPTY PARSE RATHER THAN STORING ONE. A book with no priced line is not a book, and
 * writing it would supersede a good version with an empty one — which is how she would end up
 * working from nothing while every signal said the intake was healthy. Rule 0, at the one place it
 * could actually do damage.
 */
export async function storeLiveBook(
  env: Env,
  input: { text: string; mailId: string | null; now?: number; explicit?: boolean },
): Promise<StoredBook> {
  const now = input.now ?? Date.now();
  /*
   * SIZELESS LOTS ONLY WHEN SHE SAID `book`. A bare `#monique` message recognised as a book by its
   * content is a GUESS about her intent, and a guess may not put a name with no number into her
   * inventory. Typing the verb is the consent.
   *
   * AND `book` STILL REQUIRES A PRICE SOMEWHERE — see the refusal below — but it no longer throws
   * away the unpriced names. That is the choice worth stating: if `add` can hold "Databricks, size
   * TBD" and a full resend could not, then her next complete book would silently delete the lot she
   * added on Monday, which is a worse cliff edge than the one this whole change removes.
   */
  const parsed = parseLiveBook(input.text, { allowSizeless: input.explicit === true });
  const lots = parsed.positions;
  const priced = lots.filter((p: { size_usd: number | null }) => p.size_usd !== null);

  if (priced.length === 0) {
    return {
      bookId: null, version: 0, changed: false, failed: true,
      note: lots.length
        ? `I could read ${lots.length} name(s) out of that — ${lots.map((p) => p.asset).join(", ")} — but not one size, `
          + "and a whole book with no prices in it is more likely a message than an inventory. "
          + "Your book is unchanged. Send it with sizes, or use `#monique add` for the unsized names."
        : "This read like your book but no priced line could be taken out of it, so the book you had is unchanged.",
    };
  }

  return fileVersion(env, lots, { mailId: input.mailId, now, unparsed: parsed.unparsed, what: "Filed" });
}

/**
 * `#monique add` — MORE INVENTORY, AND NOTHING ELSE TOUCHED.
 *
 * The lots she names are appended to the book she already has, and the result is a new version: the
 * history still supersedes, so "what did I have out on Tuesday" is still answerable. Amending in
 * place would be shorter and would destroy the only property that makes this a record.
 *
 * A lot that is already there, at the same size, is NOT duplicated — she resends, and a book with
 * Kalshi in it twice would be shown to a buyer as two blocks she does not have.
 */
export async function amendLiveBook(
  env: Env,
  input: { text: string; mailId: string | null; now?: number },
): Promise<StoredBook> {
  const now = input.now ?? Date.now();
  const parsed = parseLiveBook(input.text, { allowSizeless: true });
  if (parsed.positions.length === 0) return refused(couldNotRead("add", input.text, parsed.unparsed));

  const existing = (await currentBookLines(env)).map(lotOf);
  const seen = new Set(existing.map(lotKey));
  const added: Lot[] = [];
  const already: Lot[] = [];
  for (const p of parsed.positions) {
    if (seen.has(lotKey(p))) { already.push(p); continue; }
    seen.add(lotKey(p));
    added.push(p);
  }

  if (added.length === 0) {
    return {
      bookId: null, version: (await currentBook(env))?.version ?? 0, changed: false, failed: false,
      note: `Every lot you added is already on the book at that size — ${already.map((p) => describeLot(p)).join("; ")}. Nothing changed.`,
    };
  }

  const filed = await fileVersion(env, [...existing, ...added], {
    mailId: input.mailId, now, unparsed: parsed.unparsed, what: "Amended",
  });
  return {
    ...filed,
    note: `Added ${added.length} lot(s): ${added.map((p) => describeLot(p)).join("; ")}. ${filed.note}`
      + (already.length ? ` ${already.length} were already there at that size and were not duplicated.` : ""),
  };
}

/**
 * `#monique remove` — ONE NAMED LOT LEAVES, and the rest of the book is untouched.
 *
 * NAMING NOTHING IT CAN FIND IS A REFUSAL, not a quiet no-op. "I removed it" when nothing was
 * removed is how she would go on being shown buyers for a block she sold last week.
 */
export async function removeFromLiveBook(
  env: Env,
  input: { text: string; mailId: string | null; now?: number },
): Promise<StoredBook> {
  const now = input.now ?? Date.now();
  const existing = (await currentBookLines(env)).map(lotOf);
  if (existing.length === 0) {
    return refused("You asked me to remove a lot and there is no live book to remove it from. Nothing changed.");
  }

  const said = String(input.text ?? "").toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const haystack = norm(said);
  let hits = existing.filter((p) => p.asset && haystack.includes(norm(p.asset)));

  /*
   * TWO ANTHROPIC LOTS, AND SHE MEANS ONE OF THEM. Her book carries $2B and $500M of the same name
   * on purpose, so a size in the message narrows it — and a size that matches nothing is ignored
   * rather than obeyed, because dropping BOTH when she named one would be the expensive mistake.
   */
  const sizes = (said.match(/\$\s*[0-9][0-9,.]*\s*(?:k|mm|m|bn|b|t)?/gi) ?? [])
    .map((t) => usd(t.replace(/\s+/g, ""))).filter((n): n is number => n !== null);
  if (sizes.length && hits.length > 1) {
    const narrowed = hits.filter((p) => sizes.some((n) => n === p.size_usd || n === p.size_max_usd || n === p.size_min_usd));
    if (narrowed.length) hits = narrowed;
  }

  if (hits.length === 0) {
    return refused([
      "You asked me to remove a lot and I could not find it on your book, so NOTHING was removed.",
      "",
      "What is on it now:",
      ...existing.map((p) => `  ${describeLot(p)}`),
      "",
      "Name it the way it appears above — `#monique remove Kalshi`.",
    ].join("\n"));
  }

  const dropped = new Set(hits.map((p) => lotKey(p)));
  const kept = existing.filter((p) => !dropped.has(lotKey(p)));
  const filed = await fileVersion(env, kept, { mailId: input.mailId, now, what: "Rewritten" });
  return {
    ...filed,
    note: `Removed ${hits.length} lot(s): ${hits.map((p) => describeLot(p)).join("; ")}. ${filed.note}`,
  };
}
