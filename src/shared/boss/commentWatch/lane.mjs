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
  return { mode: instructions.length ? "per_number" : "none", phrase: null, instructions, unread };
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
  return { subject, text: lines.join("\n") };
}

/** One line per action, after `act` has run. */
export function confirmationEmail(results, token) {
  const subject = `${SEAT_TAG} done: ${results.length} comment action${results.length === 1 ? "" : "s"} [${token}]`;
  const lines = ["Sequoia,", "", "Applied, as you instructed:", ""];
  results.forEach((r, i) => lines.push(`${i + 1}. ${r.n ? `#${r.n} ` : ""}${r.result}${r.author ? ` — ${r.author}` : ""}`));
  lines.push("", "— Monique");
  return { subject, text: lines.join("\n") };
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
