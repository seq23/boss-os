#!/usr/bin/env node
/**
 * SIMONE'S ONE MORNING EMAIL (owner, 22 Oct 2026; reshaped 23 Oct 2026, rule 1 of the email fix).
 *
 * Her ruling: "ONE morning email from Simone (06:40)", in this order:
 *
 *   1. Decide — EVERY thing only she can decide (24 Oct 2026: "6 decisions" showed 3 and Today showed
 *      none), each with who, what they said, the history, the words that go out in her name word for
 *      word, one-tap buttons and a link to its own screen: her Inbox decisions, Danielle's plans and
 *      previews, work held for her word (the channel's comments by name), and every Decide item the
 *      other producers wrote (an intro to make, an LP reply to send) — highest priority first;
 *   2. New deals since yesterday (each opens its deal screen) and "Monique found" (her own email
 *      first, then public filings and press, labelled "not confirmed", each with one next step);
 *   3. Camille's briefing: five lines, then the WHOLE briefing under "Show the full briefing ▾"
 *      (written out in full in the plain-text copy), citations linked to their sources;
 *   4. Done for you — three lines at most, What happened / What we did / Status where it fits (the
 *      bounce agent, comments left alone, the jobs she emailed, Zora's and Toni's quiet work);
 *   5. Catch up with — 0–3, only when a live reason exists (rule 14);
 *   6. Porch & Party: To do for Valerie — the site's own owner feed, unchanged;
 *   7. the sign-off; the 8Raise line only when something is wrong with Monique's credits.
 *
 * THE MORNING IS KEPT IN BOSS OS. Before it sends, the run posts every item (POST /morning); each
 * link in the email opens that item's screen (/?morning=<day>&item=<id>) and Today shows the same
 * Decide list. The email, Today and the item screen read one record and cannot disagree.
 *
 * On Mondays the same email carries "This week" (deadlines); there is no second Monday email.
 *
 * THE SECTIONS ARE FILES. Every other producer writes `~/.boss-os/morning/<section>.json`
 * (src/shared/boss/mail/morning.mjs is the interface); this renders whatever is present and fresh and
 * skips the rest. Nothing is invented: every line is a row read from Boss OS, a section file, or the
 * P&P owner feed. A source that did not load is said in one plain line and becomes a fix job for the
 * team — never "I could not read".
 *
 * "REPLY TO CHANGE ANYTHING." The email carries `yd_<date>` as its job code (hidden, X-Boss-Ref), and
 * `postEmployeeMail` records it with the email's text against the Message-ID her reply quotes, so her
 * reply to simone@ becomes a Simone task carrying this email.
 *
 *   npm run your-day                 # send today's — once per day
 *   npm run your-day -- --dry-run    # print what would be sent, send nothing
 *   npm run your-day -- --preview <dir>   # write the HTML and text to <dir>, send nothing
 */
import { MAX_TOUCHES } from "../../src/shared/boss/lp/plan.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sendAsEmployee } from "./notify.mjs";
import { createHash } from "node:crypto";
import { layoutEmail, clockWords, lineProblems, proseRuns, proseText, cleanText, quotedSentence } from "../../src/shared/boss/mail/plain.mjs";
import { readMorningSections, clearToldSections } from "../../src/shared/boss/mail/morning.mjs";
import { templateDecide } from "./lp-prospects.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const FEED = process.env.PNP_OWNER_FEED_URL ?? "https://porchandparty901.com/api/owner-feed";
const TZ = "America/Chicago";
const SENT_DIR = path.join(os.homedir(), ".boss-os", "your-day");
const DAY_MS = 86_400_000;

// ─── Time, in her zone ─────────────────────────────────────────────────────────

function parts(at) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(new Date(at));
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, weekday: g("weekday"), hour: Number(g("hour")) % 24, minute: Number(g("minute")) };
}
export const dayOf = (at) => parts(at).date;
export const timeOf = (at) => { const p = parts(at); return clockWords(p.hour, p.minute); };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function dayWords(iso, { weekday = true } = {}) {
  const d = new Date(`${iso}T12:00:00Z`);
  const wd = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${weekday ? `${wd}, ` : ""}${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
const shortDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ─── The pieces, from data (pure: tests build them from fixtures) ─────────────

const OPEN = new Set(["queued", "running", "awaiting_approval", "classified", "assigned"]);

function callsOn(diary, iso) {
  return (diary ?? []).filter((r) => r.scheduled_at && dayOf(r.scheduled_at) === iso).sort((a, b) => a.scheduled_at - b.scheduled_at);
}

/** Every item in the email opens its own screen (owner, 24 Oct 2026): the morning, kept in Boss OS. */
export const itemUrl = (day, id) => `${ORIGIN}/?morning=${day}&item=${encodeURIComponent(id)}`;
export const taskUrl = (id) => `${ORIGIN}/?task=${encodeURIComponent(id)}`;
export const BRIEFING_URL = `${ORIGIN}/?view=briefing`;
/** Under Gmail's ~102KB clip with room to spare (24 Oct 2026). Pinned by tests/yourDaySize.test.ts. */
export const EMAIL_HTML_BUDGET = 80_000;
/** Long lists stop here in the email; the rest is one tap away on its screen. */
export const MAX_DEAL_ROWS = 10;
export const MAX_FOUND_LINES = 8;
export const MAX_PROSPECT_SENDS = 5;
/** What goes first when a heavy day is still over budget, in order; each step keeps the ones before. */
export const CUT_ORDER = Object.freeze([
  ["prospect email words", { prospectWords: false }],
  ["Monique's lines to three", { prospectWords: false, foundMax: 3 }],
  ["deal rows to five", { prospectWords: false, foundMax: 3, dealMax: 5 }],
]);
/** A short stable id for an item, from what it is (the same item keeps its screen across re-runs). */
export function itemId(kind, key) {
  return `${kind}-${createHash("sha256").update(String(key)).digest("hex").slice(0, 10)}`;
}

/** The channel Monique reads comments on, by its name (24 Oct 2026: "which channel?"). */
export const CHANNEL = "How We Know on YouTube";
const COMMENT_CHOICE = {
  hide: "hide it (it disappears for everyone except the person who wrote it)",
  reply: "answer it in public as the channel",
  ignore: "leave it alone (nothing changes on the channel)",
};

/** The comment-watch digest behind a task, with its rows, from GET /comment-watch-items. */
function digestOf(data, task) {
  let input = {};
  try { input = typeof task.input === "string" ? JSON.parse(task.input) : (task.input ?? {}); } catch { input = {}; }
  if (input?.kind !== "youtube_comment_watch") return null;
  return (data.commentWatch ?? []).find((d) => d.id === input.digest_id || d.task_id === task.id) ?? { id: input.digest_id, items: [] };
}

/**
 * Boss OS's own decisions for her: Inbox approvals, Danielle's plans and previews, work held for her
 * word. Each says what she is deciding and what each choice does, and opens its own screen.
 */
function bossDecisions(data) {
  const out = [];
  for (const a of data.approvals ?? []) {
    out.push({
      key: `approval:${a.id}`, title: a.title, body: a.summary ?? a.reason ?? "It waits in your Inbox for Approve or Decline.",
      details: [...(a.employee_name ? [`Asked by ${a.employee_name}.`] : []), ...(a.risk ? [`Risk: ${a.risk}.`] : [])],
      buttons: [{ label: "Open it to approve or decline", url: `${ORIGIN}/?tab=inbox&approval=${encodeURIComponent(a.id)}` }], priority: 2,
    });
  }
  for (const r of (data.repoChanges ?? []).filter((x) => x.phase === "asking" || x.phase === "previewing")) {
    const firstLine = String(r.instruction ?? "").split("\n")[0].trim();
    out.push(r.phase === "asking"
      ? { key: `rc:${r.id}`, title: `Start Danielle's plan for ${r.repo ?? "your change"}?`, body: `${firstLine ? `You asked: "${firstLine}". ` : ""}Danielle wrote a plan and builds nothing until you say yes.`, details: ["Yes: reply approved to her email and she starts the build.", "No: reply with what to change, or drop it."], plan: r.plan_text ?? null, buttons: [], priority: 1 }
      : { key: `rc:${r.id}`, title: `Make Danielle's preview of ${r.repo ?? "your change"} live?`, body: `${firstLine ? `You asked: "${firstLine}". ` : ""}The preview is built; nothing is live until you say so.`, details: ["Yes: reply approved to her email and it goes live.", "No: reply with what to change."], plan: r.plan_text ?? null, buttons: [], priority: 1 });
  }
  for (const t of (data.tasks ?? []).filter((x) => x.status === "awaiting_approval")) {
    const dg = digestOf(data, t);
    if (dg) {
      const items = dg.items ?? [];
      const open = items.filter((i) => !i.instructed_at);
      if (!open.length) continue; // answered: nothing waits for her
      out.push({
        key: `task:${t.id}`,
        title: `${CHANNEL}: ${plural(open.length, "comment needs", "comments need")} your word`,
        body: `${t.employee_name ?? "Monique"} read the channel's new comments. Hiding or answering one speaks for the channel, so it waits for you.`,
        details: [
          ...open.map((i) => `${i.n}. On the video "${i.video_title ?? "a video"}", ${i.author ?? "a viewer"} wrote: "${String(i.text).slice(0, 300)}". Monique suggests: ${COMMENT_CHOICE[i.proposed_action] ?? i.proposed_action}${i.proposed_action === "reply" && i.proposed_reply ? `, with: "${i.proposed_reply}"` : ""}.`),
          "Your choices for each: hide, reply or ignore. Answer by replying to Monique's email about these comments with the number and the word, for example \"1 ignore\".",
        ],
        buttons: [{ label: "See the comments", url: taskUrl(t.id) }], priority: 1,
      });
      continue;
    }
    out.push({
      key: `task:${t.id}`, title: `${t.employee_name ?? "Your team"} is waiting for your word: ${t.title}`,
      body: "Nothing happens on it until you answer.",
      buttons: [{ label: "Open it", url: taskUrl(t.id) }], priority: 1,
    });
  }
  return out;
}

/** What Monique did with the comments that did not need her (owner, 24 Oct 2026: fix it, then tell me). */
function commentDoneLines(data, now) {
  const out = [];
  for (const d of data.commentWatch ?? []) {
    if (d.task_id || !(d.items ?? []).length || now - Number(d.created_at) > DAY_MS) continue;
    const faults = d.items.filter((i) => i.product_note);
    out.push({
      text: `What happened: ${plural(d.items.length, "new comment")} on ${CHANNEL}${faults.length ? `, ${faults.length} pointing at a fault in a video (${faults.map((i) => i.product_note).join("; ")})` : ""}. What we did: Monique left ${d.items.length === 1 ? "it" : "them"} alone, as none needed an answer${faults.length ? ", and Danielle has the fault to fix for future videos" : ""}. Status: done, nothing needed from you.`,
    });
  }
  return out;
}

function valerieItems(feed) {
  if (!feed) return null;
  return (feed.items ?? []).map((i) => {
    const due = i.kind === "money" || !i.detail ? "" : ` — ${i.detail}`;
    const head = i.kind === "money" ? `Money: ${i.title}` : i.kind === "renewal" ? `Marketplace: ${i.title}` : i.kind === "id_delete" ? `ID photo: ${i.title}` : i.title;
    return `${head}${i.kind === "money" && i.detail ? ` — ${i.detail}` : due}`;
  }).filter((s) => !/^Your week\b/.test(s));
}

/** The one-minute summary's raw lines (≤5), as Camille wrote them. `null` when today's report is not in. */
function briefingRaw(briefing, today) {
  if (!briefingReady(briefing, today)) return null;
  const sec = (briefing.sections ?? []).find((s) => s?.key === "one_minute_summary" || /one[- ]minute/i.test(String(s?.heading ?? s?.title ?? "")));
  const raw = [];
  if (sec) {
    if (Array.isArray(sec.bullets)) raw.push(...sec.bullets.map((b) => (typeof b === "string" ? b : b?.text ?? "")));
    if (Array.isArray(sec.items)) raw.push(...sec.items.map((b) => (typeof b === "string" ? b : b?.text ?? b?.title ?? "")));
    if (!raw.length && typeof sec.body === "string") raw.push(...sec.body.split(/\n+|(?<=[.!?])\s+/));
    if (!raw.length && typeof sec.so_what === "string") raw.push(sec.so_what);
  }
  if (!raw.length && typeof briefing.summary === "string") raw.push(...briefing.summary.split(/(?<=[.!?])\s+/));
  if (!raw.length && briefing.headline) raw.push(String(briefing.headline));
  return raw.map((l) => String(l).replace(/^[-*•]\s+/, "").trim()).filter(Boolean).slice(0, 5);
}

/**
 * CAMILLE'S BRIEFING IN FIVE LINES OR FEWER, from the report's One-Minute Executive Summary section
 * (key `one_minute_summary`, or its heading on older reports); the report's `summary` sentences when
 * the section is absent. `null` when today's report has not landed. Plain words, no markdown.
 */
export function briefingLines(briefing, today) {
  const raw = briefingRaw(briefing, today);
  return raw ? raw.map((l) => proseText(proseRuns(l)).replace(/⁣/g, "").replace(/[.!?]?\s*$/, ".")) : null;
}

/** Where citation n of a report opens: its source on the web, else the briefing screen. */
export function briefingSourceUrl(briefing) {
  return (n) => {
    const s = (briefing?.sources ?? [])[Number(n) - 1];
    const u = String(s?.url ?? "");
    return /^https?:\/\/[^\s"'<>]+$/.test(u) ? u : `${BRIEFING_URL}#brief-src-${n}`;
  };
}

const textOf = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? (v.text ?? v.wanted ?? v.claim ?? v.title ?? v.summary ?? "") : "");

/**
 * THE WHOLE BRIEFING, for the fold under the top five (owner, 24 Oct 2026: "must come FULLY in the
 * email"): every section in the report's order, what it means, its lines, the corrections and gaps,
 * and the numbered sources, each a link. Pure.
 */
export function briefingFull(briefing) {
  if (!briefing) return [];
  const src = briefingSourceUrl(briefing);
  const runs = (l) => ({ runs: proseRuns(String(l), src) });
  const blocks = [];
  for (const sec of briefing.sections ?? []) {
    if (sec?.key === "one_minute_summary") continue;
    const lines = [];
    if (typeof sec.so_what === "string" && sec.so_what.trim()) lines.push(runs(`What it means: ${sec.so_what}`));
    for (const b of sec.bullets ?? []) if (textOf(b).trim()) lines.push(runs(textOf(b)));
    for (const it of sec.items ?? []) {
      if (typeof it === "string") { lines.push(runs(it)); continue; }
      const head = [it?.headline ?? it?.title, it?.summary ?? it?.text].filter(Boolean).join(": ");
      if (head) lines.push(runs(head));
      for (const b of it?.bullets ?? []) if (textOf(b).trim()) lines.push(runs(textOf(b)));
    }
    if (typeof sec.body === "string") for (const p of sec.body.split(/\n{2,}/)) if (p.trim()) lines.push(runs(p));
    if (sec.insight && typeof sec.insight === "object") {
      for (const [k, v] of Object.entries(sec.insight)) if (typeof v === "string" && v.trim() && k !== "cites") lines.push(runs(v));
    }
    if (sec.table) lines.push({ runs: [{ text: "The table of figures is on the briefing screen: " }, { text: "open it", url: BRIEFING_URL }] });
    if (lines.length) blocks.push({ heading: String(sec.heading ?? sec.title ?? ""), lines });
  }
  for (const [key, heading] of [["corrections", "Corrections to earlier briefings"], ["gaps", "What Camille could not confirm"], ["watching", "Watching for"]]) {
    const list = (briefing[key] ?? []).map(textOf).filter((t) => t.trim());
    if (list.length) blocks.push({ heading, lines: list.map(runs) });
  }
  const sources = (briefing.sources ?? []).map((s, i) => ({ n: i + 1, name: String(s?.name ?? s?.title ?? `Source ${i + 1}`), url: src(i + 1) }));
  if (sources.length) blocks.push({ heading: "Sources", lines: sources.map((s) => ({ runs: [{ text: `${s.n}. ` }, { text: cleanText(s.name, { prose: true }) || `Source ${s.n}`, url: s.url }] })) });
  return blocks;
}

/** Today's executive report has landed (Camille files it at about 07:10 Central). */
export function briefingReady(briefing, today) {
  return Boolean(briefing && briefing.for_day === today && (briefing.headline || briefing.summary || (briefing.sections ?? []).length));
}

/** The latest the morning email waits for Camille's briefing: 07:45 Central. */
export const BRIEFING_CAP = Object.freeze({ hour: 7, minute: 45 });
export const BRIEFING_POLL_MS = 3 * 60_000;

/**
 * THE TIMING RULE (coordinator finding, 23 Oct 2026: the report lands about 07:10, the email went at
 * 06:40 and could never carry it). From 06:40 the run waits for today's report and sends the moment
 * it lands; at 07:45 Central it sends without it, says "Briefing late" in one line, and opens a fix
 * job. `"send" | "wait" | "send_late"`. Pure.
 */
export function briefingDecision(briefing, now) {
  const today = dayOf(now);
  if (briefingReady(briefing, today)) return "send";
  const p = parts(now);
  return p.hour * 60 + p.minute >= BRIEFING_CAP.hour * 60 + BRIEFING_CAP.minute ? "send_late" : "wait";
}

/** The one "done" line for the bounce agent (rule 4), from GET /outreach/bounce-fixes. */
export function bounceLine(b) {
  if (!b || !(b.replaced || b.dropped || b.restarted?.length)) return null;
  const bits = [];
  if (b.replaced) bits.push(`Replaced ${plural(b.replaced, "outreach address", "outreach addresses")} that bounced with working ones from each company's own site`);
  if (b.dropped) bits.push(`${b.replaced ? "removed" : "Removed"} ${plural(b.dropped, "bounced address", "bounced addresses")} for good (no working address was published)`);
  if (b.restarted?.length) bits.push(`${bits.length ? "outreach restarted" : "Outreach restarted"} (${b.restarted.join(", ")})`);
  return `${bits.join("; ")}.`;
}


const SIDE_WORDS = { buyer: "a buyer", seller: "a seller", both: "buys and sells", unknown: "side not known yet" };
const shortDate = (ms) => new Date(Number(ms)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: TZ });
const nameOf = (r) => r.name || r.email || "someone";
const whoLine = (r) => `${nameOf(r)}${[r.firm, r.email].filter(Boolean).length ? ` (${[r.firm, r.email].filter(Boolean).join(", ")})` : ""}`;
export const PROSPECTS_URL = `${ORIGIN}/?tab=capital&view=prospects`;

/**
 * "PROSPECT EMAILS" (owner, 24 Oct 2026: "keep me abreast of prospect outreach"): yesterday's sends
 * (who, firm, address, side, which email of three, the words under a fold), the replies, who is next
 * and when, and the totals. Nothing went out: it says exactly why. From GET /lp/prospects/activity.
 * Pure. `null` when the activity did not load (the run says so in its log; Done keeps its line).
 */
export function prospectSection(a, now = Date.now()) {
  if (!a) return null;
  // Only what is NEW since the last morning (owner, 24 Oct 2026): sends since yesterday, new replies,
  // touches due today, one totals line. Everything already sent lives on the Prospects screen.
  const items = [];
  const t = a.totals ?? {};
  const sent = (a.sent ?? []).filter((r) => Number(r.sent_at) >= now - 30 * 3_600_000);
  for (const r of sent.slice(0, MAX_PROSPECT_SENDS)) items.push({ text: `Sent: email ${r.touch_no} of ${MAX_TOUCHES} to ${whoLine(r)}, ${SIDE_WORDS[r.side] ?? SIDE_WORDS.unknown}, ${shortDate(r.sent_at)}.`, links: [{ label: "See it on the Prospects screen", url: PROSPECTS_URL }] });
  if (sent.length > MAX_PROSPECT_SENDS) items.push({ text: `And ${sent.length - MAX_PROSPECT_SENDS} more sent since yesterday.`, links: [{ label: `See all ${sent.length} on the Prospects screen →`, url: PROSPECTS_URL }] });
  for (const r of a.replies ?? []) {
    const what = r.status === "opted_out" ? "asked not to be written to again (done: they are off every list)" : r.status === "bounced" ? "bounced (done: the address is off the list)" : `answered${r.reply_note ? `: ${quotedSentence(r.reply_note)}` : "."}${r.has_draft ? " Your reply is ready in Decide above." : ""}`;
    items.push(`${whoLine(r)} ${what}`);
  }
  const endOfToday = now + 18 * 3_600_000;
  const due = (a.next ?? []).filter((r) => r.next_at && r.next_at <= endOfToday);
  if (due.length) {
    items.push(!a.approved && !a.pending
      ? `${plural(due.length, "follow-up is", "follow-ups are")} due and not going out; why, and what unblocks them, is in Decide above.`
      : (a.stops ?? []).length
      ? `${plural(due.length, "follow-up is", "follow-ups are")} due and not going out. Why: ${(a.stops ?? []).join(" ")}`
      : `Going out today: ${plural(due.length, "follow-up")} (${due.slice(0, 5).map(nameOf).join(", ")}${due.length > 5 ? ` and ${due.length - 5} more` : ""}).`);
  }
  if (!sent.length && !(a.replies ?? []).length && !due.length) items.push("Nothing new on prospect emails since yesterday.");
  items.push(`So far: ${plural(t.emails_sent ?? 0, "email")} sent; ${(t.new ?? 0) + (t.active ?? 0)} in the sequence, ${t.interested ?? 0} interested, ${t.replied ?? 0} replied, ${t.opted_out ?? 0} opted out, ${t.bounced ?? 0} bounced.`);
  const blocks = sent.slice(0, MAX_PROSPECT_SENDS).map((r) => ({
    heading: `Email ${r.touch_no} to ${nameOf(r)}${r.firm ? `, ${r.firm}` : ""}`,
    lines: r.body ? [`Subject: ${r.sent_subject ?? r.subject ?? ""}`, ...String(r.body).split("\n").filter((l) => l.trim())] : ["Its words are in your Sent mail."],
  }));
  return { title: "Prospect emails", items, link: { label: "See every prospect", url: PROSPECTS_URL }, ...(blocks.length ? { full: { summary: "Show the emails ▾", blocks } } : {}), empty: null };
}

/**
 * EVERYTHING AWAITING HER ON PROSPECTS IS A DECISION (owner, 24 Oct 2026, Rule 0): the email waiting
 * for her OK, and follow-ups that are due but cannot go because no email is approved — with why and
 * what unblocks them. Pure; `existingKeys` stops a second copy of what a producer already wrote.
 */
export function prospectDecisions(a, existingKeys = new Set(), now = Date.now()) {
  if (!a) return [];
  const out = [];
  if (a.pending && a.pending.tap_token && !existingKeys.has(`prospect-template:${a.pending.id ?? a.pending.hash ?? ""}`)) {
    out.push({ ...templateDecide(a.pending, { forecast: a.forecast ?? null }), priority: 3 });
  }
  const due = (a.next ?? []).filter((r) => r.next_at && r.next_at <= now + 18 * 3_600_000);
  if (due.length && !a.approved && !a.pending) {
    out.push({
      key: "prospects-stuck",
      title: `${plural(due.length, "prospect follow-up is", "prospect follow-ups are")} due and cannot go out`,
      body: "No prospect email is approved, and Monique has fewer than three fresh names on your list to write one, so nothing goes.",
      details: [
        `Waiting: ${due.slice(0, 8).map(whoLine).join("; ")}${due.length > 8 ? `; and ${due.length - 8} more` : ""}.`,
        "To unblock: add at least three company names to feature, on Your team under the lists Monique keeps, or by replying to any Monique email (for example \"add Company A, Company B, Company C\"). Monique then writes the email and puts it here for your Approve.",
      ],
      buttons: [{ label: "Add the names", url: `${ORIGIN}/?tab=team` }, { label: "See who is waiting", url: PROSPECTS_URL }],
      priority: 3,
    });
  }
  return out;
}

// ─── Spirit (owner-approved sample, 24 Oct 2026) ──────────────────────────────

export const SPIRIT_URL = `${ORIGIN}/?tab=spirit`;
export const SPIRIT_LINK_LABEL = "See the full sky, body and practice in Boss OS →";
const BAND_WORDS = { peak_green: "Peak money week", green: "Good money week", yellow: "Steady money week", orange: "Careful money week", red: "Quiet money week" };
const MOON_ICON = { full_moon: "🌕", new_moon: "🌑", first_quarter: "🌓", last_quarter: "🌗" };
const STEP_WORDS = [[/breath/i, "breathe"], [/cent(er|re)|ground/i, "center"], [/gratitude/i, "gratitude"], [/visuali/i, "visualize"], [/affirm/i, "affirm"], [/embod/i, "embody"], [/action|standard/i, "name today's one action"]];
const HARD = new Set(["square", "opposition"]);
const EASY = new Set(["trine", "sextile"]);
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** "Sunday night", "this afternoon", in her zone. */
function whenWords(at, now) {
  const p = parts(at);
  const part = p.hour < 12 ? "morning" : p.hour < 17 ? "afternoon" : "night";
  if (p.date === dayOf(now)) return part === "night" ? "tonight" : `this ${part}`;
  return `${p.weekday} ${part}`;
}

/**
 * THE SPIRIT SECTION, built exactly like the sample she approved: the money-map week, the next
 * major lunar event, today's sky in one plain line, the morning practice in one line, the gratitude
 * sentence, this month's Ancestors hour and Contribution, and the week's practice in one line — then
 * one link to the Spirit tab for the rest (owner, 25 Oct 2026: trimmed). Pure.
 */
export function spiritSection(day, week, now = Date.now()) {
  if (!day) return null;
  const items = [];
  const cur = day.map?.current;
  if (cur) items.push(`${cur.signal ?? ""} ${BAND_WORDS[cur.band] ?? cur.meaning ?? "This week"} (${cur.label}). ${cap(String(cur.note ?? "").replace(/^Peak money week\s*[—-]\s*/i, ""))}${/[.!?]$/.test(cur.note ?? "") ? "" : "."}`.trim());
  const ev = day.major_event;
  if (ev?.label && ev.at) items.push(`${MOON_ICON[ev.kind] ?? "🌙"} ${ev.label} ${whenWords(ev.at, now)}${ev.hours_away ? `, about ${ev.hours_away} hours away` : ""}.`);
  const active = day.sky?.active ?? [];
  if (active.length) {
    const hard = active.filter((a) => HARD.has(a.aspect)).length;
    const easy = active.filter((a) => EASY.has(a.aspect)).length;
    const lead = hard >= easy ? "the sky says make the decision rather than wait" : "the sky is easy today, so reach for what you want";
    items.push(`⚡ Today: ${lead}.${hard >= easy && easy ? " There's also an easy opening for growth, so use it." : ""}`);
  } else if (day.sky?.available) items.push("⚡ Today: a quiet sky.");
  const steps = day.practice?.manifestation?.steps ?? [];
  if (steps.length) {
    const total = steps.reduce((n, x) => n + (Number(x.minutes) || 0), 0);
    const words = steps.map((x) => `${(STEP_WORDS.find(([re]) => re.test(x.what)) ?? [null, String(x.what).split(/\s+/).slice(0, 2).join(" ").toLowerCase()])[1]} ${x.minutes}`);
    items.push(`This morning · ${total} min: ${cap(words.join(" → "))}.`);
  }
  const g = day.practice?.gratitude?.sentence;
  if (g) items.push({ runs: [{ text: `“${g}”` }] });
  const anc = day.ancestors;
  const con = day.contribution;
  if (anc || con) {
    const [y, mo] = dayOf(now).split("-").map(Number);
    const left = new Date(Date.UTC(y, mo, 0)).getUTCDate() - Number(dayOf(now).slice(8, 10));
    items.push(`This month · ${plural(left, "day")} left: 🕯 Ancestors hour: ${anc?.minutes ?? 0} of ${anc?.target_minutes ?? 60} min · 🤝 Contribution: ${con?.count ?? 0} of ${con?.minimum ?? 1}.`);
  }
  /*
   * THE WEEK'S PRACTICE, ONE SHORT LINE (owner, 25 Oct 2026): its own first sentence, no source.
   * Everything else — the sky in full, Body, Manifestations, the advisory note — is on the Spirit tab,
   * one link away. The email carries only what she reads in the morning.
   */
  const how = String(week?.practice?.how_to_try_it ?? week?.practice?.claim ?? "").replace(/\s+/g, " ").trim();
  const tech = String(week?.practice?.technique ?? "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
  // An if-then plan reads as the plan itself: "If I finish my morning coffee, then I do 5 minutes of breathwork."
  const plan = /['"‘“](If [^'"’”]{8,160}?)['"’”]/i.exec(how)?.[1]?.trim();
  const first = (how.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? how).trim();
  const line = plan ? `${tech ? `${tech}: ` : ""}${plan}${/[.!?]$/.test(plan) ? "" : "."}` : first || tech;
  if (line) items.push(`This week's practice: ${line}${/[.!?]$/.test(line) ? "" : "."}`);
  return { title: "✨ Spirit", items: items.map((i) => (typeof i === "string" ? { runs: [{ text: i }] } : i)), link: { label: SPIRIT_LINK_LABEL, url: SPIRIT_URL }, empty: null };
}

/**
 * A TASK THAT FAILED IS THE TEAM'S TO FIX, AND SHE IS TOLD AS DONE (owner, 24 Oct 2026). Each one
 * that failed since yesterday is a done line — What happened / What we did / Status — and the run
 * opens a fix job for it (main). Pure.
 */
export function failedTaskLines(tasks, now = Date.now()) {
  return (tasks ?? []).filter((t) => t.status === "failed" && Number(t.finished_at ?? t.created_at) >= now - 26 * 3_600_000)
    .map((t) => ({ id: t.id, text: `What happened: ${t.employee_name ?? "A teammate"}'s "${String(t.title).slice(0, 80)}" stopped (${String(t.error ?? "no reason given").split("\n")[0].slice(0, 120)}). What we did: Danielle has a job to find the cause and fix it at source. Status: being fixed; nothing needed from you.` }));
}

const DONE_SOURCES = ["bounces", "lp", "prospects", "tail", "notices", "risk", "archive"];
const MAX_DONE = 3;

/** 8Raise is said only when something is wrong (owner, 24 Oct 2026: "drop the footer unless"). */
export function eightRaiseLine(credits) {
  if (!credits) return null;
  const budget = Number(credits.budget ?? 75);
  const kept = Number(credits.kept ?? 30);
  const used = Number(credits.used ?? 0);
  if (credits.error) return `8Raise: Monique could not check her credits this month (${credits.error}); the team is on it.`;
  if (used >= budget - kept) return `8Raise: Monique has used ${used} of her ${budget} credits this month, so she has stopped searching; the last ${kept} stay kept for you.`;
  return null;
}

/**
 * The one morning email, and THE MORNING it describes. `data` is everything read; `data.morning` the
 * section files by name. Returns the laid-out email plus `digest`: every item the email shows, each
 * with its full context and an id, which the run posts to Boss OS before it sends — so every link in
 * the email opens that item's own screen, and Today lists exactly the email's decisions.
 */
export function buildDay(data, now = Date.now()) {
  const today = dayOf(now);
  const p = parts(now);
  const monday = p.weekday === "Monday";
  // One producer's bad line never holds the whole email: it is dropped here, named, and the run opens
  // a fix job for it (main). What is left is only what passes the gate's content checks.
  const dropped = [];
  const passes = (where, ...texts) => {
    const problems = lineProblems(texts.filter(Boolean).join(" "));
    if (problems.length) dropped.push(`${where}: ${problems.join("; ")}`);
    return problems.length === 0;
  };
  const m = {};
  for (const [name, sec] of Object.entries(data.morning ?? {})) {
    m[name] = {
      ...sec,
      decide: (sec.decide ?? []).filter((d, i) => passes(`${name} decide ${i + 1}`, d.title, d.body, ...(d.details ?? []), ...(d.buttons ?? []).map((b) => b.label))),
      rows: (sec.rows ?? []).filter((r, i) => passes(`${name} row ${i + 1}`, r.company, r.side, r.size, r.price, r.from)),
      lines: (sec.lines ?? []).filter((l, i) => passes(`${name} line ${i + 1}`, typeof l === "string" ? l : l.text)),
    };
  }
  const used = new Set();
  const idFor = (kind, key) => { let id = itemId(kind, key); let n = 2; while (used.has(id)) id = itemId(kind, `${key}#${n++}`); used.add(id); return id; };
  const more = (url) => ({ label: "See everything about this", url });

  // 1. Decide: Boss OS's own, then every producer's (catch-ups have their own section). ALL of them.
  const decideRaw = [...bossDecisions(data)];
  for (const [name, sec] of Object.entries(m)) if (name !== "catchups") for (const d of sec.decide ?? []) decideRaw.push({ priority: 0, from: name, ...d });
  decideRaw.push(...prospectDecisions(data.prospects ?? null, new Set(decideRaw.map((d) => d.key).filter(Boolean)), now));
  decideRaw.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const decide = decideRaw.map((d) => {
    const id = idFor("decide", d.key ?? d.title);
    const screen = itemUrl(today, id);
    return { ...d, id, screen, buttons: [...(d.buttons ?? []), more(screen)] };
  });

  // 2. Deals: each opens its own screen there; the source email is one more tap from it.
  const deals = (m.deals?.rows ?? []).map((r) => {
    const id = idFor("deal", `${r.company}|${r.side}|${r.size}|${r.from}|${r.received_on ?? r.when}`);
    return { ...r, id, screen: itemUrl(today, id) };
  });
  const dealRowsAll = deals.map((r) => ({
    company: r.company, side: r.side ?? "—", size: [r.size, r.price && r.price !== "—" ? `@ ${r.price}` : ""].filter(Boolean).join(" ") || "—",
    from: r.from ?? "—", url: r.screen, url_label: "Open ›",
  }));
  /*
   * MONIQUE FOUND IS ONE GRID (owner, 25 Oct 2026, mock-up v2): company (+N more) | seller → buyer |
   * fit dots | "Open ›" to the trade's card in Boss OS, which holds the seller's ready email and
   * Dismiss. ⭐ first. No match is ever in Decide. Each row carries its pair and orders, so a match
   * she dismisses leaves Today at once (routes/morning.ts prunes them).
   */
  const foundGrid = (m.monique_found?.grid ?? []).filter((r, i) => passes(`monique_found grid ${i + 1}`, r.company, r.trade, r.fit)).map((r) => ({
    company: r.company, trade: r.trade, fit: r.fit, url: r.url, url_label: "Open ›", match_pair: r.match_pair, match_sig: r.match_sig,
  }));
  const found = (m.monique_found?.lines ?? []).map((l) => {
    const line = typeof l === "string" ? { text: l, links: [] } : l;
    const id = idFor("found", line.text);
    return { ...line, id, screen: itemUrl(today, id), holders: (m.monique_found?.rows ?? []).filter((h) => line.deal && h.company === line.deal) };
  });

  // The best few, never hundreds: the count line (it carries its own link) always shows.
  const isCount = (f) => Boolean(f.counts);
  const foundItems = found.filter((f) => !isCount(f)).map((f) => ({ text: f.text, links: f.links?.length ? f.links.slice(0, 1).concat([{ label: "See it", url: f.screen }]) : [{ label: "See it", url: f.screen }] }));
  const foundShown = (max) => [
    ...foundItems.slice(0, max),
    ...(foundItems.length > max ? [{ text: `And ${foundItems.length - max} more from Monique.`, links: [{ label: "See them all on Today", url: `${ORIGIN}/?view=morning` }] }] : []),
    ...found.filter(isCount).map((f) => ({ text: f.text, links: f.links ?? [] })),
  ];

  // 3. Briefing: the top five, and "Read the full briefing →" to its screen. The whole briefing is never
  // in the email (owner, 24 Oct 2026: "never risk the size limit"); `briefingFull` is its screen's shape.
  const raw = briefingRaw(data.briefing, today);
  const src = briefingSourceUrl(data.briefing);
  const briefTop = raw ? raw.map((l) => ({ runs: proseRuns(l, src) })) : null;

  // 4. Done for you: what the team fixed or did, each What happened / What we did / Status when it can.
  const doneRaw = [];
  const bl = bounceLine(data.bounceFixes);
  if (bl) doneRaw.push({ text: bl, links: [] });
  doneRaw.push(...commentDoneLines(data, now));
  doneRaw.push(...failedTaskLines(data.tasks, now).map(({ text }) => ({ text, links: [] })));
  const prospects = prospectSection(data.prospects ?? null, now);
  const spirit = spiritSection(data.spirit ?? null, data.practiceWeek ?? null, now);
  // The prospects producer's count line is in "Prospect emails" when that loaded; not said twice.
  for (const name of DONE_SOURCES.filter((n) => !(prospects && n === "prospects"))) for (const l of m[name]?.lines ?? []) doneRaw.push(typeof l === "string" ? { text: l, links: [] } : { links: [], ...l });
  const done = doneRaw.map((l) => { const id = idFor("done", l.text); return { ...l, id, screen: itemUrl(today, id) }; });
  const doneShown = done.slice(0, MAX_DONE).map((l) => ({ text: l.text, links: [...(l.links ?? []).slice(0, 1), { label: "See it", url: l.screen }] }));
  if (done.length > MAX_DONE) doneShown.push({ text: `And ${done.length - MAX_DONE} more done for you.`, links: [{ label: "See them all on Today", url: `${ORIGIN}/?view=morning` }] });

  // 4b. The grid repos: the weekly Search Readiness check (Mondays; owner, 25 Oct 2026). Its own short
  // section — what is broken, what was fixed, what is being built — never pooled into "Done for you",
  // where three lines would hide it.
  const gridLines = (m.grid_repos?.lines ?? []).slice(0, 4).map((l) => (typeof l === "string" ? { text: l, links: [] } : { links: [], ...l }));
  const gridRepos = gridLines.length ? { title: "The grid repos: this week's search check", tone: "done", items: gridLines, link: m.grid_repos?.link ?? null, empty: null } : null;

  // 5. Catch up with.
  const catchCards = (m.catchups?.decide ?? []).map((d) => { const id = idFor("catchup", d.key ?? d.title); const screen = itemUrl(today, id); return { ...d, id, screen, buttons: [...(d.buttons ?? []), more(screen)] }; });
  const catchLines = (m.catchups?.lines ?? []).map((l) => (typeof l === "string" ? l : l));

  // Mondays: this week's deadlines, in the same email.
  const deadlines = [];
  if (monday) {
    const end = addDays(today, 6);
    for (const t of data.tasks ?? []) {
      const due = typeof t.due === "string" ? t.due.slice(0, 10) : null;
      if (due && due >= today && due <= end && OPEN.has(t.status)) deadlines.push({ text: `${shortDay(due)}: ${t.title}${t.employee_name ? ` (${t.employee_name})` : ""}.`, links: [{ label: "Open it", url: taskUrl(t.id) }] });
    }
  }

  const val = valerieItems(data.feed);
  const calls = callsOn(data.diary, today).map((c) => `${timeOf(c.scheduled_at)} ${c.title}${c.with ? ` with ${c.with}` : ""}`);
  // While her "OpenAI first" switch is on, one small line says so (owner, 24 Oct 2026).
  const openaiFirst = (data.settings ?? []).find((r) => r.key === "seat_order_openai_first");
  const openaiLine = openaiFirst && /^(on|true)$/.test(String(openaiFirst.value))
    ? `OpenAI goes first for every job (saves Claude usage), on since ${dayWords(dayOf(Number(openaiFirst.updated_at) || now), { weekday: false })}. Turn it off in Settings.`
    : null;
  const ps = [eightRaiseLine(m.eightraise?.credits ?? null), openaiLine].filter(Boolean).join(" ") || null;

  const subjBits = [];
  if (decide.length) subjBits.push(plural(decide.length, "decision"));
  if (deals.length) subjBits.push(plural(deals.length, "new deal"));
  if (val?.length) subjBits.push("Valerie's list");
  const subject = `${p.weekday}: ${subjBits.length ? subjBits.join(", ") : "nothing to decide"}`;

  /*
   * THE SIZE BUDGET (owner, 24 Oct 2026: "never risk the size limit"). Gmail clips an email over
   * ~102KB behind "View entire message". The full briefing is never in the email: the top five and
   * "Read the full briefing →" to its screen. Past EMAIL_HTML_BUDGET the email cuts, in CUT_ORDER:
   * the prospect emails' words, then Monique's lines to three, then the deal rows to five — each
   * "See all N" on its screen. Decisions are never cut. Measured in bytes, as Gmail measures.
   */
  const lay = ({ prospectWords = true, foundMax = MAX_FOUND_LINES, dealMax = MAX_DEAL_ROWS } = {}) => layoutEmail({
    who: "Simone",
    kind: "morning",
    maxDecide: Infinity,
    subject,
    happened: `Good morning. Here is your ${dayWords(today)}.${calls.length ? ` On your calendar: ${calls.join("; ")}.` : ""}`,
    decide,
    sections: [
      { title: `New deals since yesterday (${deals.length})`, note: deals.length > dealMax ? `The ${dealMax} newest are here; all ${deals.length} are on the Deals screen.` : null, rows: dealRowsAll.length ? { columns: [{ key: "company", label: "Company" }, { key: "side", label: "Side" }, { key: "size", label: "Size @ price" }, { key: "from", label: "From" }], data: dealRowsAll.slice(0, dealMax) } : null, link: m.deals?.link ?? null, empty: m.deals ? "No new deals since yesterday." : null },
      { title: "Monique found", rows: foundGrid.length ? { columns: [{ key: "company", label: "Company" }, { key: "trade", label: "Seller → buyer" }, { key: "fit", label: "Fit" }], data: foundGrid } : null, items: foundShown(foundMax), link: m.monique_found?.link ?? null, empty: null },
      ...(prospects ? [prospectWords ? prospects : { ...prospects, full: undefined }] : []),
      ...(spirit ? [spirit] : []),
      { title: "This morning's briefing (Camille)", items: briefTop ?? ["Briefing late — it will be on your Today page."], link: { label: "Read the full briefing →", url: BRIEFING_URL } },
      { title: "Done for you", tone: "done", items: doneShown, empty: null },
      ...(gridRepos ? [gridRepos] : []),
      { title: "Catch up with", cards: catchCards, items: catchLines, empty: null },
      ...(monday ? [{ title: "This week", items: deadlines, empty: "No deadlines this week." }] : []),
      { title: "Porch & Party: To do for Valerie", note: val ? `From the Porch & Party site at ${timeOf(now)}. Valerie gets her own copy at 7 am.` : null, boxed: true, items: val ?? [], empty: val ? "All clear for Valerie today." : "Valerie's list did not load this morning; the team is fixing it and Valerie still gets her own copy at 7 am." },
    ],
    footer: 'Reply to change anything, for example "move the intro to Monday".',
    postscript: ps,
    refs: [`yd_${today.replace(/-/g, "")}`],
  });
  const bytes = (l) => Buffer.byteLength(l.html, "utf8");
  let laid = lay();
  const cuts = [];
  for (const [name, opts] of CUT_ORDER) {
    if (bytes(laid) <= EMAIL_HTML_BUDGET) break;
    laid = lay(opts);
    cuts.push(name);
  }

  const digest = {
    day: today, subject: laid.subject, built_at: new Date(now).toISOString(),
    decide: decide.map(({ id, title, body, details, draft, buttons, plan, from, screen }) => ({ id, title, body: body ?? "", details: details ?? [], draft: draft ?? null, buttons, plan: plan ?? null, from: from ?? "boss", screen })),
    deals: deals.map(({ id, company, side, size, price, structure, from, when, received_on, url, screen }) => ({ id, company, side, size, price: price ?? "—", structure: structure ?? "—", from, when, received_on: received_on ?? null, email_url: /^https:\/\/mail\.google\.com\//.test(String(url ?? "")) ? url : null, screen })),
    found: found.map(({ id, text, links, deal, holders, screen }) => ({ id, text, links: links ?? [], deal: deal ?? null, holders, screen })),
    found_grid: foundGrid,
    done: done.map(({ id, text, links, screen }) => ({ id, text, links: links ?? [], screen })),
    catchups: catchCards.map(({ id, title, body, details, draft, buttons, screen }) => ({ id, title, body: body ?? "", details: details ?? [], draft: draft ?? null, buttons, screen })),
    briefing: raw ? { for_day: data.briefing.for_day, top: raw.map((l) => proseText(proseRuns(l)).replace(/⁣/g, "")) } : null,
    prospects: prospects ? { items: prospects.items.map((i) => (typeof i === "string" ? i : i.text)), sent: (data.prospects?.sent ?? []).map((r) => ({ name: r.name, firm: r.firm, email: r.email, touch: r.touch_no, sent_at: r.sent_at, subject: r.sent_subject ?? r.subject, body: r.body ?? null })) } : null,
    eightraise: ps,
  };
  return { ...laid, dropped, digest, cuts, bytes: bytes(laid) };
}

/**
 * What her reply carries to Simone's task. Her reply's task runs on a model, so the calendar (meeting
 * titles and the people in them) stays out of it. Everything else is Boss OS's own rows, the section
 * files and Valerie's list.
 */
export function replyContext(text) {
  return String(text).split("\n").map((line) => line.replace(/\s*On your calendar: .*$/, "")).join("\n");
}

// ─── Reading ───────────────────────────────────────────────────────────────────

async function session() {
  if (!process.env.BOSS_PASSCODE) throw new Error("NAMED STOP [NO_PASSCODE] run through the vault: npm run your-day");
  const u = await fetch(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
  if (!u.ok) throw new Error(`NAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${u.status})`);
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const get = async (p) => { const r = await fetch(`${ORIGIN}/api/boss${p}`, { headers: { cookie } }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return (await r.json()).data; };
  const post = async (p, body) => { const r = await fetch(`${ORIGIN}/api/boss${p}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return (await r.json()).data; };
  return { get, post };
}

const briefingOf = (today) => today.blocks.find((b) => b.key === "executive_briefing")?.content ?? null;

async function read(api, now) {
  const [today, diary, tasks, approvals, rc] = await Promise.all([api.get("/today"), api.get("/diary"), api.get("/tasks"), api.get("/approvals"), api.get("/repo-changes")]);
  const withDue = tasks.map((t) => { let input = {}; try { input = typeof t.input === "string" ? JSON.parse(t.input) : (t.input ?? {}); } catch { input = {}; } return { ...t, due: input?.due ?? null }; });
  // The bounce agent's last day (rule 4): one "done" line. A failed read is said in the log, not to her.
  const bounceFixes = await api.get("/outreach/bounce-fixes").catch((e) => { console.error(`your-day: bounce fixes not read (${e.message})`); return null; });
  // The channel's comment digests: what a comment task is about, and the ones Monique left alone.
  const prospects = await api.get(`/lp/prospects/activity?since=${now - 30 * 3_600_000}`).catch((e) => { console.error(`your-day: prospect activity not read (${e.message})`); return null; });
  const settings = await api.get("/system/settings").catch(() => []);
  const spirit = await api.get("/spirit/day").catch((e) => { console.error(`your-day: spirit day not read (${e.message})`); return null; });
  const practiceWeek = await api.get("/spirit/practice-week").catch(() => null);
  const commentWatch = await api.get("/comment-watch-items").then((d) => d?.digests ?? []).catch((e) => { console.error(`your-day: comment digests not read (${e.message})`); return []; });
  const { sections, skipped } = readMorningSections({ now });
  for (const s of skipped) console.error(`your-day: morning section skipped — ${s}`);
  return { diary: diary?.rows ?? null, tasks: withDue, approvals, repoChanges: rc?.items ?? [], briefing: briefingOf(today), bounceFixes, commentWatch, prospects, spirit, practiceWeek, settings, morning: sections };
}

async function feedOf(range) {
  if (!process.env.PNP_OWNER_FEED_TOKEN) return { feed: null, error: "the feed key is not in the vault" };
  const r = await fetch(`${FEED}?range=${range}`, { headers: { authorization: `Bearer ${process.env.PNP_OWNER_FEED_TOKEN}` } }).catch((e) => ({ ok: false, status: String(e?.message ?? e) }));
  return r.ok ? { feed: await r.json() } : { feed: null, error: `the site answered ${r.status}` };
}

/** A source that did not load is the team's job, never her email (rule 3). Best effort, logged. */
async function fixJob(api, title, prompt) {
  try { await api.post("/tasks", { title, lane: "ops", employee_id: "emp_repo", input: { prompt: `seq23/boss-os — ${prompt}` } }); console.log(`your-day: fix job opened — ${title}`); }
  catch (e) { console.error(`your-day: the fix job "${title}" was not opened (${e.message})`); }
}

/** Keep the morning in Boss OS (one retry). `true` when it is there. */
async function postDigest(api, digest) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { await api.post("/morning", { day: digest.day, payload: digest }); console.log(`your-day: kept the morning in Boss OS (${digest.decide.length} decisions)`); return true; }
    catch (e) { console.error(`your-day: the morning was not kept in Boss OS (attempt ${attempt}: ${e.message})`); }
  }
  return false;
}

/** The morning sections this email told her once and clears after it goes (producers that append). */
const TOLD_ONCE = ["tail", "risk", "archive", "notices", "grid_repos"];

async function main() {
  const DRY = process.argv.includes("--dry-run");
  const pi = process.argv.indexOf("--preview");
  const PREVIEW = pi === -1 ? null : process.argv[pi + 1];
  const FORCE = process.argv.includes("--force");
  const NOW_WAIT = process.argv.includes("--no-wait");
  const day = dayOf(Date.now());
  const marker = path.join(SENT_DIR, `sent-${day}`);
  if (!DRY && !PREVIEW && !FORCE && fs.existsSync(marker)) { console.log(`your-day: already sent for ${day}`); return; }

  const api = await session();
  // Wait for Camille's briefing (lands about 07:10), sending the moment it does; 07:45 at the latest.
  let data = await read(api, Date.now());
  let decision = briefingDecision(data.briefing, Date.now());
  while (decision === "wait" && !DRY && !PREVIEW && !NOW_WAIT) {
    console.log("your-day: waiting for today's briefing");
    await new Promise((r) => setTimeout(r, BRIEFING_POLL_MS));
    data = await read(api, Date.now());
    decision = briefingDecision(data.briefing, Date.now());
  }
  const now = Date.now();
  const d = await feedOf("day");
  const email = buildDay({ ...data, feed: d.feed, feedError: d.error }, now);

  if (PREVIEW) {
    fs.mkdirSync(PREVIEW, { recursive: true });
    fs.writeFileSync(path.join(PREVIEW, "your-day.html"), email.html, { mode: 0o600 });
    fs.writeFileSync(path.join(PREVIEW, "your-day.txt"), `${email.subject}\n\n${email.text}`, { mode: 0o600 });
    fs.writeFileSync(path.join(PREVIEW, "your-day.digest.json"), JSON.stringify(email.digest, null, 2), { mode: 0o600 });
    // --post-digest: keep the morning in Boss OS too (its screens and Today), still sending nothing.
    if (process.argv.includes("--post-digest")) await postDigest(api, email.digest);
    console.log(`your-day: wrote the preview (${email.bytes} bytes${email.cuts?.length ? `, cut: ${email.cuts.join(", ")}` : ""}) to ${PREVIEW}${email.problems.length ? ` — it would be HELD: ${email.problems.join("; ")}` : ""}`);
    return;
  }
  if (DRY) { console.log(`--- ${email.subject}\n${email.text}\n${email.problems.length ? `HELD: ${email.problems.join("; ")}` : ""}`); return; }

  if (decision === "send_late") await fixJob(api, "Camille's briefing was late for the morning email", `today's executive report had not landed by 07:45 Central, so Simone's morning email (scripts/ops/your-day.mjs) went without it. Find why the briefing duty ran late and fix it at source.`);
  if (email.dropped.length) await fixJob(api, "A morning-email section wrote a line that is not plain", `Simone's morning email dropped these lines because they failed the plain-email check (src/shared/boss/mail/plain.mjs lineProblems): ${email.dropped.join(" | ")}. Fix the producer that wrote them (~/.boss-os/morning/<section>.json, src/shared/boss/mail/morning.mjs).`);
  // Every task that failed since yesterday is the team's to fix (its done line says so).
  const failMarks = path.join(SENT_DIR, "failed-told.json");
  let told = []; try { told = JSON.parse(fs.readFileSync(failMarks, "utf8")); } catch { told = []; }
  for (const f of failedTaskLines(data.tasks, now).filter((x) => !told.includes(x.id))) {
    const t = (data.tasks ?? []).find((x) => x.id === f.id);
    await fixJob(api, `Find why "${String(t?.title ?? "a task").slice(0, 60)}" failed`, `the task ${f.id} (${t?.employee_name ?? "an employee"}) failed: ${String(t?.error ?? "").slice(0, 400)}. Find the cause, fix it at source with a test, and run the job again or close it with the reason.`);
    told.push(f.id);
  }
  try { fs.mkdirSync(SENT_DIR, { recursive: true }); fs.writeFileSync(failMarks, JSON.stringify(told.slice(-500))); } catch { /* best effort */ }
  if (d.error) await fixJob(api, "Valerie's list did not load for the morning email", `the Porch & Party owner feed answered: ${d.error}. Simone's morning email said so in one line. Fix the read (PNP_OWNER_FEED_TOKEN, ${FEED}).`);

  // The morning goes to Boss OS FIRST: every link in the email opens one of its items, and Today
  // lists its decisions. A failed post still sends (the email carries everything) and opens a fix job.
  const kept = await postDigest(api, email.digest);
  if (!kept) await fixJob(api, "The morning email's screens were not saved", `Simone's morning email (scripts/ops/your-day.mjs) could not post its items to Boss OS (POST /morning), so its "See everything" links and Today's list are empty for ${email.digest.day}. Find why and fix it at source (src/worker/boss/routes/morning.ts).`);
  const r = await sendAsEmployee("Simone", { to: process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com", subject: email.subject, text: email.text, prelaid: email, context: replyContext(email.text) });
  if (!r.ok) { console.error(`NAMED STOP [SEND_REFUSED] "${email.subject}" was not sent: ${r.error}`); process.exit(9); }
  console.log(`your-day: sent "${email.subject}" from ${r.from}`);
  if (kept) await api.post(`/morning/${email.digest.day}/sent`, {}).catch((e) => console.error(`your-day: the morning was not marked sent (${e.message})`));
  clearToldSections(TOLD_ONCE);
  fs.mkdirSync(SENT_DIR, { recursive: true });
  fs.writeFileSync(marker, new Date(now).toISOString());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
}
