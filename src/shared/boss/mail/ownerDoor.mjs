/**
 * THE ONE DOOR: THE REQUIRED MINIMUM ON EVERY EMAIL TO HER, AT THE SEND (owner-approved plan, Wave 4,
 * 13 Nov 2026; Open Loops olp_m6v5tc60yyjdefka).
 *
 * `minimumProblems` (ownerLayout.mjs) was read by a test only, and a sender that stated no layout
 * skipped it. Every send to her now passes through `ownerDoor`, on exactly what would be sent: the Mac
 * through `postEmployeeMail` (scripts/ops/notify.mjs), the Worker through `throughOwnerDoor`
 * (src/worker/boss/mail/ownerDoor.ts). Guard: tests/ownerDoor.test.ts.
 *
 * THE RULE IS REPAIR, NOT BLOCK. What is mechanical is repaired here, and the repair is named:
 *   · no plain-text part            → written from the HTML;
 *   · no layout stated              → filed as a Note, line 1 written from its own opening sentence (or the subject);
 *   · line 1 missing or incomplete  → line 1 says what it is and whether she must do anything;
 *   · "Nothing to do" above Decide  → line 1 says how many things are hers to answer;
 *   · "needs you" where nothing is  → the phrase goes (the email itself says nothing is needed);
 *   · no subject, or a stock one    → the subject is what line 1 says it is;
 *   · a REF that a reply needs      → added to the subject;
 *   · no Reply-To, or a copy to someone else → the sender's own address; the copies removed.
 * (Raw ids, paths and UTC stamps are the plain gate's repair, `simplifyForOwner`, run beside this.)
 *
 * What cannot be repaired is HELD as a named stop a team repair job picks up; never dropped, never a
 * question to her. EXCEPT an email that truly needs her today (`mustGo`): it goes with the best repair
 * and the problem is logged for the team. "Truly hers" is the Wave 2 test (`systemRow`,
 * openLoops.mjs): she must act, and it is not about the system's own work. Pure; no node imports.
 */
import { minimumProblems, ownerLine, defaultAct, saysNothingToDo, layoutOf } from "./ownerLayout.mjs";
import { NOTHING_TO_DECIDE, MAX_SUBJECT_CHARS, cleanSubject, legacyParts, lineProblems } from "./plain.mjs";
import { systemRow } from "../openLoops/openLoops.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const core = (s) => String(s ?? "").trim().replace(/[.!?…:]$/, "");
const STOCK_SUBJECT = /^a note from your team$/i;
const NEEDS_HER = /\bneeds? (?:a look|you)\b/i;
const STRUCTURE = /^(?:Decide \(\d+\)|Nothing to decide\b|What (?:happened|broke|we did|was lost):|Status\b|Details:|[-*•]\s|\d+\.\s)/;

/** The subject without its REF and version tail. */
export const bareSubject = (subject) => String(subject ?? "").replace(/\s*·\s*REF BOS-\S+$/, "").replace(/\s*·\s*v\d+$/, "").trim();
/** How many things the email puts under Decide. */
export const decideCount = (text) => Number(/^Decide \((\d+)\)$/m.exec(String(text ?? ""))?.[1] ?? 0);

/** A readable plain-text part from an HTML one. */
export function textFromHtml(html) {
  return String(html ?? "").replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, url, label) => `${label.replace(/<[^>]+>/g, "").trim()}: ${url.replace(/&amp;/g, "&")}`)
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, "\n\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Put `line` at the top of the text and the HTML; an old first line that it replaces goes. */
function withLine1(p, line, replaces = null) {
  const lines = String(p.text ?? "").split("\n");
  let html = p.html ?? null;
  if (replaces !== null && lines.length) {
    if (html && html.includes(esc(replaces))) html = html.replace(esc(replaces), esc(line));
    else if (html) html = topOfHtml(html, line);
    lines[0] = line;
    return { ...p, text: lines.join("\n"), html };
  }
  // The older shape's own "Nothing to decide" line would now say it twice.
  const rest = lines.filter((l) => l !== NOTHING_TO_DECIDE).join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
  if (html) html = topOfHtml(String(html).replace(new RegExp(`<p[^>]*>${esc(NOTHING_TO_DECIDE)}</p>`), ""), line);
  return { ...p, text: rest ? `${line}\n\n${rest}` : line, html };
}
function topOfHtml(html, line) {
  const para = `<p style="margin:0 0 12px;font-size:14px;line-height:1.55">${esc(line)}</p>`;
  const at = /<body[^>]*>\s*(?:<div[^>]*>)?/i.exec(html);
  return at ? `${html.slice(0, at.index + at[0].length)}${para}${html.slice(at.index + at[0].length)}` : `${para}${html}`;
}

/** "needs you" / "need a look" said in an email that needs nothing from her: the phrase goes. */
function dropNeedsHer(s) {
  return String(s ?? "")
    .replace(/\s*[:,;—–-]\s*needs? (?:a look|you)\b\.?/gi, "")
    .replace(/\bneeds (?:a look|you)\b/gi, "is with the team")
    .replace(/\bneed (?:a look|you)\b/gi, "are with the team");
}

/**
 * Does it truly need her today? She must act (a Decide list, or line 1 asks her for something), and
 * it is not about the system's own work (Wave 2's `systemRow`: a stopped job, a queue, an agent, a
 * limit are the team's). Such an email is never held. Pure.
 */
export function trulyNeedsHer(payload, minimum) {
  const asks = decideCount(payload?.text) > 0 || Boolean(minimum?.act && !saysNothingToDo(minimum.act));
  return asks && !systemRow({ title: bareSubject(payload?.subject) });
}

/**
 * The door. `payload` is what would be sent ({ subject, text, html, to, reply_to, headers, cc, bcc });
 * `minimum` the laid email's own (it also rides on an `employeeMail` payload, non-enumerable);
 * `replyTo` the sender's routed address; `routed` every address the Worker routes (optional).
 * Returns `{ payload, minimum, repaired, problems, mustGo }`: `repaired` names each repair made,
 * `problems` what still misses the minimum after them ([] = it may go).
 */
export function ownerDoor(payload, { minimum = null, replyTo = null, routed = null } = {}) {
  const repaired = [];
  let p = { ...payload, headers: { ...(payload?.headers ?? {}) } };
  let m = minimum ?? payload?.minimum ?? null;

  if (!String(p.text ?? "").trim() && String(p.html ?? "").trim()) {
    p.text = textFromHtml(p.html);
    if (p.text) repaired.push("no plain-text part: written from the HTML");
  }
  const n = decideCount(p.text);
  const first = () => String(String(p.text ?? "").split("\n")[0] ?? "").trim();
  const said = bareSubject(p.subject);
  const what = said.length >= 6 && !STOCK_SUBJECT.test(said) ? said : "";

  // No layout stated: a Note, with line 1 written from what the email already says it is.
  if (!m) {
    const layout = layoutOf(p.headers["X-Boss-Layout"]);
    // Whether she must act is read from the email itself, never assumed: its Decide list, or (an older
    // block of text) the lines that ask her for something. An ask is never repaired into "Nothing to do".
    const asks = n || (NEEDS_HER.test(`${p.subject ?? ""}\n${p.text ?? ""}`) ? Math.max(1, legacyParts({ who: "", subject: p.subject ?? "", text: p.text ?? "" }).needs.length) : 0);
    // Its own opening sentence says what it is better than a repeated subject does, when it is a plain
    // sentence (not a heading, not a code); line 1 then keeps it and adds whether she must act.
    const opening = first();
    const sentence = opening.length >= 12 && opening.length <= 220 && !STRUCTURE.test(opening) && !lineProblems(opening).length;
    const why = sentence ? opening : what || opening;
    m = { why, act: defaultAct(asks, layout), ref: null, refShown: false, declared: Boolean(why), layout };
    p.headers["X-Boss-Layout"] = layout;
    p.headers["X-Boss-Owner-Line"] = "1";
    repaired.push(`no layout stated: filed as a ${layout === "note" ? "Note" : layout}`);
  } else if (!m.declared || !m.why) {
    m = { ...m, why: what || first(), declared: Boolean(what || first()) };
    if (m.declared) repaired.push("the sender never said why: line 1 says what the subject says");
  }

  // "Nothing to do" above a Decide list: line 1 says how many are hers.
  if (n > 0 && saysNothingToDo(m.act)) {
    m = { ...m, act: defaultAct(n, m.layout) };
    repaired.push('"Nothing to do" above a Decide list: line 1 now says what is hers to answer');
  }
  // "needs you" in an email that needs nothing from her.
  if (n === 0 && saysNothingToDo(m.act) && (NEEDS_HER.test(p.subject ?? "") || NEEDS_HER.test(p.text ?? ""))) {
    p = { ...p, subject: dropNeedsHer(p.subject), text: dropNeedsHer(p.text), html: p.html ? dropNeedsHer(p.html) : p.html };
    repaired.push('"needs you" on an email that needs nothing: the phrase removed');
  }
  // The subject says what it is.
  const bare = bareSubject(p.subject);
  if ((bare.length < 6 || STOCK_SUBJECT.test(bare)) && core(m.why).length >= 6) {
    let s = cleanSubject(core(m.why));
    if (s.length > MAX_SUBJECT_CHARS) s = `${s.slice(0, MAX_SUBJECT_CHARS - 1).replace(/\s+\S*$/, "")}…`;
    if (s.length >= 6) { p.subject = s; repaired.push("the subject did not say what it is: written from line 1"); }
  }
  // The REF where a reply matters.
  if (m.ref && m.layout !== "digest" && (m.refShown || !saysNothingToDo(m.act)) && !String(p.subject ?? "").includes(m.ref)) {
    const tail = ` · REF ${m.ref}`;
    const base = bareSubject(p.subject);
    p.subject = `${base.length + tail.length > MAX_SUBJECT_CHARS ? `${base.slice(0, MAX_SUBJECT_CHARS - tail.length - 1).replace(/\s+\S*$/, "")}…` : base}${tail}`;
    m = { ...m, refShown: true };
    repaired.push("a reply matters and the subject had no REF: added");
  }
  // Line 1: why she is getting it, and whether she must do anything.
  const want = ownerLine(m.why, m.act);
  const line = first();
  const saysWhy = Boolean(m.why) && line.includes(core(ownerLine(m.why, "")));
  const saysAct = Boolean(m.act) && line.includes(core(ownerLine("", m.act)));
  if (want && !(saysWhy && saysAct)) {
    // A first line that already says why (or whether to act) is the old line 1: replaced, not repeated.
    p = withLine1(p, want, line && (saysWhy || saysAct || /^Nothing to do\b/.test(line)) ? line : null);
    repaired.push(line ? "line 1 did not say what it is and whether she must do anything: written" : "line 1 was empty: written");
  }
  // Line 1 says something is hers: the older shape's "Nothing to decide" line below it would contradict it.
  if (!saysNothingToDo(m.act) && String(p.text ?? "").split("\n").includes(NOTHING_TO_DECIDE)) {
    p = { ...p, text: String(p.text).split("\n").filter((l) => l !== NOTHING_TO_DECIDE).join("\n").replace(/\n{3,}/g, "\n\n"), html: p.html ? String(p.html).replace(new RegExp(`<p[^>]*>${esc(NOTHING_TO_DECIDE)}</p>`), "") : p.html };
    repaired.push('"Nothing to decide" under a line 1 that asks her for something: removed');
  }
  // A reply reaches the job; nobody else is copied.
  if (!String(p.reply_to ?? "").trim() && replyTo) { p.reply_to = replyTo; repaired.push("no Reply-To: the sender's own address"); }
  if ((p.cc ?? []).length || (p.bcc ?? []).length) {
    const { cc: _cc, bcc: _bcc, ...rest } = p;
    p = rest;
    repaired.push("copied someone else: the copies removed");
  }
  if (!Object.keys(p.headers).length) delete p.headers;
  const problems = minimumProblems(p, m, { routed });
  Object.defineProperty(p, "minimum", { value: m, enumerable: false });
  return { payload: p, minimum: m, repaired, problems, mustGo: trulyNeedsHer(p, m) };
}

/**
 * ONE EMAIL PER EVENT IN A RUN. The event is the job it is about (its tokens) and what it says it is
 * (the subject, REF and version aside). `seen` is the run's own Set; `true` = this one already went.
 */
export function eventKey(payload) {
  const refs = String(payload?.headers?.["X-Boss-Ref"] ?? "").split(/\s+/).filter(Boolean).sort().join(" ");
  const to = (Array.isArray(payload?.to) ? payload.to : [payload?.to]).filter(Boolean).map((a) => String(a).toLowerCase()).sort().join(",");
  return `${to}|${refs}|${bareSubject(payload?.subject).replace(/\s+/g, " ").toLowerCase()}`;
}
