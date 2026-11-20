/**
 * THE COMMENT-WATCH LANE — Monique reads the channel's comments; Sequoia decides; Monique acts.
 *
 * One record of the rules, imported by the Worker (the mailbox and the routes), the Mac script
 * and the tests. Nothing here touches a database or the network.
 *
 * ─── The shape ───────────────────────────────────────────────────────────────
 *
 *   1. WEEKLY, Wednesday 14:00 America/Chicago, the Mac runs how-we-know's `loop/comments.py sweep`.
 *      It classifies every new comment and writes a digest of the NEGATIVE and QUESTION ones,
 *      each with Monique's proposed action (hide / reply / ignore) and a drafted reply.
 *   2. A NON-EMPTY digest is posted to Boss OS (`comment_watch_items`, one row per item) and
 *      emailed to her from monique@ with a `[cw_…]` token in the subject and the reply forms
 *      below. An EMPTY digest sends no email and is recorded as NOTHING_TO_REPORT by name.
 *   3. HER REPLY on the #monique tag — verified sender only, below the mailbox's refusal — is
 *      parsed by `parseReply` into one instruction per numbered item, or `your call`, which
 *      turns every proposed action into an instruction pre-approved by her, with the phrase
 *      recorded. Instructions are stored on the rows with who / when / via.
 *   4. THE NEXT MAC RUN fetches only instructed, unapplied rows, hands them to
 *      `loop/comments.py act` — which itself refuses anything without an instruction record —
 *      reports each result back, and emails her one line per action.
 *
 * ─── Why the slot is Wednesday 14:00 ─────────────────────────────────────────
 *
 * Owner correction, 21 Sep 2026: NOT daily at 08:00 — "too much already fires at 08:00". The
 * schedule inventory (~/SCHEDULE.md, the installer, the how-we-know workflows) has the Mac busy
 * 06:00–09:45 every morning, ci-sweep at 10:07 and 18:07, shorts-arm at 11:11, boss-agent at
 * 12:35 and 18:35, the batch at 23:00; Wednesday's only Mac job is the 07:00 packet reminder.
 * Nothing on the Mac fires between 12:35 and 18:00 on any weekday, and the cloud lanes near
 * 14:00 belong to other repos. So: the hourly tick at 14:00 marks the duty due, the Mac claims
 * it at 14:05. The act half runs on its own daily slots so her reply never waits a week.
 */

import { quoteStands } from "../text/wholeSentence.mjs";

export const TASK_KIND = "youtube_comment_watch";
export const DUTY_ID = "duty_youtube_comment_watch";
export const LOCAL_JOB = "youtube-comment-watch.sh";
export const SEAT_TAG = "#monique";
export const DELIVERS = "comment_watch_items";
// Replies go to monique@sequoiataylor.com since 21 Sep 2026 (employeeMail sets reply_to; a routing
// rule per employee delivers it; an untagged reply routes by its To: local part). boss@ still works.
export const REPLY_TO = "monique@sequoiataylor.com";
export const TOKEN_RE = /\[(cw_[a-z0-9]+)\]/i;

export const ACTIONS = ["hide", "reply", "ignore"];

/** Words that hand the whole digest to Monique's proposals. Pre-approval, recorded by phrase. */
export const YOUR_CALL_PHRASES = ["your call", "you decide", "your decision", "you choose", "monique decides"];

/** The exact reply forms the digest email prints. One place, so the mail and the parser agree. */
export const REPLY_FORMS = [
  "`1 delete` — hide it (YouTube keeps it under Held for review; reversible)",
  "`2 reply as drafted` — post Monique's drafted reply as the channel",
  "`3 reply: <your words>` — post your words instead",
  "`4 ignore` — leave it, and never raise it again",
  "`your call` — Monique applies every proposed action above, on your say-so",
];

export function tokenIn(text) {
  const m = TOKEN_RE.exec(text ?? "");
  return m ? m[1].toLowerCase() : null;
}

/** Nothing to send when nothing needs her: the empty-digest rule, as code. */
export function shouldEmail(digest) {
  return Array.isArray(digest?.items) && digest.items.length > 0;
}

/**
 * Parse her reply against the numbered items she was sent.
 *
 * Returns `{ mode, phrase, instructions, unread }`:
 *   mode         `your_call` | `per_number` | `none`
 *   phrase       the pre-approval words when mode is your_call
 *   instructions [{ n, comment_id, action, reply_text }] — one per item she addressed
 *   unread       lines that looked like an instruction and could not be read
 *
 * Per-number forms (tolerant of "1.", "1)", "#1", "1 -"):
 *   N delete | N hide | N remove         → hide
 *   N reply as drafted | N as drafted    → reply with the item's proposed_reply
 *   N reply: <words>                     → reply with her words
 *   N ignore | N leave it | N skip       → ignore
 *
 * `your call` anywhere on its own line wins over stray numbers: every item takes its proposed
 * action (an item proposed `reply` with no drafted text becomes `ignore`, never an empty post).
 * Quoted lines (`>`) and the digest's own text below a signature line are not read.
 */
export function parseReply(text, items) {
  const own = ownLines(text ?? "");
  const byN = new Map((items ?? []).map((it, i) => [Number(it.n ?? i + 1), it]));
  const lower = own.map((l) => l.toLowerCase().trim());

  const phrase = YOUR_CALL_PHRASES.find((p) => lower.some((l) => l === p || l.replace(/[.!]+$/, "") === p));
  if (phrase) {
    const instructions = [];
    for (const [n, it] of byN) {
      let action = ACTIONS.includes(it.proposed_action) ? it.proposed_action : "ignore";
      let reply_text = null;
      if (action === "reply") {
        reply_text = (it.proposed_reply ?? "").trim() || null;
        if (!reply_text) action = "ignore";
      }
      instructions.push({ n, comment_id: it.comment_id, action, reply_text });
    }
    return { mode: "your_call", phrase, instructions, unread: [] };
  }

  const instructions = [];
  const unread = [];
  const seen = new Set();
  for (const raw of own) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^#?\s*(\d{1,3})\s*[.):\-–—]?\s*(.*)$/.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    const rest = m[2].trim();
    const it = byN.get(n);
    if (!it) { unread.push(line); continue; }
    if (seen.has(n)) { unread.push(line); continue; }
    const read = readInstruction(rest, it);
    if (!read) { unread.push(line); continue; }
    seen.add(n);
    instructions.push({ n, comment_id: it.comment_id, ...read });
  }
  // Her prose, clause by clause (fresh review of #473): "approve 1 and 3, skip 2", "reply to 1 as drafted, delete 2, leave 3".
  for (const raw of own) {
    const line = raw.trim();
    if (!line || /^#?\s*\d{1,3}\b/.test(line)) continue;
    for (const m of line.matchAll(CLAUSE)) {
      if (!quoteStands(line, m[0], CLAUSE_SHAPES)) { unread.push(m[0].trim()); continue; }
      for (const n of numbersIn(m[2])) {
        const it = byN.get(n);
        if (!it || seen.has(n)) continue;
        const read = clauseInstruction(m[1], Boolean(m[3]), it);
        if (!read) continue;
        seen.add(n);
        instructions.push({ n, comment_id: it.comment_id, ...read });
      }
    }
  }
  return { mode: instructions.length ? "per_number" : "none", phrase: null, instructions, unread: [...unread, ...namedButUnread(own, byN, seen)] };
}

const CLAUSE = /\b(approved?|ok(?:ay)?|accept|go with|delete|hide|remove|skip|ignore|leave|reply to|reply)\s+((?:#?\d{1,3}(?:\s*(?:,|and|&|\+)\s*(?=#?\d))?)+)(\s+as\s+(?:drafted|proposed))?/gi;
/** A clause that is conditioned, reported or asked never instructs; "don't reply to 2" may well be her "leave it". */
const CLAUSE_SHAPES = ["CONDITIONS", "REPORTS", "ASKS"];
const numbersIn = (t) => [...String(t ?? "").matchAll(/\d{1,3}/g)].map((x) => Number(x[0]));
function proposedOf(it) {
  const action = ACTIONS.includes(it.proposed_action) ? it.proposed_action : "ignore";
  if (action !== "reply") return { action, reply_text: null };
  const draft = (it.proposed_reply ?? "").trim();
  return draft ? { action: "reply", reply_text: draft } : { action: "ignore", reply_text: null };
}
function clauseInstruction(verb, asDrafted, it) {
  const v = verb.toLowerCase();
  if (/^(approved?|ok(ay)?|accept|go with)$/.test(v)) return proposedOf(it);
  if (/^(delete|hide|remove)$/.test(v)) return { action: "hide", reply_text: null };
  if (/^(skip|ignore|leave)$/.test(v)) return { action: "ignore", reply_text: null };
  if (asDrafted) { const draft = (it.proposed_reply ?? "").trim(); return draft ? { action: "reply", reply_text: draft } : null; }
  return null;
}
/** Every comment she named by number that got no instruction is said back to her as unread, never dropped in silence. */
function namedButUnread(own, byN, seen) {
  const named = new Set();
  for (const l of own) for (const n of numbersIn(l)) if (byN.has(n) && !seen.has(n)) named.add(n);
  return [...named].map((n) => `${n}: no instruction read for it`);
}

/*
 * THE FIRST READ DECIDES, PER ITEM (owner ruling 19 Nov 2026; fresh review of #473). Each `comment` command carries the
 * number, an action from a closed list and her words for it; the words must stand in her sentence (the same judge).
 * Where her exact forms read an item plainly, they win over a read that disagrees; an item the read did not instruct
 * keeps what her exact words say; anything she named that neither reading instructed is listed back as unread. Pure.
 */
export const READ_ACTIONS = ["approve", "hide", "ignore", "reply_as_drafted", "reply"];
export function readCommentReply(text, items, readCommands = null) {
  const keyword = parseReply(text, items);
  if (!readCommands) return { ...keyword, by: "KEYWORD" };
  const ownText = ownLines(text ?? "").join("\n");
  const byN = new Map((items ?? []).map((it, i) => [Number(it.n ?? i + 1), it]));
  if (readCommands.some((c) => c.kind === "your_call" && quoteStands(ownText, c.text, CLAUSE_SHAPES))) {
    const all = parseReply("your call", items);
    return { ...all, phrase: readCommands.find((c) => c.kind === "your_call")?.text ?? "your call", by: "FIRST_READ" };
  }
  const instructions = [];
  const unread = [];
  const seen = new Set();
  for (const c of readCommands) {
    if (c.kind !== "comment") continue;
    const it = byN.get(Number(c.n));
    if (!it || seen.has(it.n ?? c.n)) continue;
    if (!READ_ACTIONS.includes(c.action) || !quoteStands(ownText, c.text, CLAUSE_SHAPES)) { unread.push(c.text); continue; }
    let read = null;
    if (c.action === "approve") read = proposedOf(it);
    else if (c.action === "hide" || c.action === "ignore") read = { action: c.action, reply_text: null };
    else if (c.action === "reply_as_drafted") { const d = (it.proposed_reply ?? "").trim(); read = d ? { action: "reply", reply_text: d } : null; }
    else { const w = /reply\s*(?:to\s*#?\d{1,3}\s*)?[:\-–—]\s*(.+)$/is.exec(c.text); read = w && w[1].trim() ? { action: "reply", reply_text: w[1].trim().slice(0, 2000) } : null; }
    if (!read) { unread.push(c.text); continue; }
    seen.add(Number(c.n));
    instructions.push({ n: Number(c.n), comment_id: it.comment_id, ...read });
  }
  // Her exact words win where they read an item plainly and the read says otherwise (live, 20 Nov 2026: Workers AI read
  // "skip 2" as hide); the read fills only what her exact forms cannot read.
  for (const k of keyword.instructions) {
    const at = instructions.findIndex((i) => i.n === k.n);
    if (at >= 0) instructions[at] = k;
    else if (!seen.has(k.n)) { seen.add(k.n); instructions.push(k); }
  }
  const own = ownLines(text ?? "");
  const left = [...unread, ...keyword.unread.filter((u) => !/^\d{1,3}: no instruction read/.test(u)), ...namedButUnread(own, byN, seen)];
  return { mode: instructions.length ? "per_number" : "none", phrase: null, instructions: instructions.sort((a, b) => a.n - b.n), unread: [...new Set(left)], by: "FIRST_READ" };
}

function readInstruction(rest, item) {
  const l = rest.toLowerCase().replace(/[.!]+$/, "").trim();
  if (/^(delete|hide|remove)( it| this)?$/.test(l)) return { action: "hide", reply_text: null };
  if (/^(ignore|leave( it)?|skip|nothing)$/.test(l)) return { action: "ignore", reply_text: null };
  if (/^(reply )?as drafted$/.test(l) || l === "reply" || l === "reply as proposed") {
    const draft = (item.proposed_reply ?? "").trim();
    return draft ? { action: "reply", reply_text: draft } : null;
  }
  const words = /^reply\s*[:\-–—]\s*(.+)$/is.exec(rest);
  if (words && words[1].trim()) return { action: "reply", reply_text: words[1].trim().slice(0, 2000) };
  return null;
}

/** Her own words: stop at a quoted block, a signature rule, or the mail client's "On … wrote:". */
function ownLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith(">")) continue;
    if (/^(--\s*$|—+\s*$|On .+wrote:$|From: .+|-{3,}\s*Original Message)/i.test(t)) break;
    if (/^Sent from my/i.test(t)) break;
    out.push(line);
  }
  return out;
}

/** The digest she reads. Numbered, quoted, the video, the author, the proposal, the draft, the forms. */
export function digestEmail(digest, token) {
  const items = digest.items ?? [];
  const n = items.length;
  const subject = `${SEAT_TAG} ${n} comment${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your word [${token}]`;
  const lines = [
    "Sequoia,",
    "",
    `This is Monique. I read every new comment on the channel this week — ${digest.new_comments ?? n} new,`
      + ` ${countLine(digest.by_class)}. ${n === 1 ? "One needs" : `${n} need`} your word; nothing has been`
      + " posted or hidden.",
    "",
    "Reply to this email, one line per number:",
    ...REPLY_FORMS.map((f) => `  ${f}`),
    "",
    "---",
    "",
  ];
  items.forEach((it, i) => {
    const k = i + 1;
    lines.push(`${k}. ${labelFor(it.class)} on "${it.video_title || it.video_id}" — ${it.author || "unknown"}, ${when(it.published_at)}`);
    lines.push(`   > ${(it.text || "").replace(/\s*\n\s*/g, " / ").slice(0, 700)}`);
    lines.push(`   Monique proposes: ${proposeLine(it)}`);
    if (it.proposed_action === "reply" && it.proposed_reply) lines.push(`   Drafted reply: "${it.proposed_reply}"`);
    if (it.product_note) lines.push(`   Note for the narration lexicon: ${it.product_note}`);
    lines.push("");
  });
  lines.push("— Monique, Director of Relationships");
  // The owner layout (7 Nov 2026): drafted replies wait on her word (A), the REF in the subject.
  return { subject, text: lines.join("\n"), owner: { layout: "approve", ref: token, why: `${n === 1 ? "One comment" : `${n} comments`} on the channel need${n === 1 ? "s" : ""} your word; nothing has been posted or hidden`, act: "Reply with one line per number to approve, change or skip." } };
}

/** One line per action, after `act` has run. */
export function confirmationEmail(results, token) {
  const subject = `${SEAT_TAG} done: ${results.length} comment action${results.length === 1 ? "" : "s"} [${token}]`;
  const lines = ["Sequoia,", "", "Applied, as you instructed:", ""];
  results.forEach((r, i) => lines.push(`${i + 1}. ${r.n ? `#${r.n} ` : ""}${r.result}${r.author ? ` — ${r.author}` : ""}`));
  lines.push("", "— Monique");
  return { subject, text: lines.join("\n"), owner: { layout: "delivered", ref: token, why: `Monique did the ${results.length === 1 ? "comment action" : `${results.length} comment actions`} you asked for`, act: "Nothing to do." } };
}

function countLine(byClass) {
  const c = byClass ?? {};
  const parts = ["praise", "question", "negative", "spam", "other"].filter((k) => c[k]).map((k) => `${c[k]} ${k}`);
  return parts.length ? parts.join(", ") : "none new";
}
function labelFor(cls) { return cls === "question" ? "Question" : cls === "negative" ? "Negative" : cls ?? "Comment"; }
function proposeLine(it) {
  if (it.proposed_action === "hide") return "hide it";
  if (it.proposed_action === "reply") return "reply";
  return "ignore";
}
function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
