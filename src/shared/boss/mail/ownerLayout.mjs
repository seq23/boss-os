/**
 * THE ONE LAYOUT FOR EVERY BOSS OS EMAIL TO HER (owner, 7 Nov 2026, personal brain, Settled
 * decisions: "ONE required minimum on every email … Then layouts used when they fit, never a gate").
 *
 * The required minimum, met by construction here and proved for every sender by
 * tests/ownerEmailMinimum.test.ts:
 *   1. the subject says what it is, plus a REF code where a reply matters (`BOS-XXXXXX`, refCode);
 *   2. line 1 says why she is getting it and whether she must do anything ("Nothing to do." counts);
 *   3. a reply reaches the job that sent it: Reply-To is the employee's own address (the Worker's
 *      inbound route), the job token rides in `X-Boss-Ref` against the Message-ID her reply quotes,
 *      and the REF code finds the job when the thread is lost (`boss_mail_refs.ref_code`).
 *
 * The layouts, used when they fit (an unknown one is a Note, never a refusal):
 *   approve   A  vN on drafts, the REF, the thing inline, what changed per note
 *   delivered D  here's what you asked for: answers, deliverables, research, preps
 *   digest    B  the daily digest: items as mini A or D cards
 *   alarm     C  what broke + REF, anything lost, what is being done, the one thing to do
 *   note         the catch-all plain email that still meets the minimum
 *
 * The layout rides in `X-Boss-Layout`, is kept on the sent-mail record (`boss_sent_mail.layout`), and
 * the Updates page counts the week's Notes in one line (`notesLine`), so she can see when a new
 * layout is needed. Built on `layoutEmail` / `layoutProblem` (plain.mjs): every gate there still holds.
 */
import { layoutEmail, layoutProblem, legacyParts, cleanText, cleanSubject, refCode, NOTHING_TO_DO, REF_CODE_RE, MAX_SUBJECT_CHARS } from "./plain.mjs";

export { refCode, NOTHING_TO_DO, REF_CODE_RE };

export const LAYOUTS = Object.freeze({ approve: "A", delivered: "D", digest: "B", alarm: "C", note: "Note" });
const KNOWN = new Set(Object.keys(LAYOUTS));
/** The layout an email is filed under; anything unknown or missing is a Note (never blocked). */
export const layoutOf = (name) => (KNOWN.has(String(name ?? "")) ? String(name) : "note");

const sentence = (s) => { const t = String(s ?? "").trim(); return !t ? "" : /[.!?…:]$/.test(t) ? t : `${t}.`; };
/** True when the act part of line 1 says she has nothing to do. */
export const saysNothingToDo = (act) => String(act ?? "").trim().startsWith(NOTHING_TO_DO);

/** What line 1 says she must do, when the sender did not say: read from the Decide count. */
export function defaultAct(decideCount, layout) {
  if (decideCount > 0 && layout === "approve") return "Approve it, or say what to change, below.";
  if (decideCount > 0) return decideCount === 1 ? "One thing for you to answer below." : `${decideCount} things for you to answer below.`;
  return layout === "alarm" ? `${NOTHING_TO_DO} The team is fixing it.` : NOTHING_TO_DO;
}

/** Line 1: why she is getting it, then whether she must do anything. */
export function ownerLine(why, act) {
  return [sentence(why), sentence(act)].filter(Boolean).join(" ");
}

/**
 * Lay out an email to her. `spec`:
 *   who, subject, layout, why, act?                        — every layout
 *   ref?, refs?                                            — the job token(s); the REF code is made from the first
 *   happened?, decide?, needs?, sections?, details?, footer?, postscript?, maxDecide?, moreDecide?, kind? — as layoutEmail
 *   text?                                                  — a sender that still writes one block (read by legacyParts)
 *   lineTail?                                              — short lines that stay right under line 1, each its own line (the morning's law, calendar)
 *   version?, changed? (string[]), thing? ({ title?, heading?, text }) — approve (A)
 *   broke, lost?, doing, status?, done?, happenedLabel?    — alarm (C), as layoutProblem
 * Returns the laid email with `layout` and `minimum: { why, act, ref, refShown, declared }`.
 */
export function ownerEmail(spec) {
  const layout = layoutOf(spec.layout);
  let parts = { ...spec };
  if (typeof spec.text === "string" && !spec.happened && !(spec.sections ?? []).length && layout !== "alarm") {
    const legacy = legacyParts({ who: spec.who, subject: spec.subject, text: spec.text, refs: spec.refs ?? [] });
    parts = { ...parts, happened: legacy.happened, needs: [...(spec.needs ?? []), ...legacy.needs], details: [...legacy.details, ...(spec.details ?? [])], refs: legacy.refs };
  }
  const jobRefs = [...new Set([spec.ref, ...(parts.refs ?? [])].filter(Boolean).map((r) => String(r).toLowerCase()))];
  const decideCount = [...(Array.isArray(parts.decide) ? parts.decide : parts.decide ? [parts.decide] : []), ...(Array.isArray(parts.needs) ? parts.needs : parts.needs ? [parts.needs] : [])].filter(Boolean).length;
  const why = cleanText(spec.why ?? "");
  const act = cleanText(spec.act ?? "") || defaultAct(decideCount, layout);
  const code = jobRefs.length ? refCode(jobRefs[0]) : null;
  // A REF where a reply matters: always on approve and alarm, and on any email that asks her for something.
  // Never on the digest: each of its cards has its own "Reply N: …", and one code for many would mislead.
  const refShown = Boolean(code) && layout !== "digest" && (layout === "approve" || layout === "alarm" || !saysNothingToDo(act));
  // The REF and vN always fit: the words before them are trimmed to the subject cap, never the code
  // (7 Nov 2026 live read: a long task title pushed the REF off the end).
  const tail = [layout === "approve" && Number(spec.version) > 0 ? `v${Number(spec.version)}` : null, refShown ? `REF ${code}` : null].filter(Boolean).map((t) => ` · ${t}`).join("");
  let base = cleanSubject(spec.subject);
  if (base.length + tail.length > MAX_SUBJECT_CHARS) base = `${base.slice(0, MAX_SUBJECT_CHARS - tail.length - 1).replace(/\s+\S*$/, "")}…`;
  const subject = `${base}${tail}`;
  // `lineTail`: what must stay above the fold after the act (the morning's law, the ancestral hour, her calendar).
  const lead = ownerLine(why || cleanText(parts.happened ?? "") || cleanText(spec.subject ?? ""), act);
  const leadNotes = (Array.isArray(spec.lineTail) ? spec.lineTail : [spec.lineTail]).map((x) => cleanText(x ?? "")).filter(Boolean);
  const footer = [parts.footer, refShown ? `Ref ${code}: reply to this email and it reaches the job.` : null].filter(Boolean).join(" ") || null;

  let laid;
  if (layout === "alarm") {
    laid = layoutProblem({
      who: spec.who, subject, lead, happened: spec.broke ?? parts.happened, lost: spec.lost ?? null, did: spec.doing ?? spec.did,
      status: spec.status, done: Boolean(spec.done), decide: parts.decide ?? [], refs: jobRefs, happenedLabel: spec.happenedLabel ?? "What happened:",
    });
  } else {
    const extra = [];
    if (layout === "approve") {
      const changed = (spec.changed ?? []).map((c) => cleanText(c)).filter(Boolean);
      if (changed.length) extra.push({ title: Number(spec.version) > 1 ? `What changed in v${Number(spec.version)}` : "What changed", items: changed, empty: null });
      if (spec.thing?.text) extra.push({ title: spec.thing.title ?? "The draft", cards: [{ title: spec.thing.heading ?? "Word for word", draft: { heading: "The words that go out", text: spec.thing.text } }], empty: null });
    }
    laid = layoutEmail({
      who: spec.who, subject, lead, leadNotes, happened: why && parts.happened && cleanText(parts.happened) !== why ? parts.happened : "", decide: parts.decide ?? [], needs: parts.needs ?? [],
      sections: [...extra, ...(parts.sections ?? [])], details: parts.details ?? [], refs: jobRefs, footer, postscript: parts.postscript ?? null,
      ...(parts.maxDecide !== undefined ? { maxDecide: parts.maxDecide } : {}), ...(parts.moreDecide ? { moreDecide: parts.moreDecide } : {}), kind: parts.kind === "morning" ? "morning" : "plain",
    });
  }
  return { ...laid, ...(spec.kind === "report" ? { kind: "report" } : {}), layout, minimum: { why, act, ref: code, refShown, declared: Boolean(why), layout } };
}

/**
 * THE 3-POINT MINIMUM, CHECKED ON WHAT WOULD BE SENT (a payload from `employeeMail`, or a laid email
 * plus its sender). `[]` = met. Read by tests/ownerEmailMinimum.test.ts for every sender to her; never
 * a send-time gate (nothing is ever blocked for being the wrong kind).
 *   payload  { subject, text, html, reply_to?, headers?, cc?, bcc? }
 *   minimum  the laid email's `minimum`
 *   routed   the addresses the Worker routes to a job (the roster's employee addresses)
 */
export function minimumProblems(payload, minimum, { routed = null } = {}) {
  const out = [];
  const subject = String(payload?.subject ?? "").trim();
  const lines = String(payload?.text ?? "").split("\n");
  if (!minimum) return ["no owner layout: the sender did not use ownerEmail"];
  // 1. The subject says what it is (not a stock fallback), with the REF where a reply matters.
  const bare = subject.replace(/\s*·\s*REF BOS-\S+$/, "").replace(/\s*·\s*v\d+$/, "").trim();
  if (bare.length < 6 || /^a note from your team$/i.test(bare)) out.push(`1. the subject does not say what it is: "${subject}"`);
  if (minimum.refShown && !(minimum.ref && subject.includes(minimum.ref))) out.push("1. a reply matters but the subject has no REF code");
  if (!minimum.refShown && !saysNothingToDo(minimum.act) && minimum.ref && minimum.layout !== "digest") out.push("1. she must act and the job has a REF, but the subject does not show it");
  // 2. Line 1 says why, and whether she must do anything, and agrees with the body.
  if (!minimum.declared) out.push("2. the sender never said why she is getting it");
  const first = String(lines[0] ?? "").trim();
  if (!first) out.push("2. line 1 is empty");
  else {
    if (minimum.why && !first.includes(sentence(minimum.why).replace(/[.!?…:]$/, ""))) out.push(`2. line 1 does not say why: "${first}"`);
    if (!minimum.act || !first.includes(sentence(minimum.act).replace(/[.!?…:]$/, ""))) out.push(`2. line 1 does not say whether she must do anything: "${first}"`);
  }
  const decideHeading = lines.some((l) => /^Decide \(\d+\)$/.test(l));
  if (decideHeading && saysNothingToDo(minimum.act)) out.push('2. line 1 says "Nothing to do" above a Decide list');
  // 3. A reply reaches the job: Reply-To is a routed employee address; the job token rides the thread.
  const replyTo = String(payload?.reply_to ?? "").toLowerCase().replace(/^.*<|>.*$/g, "");
  if (!replyTo) out.push("3. no Reply-To: her reply would not reach the job");
  else if (routed && !routed.some((a) => replyTo === String(a).toLowerCase())) out.push(`3. Reply-To ${replyTo} is not an address the Worker routes`);
  if (minimum.ref && !String(payload?.headers?.["X-Boss-Ref"] ?? "").trim()) out.push("3. the job token is not on the email, so her reply cannot find the job");
  // Never Scooter, never anyone else: one recipient, no copies.
  if ((payload?.cc ?? []).length || (payload?.bcc ?? []).length || (Array.isArray(payload?.to) && payload.to.length !== 1)) out.push("an email to her copies someone else");
  return out;
}

/** The Updates page's one line: how many emails this week fit no layout yet (owner: "we need a catchall bucket"). */
export function notesLine(count, days = 7) {
  const n = Number(count) || 0;
  if (n === 0) return `Every email the team sent you in the last ${days} days fit one of its layouts.`;
  return `${n} email${n === 1 ? "" : "s"} in the last ${days} days ${n === 1 ? "was a plain note" : "were plain notes"}, fitting no layout yet. When this stays high, a new layout is due.`;
}
