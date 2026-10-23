/**
 * EVERY EMAIL SHE GETS FROM BOSS OS, IN ONE PLAIN LAYOUT (owner, 22 Oct 2026; Decide-first, 23 Oct 2026).
 *
 * Her words, 22 Oct: "U need to fix the massive problem of all the emails from the boss OS agents being
 * confusing hard to read hard to understand. Lots of jargon not formatted well." Her inbox review on
 * 22–23 Oct then found nine Boss OS emails in two days and none useful to a busy executive: raw Gmail
 * ids ("Open 1a08831e… in Gmail"), shell commands, /api paths, PR numbers, UTC times, `#simone` tags,
 * jargon ("friction", "seat", "That is an answer, not an empty run"), "Needs a look" next to "Nothing
 * needed", the same bounce line three times, and a "Stopped" email three hours after the fix.
 *
 * ONE MODULE, EVERY SENDER. The Mac sends through `scripts/ops/notify.mjs` (`employeeMail` →
 * `postEmployeeMail`, which every Mac sender reaches), and the Worker answers her mail with
 * `message.reply()` through `plainReply` (src/worker/boss/intake/mailRefs.ts). Both lay out here, and
 * both run THE GATE (`plainProblems`) on what was laid out: an email that fails it is HELD — logged and
 * turned into a fix job for the team — and never sent (`postEmployeeMail`, `plainReply`). The gate is
 * also a registered validator (`npm run validate:email-plain`) run over blurred copies of the 22–23 Oct
 * emails (each must fail) and a sample of every sender (each must pass).
 *
 * THE LAYOUT, in this order (rule 2, 23 Oct 2026):
 *   1. the first line says what happened, in everyday words;
 *   2. "Decide (N)" — at most three things only she can decide, each with one-tap buttons
 *      (Yes / No / Call / Open the email / Approve the draft / Send as is / Edit, then send / Skip) — or
 *      "Nothing to decide — this is just so you know.";
 *   3. the sections (a deal grid, a "Done for you" list, Valerie's boxed list …);
 *   4. the employee's name, once; then an optional small postscript (the 8Raise line).
 *
 * A PROBLEM EMAIL (`layoutProblem`, rule 3) is three labelled parts instead — What happened → What we
 * did → Status (done, or when) — sent only once the fix is running; a Decide item (one button) comes
 * first only when she alone can act.
 *
 * THE REPLY TOKENS LEAVE THE VISIBLE TEXT. `[rc_…]`, `[dd_…]`, `[tsk_…]`, `[cw_…]` and `[kml_…]`
 * are pulled out into `refs`, sent in the `X-Boss-Ref` header, and recorded against the sent message's
 * Message-ID (`boss_mail_refs`); her reply quotes that Message-ID and the inbound handler reads the refs
 * back from it (`refsForChain`). Nothing she sees carries a code.
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
 * `ban` is what the gate refuses in anything she sees; `plain` is what the cleaner writes instead;
 * `sample` is a phrase the gate must catch (tests/plainEmail.test.ts and validate:email-plain feed every
 * sample through the gate, so an entry whose `ban` cannot match is caught). Add a word here and the
 * cleaner, the gate and both checks pick it up; there is no second list to forget.
 */
export const JARGON = [
  { ban: /\bledger hunt\b/i, find: /\bledger hunt\b/gi, plain: "check of your new messages", sample: "the ledger hunt ran" },
  { ban: /\bledgers?\b/i, find: /\bledger(s?)\b/gi, plain: "records", sample: "the ledger" },
  { ban: /\bpairings?\b/i, find: /\bpairing(s?)\b/gi, plain: (m, s) => (s ? "possible matches" : "possible match"), sample: "673 pairings" },
  { ban: /\bcross(es)?\b/i, find: /\bcross(es)?\b/gi, plain: (m, es) => (es ? "matches" : "match"), sample: "5 crosses" },
  { ban: /\broutes?\b/i, find: /\broute(s?)\b/gi, plain: (m, s) => (s ? "places" : "place"), sample: "a route" },
  { ban: /\blanes?\b/i, find: /\blane(s?)\b/gi, plain: (m, s) => (s ? "jobs" : "job"), sample: "the ops lane" },
  { ban: /\bslugs?\b/i, find: /\bslug(s?)\b/gi, plain: (m, s) => (s ? "names" : "name"), sample: "a slug" },
  { ban: /\bseats?\b/i, find: /\bseat(s?)\b/gi, plain: (m, s) => (s ? "teammates" : "teammate"), sample: "the seat" },
  { ban: /\bduty_/i, find: /\bduty_[a-z0-9_]*/gi, plain: "", sample: "duty_x" },
  { ban: /\bNAMED STOP\b/i, find: /\bNAMED STOP\b(?:\s*\[[A-Z0-9_]+\])?:?/g, plain: "Stopped:", sample: "NAMED STOP" },
  { ban: /\bexecutor\b/i, find: /\bexecutor\b/gi, plain: "the teammate who runs it", sample: "the executor" },
  { ban: /\bpayload\b/i, find: /\bpayload\b/gi, plain: "details", sample: "the payload" },
  // 23 Oct 2026, from her inbox review.
  { ban: /\bN-?PORT\b/i, find: /\bN-?PORT\b/gi, plain: "fund filings", sample: "N-PORT search" },
  { ban: /\bfriction\b/i, find: /\bfriction\b/gi, plain: "snags", sample: "friction fixed" },
  { ban: /\bempty run\b/i, find: /[^.!?\n]*\bempty run\b[^.!?\n]*[.!?]?/gi, plain: "", sample: "That is an answer, not an empty run." },
  { ban: /\btail\b/i, find: /\btail\b/gi, plain: "follow-up", sample: "Tail: your email" },
];

/** The reply tokens a lane reads back from her answer. Pulled out of the text into `refs`. */
export const REF_RE = /\b(?:rc|dd|tsk|cw|kml|yd)_[a-z0-9]{3,40}\b/gi;

/** Every internal id shape: a known prefix, or a short prefix and an underscore with a digit in it. */
const ID_RE = /\b(?:(?:rc|dd|tsk|wc|cw|kml|apr|iml|emp|cred|yd|mail|run)_[a-z0-9_]{3,}|[a-z]{2,5}_[a-z0-9]*\d[a-z0-9]*)\b/gi;
const BRACKETED_ID_RE = /\[[a-z]{2,5}_[^\]\s]*\]/i;
const SNAKE_RE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/;
const CRON_RE = /(?:^|\s)(?:[\d*/,-]+\s+){4}[\d*/,-]+(?=\s|$)/;
const TZ_RE = /\b(?:America|Europe|Asia|Africa|Australia|Pacific|Atlantic|Etc)\/[A-Za-z_]+\b/g;
const URL_RE = /\b(?:https?:\/\/|mailto:)[^\s<>()"']+[^\s<>()"'.,;:!?]/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SECRET_LINE_RE = /\bSECRET [A-Z][A-Z0-9_]*=(?:<value>)?/g;
const MAC_PATH_RE = /(?:~|\/Users\/[^\s/]+)(?:\/[^\s,;)]+)+/g;
/** A Gmail message id, a commit, any bare hex code: 7+ lowercase hex with a digit and a letter in it. */
const HEX_ID_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b…?/;
/** Something to type at a terminal. */
const COMMAND_RE = /\bnpm (?:run|i|install|ci|test)\b|\bnpx\s|\bnode\s+scripts\/|\bgit\s+(?:push|pull|merge|checkout|rebase|commit)\b|\bwrangler\s|\bcurl\s|\blaunchctl\b|\bvault:run\b|(?:^|\s)--[a-z][a-z-]{2,}\b/i;
const COMMAND_SPAN = /`[^`]*`|\b(?:npm (?:run|i|install|ci|test)|npx|node scripts\/|launchctl|wrangler|curl|git (?:push|pull|merge|checkout|rebase|commit))\s*[^\s.,;)]*(?:\s+--?\s*[^\s.,;)]*)*/gi;
const API_PATH_RE = /(?:^|[\s("'])\/api\/[\w/:.-]*/;
const PR_NUMBER_RE = /\bPRs?\s*#?\d+\b|\bpull request\s*#?\d+\b|(?:^|[\s(])#\d+\b/i;
const UTC_RE = /\bUTC\b|\bGMT\b|\b\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?Z\b/;
const TAG_RE = /(?:^|\s)#[a-z][a-z0-9_-]*/i;
const COULD_NOT_READ_RE = /\bI could(?: not|n['’]t) read\b/i;

/** The caps the gate holds an email to. */
export const MAX_TEXT_CHARS = 9000;
export const MAX_SUBJECT_CHARS = 90;
export const MAX_DECIDE = 3;

export const DECIDE_HEADING = "Decide";
export const NOTHING_TO_DECIDE = "Nothing to decide — this is just so you know.";
export const PROBLEM_PARTS = Object.freeze({ happened: "What happened:", did: "What we did:", status: "Status:" });

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "13:00" → "1 pm", "09:30" → "9:30 am". Only zero-padded 24-hour times; "6:05" is already plain. */
export function clockWords(h, m) {
  const hour = Number(h);
  const min = Number(m);
  const ampm = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return min === 0 ? `${h12} ${ampm}` : `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

/** "14:05 UTC" → her clock ("9:05 am"), on today's offset (CDT or CST). */
export function utcClockWords(h, m, now = Date.now()) {
  const d = new Date(now);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(h), Number(m));
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(new Date(at));
  const g = (t) => p.find((x) => x.type === t)?.value ?? "0";
  return clockWords(Number(g("hour")) % 24, Number(g("minute")));
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
 * One line, made plain: no ids or codes, no commands, no /api paths, no PR numbers, no UTC, no #tags,
 * no snake_case, no cron or time-zone strings, no shouting, no jargon. Idempotent, so a structured
 * sender that already wrote plainly passes through untouched.
 */
export function cleanText(input) {
  if (input === null || input === undefined) return "";
  const { out, restore } = protect(String(input));
  let s = out;
  const wasAllCaps = /[A-Z]{3}/.test(s) && !/[a-z]/.test(s.replace(/\u0000\d+\u0000/g, ""));
  // Commands (backticked or bare) go whole; then the backticks of anything else.
  s = s.replace(COMMAND_SPAN, (m) => (m.startsWith("`") && !COMMAND_RE.test(m) ? m : ""));
  s = s.replace(/`/g, "");
  s = s.replace(/\b(\w+)\((e?s)\)/g, "$1$2");
  for (const j of JARGON) s = s.replace(j.find, j.plain);
  // /api paths, with or without their verb or brackets.
  s = s.replace(/\s*\(\s*(?:(?:GET|POST|PUT|PATCH|DELETE)\s+)?\/api\/[^)]*\)/g, "");
  s = s.replace(/(?:\b(?:GET|POST|PUT|PATCH|DELETE)\s+)?(?<![\w.])\/api\/[\w/:.?=&-]*/g, "");
  s = s.replace(/\s+\b(?:via|at|see|through|in|from)\s*(?=[.,;:]|$)/g, "");
  // PR numbers: "(#112)" and "(PR #112)" go, "PR #12" is "the change".
  s = s.replace(/\s*\(\s*(?:PR|pull request)?\s*#\d+\s*\)/gi, "").replace(/\b(?:PR|pull request)\s*#?\d+\b/gi, "the change").replace(/(^|\s)#\d+\b/g, "$1");
  // #tags: "#simone" is Simone.
  s = s.replace(/(^|\s)#([a-z][a-z0-9_-]*)/gi, (m, p, w) => `${p}${w.charAt(0).toUpperCase()}${w.slice(1)}`);
  // Ids: bracketed or in parentheses go with their brackets; bare ones go alone; hex codes too.
  s = s.replace(/\s*[[(]\s*(?:[a-z]{2,5}_[a-z0-9_]+)\s*[\])]/gi, "");
  s = s.replace(ID_RE, "");
  s = s.replace(new RegExp(`\\s*${HEX_ID_RE.source}`, "g"), "");
  // UTC times become her clock before any other time is read as Central.
  s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*(?:UTC|GMT)\b/g, (_, h, m) => utcClockWords(h, m));
  s = s.replace(/\s*\(?\b(?:UTC|GMT)\b\)?/g, "");
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
  if (s.length > MAX_SUBJECT_CHARS) s = `${s.slice(0, MAX_SUBJECT_CHARS - 2).replace(/\s+\S*$/, "")}…`;
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

/** What a link is called on screen: the thing it opens, never the address itself. */
export function linkLabel(url) {
  const u = String(url);
  if (/^mailto:/i.test(u)) return "Write the email";
  if (/mail\.google\.com/.test(u)) return "Open the email";
  if (/github\.com\/.+\/pull\//.test(u)) return "Open the change";
  if (/boss\.sequoiataylor\.com/.test(u)) return "Open Boss OS";
  if (/claude\.ai\/(?:code\/)?artifact/.test(u)) return "Open the page";
  try { return `Open ${new URL(u).hostname.replace(/^www\./, "")}`; } catch { return "Open the link"; }
}
/** A Gmail search for a subject: the email itself, one tap, never a bare id (rule 2, 23 Oct 2026). */
export function gmailSearchLink(subject) {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`subject:"${String(subject ?? "").replace(/"/g, "")}"`)}`;
}
const linkify = (s) => esc(s).replace(/\b(?:https?:\/\/|mailto:)[^\s<>()"']+[^\s<>()"'.,;:!?]/g, (u) => `<a href="${u}" style="color:#1F4E8C">${esc(linkLabel(u.replace(/&amp;/g, "&")))}</a>`);
const okUrl = (u) => typeof u === "string" && /^(?:https?:\/\/|mailto:)\S+$/.test(u.trim());

function cleanButtons(buttons) {
  return (buttons ?? []).filter((b) => b && okUrl(b.url)).map((b) => ({ label: cleanText(b.label) || linkLabel(b.url), url: b.url.trim() })).filter((b) => b.label);
}

/** A Decide item, cleaned: `{ title, body?, buttons: [{ label, url }] }`. A bare string is a title. */
function cleanCard(c) {
  if (typeof c === "string") return { title: cleanText(c), body: "", buttons: [] };
  return { title: cleanText(c?.title), body: cleanText(c?.body ?? ""), buttons: cleanButtons(c?.buttons) };
}

function cardText(c, n) {
  return [`${n}. ${c.title}`, ...(c.body ? [c.body] : []), ...c.buttons.map((b) => `- ${b.label}: ${b.url}`)];
}

const C = {
  ink: "#1B1F24", muted: "#5B6472", link: "#1F4E8C", line: "#E3E6EB",
  decideBorder: "#E9C46A", decideBg: "#FFFBEF", decideInk: "#8A5A00",
  doneBorder: "#BFE0CB", doneBg: "#F3FAF5", doneInk: "#1F6B3A",
  boxBorder: "#e9dfc7", boxBg: "#faf6ec", page: "#F4F5F7",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SEC = (color = C.muted) => `style="margin:18px 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color}"`;
const BTN = (primary) => `style="display:inline-block;margin:0 8px 8px 0;padding:11px 14px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;border:1px solid ${C.link};${primary ? `background:${C.link};color:#ffffff` : `background:#ffffff;color:${C.link}`}"`;

function cardHtml(c, n, tone = "decide") {
  const border = tone === "decide" ? C.decideBorder : C.line;
  const bg = tone === "decide" ? C.decideBg : "#ffffff";
  return `<div style="margin:0 0 10px;padding:14px;border:1px solid ${border};border-radius:10px;background:${bg}">`
    + `<p style="margin:0 0 6px;font-size:15px;font-weight:600;color:${C.ink}">${n ? `${n}. ` : ""}${esc(c.title)}</p>`
    + (c.body ? `<p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:${C.ink}">${linkify(c.body)}</p>` : "")
    + (c.buttons.length ? `<div>${c.buttons.map((b, i) => `<a href="${esc(b.url)}" ${BTN(i === 0)}>${esc(b.label)}</a>`).join("")}</div>` : "")
    + `</div>`;
}

function cleanSection(sec) {
  const items = (sec.items ?? []).map((i) => (i && typeof i === "object"
    ? { text: cleanText(i.text), links: cleanButtons(i.links) }
    : { text: cleanText(i), links: [] })).filter((i) => i.text);
  const rows = sec.rows && Array.isArray(sec.rows.data) && sec.rows.data.length ? {
    columns: (sec.rows.columns ?? []).map((c) => ({ key: c.key, label: cleanText(c.label) })),
    data: sec.rows.data.map((r) => ({ ...r, url: okUrl(r.url) ? r.url : null, url_label: cleanText(r.url_label ?? "") || null })),
  } : null;
  return {
    title: cleanText(sec.title), note: sec.note ? cleanText(sec.note) : null, boxed: Boolean(sec.boxed), tone: sec.tone ?? null,
    items, rows, cards: (sec.cards ?? []).map(cleanCard).filter((c) => c.title),
    link: sec.link && okUrl(sec.link.url) ? { label: cleanText(sec.link.label) || linkLabel(sec.link.url), url: sec.link.url } : null,
    empty: sec.empty === null ? null : (sec.empty ? cleanText(sec.empty) : "Nothing here today."),
  };
}

const cell = (r, key) => cleanText(r[key] ?? "") || "—";

function sectionText(sec) {
  const out = ["", sec.title, ...(sec.note ? [sec.note] : [])];
  const body = [];
  if (sec.rows) for (const r of sec.rows.data) body.push(`- ${sec.rows.columns.map((c) => cell(r, c.key)).join(" · ")}${r.url ? ` — ${r.url_label ?? linkLabel(r.url)}: ${r.url}` : ""}`);
  sec.cards.forEach((c, i) => body.push(...cardText(c, i + 1)));
  for (const i of sec.items) body.push(`- ${i.text}${i.links.map((l) => ` — ${l.label}: ${l.url}`).join("")}`);
  if (!body.length && sec.empty) body.push(sec.empty);
  if (!body.length && !sec.link) return [];
  return [...out, ...body, ...(sec.link ? [`${sec.link.label}: ${sec.link.url}`] : [])];
}

function sectionHtml(sec) {
  const color = sec.tone === "done" ? C.doneInk : sec.tone === "decide" ? C.decideInk : C.muted;
  let inner = `<p ${SEC(color)}>${esc(sec.title)}</p>${sec.note ? `<p style="margin:0 0 8px;font-size:13px;color:${C.muted}">${esc(sec.note)}</p>` : ""}`;
  let any = false;
  if (sec.rows) {
    any = true;
    const th = `style="padding:6px;text-align:left;font-size:11px;color:${C.muted};font-weight:600;border-bottom:1px solid #D9DDE3"`;
    const td = `style="padding:7px 6px;border-bottom:1px solid #EEF0F3;vertical-align:top;font-size:13px;color:${C.ink}"`;
    inner += `<table role="presentation" style="border-collapse:collapse;width:100%;margin:0 0 8px">`
      + `<tr>${sec.rows.columns.map((c) => `<th ${th}>${esc(c.label)}</th>`).join("")}<th ${th}></th></tr>`
      + sec.rows.data.map((r) => `<tr>${sec.rows.columns.map((c, i) => `<td ${td}>${i === 0 ? `<b>${esc(cell(r, c.key))}</b>` : esc(cell(r, c.key))}</td>`).join("")}`
        + `<td ${td}>${r.url ? `<a href="${esc(r.url)}" style="color:${C.link}">${esc(r.url_label ?? linkLabel(r.url))}</a>` : ""}</td></tr>`).join("")
      + `</table>`;
  }
  if (sec.cards.length) { any = true; inner += sec.cards.map((c, i) => cardHtml(c, i + 1, "plain")).join(""); }
  if (sec.items.length) {
    any = true;
    inner += sec.items.map((i) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:${C.ink}">${linkify(i.text)}${i.links.map((l) => ` <a href="${esc(l.url)}" style="color:${C.link}">${esc(l.label)}</a>`).join("")}</p>`).join("");
  }
  if (!any && sec.empty) { any = true; inner += `<p style="margin:0 0 8px;font-size:14px;color:${C.ink}">${esc(sec.empty)}</p>`; }
  if (sec.link) { any = true; inner += `<p style="margin:4px 0 0"><a href="${esc(sec.link.url)}" ${BTN(false)}>${esc(sec.link.label)}</a></p>`; }
  if (!any) return "";
  const box = sec.boxed
    ? [C.boxBorder, C.boxBg]
    : sec.tone === "done" ? [C.doneBorder, C.doneBg] : [C.line, "#ffffff"];
  return `<div style="margin:12px 0;padding:4px 14px 10px;border:1px solid ${box[0]};border-radius:10px;background:${box[1]}">${inner}</div>`;
}

function page(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:${C.page}"><div style="max-width:560px;margin:0 auto;padding:16px;font-family:${FONT};color:${C.ink}">`
    + inner + `</div></body></html>`;
}

/**
 * THE LAYOUT. Every field is cleaned here again, so a structured sender cannot reintroduce a code.
 *
 *   decide    up to three `{ title, body?, buttons: [{ label, url }] }` (a string is a title); `needs`
 *             (strings, the older name) are Decide items too. More than three: the first three show
 *             and one line says how many more and where.
 *   sections  `{ title, note?, boxed?, tone?: "done" | "decide", items?: (string | { text, links })[],
 *             rows?: { columns: [{ key, label }], data: [{ …cells, url?, url_label? }] }, cards?: […],
 *             link?: { label, url }, empty? }` — `empty: null` drops a section with nothing in it.
 *   details   strings (bullets) or `{ heading }`, under "Details" (what `fromLegacy` writes).
 *   footer    a small line above the name; `postscript` a small line below it (the 8Raise line).
 */
export function layoutEmail({ who, subject, happened, decide = [], needs = [], details = [], sections = [], refs = [], footer = null, postscript = null, moreDecide = null }) {
  const name = String(who ?? "").trim() || "Simone";
  const subj = cleanSubject(subject);
  const first = cleanText(happened) || subj;
  const allDecide = [...(Array.isArray(decide) ? decide : [decide]), ...(Array.isArray(needs) ? needs : [needs])].map(cleanCard).filter((c) => c.title);
  const shown = allDecide.slice(0, MAX_DECIDE);
  const extra = allDecide.length - shown.length;
  const moreLine = extra > 0 ? cleanText(moreDecide ?? `And ${extra} more on your Today page.`) : null;
  const detailList = (details ?? []).map((d) => (d && typeof d === "object" && "heading" in d ? { heading: cleanText(d.heading) } : cleanText(d)))
    .filter((d) => (typeof d === "string" ? d : d.heading));
  const sectionList = (sections ?? []).map(cleanSection).filter((sec) => sec.title);
  const foot = footer ? cleanText(footer) : null;
  const ps = postscript ? cleanText(postscript) : null;

  const text = [
    first, "",
    ...(shown.length
      ? [`${DECIDE_HEADING} (${allDecide.length})`, ...shown.flatMap((c, i) => [...cardText(c, i + 1), ""]), ...(moreLine ? [moreLine] : [])]
      : [NOTHING_TO_DECIDE]),
    ...sectionList.flatMap(sectionText),
    ...(detailList.length ? ["", "Details:", ...detailList.map((d) => (typeof d === "string" ? `- ${d}` : `${d.heading}`))] : []),
    "", ...(foot ? [foot, ""] : []), `— ${name}`,
    ...(ps ? ["", ps] : []),
  ].join("\n").replace(/\n{3,}/g, "\n\n");

  let detailHtml = "";
  if (detailList.length) {
    let open = false;
    detailHtml += `<div style="margin:12px 0;padding:4px 14px 10px;border:1px solid ${C.line};border-radius:10px;background:#ffffff"><p ${SEC()}>Details</p>`;
    for (const d of detailList) {
      if (typeof d === "string") { if (!open) { detailHtml += `<ul style="margin:0 0 8px;padding-left:20px;font-size:14px;line-height:1.5;color:${C.ink}">`; open = true; } detailHtml += `<li style="margin:0 0 6px">${linkify(d)}</li>`; }
      else { if (open) { detailHtml += "</ul>"; open = false; } detailHtml += `<p style="margin:12px 0 4px;font-size:14px;font-weight:600;color:${C.ink}">${esc(d.heading)}</p>`; }
    }
    if (open) detailHtml += "</ul>";
    detailHtml += "</div>";
  }
  const html = page(
    `<div style="background:#ffffff;border-radius:10px;padding:12px 14px;border:1px solid ${C.line}"><p style="margin:0;font-size:16px;line-height:1.45;font-weight:600;color:${C.ink}">${linkify(first)}</p></div>`
    + (shown.length
      ? `<p ${SEC(C.decideInk)}>${DECIDE_HEADING} (${allDecide.length})</p>${shown.map((c, i) => cardHtml(c, i + 1)).join("")}${moreLine ? `<p style="margin:0 0 8px;font-size:13px;color:${C.muted}">${esc(moreLine)}</p>` : ""}`
      : `<p style="margin:14px 2px;font-size:14px;color:${C.muted}">${NOTHING_TO_DECIDE}</p>`)
    + sectionList.map(sectionHtml).join("")
    + detailHtml
    + (foot ? `<p style="margin:16px 2px 0;font-size:13px;color:${C.muted}">${linkify(foot)}</p>` : "")
    + `<p style="margin:12px 2px 0;font-size:14px;color:${C.ink}">— ${esc(name)}</p>`
    + (ps ? `<p style="margin:14px 2px 0;font-size:12px;color:${C.muted}">${esc(ps)}</p>` : ""),
  );

  return finish({ subject: subj, text, html, refs: [...new Set(refs.map((r) => String(r).toLowerCase()))], kind: "plain" });
}

/**
 * A PROBLEM EMAIL (rule 3, 23 Oct 2026): What happened (one line) → What we did → Status (done, or
 * when). Sent only once the fix is running. `decide` — one item, one button — only when she alone can
 * act (an account or key only she holds); it then comes first, as every Decide does.
 */
export function layoutProblem({ who, subject, happened, did, status, done = false, decide = [], refs = [] }) {
  const name = String(who ?? "").trim() || "Simone";
  const subj = cleanSubject(subject);
  const what = cleanText(happened);
  const didLine = cleanText(did);
  const statusLine = cleanText(status) || (done ? "Done. Nothing needed from you." : "");
  const ask = (Array.isArray(decide) ? decide : [decide]).map(cleanCard).filter((c) => c.title).slice(0, 1);
  const statusWord = done ? "Status: done." : PROBLEM_PARTS.status;
  const text = [
    ...(ask.length ? [`${DECIDE_HEADING} (1)`, ...cardText(ask[0], 1), ""] : []),
    `${PROBLEM_PARTS.happened} ${what}`,
    `${PROBLEM_PARTS.did} ${didLine}`,
    `${statusWord} ${statusLine}`,
    "", `— ${name}`,
  ].join("\n");
  const part = (label, body, tone) => {
    const [border, bg, ink] = tone === "done" ? [C.doneBorder, C.doneBg, C.doneInk] : [C.line, "#ffffff", C.muted];
    return `<div style="margin:0 0 10px;padding:14px;border:1px solid ${border};border-radius:10px;background:${bg}">`
      + `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${ink}">${esc(label)}</p>`
      + `<p style="margin:0;font-size:14px;line-height:1.55;color:${C.ink}">${linkify(body)}</p></div>`;
  };
  const html = page(
    (ask.length ? `<p ${SEC(C.decideInk)}>${DECIDE_HEADING} (1)</p>${cardHtml(ask[0], 1)}` : "")
    + part(PROBLEM_PARTS.happened.replace(/:$/, ""), what)
    + part(PROBLEM_PARTS.did.replace(/:$/, ""), didLine)
    + part(done ? "Status: done" : "Status", statusLine, done ? "done" : null)
    + `<p style="margin:12px 2px 0;font-size:14px;color:${C.ink}">— ${esc(name)}</p>`,
  );
  return finish({ subject: subj, text, html, refs: [...new Set(refs.map((r) => String(r).toLowerCase()))], kind: "problem" });
}

/** Every laid-out email carries the gate's verdict, so the sender holds it rather than sends it. */
function finish(laid) {
  return { ...laid, problems: plainProblems(laid) };
}

const NEED_LINE = /^(reply|answer|approve|say|tap|open|send|tell me|choose|pick)\b|\breply (with|")|\bneeds you\b|\bwhat i need\b|\bonly you can do\b/i;
const DROP_LINE = [
  /^(hi |hello |dear )?sequoia,?$/i,
  /^[—–-]{1,2}\s*[A-Z][a-z]+(\s*[,·].*)?$/,          // "— Danielle, Technical Program Manager"
  /^[─━=_\-–—\s]{6,}$/,                              // separators
  /^run log on your mac\b/i,
  /^\(keep \[/i,
  /^(merge )?commit:\s*\S+$/i,                       // a commit hash is a code
];

/**
 * AN EMAIL WRITTEN BEFORE THE LAYOUT, MADE TO FIT IT.
 *
 * Every sender that has not been rewritten field by field still reaches her through this: the
 * greeting and signature go, a line that is a command goes, the first sentence becomes the first line,
 * the lines that ask her for something become Decide items, and the rest become short bullets — all
 * of it cleaned.
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
    // A line she would have to type at a terminal is not for her (23 Oct 2026: "npm run capital:match -- --not").
    // Only the sentences that hold one go; the rest of the line stays.
    const kept = trimmed.split(/(?<=[.!?])\s+/).filter((sentence) => !COMMAND_RE.test(sentence)).join(" ");
    if (!kept) continue;
    const wasHeading = /[A-Z]{3}/.test(kept) && !/[a-z]/.test(kept.replace(/\bhttps?:\S+/g, "")) && kept.length < 90;
    let line = kept.replace(/^(?:[-*•·]|\d+[.)])\s+/, "").replace(new RegExp(`^This is ${name || "[A-Z][a-z]+"}\\.\\s*`), "");
    line = cleanText(line);
    if (!line) continue;
    line = line.charAt(0).toUpperCase() + line.slice(1);
    if (wasHeading) { details.push({ heading: line.replace(/[:.]?$/, "") }); continue; }
    if (!happened) {
      const cut = line.match(/^(.{20,240}?[.!?])\s+(.+)$/);
      if (cut) { happened = cut[1]; (NEED_LINE.test(cut[2]) ? needs : details).push(cut[2]); } else happened = line;
      continue;
    }
    if (needs.length < MAX_DECIDE && NEED_LINE.test(line)) {
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

/** Every link in an email: the urls in its text and the hrefs in its HTML. */
export function linksIn({ text, html }) {
  const out = [...String(text ?? "").matchAll(URL_RE)].map((m) => m[0]);
  for (const m of String(html ?? "").matchAll(/href="([^"]+)"/g)) out.push(m[1].replace(/&amp;/g, "&"));
  return out;
}

/**
 * THE GATE. Every banned pattern in what she would see, by name. Empty means it may be sent.
 *
 * Run on every email laid out here (`finish`), by `postEmployeeMail` before any Mac send, by
 * `plainReply` before the Worker's reply, by `npm run validate:email-plain` and by
 * tests/plainEmail.test.ts. Rule 13 (23 Oct 2026): codes and ids, commands, /api paths, PR numbers, UTC
 * times, #tags, the jargon list, a length cap, Decide not first, a problem email missing "what we
 * did" or its status — and the rest of her review: "I could not read", "needs a look" beside "nothing
 * needed", a dump of bare links, a link to an API path.
 */
function contentProblems(seen) {
  const problems = [];
  const hit = (name, re) => { const m = re.exec(seen); if (m) problems.push(`${name}: "${m[0].trim()}"`); };
  hit("internal id", new RegExp(ID_RE.source, "i"));
  hit("bracketed id", BRACKETED_ID_RE);
  hit("code or Gmail id", HEX_ID_RE);
  hit("snake_case word", SNAKE_RE);
  hit("command", COMMAND_RE);
  hit("API path", API_PATH_RE);
  hit("PR number", PR_NUMBER_RE);
  hit("UTC time", UTC_RE);
  hit("#tag", TAG_RE);
  hit('"I could not read"', COULD_NOT_READ_RE);
  const cron = seen.match(new RegExp(CRON_RE.source, "gm"))?.find((m) => m.includes("*"));
  if (cron) problems.push(`cron string: "${cron.trim()}"`);
  hit("time zone string", new RegExp(TZ_RE.source));
  for (const j of JARGON) hit(`jargon "${j.ban.source}"`, j.ban);
  return problems;
}

/**
 * What is wrong with ONE line a producer wrote, after the cleaner has had it — the content checks
 * only. The morning email drops a failing line (and logs it) rather than let one producer's line hold
 * the whole email.
 */
export function lineProblems(line) {
  return contentProblems(visibleText({ text: cleanText(line) }));
}

export function plainProblems({ subject, text, html, kind = null }) {
  const seen = visibleText({ subject, text, html });
  const subj = String(subject ?? "");
  const body = String(text ?? "");
  const problems = contentProblems(seen);
  const hit = (name, re, where = seen) => { const m = re.exec(where); if (m) problems.push(`${name}: "${m[0].trim()}"`); };
  hit("brackets in the subject", /[[\]]/, subj);
  const shout = subj.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, "")).find((w) => w.length >= 2 && /^[A-Z][A-Z0-9]*$/.test(w) && /[A-Z]{2}/.test(w) && !ACRONYMS.has(w));
  if (shout) problems.push(`capitals in the subject: "${shout}"`);
  for (const seg of subj.split(/\s+[—–]\s+/)) {
    const items = seg.split(/,|\band\b/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const dup = items.find((x, i) => items.indexOf(x) !== i);
    if (dup) problems.push(`repeated name in the subject: "${dup}"`);
  }
  if (/\bneeds? (?:a look|you)\b/i.test(seen) && /\bnothing (?:needed|to decide)\b|\bno reply needed\b/i.test(seen)) problems.push('"needs a look" beside "nothing needed"');
  if (subj.length > MAX_SUBJECT_CHARS) problems.push(`subject longer than ${MAX_SUBJECT_CHARS} characters`);
  if (body.length > MAX_TEXT_CHARS) problems.push(`longer than ${MAX_TEXT_CHARS} characters`);
  const bare = body.split("\n").filter((l) => /^\s*(?:[-*•]\s*)?(?:https?:\/\/|mailto:)\S+\s*$/.test(l)).length;
  if (bare >= 3) problems.push(`a dump of ${bare} bare links`);
  const api = linksIn({ text, html }).find((u) => /^https?:\/\/[^/]+\/api\//.test(u) && !/\/api\/outreach\/u\//.test(u));
  if (api) problems.push(`a link to an API path: "${api}"`);
  // The shape: Decide first (or "nothing to decide"); a problem email in its three parts.
  const lines = body.split("\n");
  // "Stopped: …" and Danielle's "Stopped work on …" are both problem emails (combined boss fix).
  const problem = kind === "problem" || /^stopped\b/i.test(subj);
  if (problem) {
    if (!/^What happened:/m.test(body)) problems.push('a problem email without "What happened"');
    if (!/^What we did:/m.test(body)) problems.push('a problem email without "What we did"');
    if (!/^Status(?::| done)/m.test(body)) problems.push("a problem email without its status");
    if (!(/^What happened:/.test(lines[0] ?? "") || /^Decide \(\d+\)$/.test(lines[0] ?? ""))) problems.push("Decide is not first");
  } else if (!(/^Decide \(\d+\)$/.test(lines[2] ?? "") || lines[2] === NOTHING_TO_DECIDE)) {
    problems.push("Decide is not first");
  }
  const decideAt = lines.findIndex((l) => /^Decide \(\d+\)$/.test(l));
  if (decideAt > 2 && !problem) problems.push("Decide is not first");
  if (html !== undefined && html !== null && !/Decide \(\d+\)|Nothing to decide|What happened/.test(String(html))) problems.push("the HTML has no Decide line");
  return [...new Set(problems)];
}
