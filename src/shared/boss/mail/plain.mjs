/**
 * EVERY EMAIL SHE GETS FROM BOSS OS, IN ONE PLAIN LAYOUT (owner, 22 Oct 2026).
 *
 * Her words: "U need to fix the massive problem of all the emails from the boss OS agents being
 * confusing hard to read hard to understand. Lots of jargon not formatted well." Real subjects that
 * day carried `#danielle`, `[rc_m5jh89zfkeyv3tmm]`, "NOT publish-ready", a duty slug, a cron-shaped
 * time with `America/Chicago`, and "OpenAI, OpenAI, OpenAI, OpenAI, Blue Origin".
 *
 * ONE MODULE, BOTH SENDERS. The Mac sends through `scripts/ops/notify.mjs` (`employeeMail`, which
 * every Mac sender reaches through `sendAsEmployee`), and the Worker answers her mail with
 * `message.reply()` in `src/worker/index.ts`. Both call `layoutEmail` / `fromLegacy` here, so no
 * email reaches her without passing through this file. `tests/plainEmail.test.ts` renders a sample
 * of every sender and fails on any banned pattern, and fails if a sending file skips this path.
 *
 * THE LAYOUT, in this order:
 *   1. the first line says what happened, in everyday words;
 *   2. "What I need from you:" with 1–3 bullets, or "Nothing — this is just so you know.";
 *   3. the details, in short bullets;
 *   4. the employee's name, once.
 *
 * THE REPLY TOKENS LEAVE THE VISIBLE TEXT. `[rc_…]`, `[dd_…]`, `[tsk_…]`, `[cw_…]` and `[kml_…]`
 * used to ride in the subject so her reply could name its job. They are pulled out here into
 * `refs`, sent in the `X-Boss-Ref` header, and recorded against the sent message's Message-ID
 * (`boss_mail_refs`); her client puts that Message-ID in `References`, and the inbound handler reads
 * the refs back from it (`refsForChain`, src/worker/boss/intake/mailRefs.ts). Nothing she sees
 * carries a code.
 */

/** Words that stay in capitals: real acronyms, not shouting. */
export const ACRONYMS = new Set([
  "AI", "API", "CEO", "CFO", "CI", "CSV", "DKIM", "DMARC", "DNS", "FAQ", "FYI", "GP", "HTML", "ID", "IDS", "IPO", "IRA",
  "KDP", "LLC", "LP", "LPS", "NYC", "OK", "PDF", "PR", "PRS", "SEO", "SMS", "SPF", "TLC", "TV", "UK", "URL", "US", "USA",
  "UTC", "VC", "PNG", "AM", "PM", "ET", "CT", "PT", "Q1", "Q2", "Q3", "Q4", "ABA", "ADHD", "TRT", "IV", "LGCV", "OS",
  "SPV", "ESOP", "RSU", "IRS", "SEC", "FINRA", "BD", "AUM", "HNW", "YC", "ISBN", "DMs", "HQ", "ASAP", "EOD", "USCIS",
]);

/**
 * THE JARGON LIST — THE ONE PLACE IT IS KEPT.
 *
 * `ban` is what the guard refuses in anything she sees; `plain` is what the cleaner writes instead.
 * Add a word here and both the cleaner and `tests/plainEmail.test.ts` pick it up; there is no
 * second list to forget.
 */
export const JARGON = [
  { ban: /\bledger hunt\b/i, find: /\bledger hunt\b/gi, plain: "check of your new messages" },
  { ban: /\bledgers?\b/i, find: /\bledger(s?)\b/gi, plain: "records" },
  { ban: /\bpairings?\b/i, find: /\bpairing(s?)\b/gi, plain: (m, s) => (s ? "possible matches" : "possible match") },
  { ban: /\bcross(es)?\b/i, find: /\bcross(es)?\b/gi, plain: (m, es) => (es ? "matches" : "match") },
  { ban: /\broutes?\b/i, find: /\broute(s?)\b/gi, plain: (m, s) => (s ? "places" : "place") },
  { ban: /\blanes?\b/i, find: /\blane(s?)\b/gi, plain: (m, s) => (s ? "jobs" : "job") },
  { ban: /\bslugs?\b/i, find: /\bslug(s?)\b/gi, plain: (m, s) => (s ? "names" : "name") },
  { ban: /\bseats?\b/i, find: /\bseat(s?)\b/gi, plain: (m, s) => (s ? "teammates" : "teammate") },
  { ban: /\bduty_/i, find: /\bduty_[a-z0-9_]*/gi, plain: "" },
  { ban: /\bNAMED STOP\b/i, find: /\bNAMED STOP\b(?:\s*\[[A-Z0-9_]+\])?:?/g, plain: "Stopped:" },
  { ban: /\bexecutor\b/i, find: /\bexecutor\b/gi, plain: "the teammate who runs it" },
  { ban: /\bpayload\b/i, find: /\bpayload\b/gi, plain: "details" },
];

/** The reply tokens a lane reads back from her answer. Pulled out of the text into `refs`. */
export const REF_RE = /\b(?:rc|dd|tsk|cw|kml|yd)_[a-z0-9]{3,40}\b/gi;

/** Every internal id shape: a known prefix, or a short prefix and an underscore with a digit in it. */
const ID_RE = /\b(?:(?:rc|dd|tsk|wc|cw|kml|apr|iml|emp|cred|yd|mail|run)_[a-z0-9_]{3,}|[a-z]{2,5}_[a-z0-9]*\d[a-z0-9]*)\b/gi;
const BRACKETED_ID_RE = /\[[a-z]{2,5}_[^\]\s]*\]/i;
const SNAKE_RE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/;
const CRON_RE = /(?:^|\s)(?:[\d*/,-]+\s+){4}[\d*/,-]+(?=\s|$)/;
const TZ_RE = /\b(?:America|Europe|Asia|Africa|Australia|Pacific|Atlantic|Etc)\/[A-Za-z_]+\b/g;
const URL_RE = /\bhttps?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SECRET_LINE_RE = /\bSECRET [A-Z][A-Z0-9_]*=(?:<value>)?/g;
const MAC_PATH_RE = /(?:~|\/Users\/[^\s/]+)(?:\/[^\s,;)]+)+/g;

export const NOTHING_NEEDED = "Nothing — this is just so you know.";
export const NEEDS_HEADING = "What I need from you:";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "13:00" → "1 pm", "09:30" → "9:30 am". Only zero-padded 24-hour times; "6:05" is already plain. */
export function clockWords(h, m) {
  const hour = Number(h);
  const min = Number(m);
  const ampm = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return min === 0 ? `${h12} ${ampm}` : `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

function protect(s) {
  const kept = [];
  const keep = (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; };
  // `SECRET NAME=<value>` is a line she types exactly, so the key's name is kept as written.
  const out = String(s).replace(SECRET_LINE_RE, keep).replace(URL_RE, keep).replace(EMAIL_RE, keep);
  return { out, restore: (t) => t.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]) };
}

function capsWord(w) {
  const bare = w.replace(/[^A-Za-z0-9]/g, "");
  if (bare.length < 2 || !/^[A-Z][A-Z0-9]*$/.test(bare) || !/[A-Z]{2}/.test(bare)) return w;
  if (ACRONYMS.has(bare) || ACRONYMS.has(bare.toUpperCase())) return w;
  return w.toLowerCase();
}

/**
 * One line, made plain: no ids, no snake_case, no cron or time-zone strings, no shouting, no jargon.
 * Idempotent, so a structured sender that already wrote plainly passes through untouched.
 */
export function cleanText(input) {
  if (input === null || input === undefined) return "";
  const { out, restore } = protect(String(input));
  let s = out;
  const wasAllCaps = /[A-Z]{3}/.test(s) && !/[a-z]/.test(s.replace(/\u0000\d+\u0000/g, ""));
  s = s.replace(/`/g, "");
  s = s.replace(/\b(\w+)\((e?s)\)/g, "$1$2");
  for (const j of JARGON) s = s.replace(j.find, j.plain);
  // Ids: bracketed or in parentheses go with their brackets; bare ones go alone.
  s = s.replace(/\s*[[(]\s*(?:[a-z]{2,5}_[a-z0-9_]+)\s*[\])]/gi, "");
  s = s.replace(ID_RE, "");
  // Cron, then "13:00 America/Chicago" → "1 pm".
  s = s.replace(/(?:^|\s)(?:[\d*/,-]+\s+){4}[\d*/,-]+(?=\s|$)/g, (m) => (/\*/.test(m) ? "" : m));
  s = s.replace(/\b([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?!\s*[AaPp]\.?[Mm]\b)(?:\s*(?:CT|CDT|CST|Central))?\b/g, (_, h, m) => clockWords(h, m));
  s = s.replace(/\s*\(?\s*(?:in\s+)?(?:America|Europe|Asia|Africa|Australia|Pacific|Atlantic|Etc)\/[A-Za-z_]+\s*\)?/g, "");
  // ISO dates and stamps → "October 26".
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.]+Z?)?\b/g, (m, y, mo, d) => {
    const month = MONTHS[Number(mo) - 1];
    return month ? `${month} ${Number(d)}` : m;
  });
  s = s.replace(MAC_PATH_RE, "a file on your Mac");
  // snake_case and UPPER_SNAKE become words.
  s = s.replace(/\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g, (m) => m.replace(/_/g, " ").toLowerCase());
  s = s.replace(/[A-Za-z0-9][A-Za-z0-9'’-]*/g, capsWord);
  s = s.replace(/\(\s*\)/g, "").replace(/\[\s*\]/g, "").replace(/\s+([,.;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  s = s.replace(/^[—–-]\s+/, "").replace(/\s+[—–-]$/, "");
  if (wasAllCaps && s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return restore(s);
}

/** "OpenAI, OpenAI, OpenAI, Blue Origin" → "OpenAI and Blue Origin". */
export function dedupeList(segment) {
  if (!segment.includes(",")) return segment;
  const items = segment.split(",").map((x) => x.trim()).filter(Boolean);
  const seen = [];
  for (const it of items) if (!seen.some((x) => x.toLowerCase() === it.toLowerCase())) seen.push(it);
  if (seen.length === items.length) return segment;
  if (seen.length === 1) return seen[0];
  return seen.length === 2 ? `${seen[0]} and ${seen[1]}` : `${seen.slice(0, -1).join(", ")} and ${seen[seen.length - 1]}`;
}

/** A subject she can read on a phone lock screen: no tags, brackets, ids, capitals or repeats. */
export function cleanSubject(input) {
  let s = String(input ?? "").replace(/[\r\n\t]+/g, " ");
  s = s.replace(/(^|\s)#[a-z][a-z0-9_-]*/gi, " ");
  s = s.replace(/\([^)]*["“”][^)]*\)/g, "");
  s = cleanText(s);
  s = s.replace(/\bFYI\b\s*[—–:-]?\s*/g, "");
  s = s.split(/\s+[—–]\s+/).map((seg) => dedupeList(seg.trim())).filter(Boolean).join(" — ");
  s = s.replace(/\s{2,}/g, " ").replace(/^[\s—–:-]+|[\s—–:-]+$/g, "");
  if (s.length > 90) s = `${s.slice(0, 88).replace(/\s+\S*$/, "")}…`;
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "A note from your team";
}

/** Every reply token in a text, lower-cased, de-duplicated, in order. */
export function refsIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(REF_RE)) {
    const r = m[0].toLowerCase();
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const linkify = (s) => esc(s).replace(/\bhttps?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g, (u) => `<a href="${u}" style="color:#1d4ed8">${u.length > 60 ? "Open the link" : u}</a>`);

/**
 * THE LAYOUT. Every field is cleaned here again, so a structured sender cannot reintroduce a code.
 *
 * `details` items are strings (a bullet) or `{ heading }` (a short bold line above the next bullets).
 * `box` is an optional calm boxed list (Simone's "Porch & Party: To do for Valerie").
 */
export function layoutEmail({ who, subject, happened, needs = [], details = [], sections = [], refs = [], footer = null }) {
  const name = String(who ?? "").trim() || "Simone";
  const subj = cleanSubject(subject);
  const first = cleanText(happened) || subj;
  const needList = (Array.isArray(needs) ? needs : [needs]).map(cleanText).filter(Boolean).slice(0, 3);
  const detailList = (details ?? []).map((d) => (d && typeof d === "object" && "heading" in d ? { heading: cleanText(d.heading) } : cleanText(d)))
    .filter((d) => (typeof d === "string" ? d : d.heading));
  const sectionList = (sections ?? []).map((sec) => ({
    title: cleanText(sec.title), note: sec.note ? cleanText(sec.note) : null, boxed: Boolean(sec.boxed),
    items: (sec.items ?? []).map(cleanText).filter(Boolean), empty: sec.empty ? cleanText(sec.empty) : "Nothing here today.",
  })).filter((sec) => sec.title);
  const foot = footer ? cleanText(footer) : null;

  const text = [
    first, "",
    needList.length ? NEEDS_HEADING : `${NEEDS_HEADING} ${NOTHING_NEEDED}`,
    ...needList.map((n) => `- ${n}`),
    ...sectionList.flatMap((sec) => ["", sec.title, ...(sec.note ? [sec.note] : []), ...(sec.items.length ? sec.items.map((i) => `- ${i}`) : [sec.empty])]),
    ...(detailList.length ? ["", "Details:", ...detailList.map((d) => (typeof d === "string" ? `- ${d}` : `${d.heading}`))] : []),
    "", ...(foot ? [foot, ""] : []), `— ${name}`,
  ].join("\n").replace(/\n{3,}/g, "\n\n");

  const P = 'style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#1f2937"';
  const H = 'style="margin:18px 0 6px;font-size:15px;font-weight:600;color:#111827"';
  const UL = 'style="margin:0 0 12px;padding-left:20px;font-size:15px;line-height:1.5;color:#374151"';
  const sectionHtml = (sec) => {
    const inner = `<p ${H}>${esc(sec.title)}</p>${sec.note ? `<p style="margin:0 0 8px;font-size:13px;color:#6b7280">${esc(sec.note)}</p>` : ""}`
      + (sec.items.length ? `<ul ${UL}>${sec.items.map((i) => `<li style="margin:0 0 6px">${linkify(i)}</li>`).join("")}</ul>` : `<p ${P}>${esc(sec.empty)}</p>`);
    return sec.boxed
      ? `<div style="margin:16px 0;padding:12px 16px;border:1px solid #e9dfc7;border-radius:10px;background:#faf6ec">${inner}</div>`
      : inner;
  };
  let detailHtml = "";
  if (detailList.length) {
    let open = false;
    detailHtml += `<p ${H}>Details</p>`;
    for (const d of detailList) {
      if (typeof d === "string") { if (!open) { detailHtml += `<ul ${UL}>`; open = true; } detailHtml += `<li style="margin:0 0 6px">${linkify(d)}</li>`; }
      else { if (open) { detailHtml += "</ul>"; open = false; } detailHtml += `<p style="margin:12px 0 4px;font-size:14px;font-weight:600;color:#374151">${esc(d.heading)}</p>`; }
    }
    if (open) detailHtml += "</ul>";
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:#f5f3ee"><div style="max-width:560px;margin:0 auto;padding:20px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`
    + `<div style="background:#ffffff;border-radius:12px;padding:20px 18px">`
    + `<p style="margin:0 0 16px;font-size:17px;line-height:1.45;color:#111827">${linkify(first)}</p>`
    + `<p ${H}>${NEEDS_HEADING}</p>`
    + (needList.length ? `<ul ${UL}>${needList.map((n) => `<li style="margin:0 0 6px">${linkify(n)}</li>`).join("")}</ul>` : `<p ${P}>${NOTHING_NEEDED}</p>`)
    + sectionList.map(sectionHtml).join("")
    + detailHtml
    + (foot ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">${esc(foot)}</p>` : "")
    + `<p style="margin:18px 0 0;font-size:15px;color:#374151">— ${esc(name)}</p>`
    + `</div></div></body></html>`;

  return { subject: subj, text, html, refs: [...new Set(refs.map((r) => String(r).toLowerCase()))] };
}

const NEED_LINE = /^(reply|answer|approve|say|tap|open|send|tell me|choose|pick)\b|\breply (with|")|\bneeds you\b|\bwhat i need\b|\bonly you can do\b/i;
const DROP_LINE = [
  /^(hi |hello |dear )?sequoia,?$/i,
  /^[—–-]{1,2}\s*[A-Z][a-z]+(\s*[,·].*)?$/,          // "— Danielle, Technical Program Manager"
  /^[─━=_\-–—\s]{6,}$/,                              // separators
  /^run log on your mac\b/i,
  /^\(keep \[/i,
];

/**
 * AN EMAIL WRITTEN BEFORE THE LAYOUT, MADE TO FIT IT.
 *
 * Every sender that has not been rewritten field by field still reaches her through this: the
 * greeting and signature go, the first sentence becomes the first line, the lines that ask her for
 * something become "What I need from you:", and the rest become short bullets — all of it cleaned.
 */
export function fromLegacy({ who, subject, text, refs = [] }) {
  const raw = String(text ?? "").replace(/\r/g, "");
  const allRefs = [...new Set([...refs, ...refsIn(subject), ...refsIn(raw)])];
  const name = String(who ?? "").trim();
  const lines = raw.split("\n").map((l) => l.replace(/\s+$/, ""));
  const needs = [];
  const details = [];
  let happened = "";
  for (const original of lines) {
    const trimmed = original.trim();
    if (!trimmed || DROP_LINE.some((re) => re.test(trimmed))) continue;
    if (name && new RegExp(`^[—–-]\\s*${name}\\b`, "i").test(trimmed)) continue;
    const wasHeading = /[A-Z]{3}/.test(trimmed) && !/[a-z]/.test(trimmed.replace(/\bhttps?:\S+/g, "")) && trimmed.length < 90;
    let line = trimmed.replace(/^(?:[-*•·]|\d+[.)])\s+/, "").replace(new RegExp(`^This is ${name || "[A-Z][a-z]+"}\\.\\s*`), "");
    line = cleanText(line);
    if (!line) continue;
    line = line.charAt(0).toUpperCase() + line.slice(1);
    if (wasHeading) { details.push({ heading: line.replace(/[:.]?$/, "") }); continue; }
    if (!happened) {
      const cut = line.match(/^(.{20,240}?[.!?])\s+(.+)$/);
      if (cut) { happened = cut[1]; details.push(cut[2]); } else happened = line;
      continue;
    }
    if (needs.length < 3 && NEED_LINE.test(line)) {
      const ask = line.replace(/^what (?:i need(?: from you)?|only you can do):\s*/i, "");
      needs.push(ask.charAt(0).toUpperCase() + ask.slice(1));
      continue;
    }
    details.push(line);
  }
  // A trailing heading with nothing under it says nothing.
  while (details.length && typeof details[details.length - 1] === "object") details.pop();
  return layoutEmail({ who: name || "Simone", subject, happened: happened || subject, needs, details, refs: allRefs });
}

/** The words she sees: subject, the plain text, and the HTML with its tags, urls and addresses removed. */
export function visibleText({ subject, text, html }) {
  const fromHtml = String(html ?? "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  return [subject ?? "", text ?? "", fromHtml].join("\n").replace(SECRET_LINE_RE, " ").replace(URL_RE, " ").replace(EMAIL_RE, " ");
}

/**
 * THE GUARD. Every banned pattern in what she would see, by name. Empty means plain.
 * Read by `tests/plainEmail.test.ts` for every sender's sample.
 */
export function plainProblems({ subject, text, html }) {
  const problems = [];
  const seen = visibleText({ subject, text, html });
  const subj = String(subject ?? "");
  const hit = (name, re, where = seen) => { const m = re.exec(where); if (m) problems.push(`${name}: "${m[0].trim()}"`); };
  hit("internal id", new RegExp(ID_RE.source, "i"));
  hit("bracketed id", BRACKETED_ID_RE);
  hit("snake_case word", SNAKE_RE);
  const cron = seen.match(new RegExp(CRON_RE.source, "gm"))?.find((m) => m.includes("*"));
  if (cron) problems.push(`cron string: "${cron.trim()}"`);
  hit("time zone string", new RegExp(TZ_RE.source));
  for (const j of JARGON) hit(`jargon "${j.ban.source}"`, j.ban);
  hit("#tag in the subject", /(^|\s)#[a-z][a-z0-9_-]*/i, subj);
  hit("brackets in the subject", /[[\]]/, subj);
  const shout = subj.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, "")).find((w) => w.length >= 2 && /^[A-Z][A-Z0-9]*$/.test(w) && /[A-Z]{2}/.test(w) && !ACRONYMS.has(w));
  if (shout) problems.push(`capitals in the subject: "${shout}"`);
  for (const seg of subj.split(/\s+[—–]\s+/)) {
    const items = seg.split(/,|\band\b/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const dup = items.find((x, i) => items.indexOf(x) !== i);
    if (dup) problems.push(`repeated name in the subject: "${dup}"`);
  }
  if (!String(text ?? "").includes(NEEDS_HEADING)) problems.push('no "What I need from you:" line');
  if (html !== undefined && html !== null && !String(html).includes(NEEDS_HEADING)) problems.push('HTML has no "What I need from you:" line');
  return problems;
}
