import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { admitTask } from "../tasks/admit";
import {
  BOSS_INTAKE_MAILBOX, BOSS_INTAKE_DOMAIN,
  decodeMimeHeader, dmarcPassed, extractAddress, isOwner,
  replyBody, routeToSeat, seatTag, strippedSubject,
  type BossRoute, type BossSeat,
} from "../../../shared/boss/intake/mail.mjs";
import { parseLiveBook, readBookDirective } from "../../../shared/boss/intake/liveBook.mjs";
import type { BookDirective } from "../../../shared/boss/intake/liveBook.mjs";
import { clarificationFor, isReplyMessage } from "../../../shared/boss/intake/clarify.mjs";
import { taskBodyFrom } from "../../../shared/boss/intake/messageBody.mjs";
import { storeLiveBook, amendLiveBook, removeFromLiveBook, type StoredBook } from "../capital/book";

/**
 * MAIL TO `boss@sequoiataylor.com`.
 *
 * Boss OS's own inbox, written for Boss OS, importing nothing from `src/worker/effects/inboundEmail.ts`.
 * That file serves `os@joinwestpeek.com`, which is West Peek's mailbox on West Peek's domain,
 * delivered to a Worker called `west-peek-os` and not to this one. Owner, 10 Sep 2026: "why are u
 * sharing anything with west peek's os? why? this is a separate repo and domain."
 *
 * The GOOD IDEAS from there are copied and are worth copying: decode the headers before matching,
 * read the true sender out of a forward, store an oversized message rather than dropping it, and
 * above all never let a message vanish. The ROUTING is not shared. `validate:boss-intake-is-boss-only`
 * fails the build if an import ever appears.
 *
 * ─── THE ORDER OF OPERATIONS IS THE SECURITY MODEL ─────────────────────────
 *
 *   1. Is the domain ours? Anything else is not this system's mail.
 *   2. Is the sender hers, AND did DMARC prove it? If not: recorded, refused, no work created.
 *   3. Only then: which employee, from the D1 roster.
 *
 * Step 3 can never move above step 2. A tag is a public word and the roster is publishable; the
 * whole design is safe precisely because knowing `#monique` buys an attacker nothing.
 */

/** Bigger than this and the body is not parsed — a Worker invocation has ~10ms of CPU. */
export const MAX_BODY_BYTES = 512 * 1024;

/** Every active seat, which is the whole tag table. There is no second list. */
export async function activeRoster(env: Env): Promise<BossSeat[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT id, name, role, lane, department FROM employees
        WHERE status = 'active' AND lifecycle IN ('active','provisional')
        ORDER BY created_at`,
    )
    .all<BossSeat>();
  return (results ?? []).filter((s) => s.name && s.id);
}

export interface BossMailMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream;
  rawSize: number;
}

export interface BossMailResult {
  mailId: string;
  outcome: string;
  employeeId: string | null;
  taskId: string | null;
  reply: string | null;
}

/** Is this message for Boss OS at all? Checked on the domain, not the local part. */
export function isBossMailbox(to: string): boolean {
  return String(to ?? "").trim().toLowerCase().endsWith(`@${BOSS_INTAKE_DOMAIN}`);
}

/**
 * The original sender inside a forwarded message. She forwards constantly — a counterparty's mail
 * with `#monique` typed above it is the ordinary shape — and recording the forward as though she
 * wrote it would throw away who it actually came from.
 *
 * NOTE THAT THIS DOES NOT AFFECT AUTHORISATION. The message is authorised because SHE sent it, and
 * `senderOf` below reads the envelope and the `From:` header, never the forwarded block. Letting a
 * quoted "From:" line inside a body decide who is trusted would put the authorisation back in
 * attacker-controlled text, which is the one thing this design refuses to do.
 */
export function forwardedOrigin(raw: string): { from: string | null; subject: string | null } | null {
  const bodyAt = raw.search(/\r?\n\r?\n/);
  if (bodyAt === -1) return null;
  const body = raw.slice(bodyAt);
  const marker = /(-{2,}\s*forwarded message\s*-{2,}|begin forwarded message:)/i.exec(body);
  const start = marker ? marker.index + marker[0].length : /^\s*from:\s*.+\r?\n\s*(sent|date):/im.exec(body)?.index;
  if (start === undefined) return null;
  const block = body.slice(start, start + 1200);
  const fromLine = /^\s*from:\s*(.+)$/im.exec(block)?.[1]?.trim() ?? null;
  const subjectLine = /^\s*subject:\s*(.+)$/im.exec(block)?.[1]?.trim() ?? null;
  return { from: fromLine ? extractAddress(fromLine) : null, subject: subjectLine };
}

/** Who really sent this, from headers only — never from body text. */
function senderOf(message: BossMailMessage): string {
  return extractAddress(message.headers.get("from")) ?? String(message.from ?? "").toLowerCase();
}

/**
 * Does this message carry her live book?
 *
 * ANCHORED ON THE TAG AND THE CONTENT TOGETHER. `#monique` alone is not enough — most of what she
 * sends Monique is an ordinary instruction — and content alone is not enough either, or any mail
 * quoting a price would rewrite her inventory. So: addressed to Monique, and it parses into at
 * least two priced lines. Below that it is an instruction that happens to mention a number.
 */
export function looksLikeBook(route: BossRoute, text: string): boolean {
  if (!booksAreThisSeats(route, text)) return false;
  const parsed = parseLiveBook(text);
  return parsed.positions.filter((p: { size_usd: number | null }) => p.size_usd !== null).length >= 2;
}

/**
 * The two guards that sit in front of EVERY book operation, verb or no verb.
 *
 * THE SEAT: her inventory is Monique's, and the same words sent to somebody else are not her book.
 * THE ESCAPE: "do not file" / "ignore" still means it, and now covers the verbs too — she has to be
 * able to quote a book back at this machine without the quote becoming an instruction.
 */
function booksAreThisSeats(route: BossRoute, text: string): boolean {
  if (route.outcome === "AMBIGUOUS") return false;
  if (route.seat.department !== "Relationships") return false;
  return !/\bdo not (?:file|store|update)\b|\bignore\b/i.test(text);
}

/**
 * ─── THE VERB IS THE INSTRUCTION. THE PRICE COUNT NEVER WAS. ───────────────
 *
 * `#monique book` replaces, `#monique add` amends, `#monique remove` drops a named lot, and
 * `#monique` followed by anything else is an ordinary instruction. Read `readBookDirective` for what
 * this replaced and why; the short version is that intent was being inferred from how many dollar
 * signs a message contained, and one unpriced line therefore became a hallucinated approval while
 * two priced ones would silently have replaced her entire inventory.
 *
 * Returns null for a message with no verb, which is most of them, and null is the old path intact.
 */
export function bookDirectiveFor(route: BossRoute, subject: string, body: string): BookDirective | null {
  if (!booksAreThisSeats(route, `${subject}\n${body}`)) return null;
  if (!route.tag) return null;
  return readBookDirective(subject, body, route.tag);
}

/** Run the verb she typed. One switch, so a verb can never quietly mean "and also the other thing". */
async function applyBookDirective(
  env: Env, directive: BookDirective, mailId: string, now: number,
): Promise<StoredBook> {
  const input = { text: directive.text, mailId, now };
  if (directive.verb === "book") return storeLiveBook(env, { ...input, explicit: true });
  if (directive.verb === "add") return amendLiveBook(env, input);
  return removeFromLiveBook(env, input);
}

export async function handleBossInboundMail(message: BossMailMessage, env: Env): Promise<BossMailResult> {
  const mailId = newId("iml");
  const now = Date.now();
  const to = String(message.to ?? "").toLowerCase();
  const subject = decodeMimeHeader(message.headers.get("subject") ?? "");
  const sender = senderOf(message);
  const dmarc = dmarcPassed(message.headers.get("authentication-results"));
  const authorised = isOwner(sender) && dmarc;

  /*
   * ─── THE ARRIVAL IS RECORDED FIRST, AND THE OUTCOME IS FILLED IN AFTER ────
   *
   * This used to be a single INSERT at the END of the handler, and it was wrong twice over.
   *
   * IT BROKE HER BOOK. `capital_book.mail_id` references this row, and the book is filed before the
   * end of the handler — so filing a book threw `FOREIGN KEY constraint failed` and the message was
   * lost with nothing but a console line. Caught by the end-to-end test rather than by review; the
   * unit-level parser tests all passed, because the parser was never the problem.
   *
   * AND IT MADE EVERY CRASH SILENT. A throw anywhere between the sender check and the last line
   * meant no row at all — an arrival with no trace, which is the exact failure this mailbox is
   * written to prevent. Recording on arrival means the worst case is a row that says the outcome is
   * still RECEIVED, which is a visible loose end rather than a message that never existed.
   */
  const messageId = (message.headers.get("message-id") ?? "").trim().slice(0, 400) || null;
  /*
   * DID THIS ARRIVE BY SMTP, OR DID SHE TYPE IT HERE? Recorded rather than blurred. `POST
   * /api/intake/mail` runs this exact handler from her own authenticated session — see that route
   * for why a replay door exists at all — and a row that claimed Cloudflare had DMARC-verified a
   * message nobody posted would be a lie in the one table whose whole job is saying what was proven.
   */
  const viaConsole = (message.headers.get("x-boss-intake-origin") ?? "").toLowerCase() === "console";
  const recordArrival = async (outcome: string, why: string) => {
    await env.DB.prepare(
      `INSERT INTO boss_inbound_mail
         (id, received_at, to_addr, from_addr, dmarc_pass, authorised, subject, outcome, why, bytes, message_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      mailId, now, to, sender, dmarc ? 1 : 0, authorised ? 1 : 0, subject.slice(0, 400),
      outcome, why.slice(0, 1000), message.rawSize, messageId,
    ).run();
  };

  const finish = async (row: {
    outcome: string; why: string; tag?: string | null; employeeId?: string | null;
    taskId?: string | null; objectKey?: string | null;
  }) => {
    await env.DB.prepare(
      `UPDATE boss_inbound_mail
          SET outcome = ?, why = ?, tag = ?, employee_id = ?, task_id = ?, object_key = ?
        WHERE id = ?`,
    ).bind(
      row.outcome, row.why.slice(0, 1000), row.tag ?? null, row.employeeId ?? null,
      row.taskId ?? null, row.objectKey ?? null, mailId,
    ).run();
  };

  /*
   * REFUSED, AND RECORDED. Not bounced and not silently dropped.
   *
   * No reply is sent to an unauthorised sender, deliberately: replying would confirm the address is
   * live and would turn this mailbox into a way to make Boss OS send mail to a stranger. The refusal
   * is visible to HER instead, on the row and in the audit trail, which is the person who actually
   * needs to know somebody is writing to her machine inbox.
   */
  if (!authorised) {
    const why = isOwner(sender)
      ? `From ${sender}, which is one of yours, but DMARC did not pass — so the address was not proven and nothing was run.`
      : `From ${sender}, which is not one of your addresses. Recorded and refused.`;
    await recordArrival("REFUSED_SENDER", why);
    await audit(env.DB, {
      actor: "system", lane: "ops", entityType: "inbound_mail", entityId: mailId,
      action: "refused", detail: { from: sender, dmarc, to },
    });
    await logEvent(env.DB, {
      level: "warn", scope: "intake", event: "boss_mail_refused", lane: "ops", entityId: mailId,
      detail: { from: sender, dmarc_pass: dmarc },
    });
    return { mailId, outcome: "REFUSED_SENDER", employeeId: null, taskId: null, reply: null };
  }

  /*
   * The arrival exists from here on, whatever happens next. `finish` fills in the outcome; a row
   * left saying RECEIVED is a message this handler started and did not complete, which is a thing
   * she can find rather than a message that silently never existed.
   */
  await recordArrival("RECEIVED", "Authorised and being routed.");

  const roster = await activeRoster(env);
  if (roster.length === 0) {
    /*
     * RULE 0, at runtime. A roster of nobody means the query is wrong or the seed never ran, and
     * routing "to the default" out of an empty list would invent a destination. The message is kept
     * and the failure is loud.
     */
    await finish({ outcome: "NO_ROSTER", why: "No active employee could be read from D1, so nothing could take this. The message is recorded and unworked." });
    await logEvent(env.DB, { level: "error", scope: "intake", event: "boss_mail_no_roster", lane: "ops", entityId: mailId, detail: { to } });
    return { mailId, outcome: "NO_ROSTER", employeeId: null, taskId: null, reply: null };
  }

  /*
   * OVERSIZE: STORED, ROUTED FROM ITS HEADERS, NEVER PARSED.
   *
   * Copied from the mailbox that came before this one, which learned it by dropping a real 7MB deck
   * at 03:29 and telling nobody. Streaming bytes to R2 is I/O and costs a Worker almost nothing;
   * DECODING seven megabytes would exhaust the CPU budget. The subject still carries the tag, which
   * is the whole routing decision, so the arrival survives as real work.
   */
  const objectKeyFor = () => `boss-inbound-mail/${new Date(now).toISOString().slice(0, 10)}/${mailId}.eml`;
  const oversize = message.rawSize > MAX_BODY_BYTES;

  let objectKey: string | null = null;
  let rawMessage = "";
  if (oversize) {
    objectKey = objectKeyFor();
    try {
      const sized = new FixedLengthStream(message.rawSize);
      const pumped = message.raw.pipeTo(sized.writable);
      await env.VAULT.put(objectKey, sized.readable, {
        httpMetadata: { contentType: "message/rfc822" },
        customMetadata: { from: sender.slice(0, 200), subject: subject.slice(0, 200) },
      });
      await pumped;
    } catch {
      // A failed store must not also lose the notification: the work card still opens and says so.
      objectKey = null;
    }
  } else {
    rawMessage = await new Response(message.raw).text();
    /*
     * ─── THE RAW MESSAGE IS KEPT, AND THE CARD GETS THE WORDS ────────────────
     *
     * Under the cap this used to be the end of it: the whole RFC 822 message went straight onto the
     * task as `input.body` and the original was never stored anywhere. Both halves of that were
     * wrong. The card got 8,378 bytes of `Received:`, ARC seals and a quoted-printable HTML
     * alternative with her one-line instruction buried on line 104 — and the ONLY copy of the
     * message was that mangled field, so there was nothing to re-extract from either.
     *
     * Now every authorised message goes to R2 exactly as it arrived, whatever its size, and the task
     * carries the readable text. The store is best-effort on purpose: R2 being unavailable must
     * degrade to "the card is still right and the archive is missing", never to a lost message.
     */
    try {
      const key = objectKeyFor();
      await env.VAULT.put(key, rawMessage, {
        httpMetadata: { contentType: "message/rfc822" },
        customMetadata: { from: sender.slice(0, 200), subject: subject.slice(0, 200) },
      });
      objectKey = key;
    } catch {
      objectKey = null;
    }
  }

  /*
   * ─── WHAT SHE TYPED, NOT WHAT HER MAIL CLIENT WRAPPED IT IN ───────────────
   *
   * `taskBodyFrom` walks the MIME tree, prefers `text/plain`, falls back to HTML stripped to text,
   * decodes base64 and quoted-printable, and takes off the signature and any quoted reply. It is the
   * SAME function `validate:task-body` calls, so the guard cannot pass against a copy of the rule.
   *
   * ROUTING READS THE DECODED TEXT TOO, and that is a fix in its own right: `#monique` written only
   * in an HTML-only message was previously matched against `=23monique`-shaped bytes and would have
   * missed. The subject is still in the haystack, because that is where she usually puts it.
   */
  const read = rawMessage ? taskBodyFrom(rawMessage) : null;
  const readable = read?.readable ?? "";
  const taskBody = read?.body ?? "";

  const origin = readable ? forwardedOrigin(readable) : null;
  const trueSubject = origin?.subject ? decodeMimeHeader(origin.subject) : subject;
  const haystack = `${subject}\n${readable}`;
  const route = routeToSeat(haystack, roster)!;

  /*
   * ─── HER BOOK, BY THE VERB SHE TYPED ───────────────────────────────────────
   *
   * A verb is explicit and therefore BINDING BOTH WAYS: it files when it can, and when it cannot it
   * says so and stops. What it must never do is fall through to the generic model path, which is
   * exactly what happened to "#Monique - Please add searching for buyers of Databricks…" — a message
   * that was not a book, was not recognised as anything else either, and came back as a paragraph of
   * invention sitting in her approval queue.
   *
   * The no-verb path below is UNCHANGED, deliberately: she has been told a full priced book to
   * `#monique` files, and a convention that breaks the thing somebody was just told to do is worse
   * than the gap it closes.
   */
  let bookNote: string | null = null;
  let bookFailure: string | null = null;
  const directive = readable || subject ? bookDirectiveFor(route, subject, readable) : null;
  if (directive) {
    const result = await applyBookDirective(env, directive, mailId, now);
    if (result.failed) bookFailure = result.note;
    else bookNote = result.note;
  } else if (readable && route.outcome !== "AMBIGUOUS" && looksLikeBook(route, readable)) {
    /*
     * NOT A BLOCKER ON THIS PATH. She did not ask for a book operation here — this branch GUESSED
     * that she meant one — so a refusal is something to tell her about while the message still
     * becomes ordinary work. Only an explicit verb earns the right to stop the message.
     */
    const stored = await storeLiveBook(env, { text: readable, mailId, now });
    bookNote = stored.note;
  }

  /*
   * THE MESSAGE BECOMES WORK THROUGH `admitTask`, THE ONE INTAKE PATH.
   *
   * Not a bespoke insert. `tasks/admit.ts` exists precisely because a second intake path was
   * written once, skipped classification and the queue, and produced a duty that fired on time
   * every morning and never once ran. A task created by this mailbox has to be indistinguishable
   * from one she typed on the Tasks page, or it inherits that bug by construction.
   */
  /*
   * ─── IF SHE CANNOT BE UNDERSTOOD, SHE IS ASKED — BEFORE ANYTHING IS MADE ──
   *
   * Owner, 11 September 2026: "can u make it so that if simone doesnt understand something she
   * emails back for clarity". The rules live in `shared/boss/intake/clarify.mjs`, which says where
   * the line is drawn and why it is drawn there; what matters HERE is the position of this block —
   * above `admitTask`, so no model ever sees a message that could not be understood. A question
   * asked after the fact, beside an invented answer, is worse than either on its own.
   *
   * A REPLY IS NEVER QUESTIONED, which is what makes this terminate. Her answer routes as ordinary
   * work, and it also CLOSES the question it answers, a few lines further down.
   */
  const isReply = isReplyMessage({
    subject, inReplyTo: message.headers.get("in-reply-to"), references: message.headers.get("references"),
  });
  const question = bookFailure ? null : clarificationFor({
    subject: trueSubject, body: readable, department: route.seat.department ?? "",
    seatName: route.seat.name, tag: route.tag, isReply, bookFiled: Boolean(bookNote),
    hasVerb: Boolean(directive), forwarded: Boolean(origin?.from),
  });

  /*
   * HER ANSWER CLOSES THE QUESTION. Matched on the Message-ID her own client put in `References`,
   * so "she has been asked something and has not answered" is arithmetic over rows rather than a
   * hope. Without this the Today alert would nag at questions she replied to the same hour.
   */
  if (isReply) {
    const chain = `${message.headers.get("references") ?? ""} ${message.headers.get("in-reply-to") ?? ""}`;
    const ids = (chain.match(/<[^>]+>/g) ?? []).slice(0, 20);
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      await env.DB.prepare(
        `UPDATE boss_inbound_mail SET answered_at = ?
          WHERE outcome = 'NEEDS_CLARITY' AND answered_at IS NULL AND message_id IN (${marks})`,
      ).bind(now, ...ids).run().catch(() => undefined);
    }
  }

  let taskId: string | null = null;
  let admitFailure: string | null = null;
  /*
   * A FAILED VERB OPENS NO WORK, AND THAT IS THE WHOLE POINT OF THE VERB.
   *
   * `apr_m26zq5praheyw251` is what the other branch produces: an unreadable book instruction handed
   * to a language model, which obliges with a paragraph about "managing a meeting or interaction
   * with a superior" and lands in her approval queue as though it were a considered answer. She now
   * gets a reply that says what could not be read, and nothing is invented on top of it.
   */
  if (route.outcome !== "AMBIGUOUS" && !bookFailure && !question) {
    try {
      const admitted = await admitTask(env, {
        title: strippedSubject(trueSubject) || `Mail from ${sender}`,
        lane: route.seat.lane,
        employee_id: route.seat.id,
        input: {
          source: "boss_inbound_mail",
          mail_id: mailId,
          from: sender,
          ...(origin?.from ? { forwarded_from: origin.from } : {}),
          subject: trueSubject,
          tag: route.tag,
          routing: route.why,
          ...(bookNote ? { live_book: bookNote } : {}),
          /*
           * `body` IS THE INSTRUCTION. Not the message, not the headers, not the markup — the words.
           * Guarded by `scripts/validate/a-task-body-is-not-a-mime-message.mjs`, which fails on a
           * `Received:` line, a boundary, or a quoted-printable soft break in any captured body.
           */
          body: oversize
            ? `The message is ${(message.rawSize / 1024 / 1024).toFixed(1)}MB and was not read here.${objectKey ? ` The whole of it is kept at ${objectKey}.` : " It could not be stored either — nothing but this card survives it."}`
            : taskBody || `The message carried no readable text — ${read?.parts ?? 0} MIME part(s) and nothing in any of them.${objectKey ? ` It is kept exactly as it arrived at ${objectKey}.` : ""}`,
          // The original, byte for byte. Re-extractable, and the reason a parser bug is repairable.
          ...(objectKey ? { raw_message: objectKey } : {}),
          ...(read ? { body_format: read.format, mime_parts: read.parts } : {}),
        },
      });
      taskId = admitted.task_id;
      if (!admitted.created) admitFailure = admitted.reason ?? "intake refused it";
    } catch (err) {
      /*
       * A THROW HERE MUST NOT EAT THE MESSAGE. `admitTask` legitimately throws on a lane mismatch or
       * a retired seat, and any of those would otherwise turn into a silent loss of her mail. The
       * row is written either way and the reply says what happened.
       */
      admitFailure = err instanceof Error ? err.message : String(err);
    }
  }

  // BOOK_NOT_READ is a fourth outcome beside ROUTED / DEFAULTED / AMBIGUOUS: the message arrived,
  // was hers, named a book verb, and could not be carried out. Recorded as its own fact so it is
  // countable rather than hiding inside "routed".
  const outcome = bookFailure ? "BOOK_NOT_READ"
    : question ? "NEEDS_CLARITY"
      : admitFailure ? "NOT_ADMITTED" : route.outcome;
  const why = [route.why,
    ...(viaConsole ? ["Typed into Boss OS from her own authenticated session, not received over SMTP."] : []),
    ...(bookNote ? [bookNote] : []),
    ...(question ? [`${route.seat.name} asked you a question instead of starting work. ${question.why}`] : []),
    ...(bookFailure ? [`No work was opened: the book instruction could not be read. ${bookFailure.split("\n")[0]}`] : []),
    ...(admitFailure ? [`No task was opened: ${admitFailure}.`] : []),
    ...(oversize
      ? [objectKey
        ? `Too large to read here; the whole message is kept at ${objectKey}.`
        : "Too large to read here, and storing it failed — only this row records that it arrived."]
      : objectKey ? [`The message is kept as it arrived at ${objectKey}.`] : []),
  ].join(" ");

  /*
   * SHE ALWAYS GETS AN ANSWER, INCLUDING WHEN IT WORKED.
   *
   * A reply only on failure teaches her to read silence as success — and silence is also what a
   * crashed handler produces, so the two become indistinguishable at exactly the moment she needs
   * them not to be.
   */
  /*
   * A QUESTION IS THE WHOLE REPLY. Not a question appended to "Monique has it." and a list of every
   * tag in the building: she has to be able to hit reply and type one line, and everything above
   * that line is a reason not to. The routing boilerplate is right for a message that became work
   * and wrong for one that is waiting on her.
   */
  const reply = question ? [
    question.ask,
    /*
     * A QUESTION DOES NOT REPLACE "I DID NOT KNOW WHO THIS WAS FOR". When the tag was unrecognised
     * she still has to be told which seats exist, or the question and the mis-routing become one
     * confusing message and she fixes neither. On a clean ROUTED message the roster block is noise.
     */
    ...(route.outcome !== "ROUTED" ? ["", "—", "", replyBody(route, roster, trueSubject)] : []),
  ].join("\n") : [replyBody(route, roster, trueSubject),
    ...(bookNote ? ["", bookNote] : []),
    ...(bookFailure ? ["", bookFailure] : []),
    ...(admitFailure ? ["", `I did NOT open work for this: ${admitFailure}.`] : []),
  ].join("\n");

  await finish({ outcome, why, tag: route.tag, employeeId: route.seat.id, taskId, objectKey });
  await audit(env.DB, {
    actor: "boss", lane: route.seat.lane, entityType: "inbound_mail", entityId: mailId,
    action: "routed",
    detail: {
      to, from: sender, tag: route.tag, employee: route.seat.id, outcome, task_id: taskId,
      origin: viaConsole ? "console" : "smtp",
    },
  });
  await logEvent(env.DB, {
    level: admitFailure ? "warn" : "info", scope: "intake", event: "boss_mail_routed", lane: route.seat.lane,
    entityId: mailId,
    detail: {
      mailbox: BOSS_INTAKE_MAILBOX, tag: route.tag, employee: route.seat.name, outcome,
      ...(question ? { asked: question.reason } : {}),
      unknown_tags: route.unknownTags,
      // The tags that WERE available, so a mis-typed one is diagnosable from the log alone.
      known_tags: roster.map((s) => seatTag(s.name)),
    },
  });

  return { mailId, outcome, employeeId: route.seat.id, taskId, reply };
}
