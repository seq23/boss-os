import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { parseLiveBook, bookFingerprint, describeLot } from "../../../shared/boss/intake/liveBook.mjs";

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
  /** One sentence for the reply and the audit row. Always says what happened, including "nothing". */
  note: string;
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
  input: { text: string; mailId: string | null; now?: number },
): Promise<StoredBook> {
  const now = input.now ?? Date.now();
  const parsed = parseLiveBook(input.text);
  const priced = parsed.positions.filter((p: { size_usd: number | null }) => p.size_usd !== null);

  if (priced.length === 0) {
    return {
      bookId: null, version: 0, changed: false,
      note: "This read like your book but no priced line could be taken out of it, so the book you had is unchanged.",
    };
  }

  const fingerprint = bookFingerprint(priced);
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
        bookId: live.id, version: live.version, changed: false,
        note: `Same book as v${live.version} — nothing changed, and I have marked it as confirmed today.`,
      };
    }
  }

  const version = (live?.version ?? 0) + 1;
  const bookId = newId("bok");
  const statements = [
    ...(live ? [env.DB.prepare(`UPDATE capital_book SET superseded_at = ? WHERE id = ?`).bind(now, live.id)] : []),
    env.DB.prepare(
      `INSERT INTO capital_book (id, version, received_at, mail_id, fingerprint, unparsed, superseded_at)
       VALUES (?,?,?,?,?,?,NULL)`,
    ).bind(bookId, version, now, input.mailId, fingerprint,
      parsed.unparsed.length ? JSON.stringify(parsed.unparsed) : null),
    ...priced.map((p) => env.DB.prepare(
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
    action: "filed", detail: { version, lines: priced.length, unparsed: parsed.unparsed.length, mail_id: input.mailId },
  });

  /*
   * WHAT COULD NOT BE READ IS SAID OUT LOUD, in the same breath as what could.
   *
   * A line she meant as inventory and this could not parse is a hole in her book, and the only
   * moment she can cheaply fix it is the day she sent it. Discovered a month later it is a name she
   * thought was being worked and never was.
   */
  const unread = parsed.unparsed.length
    ? ` I could NOT read ${parsed.unparsed.length} line(s): ${parsed.unparsed.map((u: { line: string }) => `"${u.line}"`).join(", ")}.`
    : "";

  return {
    bookId, version, changed: true,
    note: `Filed as book v${version}, ${priced.length} lot(s): ${priced.map((p) => describeLot(p)).join("; ")}.${unread}`,
  };
}
