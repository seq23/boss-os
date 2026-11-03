/**
 * THE HICKS QUARTERLY WEBSITE UPDATE (owner, 3 Nov 2026: "one of my boss OS people should send me a
 * draft email for approval to send to monika quarterly"). Camille owns it.
 *
 * WHEN: the first Monday of February, May, August and November, from 08:00 Central. The Worker's
 * hourly cron asks `quarterDue(now)` on every tick; the quarter is claimed (one row per quarter) before
 * anything is read, so the draft is made once.
 *
 * WHAT: live Search Console clicks (the last 4 weeks, the 4 before, and the figure in the last email
 * she approved) and the fixes merged in the client's site repo since that email, in plain words. A
 * source that could not be read says "not read", never 0.
 *
 * THE WORDS (her two sent emails, 11 Oct and 3 Nov 2026): greeting, one happy line, the numbers in
 * plain words, "What I'm polishing" bullets, "None of this changes your writing…", "Thanks again for
 * trusting me with this.", "Best, Sequoia". Lead with the win; a quarter with nothing up is said to be
 * steady, never led with a dip. Never the Resources posting schedule, never a call (friends brain, 3 Nov).
 *
 * NO ADDRESS OR CLIENT NAME LIVES HERE: the repo is public. The recipient's name and address come from
 * runtime config (D1 setting `hicks_update_recipient`), never from code.
 *
 * NOTHING SENDS WITHOUT HER APPROVAL. This file only composes. The Worker side
 * (src/worker/boss/clients/hicksUpdate.ts) stores the draft and asks her; Approve opens her own Gmail
 * with the approved words, because Boss OS has no route that sends as her personal Gmail
 * (`SEND_ROUTE_STOP`).
 */

export const CLIENT = "hicks";
export const SITE = "hicksconsulting.org";
export const REPO = "seq23/hicks-consulting-canonical";
export const QUARTER_MONTHS = [2, 5, 8, 11];
export const DUE_HOUR_CT = 8;
export const TIMEZONE = "America/Chicago";
/** Search Console publishes two to three days late; the window ends before the lag. */
export const GSC_LAG_DAYS = 3;
export const WINDOW_DAYS = 28;
export const NOT_READ = "not read";

/**
 * NAMED STOP: Boss OS sends as her only through the Workspace delegation (Simone's mailboxes); her
 * emails to this client go from her personal Gmail, which no Boss OS route can send from. So Approve
 * records the approval and opens a ready Gmail compose window; she presses Send. Never a silent skip.
 */
export const SEND_ROUTE_STOP = "NAMED STOP [HICKS_UPDATE_NO_SEND_ROUTE] Boss OS cannot send from your personal Gmail, so Approve opens the email in Gmail ready to send: one more tap on Send.";
export const RECIPIENT_STOP = "NAMED STOP [HICKS_UPDATE_NO_RECIPIENT] The recipient is not set in Boss OS, so the Gmail window opens without an address.";

const DAY = 86_400_000;

/** Her wall clock in Central: year, month (1-12), day, hour, weekday (0 = Sunday). */
export function centralClock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, dow };
}

/**
 * Is a quarterly draft due at `now`? The first Monday of Feb/May/Aug/Nov, from 08:00 Central, for the
 * rest of that day (a missed tick catches up). Returns the quarter's key ("2026-11") or why not.
 */
export function quarterDue(now) {
  const c = centralClock(now);
  if (!QUARTER_MONTHS.includes(c.m)) return { due: false, reason: "not_a_quarter_month" };
  if (c.dow !== 1 || c.d > 7) return { due: false, reason: "not_the_first_monday" };
  if (c.h < DUE_HOUR_CT) return { due: false, reason: "before_8am_central" };
  return { due: true, quarter: `${c.y}-${String(c.m).padStart(2, "0")}`, day: `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}` };
}

/** The two 4-week windows, ending before Search Console's lag. Dates are YYYY-MM-DD. */
export function clickWindows(now) {
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const end = now - GSC_LAG_DAYS * DAY;
  return {
    now: { start: iso(end - (WINDOW_DAYS - 1) * DAY), end: iso(end) },
    prev: { start: iso(end - (2 * WINDOW_DAYS - 1) * DAY), end: iso(end - WINDOW_DAYS * DAY) },
  };
}

/** Sum daily rows ({ date, clicks }) into the two windows. */
export function sumWindows(rows, w) {
  const inside = (d, win) => d >= win.start && d <= win.end;
  let a = 0, b = 0;
  for (const r of rows ?? []) {
    if (inside(r.date, w.now)) a += Number(r.clicks) || 0;
    else if (inside(r.date, w.prev)) b += Number(r.clicks) || 0;
  }
  return { now: a, prev: b };
}

// ─── Fixes in plain words ──────────────────────────────────────────────────────────────────────────

/**
 * Never in her email: the Resources schedule (auto-posting is expected, not news), the build and test
 * machinery, passwords and admin, and anything about calls. A title part matching this is dropped.
 */
const NEVER = /resources?\b|posting|publish|schedul|cadence|\bcron|redraft|\bci\b|\btests?\b|\bdocs?\b|\badmin\b|password|clarity|lead.?domain|\bcall\b|measurement loop|commit helper|search.?loop|\bloop\b|gemini|workers ai|free model|baseline|manifest|ledger|ingestion|queue|pipeline|self.?heal|gate|agent|quarantin|guard|rule zero|ceiling|floor/i;

/** Ordered: the first rule that matches a title part gives its plain sentence. `key` dedupes. */
export const FIX_RULES = [
  { key: "author", re: /byline|author/i, line: "Adding your name as the author on pages that didn't show it, so Google and AI tools know the expertise is yours." },
  { key: "question-headings", re: /question heading|\bfaq|headings? as questions/i, line: "Rewording section headings as the questions people actually ask, which helps Google and tools like ChatGPT quote your answers." },
  { key: "placeholder", re: /filler|placeholder/i, line: "Tidying a page that had some leftover placeholder text." },
  { key: "ai-visits", re: /\bAI measurement|AI (?:visits|traffic|referr)|chatgpt/i, line: "Tracking visits that come from ChatGPT and other AI assistants, so we can watch that new source of traffic grow." },
  { key: "fees", re: /\bfees?\b|pricing|\bprices?\b/i, line: "Showing your session fees clearly, in the place Google looks for them." },
  { key: "schema", re: /schema|rich.?results|structured data/i, line: "Fixing the behind-the-scenes labels that tell Google what each page is about." },
  { key: "speed", re: /speed|cache|compress|images?\b|performance|faster/i, line: "Making the pages load faster." },
  { key: "one-address", re: /redirect|canonical|apex|\bwww\b|\b301\b/i, line: "Making sure Google sends everyone to one official address for the site." },
  { key: "old-links", re: /\b404s?\b|broken|dead link|legacy wix|old site/i, line: "Cleaning up old links left over from the previous site." },
  { key: "titles", re: /\btitles?\b|meta ?data|metadata|descriptions?\b/i, line: "Sharpening page titles and the short descriptions Google shows under them." },
  { key: "crawl", re: /sitemap|crawl|index(?:ing|ed)?\b/i, line: "Making sure Google can find and read every page." },
  { key: "contact", re: /contact|booking/i, line: "Keeping your contact and booking links easy for Google and visitors to reach." },
  { key: "identity", re: /sameas|entity|backlink|profiles?\b/i, line: "Connecting your practice's profiles so Google sees one clear identity." },
  { key: "local-pages", re: /memphis|near me|local pages?/i, line: "Strengthening the Memphis pages that answer \"therapist near me\" searches." },
];

/** A PR title cut into its parts ("Approved search fixes: a, b, c" → a · b · c). */
function titleParts(title) {
  const t = String(title ?? "").replace(/^\s*[a-z]+(\([^)]*\))?!?:\s*/i, "");
  const afterColon = t.includes(":") ? t.slice(t.indexOf(":") + 1) : t;
  return afterColon.split(/[,;]| and (?=[a-z])/i).map((s) => s.trim()).filter(Boolean);
}

/**
 * Merged PRs → plain sentences, deduped, in merge order. `told` = keys the last approved email already
 * said, so a fix is never told twice. Internal machinery maps to nothing and is left out.
 */
export function plainFixes(prs, { told = [] } = {}) {
  const seen = new Set(told);
  const out = [];
  for (const pr of [...(prs ?? [])].sort((a, b) => String(a.merged_at).localeCompare(String(b.merged_at)))) {
    for (const part of titleParts(pr.title)) {
      if (NEVER.test(part)) continue;
      const rule = FIX_RULES.find((r) => r.re.test(part));
      if (!rule || seen.has(rule.key)) continue;
      seen.add(rule.key);
      out.push({ key: rule.key, line: rule.line });
    }
  }
  return out;
}

// ─── The research wins (owner, 3 Nov 2026: "the email at the time will have updated metrics based on
// research too") ───────────────────────────────────────────────────────────────────────────────────
//
// Each read live at draft time. ONLY a real increase or a first is listed; a metric that is flat, down
// or unread is dropped from her client's email (never invented, never 0) and named for HER on the
// approval card instead.

const n0 = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
export const PAGE_ONE = 10;
export const MIN_IMPRESSIONS = 3;
const slugWords = (u) => decodeURIComponent(String(u).replace(/\/+$/, "").split("/").pop() ?? "").replace(/-/g, " ").trim();

/** Sum an AI daily file's days into the two windows: { visitors, bots, measuredDays } per window. */
export function aiWindows(daily, w) {
  const out = { now: { visitors: 0, bots: 0, days: 0 }, prev: { visitors: 0, bots: 0, days: 0 } };
  for (const [day, v] of Object.entries(daily?.days ?? {})) {
    const win = day >= w.now.start && day <= w.now.end ? out.now : day >= w.prev.start && day <= w.prev.end ? out.prev : null;
    if (!win || !v || typeof v !== "object") continue;
    const vis = n0(v.ai_visitors ?? v.ai_referrals ?? v.visitors);
    const bot = n0(v.ai_bot_hits ?? v.bot_hits ?? v.bots);
    if (vis == null && bot == null) continue;
    win.days++; win.visitors += vis ?? 0; win.bots += bot ?? 0;
  }
  return out;
}

/**
 * The wins, in plain words. Inputs (each { ok: false, why } when unread):
 *   ai       { ok, now: { visitors, bots, days }, prev: { … } }   from aiWindows
 *   queries  { ok, now: [{ query, position, impressions }], prev: [...] }
 *   pages    { ok, now: [{ page, impressions }], prev: [...] }      Search Console rows by page
 * Returns { wins: [{ key, line }], unread: [why…], dropped: [what…] }.
 */
export function researchWins({ ai, queries, pages } = {}) {
  const wins = [], unread = [], dropped = [];
  if (!ai?.ok) unread.push(`AI-tool visits and AI crawler reads: ${NOT_READ}${ai?.why ? ` (${ai.why})` : ""}`);
  else {
    const first = ai.prev.days === 0;
    if (ai.now.days > 0 && ai.now.visitors > 0 && (first || ai.now.visitors > ai.prev.visitors)) {
      wins.push({ key: "ai-visits", line: first
        ? `For the first time we can see people arriving from ChatGPT and other AI tools: ${ai.now.visitors} ${ai.now.visitors === 1 ? "visit" : "visits"} in the last four weeks.`
        : `More people are arriving from ChatGPT and other AI tools: ${ai.now.visitors} visits in the last four weeks, up from ${ai.prev.visitors}.` });
    } else dropped.push("AI-tool visits (not up)");
    if (ai.now.days > 0 && ai.now.bots > 0 && (first || ai.now.bots > ai.prev.bots)) {
      wins.push({ key: "ai-reads", line: first
        ? `AI tools like ChatGPT are now reading your pages: ${ai.now.bots} ${ai.now.bots === 1 ? "read" : "reads"} in the last four weeks.`
        : `AI tools like ChatGPT read your pages more often: ${ai.now.bots} times in the last four weeks, up from ${ai.prev.bots}.` });
    } else dropped.push("AI crawler reads (not up)");
  }
  if (!queries?.ok) unread.push(`Searches on Google's first page: ${NOT_READ}${queries?.why ? ` (${queries.why})` : ""}`);
  else {
    const before = new Map((queries.prev ?? []).map((r) => [String(r.query).toLowerCase(), r]));
    const climbed = (queries.now ?? [])
      .filter((r) => n0(r.position) != null && r.position <= PAGE_ONE && r.impressions >= MIN_IMPRESSIONS)
      .filter((r) => { const b = before.get(String(r.query).toLowerCase()); return !b || !(b.position <= PAGE_ONE); })
      .sort((a, b) => b.impressions - a.impressions);
    if (climbed.length) {
      const top = climbed.slice(0, 3).map((r) => `"${r.query}"`);
      const more = climbed.length - top.length;
      wins.push({ key: "page-one", line: `You're now on Google's first page for ${top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}` : top[0]}${more > 0 ? `, plus ${more} more ${more === 1 ? "search" : "searches"}` : ""}.` });
    } else dropped.push("first-page searches (none new)");
  }
  if (!pages?.ok) unread.push(`New question pages showing in Google: ${NOT_READ}${pages?.why ? ` (${pages.why})` : ""}`);
  else {
    const before = new Map((pages.prev ?? []).map((r) => [r.page, r.impressions]));
    const firsts = (pages.now ?? []).filter((r) => /\/questions\//.test(r.page) && r.impressions > 0 && !(before.get(r.page) > 0))
      .sort((a, b) => b.impressions - a.impressions);
    if (firsts.length) {
      const eg = slugWords(firsts[0].page);
      wins.push({ key: "question-pages", line: `${firsts.length === 1 ? "One of your new local question pages has" : `${firsts.length} of your new local question pages have`} started showing up in Google searches${eg ? `, like the one answering "${eg}"` : ""}.` });
    } else dropped.push("new question pages (none showing yet)");
  }
  return { wins, unread, dropped };
}

// ─── The draft ─────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (ts) => MONTHS[centralClock(ts).m - 1];

/**
 * The verdict, from the numbers: a WIN when this window beats the window before or the figure in the
 * last email; STEADY when the numbers were read and nothing went up; UNREAD when Search Console could
 * not be read. Never a dip in the lead.
 */
export function clicksUp(clicks) {
  return Boolean(clicks?.ok) && [clicks.prev, clicks.lastSent].some((x) => Number.isFinite(x) && clicks.now > x);
}
export function verdict(clicks, wins = []) {
  if (clicksUp(clicks) || wins.length) return "win";
  return clicks?.ok ? "steady" : "unread";
}

/**
 * SUBJECTS NEVER REPEAT (owner's coordinator, 3 Nov 2026: the first dry run reused the 3 Nov subject
 * word for word). Every subject ever sent to the client is data (`client_update_subjects`, seeded with
 * her earlier ones); the first candidate for the verdict not already used wins, and when all are used
 * the month and year are added, which is new by construction.
 */
export const SUBJECTS = {
  win: ["Your Google visits are up again", `A good quarter for ${SITE}`, "More people found Hicks Consulting on Google this quarter", "Good news: Google is sending more people your way"],
  steady: [`A steady quarter for ${SITE}`, "Your quarterly website update: holding steady on Google", `Quick update: ${SITE} held steady this quarter`],
  unread: ["Your quarterly website update", `Quick update on ${SITE}`],
};
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function freshSubject(v, pastSubjects = [], now = Date.now()) {
  const used = new Set(pastSubjects.map(norm));
  const list = SUBJECTS[v] ?? SUBJECTS.unread;
  const pick = list.find((s) => !used.has(norm(s)));
  if (pick) return pick;
  const c = centralClock(now);
  for (let i = 0; ; i++) {
    const s = `${list[i % list.length]} (${MONTHS[c.m - 1]} ${c.y}${i >= list.length ? `, ${Math.floor(i / list.length) + 1}` : ""})`;
    if (!used.has(norm(s))) return s;
  }
}

/**
 * Compose the email. Inputs:
 *   name      the greeting name (runtime config; null → "Hi,")
 *   clicks    { ok: true, now, prev, lastSent|null, lastSentAt|null } or { ok: false, why }
 *   fixes     { ok: true, items: [{ key, line }] } or { ok: false, why }
 *   carryOver [{ id, line }] placed FIRST in the fixes section
 *   pastSubjects every subject already sent to the client (never reused)
 */
export function composeDraft({ name, clicks, fixes, carryOver = [], pastSubjects = [], wins = [], now = Date.now() }) {
  const v = verdict(clicks, wins);
  const lines = [`Hi ${name ? String(name).trim() : ""}`.trim() + ",", ""];
  const subject = freshSubject(v, pastSubjects, now);
  const visitsLine = (withUps) => {
    const ups = [];
    if (withUps && Number.isFinite(clicks.lastSent) && clicks.now > clicks.lastSent) ups.push(`up from ${clicks.lastSent} when I last wrote${clicks.lastSentAt ? ` in ${monthOf(clicks.lastSentAt)}` : ""}`);
    if (withUps && Number.isFinite(clicks.prev) && clicks.now > clicks.prev) ups.push(`${ups.length ? "and " : "up from "}${clicks.prev} the four weeks before that`);
    return `Over the last four weeks, ${clicks.now} ${clicks.now === 1 ? "person" : "people"} came to ${SITE} from Google search${ups.length ? `, ${ups.join(" ")}` : ""}.`;
  };
  if (v === "win" && clicksUp(clicks)) {
    lines.push("Quick, happy update. More people are finding you on Google and clicking through to your site.", "");
    lines.push(visitsLine(true), "");
  } else if (v === "win") {
    // The win is in the research, not the visits: lead with it; the visits are said plainly after.
    lines.push("Quick, happy update. There are some good new signs that people are finding you.", "");
  } else if (v === "steady") {
    lines.push("Quick update: it was a steady quarter for your site on Google.", "");
    lines.push(`${visitsLine(false).replace(/\.$/, "")}, and the pages people find you through are holding their places.`, "");
  } else {
    lines.push("Quick update on your website.", "");
    lines.push(`Visits from Google over the last four weeks: ${NOT_READ}.`, "");
  }
  if (wins.length) {
    lines.push("A few more good signs:", ...wins.map((w) => `- ${w.line}`), "");
    if (v === "win" && !clicksUp(clicks) && clicks?.ok) lines.push(visitsLine(false), "");
  }

  const bullets = [...carryOver.map((c) => c.line)];
  if (fixes?.ok) bullets.push(...fixes.items.map((f) => f.line));
  else bullets.push(`Fixes this quarter: ${NOT_READ}.`);
  if (bullets.length) lines.push("What I'm polishing:", ...bullets.map((b) => `- ${b}`), "");

  lines.push("None of this changes your writing. It just helps the right people find it.", "");
  lines.push("Thanks again for trusting me with this.", "", "Best,", "Sequoia");
  const text = lines.join("\n");
  return { subject, text, verdict: v, fixKeys: fixes?.ok ? fixes.items.map((f) => f.key) : [], carryIds: carryOver.map((c) => c.id) };
}

/**
 * What must never be in the words that go to the client. Each is a problem by name; empty = fine.
 * Run on every composed draft; a draft with a problem is never put in front of her for approval.
 */
export function draftProblems(text, subject = "") {
  const all = `${subject}\n${text}`;
  const out = [];
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(all)) out.push("an email address is in the words");
  if (/\bresources?\b[^.\n]*\b(schedul|post(?:s|ing)?|publish)/i.test(all) || /\bposting schedule\b/i.test(all)) out.push("it mentions the Resources posting schedule");
  if (/\b(a |on a |hop on a |jump on a )?call\b|\bzoom\b|\bmeet(?:ing)? (?:up|to go over)\b/i.test(all)) out.push("it suggests a call");
  if (/\b(dip|drop(?:ped)?|down|fell|fewer|decline)\b/i.test(text.split("\n").filter(Boolean).slice(1, 3).join(" "))) out.push("it leads with a dip");
  if (!/^Hi\b/.test(text) || !/Best,\nSequoia\s*$/.test(text)) out.push("it is missing the greeting or the sign-off");
  return out;
}

/** A Gmail compose link in HER personal Gmail with the approved words (never sends anything itself). */
export function composeUrl({ to, gmailUser, subject, text }) {
  const q = new URLSearchParams({ view: "cm", fs: "1", ...(to ? { to } : {}), su: subject, body: text });
  if (gmailUser) q.set("authuser", gmailUser);
  return `https://mail.google.com/mail/?${q.toString()}`;
}

/**
 * The approval email Camille sends her (owner-email layout: happened, then one Decide card with the
 * words that go, word for word). `taps` = { approve, change, skip } absolute URLs.
 */
export function approvalNotice({ draft, clicks, fixes, recipient, taps, version = 1, research = null }) {
  const n = (x) => (Number.isFinite(x) ? String(x) : NOT_READ);
  const numbers = clicks?.ok
    ? `Google visits, last 4 weeks: ${clicks.now}. The 4 weeks before: ${n(clicks.prev)}. Your last email said: ${n(clicks.lastSent)}.`
    : `Google visits: ${NOT_READ} (${clicks?.why ?? "Search Console did not answer"}).`;
  const fixLine = fixes?.ok ? `Fixes since your last email, in plain words: ${fixes.items.length}.` : `Fixes since your last email: ${NOT_READ} (${fixes?.why ?? "the site's history did not answer"}).`;
  const lead = draft.verdict === "win" ? "It leads with the win." : draft.verdict === "steady" ? "Nothing went up, so it says the quarter was steady." : "Search Console could not be read, so the email says so.";
  return {
    subject: version > 1 ? "Your changed Hicks website update is ready for your OK" : "The Hicks website update is ready for your OK",
    happened: `Camille drafted this quarter's website update for Hicks Consulting. ${lead} Nothing goes to them until you approve it.`,
    details: [],
    decide: [{
      title: "Send the Hicks quarterly website update?",
      body: `To: ${recipient?.name && recipient?.to ? `${recipient.name} <${recipient.to}>` : RECIPIENT_STOP.replace(/^NAMED STOP \[[A-Z_]+\] /, "")}, from your Gmail.`,
      details: [numbers, fixLine, ...(research?.unread ?? []).map((u) => `Left out, could not be read: ${u}.`), ...((research?.dropped ?? []).length ? [`Left out because they did not go up: ${research.dropped.join(", ")}.`] : []), SEND_ROUTE_STOP.replace(/^NAMED STOP \[[A-Z_]+\] /, "")],
      draft: { heading: "The email, word for word", text: `Subject: ${draft.subject}\n\n${draft.text}` },
      buttons: [
        { label: "Approve and open in Gmail", url: taps.approve },
        { label: "Change the words", url: taps.change },
        { label: "Skip this quarter", url: taps.skip },
      ],
    }],
  };
}
