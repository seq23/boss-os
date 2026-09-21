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
import { handoffFor, seatInDepartment, huntRequestIn } from "../../../shared/boss/intake/handoff.mjs";
import { taskBodyFrom } from "../../../shared/boss/intake/messageBody.mjs";
import { closeDirectiveFor } from "../../../shared/boss/intake/close.mjs";
import { storeLiveBook, amendLiveBook, removeFromLiveBook, type StoredBook } from "../capital/book";
import { stopDeliverable } from "../today/deliverables";
import { answerFromMail } from "../repoChange/answer";
import { answerDutyFromMail, newDutyFromMail } from "../duties/mailLane";
import { answerCommentWatchFromMail } from "../commentWatch/answer";

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

/**
 * THE ENVELOPE CAP IS NOT THE CPU GUARD, AND MEASURING THE WRONG ONE COST HER A MESSAGE.
 *
 * This used to be 512 KB and it is compared against `rawSize` — the whole RFC 822 envelope, ARC
 * seals, base64 attachments and the `text/html` alternative every mail client sends alongside the
 * text. On 12 September 2026 her iPhone Mail sent 538,189 bytes: one 32 KB instruction, wrapped in a
 * 472 KB HTML alternative. Over by 2.6%. The parse was skipped entirely, the body became `""`, and
 * the instruction — "make sure the spirit page … displays astrology …" — reached nobody.
 *
 * The real CPU guard is `MAX_READABLE_BYTES` (60,000) in `shared/boss/intake/messageBody.mjs`, which
 * caps the DECODE OUTPUT — the only number that bounds the work. That stays exactly where it is.
 * This one only has to be big enough that a normal mail client's envelope overhead cannot push a
 * small instruction over it, and small enough that a 7 MB deck still streams to R2 unparsed.
 *
 * 4 MB: eight times her real message, and still refuses the 7 MB deck that taught the oversize path
 * to exist. Guarded by `validate:unread-not-empty`, which measures her actual message.
 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

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
  /*
   * ─── A GUESS IS MADE ONLY AT THE DESK SHE ADDRESSED HERSELF ──────────────
   *
   * 12 September 2026, 19:57: her 700-line Executive Intelligence Report, sent to `#simone`, was
   * handed to Monique BY RULE because it "names a counterparty and a trade" — and this function,
   * seeing Monique's desk and thirteen dollar signs, filed it as book v2. Thirteen lots named
   * "3. Nvidia may anchor a", "U.S. budget deficit hits" and "roughly €", and it superseded the
   * real book she had typed the night before. The buyer hunt then worked from a news article.
   *
   * A handoff moves work between desks; it must not lend Monique's inventory rule to a message she
   * never addressed to Monique. The verb path is unaffected — `#monique add` still files — because
   * `bookDirectiveFor` reads the tag she typed, and that tag is the one this checks too.
   */
  if (!route.tag || route.tag !== seatTag(route.seat.name)) return false;
  const parsed = parseLiveBook(text);
  const priced = parsed.positions.filter((p: { size_usd: number | null }) => p.size_usd !== null).length;
  /*
   * A BOOK IS A LIST, NOT PROSE WITH NUMBERS IN IT. Hers is seven lines and every one of them
   * reads; the report was 13 priced fragments against 687 lines that did not. When the lines that
   * could not be read outnumber the lots, this is not her inventory and no guess is made.
   */
  return priced >= 2 && parsed.unparsed.length <= priced;
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

/** The Message-ID a console-typed message carries, so a reply to it has something to name. */
export function consoleMessageId(mailId: string): string {
  return `<${mailId}@boss-os-console>`;
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
  /*
   * DID THIS ARRIVE BY SMTP, OR DID SHE TYPE IT HERE? Recorded rather than blurred. `POST
   * /api/intake/mail` runs this exact handler from her own authenticated session — see that route
   * for why a replay door exists at all — and a row that claimed Cloudflare had DMARC-verified a
   * message nobody posted would be a lie in the one table whose whole job is saying what was proven.
   */
  const viaConsole = (message.headers.get("x-boss-intake-origin") ?? "").toLowerCase() === "console";
  /*
   * ─── A QUESTION SHE CANNOT ANSWER IS A QUESTION THAT NAGS FOR EVER ────────
   *
   * A question closes when her reply's `In-Reply-To` names the `Message-ID` of the message that
   * asked it. A message typed into Boss OS has no mail client and so had no Message-ID — which
   * meant `iml_m297nsjanp50ygzr` ("#Monique - Please add searching for buyers of Databricks…", typed
   * on 11 September) sat on Today at HIGH with the instruction "reply to that email", about an
   * email that did not exist. So a console message mints its own id, in the shape a mail client
   * would, and the answer route below replies to it by exactly the path an emailed reply takes.
   */
  const messageId = (message.headers.get("message-id") ?? "").trim().slice(0, 400)
    || (viaConsole ? consoleMessageId(mailId) : null);
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
   * ─── "ROUTE THIS TO WHOMEVER SHOULD HANDLE THIS" ──────────────────────────
   *
   * Her words, 12 September 2026, on a message asking for a seller of $1B+ of OpenAI shares. It
   * carried no tag, so it DEFAULTED to the Chief of Staff and stopped there — because nothing in
   * this system had ever been able to hand work to a colleague. The only statement anywhere that
   * changes `tasks.employee_id` lives inside employee merge.
   *
   * BY RULE, AND BEFORE ANY MODEL. The obvious implementation is to ask a model which desk should
   * take it, and that is exactly what already failed: the same message produced "Routing: Route to
   * Customer Service Team." A model picking the seat is the defect, not the fix.
   *
   * It only moves work OFF THE HOLDING DESK. A tag she typed is a decision she made and this may
   * never overrule it; an untagged message is a routing decision nobody has made yet, and this
   * completes it. The department is looked up in the roster that was just read from D1, so the
   * seat list stays derived — an empty department leaves the message exactly where it was.
   */
  let handoffNote: string | null = null;
  const handoff = handoffFor({
    text: readable, subject: trueSubject, fromDepartment: route.seat.department ?? "",
    outcome: route.outcome,
  });
  if (handoff) {
    const seat = seatInDepartment(roster, handoff.department);
    if (seat && seat.id !== route.seat.id) {
      handoffNote =
        `${route.seat.name} handed this to ${seat.name} (${seat.role}) on arrival, because `
        + `${handoff.why}. Matched on: ${handoff.matched.join(", ")}. No model was asked.`;
      route.seat = seat;
      route.why = `${route.why} ${handoffNote}`;
      await audit(env.DB, {
        actor: "boss", lane: seat.lane, entityType: "inbound_mail", entityId: mailId,
        action: "handed_off",
        detail: { to_employee: seat.id, department: handoff.department, matched: handoff.matched, by: "rule" },
      });
    }
  }

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
  /*
   * ─── "FIND ME A SELLER OF $1B+ OPENAI" BECOMES A REAL HUNT ────────────────
   *
   * `scripts/ops/buyer-hunt.mjs` has taken `--asset`, `--size` and (now) `--side` all along, and was
   * reachable from exactly one place: `npm run capital:buyers`, typed by hand. Nothing connected her
   * sentence to it. So the request sat as a paragraph on a card and the search never ran.
   *
   * The asset, the size and the SIDE are parsed deterministically and written onto the task as
   * `input.hunt`, which is the exact argument list the script takes. `buyer-hunt.mjs --from-boss`
   * picks those up on her Mac, where the SEC calls and her own ledger actually live. A Worker cannot
   * do this work — it is EDGAR full-text search plus ~/.boss-os/capital — and pretending otherwise
   * is how a feature comes to exist and never run.
   *
   * IT REFUSES RATHER THAN GUESSES. No side, no asset or no size means no `hunt` key and the message
   * is ordinary work on the right desk. A hunt queued against an asset nobody named would be a real
   * search run over nothing, reported as a quiet week.
   */
  const hunt = route.seat.department === "Relationships"
    ? huntRequestIn(`${trueSubject}\n${readable}`)
    : null;

  /*
   * ─── "PLEASE CLOSE OUT THE KDP UPLOAD ISSUE" IS A STATE CHANGE, NOT A PROMPT ──
   *
   * 14 September 2026, 09:27, in reply to a watcher email about a block that had cleared two days
   * earlier. The message routed to Simone and then went to a model, which wrote "The KDP upload
   * issue is now closed" into her approval queue while `owned_deliverables.del_kdp_publication`
   * stayed `blocked` — and the Wednesday run would have emailed her about it again. Understood by a
   * model, applied by nothing.
   *
   * So a close verb beside the name of ONE open deliverable the routed seat owns stops that
   * deliverable, here, by rule, with her sentence as the reason — before any model sees the message.
   * Two candidates is a question, not a guess. It is the seat's own register that is searched, so
   * telling Simone to close something can never close Monique's work.
   */
  let closedNote: string | null = null;
  let closeQuestion: string | null = null;
  if (route.outcome !== "AMBIGUOUS" && (readable || subject)) {
    const owned = await env.DB
      .prepare(`SELECT id, name FROM owned_deliverables WHERE employee_id = ? AND state IN ('open','blocked') ORDER BY created_at`)
      .bind(route.seat.id)
      .all<{ id: string; name: string }>();
    const close = closeDirectiveFor({ subject: trueSubject, text: readable, deliverables: owned.results ?? [] });
    if (close && "ambiguous" in close) {
      const names = (owned.results ?? []).filter((d) => close.ambiguous.includes(d.id)).map((d) => `"${d.name}"`);
      closeQuestion =
        `You asked ${route.seat.name} to close something, and more than one of her open commitments fits: ${names.join(" and ")}. ` +
        "Nothing was closed. Reply with the one you mean, in its own words, and it will be.";
    } else if (close) {
      const stopped = await stopDeliverable(env, { id: close.id, reason: close.reason, via: "mail", mailId, now });
      if (stopped) {
        closedNote =
          `Closed "${close.name}" (${close.id}) on your instruction — it was ${stopped.from}, and it is now stopped with your ` +
          `reason on the record: "${close.reason}". It will not be chased again and it leaves Today's alerts. ` +
          "Nothing else was opened from this message; if there was more in it to do, send that on its own.";
      }
    }
  }

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
  /*
   * ─── UNREAD IS NOT EMPTY ───────────────────────────────────────────────────
   *
   * The oversize path deliberately does not parse, so `readable` is `""` — and `clarificationFor`
   * read that as "a tag and no instruction", returned `nothing_to_act_on`, and the `!question`
   * guard below then gated out the whole `admitTask` block INCLUDING the oversize branch a few lines
   * down that exists to open a card anyway. Two correct-looking rules cancelling each other out:
   * the message was stored in R2, recorded in `boss_inbound_mail`, and produced no work at all.
   *
   * `unread` is the distinction. A message nobody could read has something to act on by definition
   * — the R2 key is the handle — and asking "what would you like me to do?" about a message she
   * plainly wrote is the most insulting question this system can send.
   */
  /*
   * ─── HER REPLY TO DANIELLE'S PLAN IS THE APPROVAL, AND IT OPENS NO NEW WORK ─
   *
   * Plan B, 20 Sep 2026. The plan email put `[rc_…]` in its subject; a message on Danielle's desk
   * that carries the token is her answer to that plan. `answerFromMail` records the reply on the
   * `repo_changes` row and moves it to `build` — the Mac lane claims it from there — and the reply
   * she gets says so. Nothing is admitted: the task already exists, and a second card for "yes, go"
   * is exactly the paragraph-in-the-approval-queue shape this mailbox keeps refusing.
   *
   * BELOW THE REFUSAL, DELIBERATELY. This runs only for a message that is hers and DMARC-proven,
   * because the recorded answer is one of the two facts land-on-green rests on.
   * `validate:repo-lane` pins that this call sits after the `!authorised` return.
   */
  const planAnswer = route.outcome !== "AMBIGUOUS"
    ? await answerFromMail(env, { seatId: route.seat.id, subject: trueSubject, text: readable, mailId, now, sender })
    : null;
  /*
   * HER WORD ON A COMMENT DIGEST, the same way: `[cw_…]` in the subject names the digest Monique
   * sent; her numbered lines (or `your call`) become instruction rows, and the Mac's `act` half
   * reads nothing else. Below the refusal for the same reason as the plan answer — an instruction
   * row is what lets a comment be hidden or answered as the channel.
   * `validate:comment-act-instructed` pins that this call sits after the `!authorised` return.
   */
  const commentAnswer = !planAnswer
    ? await answerCommentWatchFromMail(env, { sender, subject: trueSubject, text: readable, mailId, now })
    : null;

  /*
   * ─── "#<SEAT> NEW DUTY …" IS A DRAFT, AND HER REPLY TO IT IS THE APPROVAL ──
   *
   * 21 Sep 2026: "is there a lane for me to ask for a new duty to my Boss OS agents?" There was a
   * drafter and an Inbox card and nothing invoked either. Now the verb drafts through `author.ts`,
   * files the SAME `duty_created` judgement call the Inbox shows, and the reply she gets IS the
   * draft — every field with its reason, every refusal verbatim, and one line to answer with.
   * `approved` on the thread decides that judgement call through `approvals/decide.ts`, the Inbox
   * button's exact path; `changes: …` redrafts; `your call` in the original request creates it
   * at once with the phrase on the record. A request that cannot run comes back as a NAMED STOP
   * and creates nothing.
   *
   * BELOW THE REFUSAL, DELIBERATELY, like the plan answer above it: a draft a stranger could
   * approve by knowing a token would make the schedule a door anyone could open.
   * `validate:duty-birth` pins that both calls sit after the `!authorised` return.
   */
  const dutyAnswer = planAnswer || commentAnswer ? null : await answerDutyFromMail(env, {
    roster, subject: trueSubject, text: readable, mailId, now, sender,
    inReplyTo: message.headers.get("in-reply-to"), references: message.headers.get("references"),
  });
  const dutyRequest = planAnswer || commentAnswer || dutyAnswer ? null : await newDutyFromMail(env, {
    roster, subject: trueSubject, text: readable, mailId, messageId, now, sender,
  });
  const dutyNote = dutyAnswer ?? dutyRequest;

  const question = bookFailure || closedNote || planAnswer || commentAnswer || dutyNote ? null : clarificationFor({
    subject: trueSubject, body: readable, department: route.seat.department ?? "",
    seatName: route.seat.name, tag: route.tag, isReply, bookFiled: Boolean(bookNote),
    hasVerb: Boolean(directive), forwarded: Boolean(origin?.from), unread: oversize,
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
  /*
   * A VERB THAT WORKED IS ALREADY THE WHOLE JOB. Filing the book IS the work; handing the same text
   * to a language model afterwards produces an "output" about an inventory that is already stored,
   * and that output lands in her approval queue asking her to bless a paragraph nobody needed.
   * Confirmed the hard way while commissioning this: `#monique book` filed her seven lots correctly
   * and left `apr_m296y5wq65e3s6va` sitting in her queue titled "book".
   *
   * The no-verb path still opens a task, deliberately — there she wrote a message that HAPPENED to
   * be a book, and the message may well have been asking for something as well.
   */
  // A close she asked for, like a book verb that worked, is the whole job: nothing goes to a model.
  const filedByVerb = Boolean(directive && bookNote) || Boolean(closedNote) || Boolean(closeQuestion) || Boolean(planAnswer) || Boolean(commentAnswer) || Boolean(dutyNote);
  if (route.outcome !== "AMBIGUOUS" && !bookFailure && !question && !filedByVerb) {
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
          ...(handoffNote ? { handed_off: handoffNote } : {}),
          ...(hunt ? { hunt } : {}),
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

/**
 * The first PARAGRAPH of a refusal, as one line — not its first line.
 *
 * THE BUG THIS FIXES. `why` used to take `bookFailure.split("\n")[0]`, and the refusals it reads
 * are written as wrapped prose for a mail client. On 2026-09-11 that left three arrival rows saying
 *
 *     "You wrote `add`, and I could not read a single lot out of what followed it — so your book is"
 *
 * and stopping there. The next line was "UNCHANGED and I have not opened any work for this." — the
 * half that says what actually happened to her book. The reply she received was complete; it was
 * the AUDIT ROW, whose entire job is saying what was proven, that ended mid-sentence and dropped
 * the word UNCHANGED. A `why` that reads like a truncation bug cannot be used to tell a refusal
 * from a crash.
 *
 * A blank line is the author's own mark for "the summary ends here", so that is the boundary.
 */
function headline(text: string): string {
  return String(text ?? "")
    .split(/\r?\n\s*\r?\n/)[0]!          // up to the first blank line
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" ")
    .trim();
}

  // BOOK_NOT_READ is a fourth outcome beside ROUTED / DEFAULTED / AMBIGUOUS: the message arrived,
  // was hers, named a book verb, and could not be carried out. Recorded as its own fact so it is
  // countable rather than hiding inside "routed".
  // CLOSED is a fifth outcome: the message arrived, was hers, named a commitment and stopped it.
  // Recorded as its own fact so a closure is countable rather than hiding inside "routed".
  // PLAN_ANSWERED is its own outcome: her reply resumed (or annotated) a repo change and opened nothing.
  // DUTY_DRAFTED / DUTY_REFUSED / DUTY_CREATED / DUTY_ANSWERED / DUTY_NOT_UNDERSTOOD: the duty lane's
  // own outcomes, so a draft and its answer are countable rather than hiding inside "routed".
  const outcome = bookFailure ? "BOOK_NOT_READ"
    : dutyNote ? dutyNote.outcome
    : planAnswer ? "PLAN_ANSWERED"
    : commentAnswer ? "COMMENT_INSTRUCTED"
    : closedNote ? "CLOSED"
      : question || closeQuestion ? "NEEDS_CLARITY"
        : admitFailure ? "NOT_ADMITTED" : route.outcome;
  const why = [route.why,
    ...(planAnswer ? [planAnswer.note] : []),
    ...(commentAnswer ? [commentAnswer.note] : []),
    ...(dutyNote ? [headline(dutyNote.note)] : []),
    ...(closedNote ? [closedNote] : []),
    ...(closeQuestion ? [closeQuestion] : []),
    ...(viaConsole ? ["Typed into Boss OS from her own authenticated session, not received over SMTP."] : []),
    ...(bookNote ? [bookNote] : []),
    ...(question ? [`${route.seat.name} asked you a question instead of starting work. ${question.why}`] : []),
    ...(bookFailure ? [`No work was opened: the book instruction could not be read. ${headline(bookFailure)}`] : []),
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
  /*
   * WHEN THE MESSAGE STOPPED, THE REASON IS THE FIRST THING SHE READS. A question or an unreadable
   * verb both mean "nothing was started"; leading with "Monique has it." and eight lines of tag
   * directory buries the only sentence that matters under the reassurance that it worked.
   */
  const stopped = question ? question.ask : planAnswer?.note ?? commentAnswer?.note ?? dutyNote?.note ?? closeQuestion ?? closedNote ?? bookFailure;
  const reply = stopped ? [
    stopped,
    /*
     * A QUESTION DOES NOT REPLACE "I DID NOT KNOW WHO THIS WAS FOR". When the tag was unrecognised
     * she still has to be told which seats exist, or the question and the mis-routing become one
     * confusing message and she fixes neither. On a clean ROUTED message the roster block is noise.
     */
    ...(route.outcome !== "ROUTED" && !dutyNote ? ["", "—", "", replyBody(route, roster, trueSubject)] : []),
  ].join("\n") : [replyBody(route, roster, trueSubject),
    ...(bookNote ? ["", bookNote] : []),
    ...(bookFailure ? ["", bookFailure] : []),
    ...(admitFailure ? ["", `I did NOT open work for this: ${admitFailure}.`] : []),
  ].join("\n");

  await finish({ outcome, why, tag: route.tag, employeeId: dutyNote?.employeeId ?? route.seat.id, taskId, objectKey });
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

  return { mailId, outcome, employeeId: dutyNote?.employeeId ?? route.seat.id, taskId, reply };
}
