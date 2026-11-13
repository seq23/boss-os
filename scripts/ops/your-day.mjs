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
 *   2. New deals since yesterday (one row per company and side) and "Monique found" (the matches);
 *      "Prospect emails" only when someone answered;
 *   3. Camille's briefing: three one-line headlines and the link to the full briefing;
 *   4. Done for you — three lines at most (the bounce agent, comments left alone, the jobs she
 *      emailed, Zora's and Toni's quiet work);
 *   5. Your open loops — her own rows only, five at most, each for three mornings;
 *   6. Catch up with — 0–3, only when a live reason exists (rule 14);
 *   7. Porch & Party: To do for Valerie — only when the site's owner feed has something;
 *   8. the sign-off; the 8Raise line only when something is wrong with Monique's credits.
 *
 * A BLOCK WITH NOTHING IN IT IS LEFT OUT (owner, 13 Nov 2026): no "nothing here" lines. A thin
 * "Still yours to answer" row and an open-loop row show on three mornings, then leave the email.
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
import { startedBySystem } from "../../src/shared/boss/mail/noticeGate.mjs";
import { outputLine } from "../../src/shared/boss/alarms/rules.mjs";
import { doneForYou, failedDoneLine, jobFamily, jobName, splitRepeats, fixJobsToOpen, answeredUnderneath, withinShowings } from "../../src/shared/boss/mail/morningMemory.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sendAsEmployee, ownerTo } from "./notify.mjs";
import { createHash } from "node:crypto";
import { ownerTime } from "../../src/shared/boss/ownerTime.mjs";
import { clockWords, lineProblems, proseRuns, proseText, cleanText, quotedSentence, NOTHING_TO_DO, toYou } from "../../src/shared/boss/mail/plain.mjs";
import { ownerEmail } from "../../src/shared/boss/mail/ownerLayout.mjs";
import { readMorningSections, clearToldSections } from "../../src/shared/boss/mail/morning.mjs";
import { sectionsNotReported, notReportedLine } from "../../src/shared/boss/mail/morningSections.mjs";
import { templateDecide } from "./lp-prospects.mjs";
import { systemRow } from "../../src/shared/boss/openLoops/openLoops.mjs";
import { yoursThisWeek } from "../../src/shared/boss/waiting/register.mjs";

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
// A time she reads: her current zone, Central in brackets when away ("10 am ET (9 am CT)"); 6 Nov 2026.
export const timeOf = (at, tz = null) => ownerTime(at, { tz, clock: clockWords });
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
/** What goes first when a heavy day is still over budget, in order; each step keeps the ones before. */
export const CUT_ORDER = Object.freeze([
  ["Monique's lines to three", { foundMax: 3 }],
  ["deal rows to five", { foundMax: 3, dealMax: 5 }],
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
 * Words the system writes for itself — intake's assignment and policy reasons — never shown to her
 * (2 Nov 2026: "Intake assigned this user only. Trading job work. No model receives execution
 * authority here." and "Risk: high." reached a Decide item).
 */
const SYSTEM_TEXT = /\b(?:intake assigned|USER_ONLY|AI_DRAFT|AI_EXECUTE|HUMAN_CONTRACTOR|DEFER|execution authority|lane work|agent creation gate)\b/i;

/**
 * AN APPROVAL'S OWN LINE, ONLY WHEN IT IS ONE PLAIN LINE (owner, 13 Nov 2026: a card's summary read
 * "Based on the provided information, I will outline the tasks and responsibilities…", a model's
 * output). The Worker now writes a plain line (queue/consumer.ts `approvalSummary`, routes/backends.ts);
 * a row written before that, or by any writer that passes text through, is never printed: a finished
 * result's old summary is skipped whole, an old run's keeps only the reason before the dash, and
 * anything with several lines, markup, or a model's opening words is dropped. Null = say nothing. Pure.
 */
const MODEL_VOICE = /\*\*|`|^#|^(?:based on|to address|i will|i'll|i have|i am|i'm|here is|here's|here are|sure|certainly|okay|as an ai)\b/i;
export function plainSummary(a) {
  if (a?.kind === "task_output") return null;
  for (const x of [a?.summary, a?.reason]) {
    if (typeof x !== "string") continue;
    const t = (a.kind === "backend_run" ? x.split(" — ")[0] : x).trim();
    if (!t || SYSTEM_TEXT.test(t) || /\n/.test(t) || t.length > 240 || MODEL_VOICE.test(t)) continue;
    return /[.!?]$/.test(t) ? t : `${t}.`;
  }
  return null;
}

function inputOf(task) {
  try { return typeof task?.input === "string" ? JSON.parse(task.input) : (task?.input ?? {}); } catch { return {}; }
}

/** The task an approval is about, by its origin or its payload. */
function approvalTaskId(a) {
  if (a?.origin_type === "tasks" && a.origin_id) return a.origin_id;
  try { return (typeof a?.payload === "string" ? JSON.parse(a.payload) : a?.payload)?.task_id ?? null; } catch { return null; }
}

/**
 * A change to a teammate's standing duty, in plain words: who wants what, and what yes and no do
 * (2 Nov 2026). Null when the item is not a duty change. Pure.
 */
/**
 * THE CHANGE ITSELF, IN ONE LINE (7 Nov 2026 live read: the card quoted "Change to Camille's
 * Marketplace listings duty (my ruling, 1 Nov)." — a label, so she could not say yes or no). Her
 * words' label and sign-off sentences are skipped; the first sentence that says what to do is kept.
 * Pure.
 */
export function theChange(words) {
  const sentences = String(words ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const label = (x) => /^(?:change (?:to|for)\b|re:|your call\b|no need to ask\b|thanks?\b|thank you\b|ok\b)/i.test(x) || x.split(/\s+/).length < 4;
  const kept = sentences.filter((x) => !label(x));
  // Strongest cue first: "Add this:", "instead", "from now on"; then a verb that changes something.
  // "Keep doing it as now" is what stays, never the change.
  const cues = [/^(?:add this|change this|new rule)\s*:/i, /\b(?:instead|from now on|no longer)\b/i, /\b(?:add|stop|start|only|never|always|should|must|drop|move|ask)\b/i];
  const changes = kept.filter((x) => !/\bkeep (?:doing|it|them)\b.*\bas (?:now|is|before)\b/i.test(x));
  const pick = cues.map((re) => changes.find((x) => re.test(x))).find(Boolean) ?? changes[0];
  if (!pick) return null;
  // A run of shouted words is her emphasis, said in ordinary case ("OUR REAL WORK" → "our real work").
  const one = pick.replace(/^(?:add this|change this|new rule|also|and)\s*:\s*/i, "").replace(/\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\b/g, (m) => m.toLowerCase()).replace(/^./, (c) => c.toUpperCase());
  return one.length > 200 ? `${one.slice(0, 199).replace(/\s+\S*$/, "")}…` : one;
}

export function dutyChangeCard(title, task, worker) {
  const t = String(title ?? "");
  const m = /^Change how (?:the )?(?:(.+?)(?:'s)? )?duty "(.+)" works$/.exec(t) ?? /^Change (.+?)'s duty\s*[:—-]\s*(.+)$/.exec(t);
  if (!m) return null;
  const seat = m[1] && !/^the$/i.test(m[1]) ? m[1].trim() : null;
  const duty = m[2].trim().replace(/^"|"$/g, "");
  const input = inputOf(task);
  const raw = String(input.body ?? input.prompt ?? "");
  const words = /Her words:\s*([\s\S]+)/.exec(raw)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const said = theChange(words);
  const who = worker ?? "Danielle";
  const whose = seat ? `${seat}'s` : "a";
  return {
    title: `Change how ${seat ?? "your team"} handles "${duty}"?`,
    // The duty is named once, in the title (7 Nov 2026 live read: the long name came twice in one breath).
    body: `${said ? `The change: ${cleanText(said).replace(/[.!?…]*$/, ".")} ` : ""}${who} makes it as you asked. Yes lets ${who} make it; no keeps ${whose === "a" ? "the duty" : `${whose} duty`} as it is.`,
  };
}

/**
 * Boss OS's own decisions for her: Inbox approvals, Danielle's plans and previews, work held for her
 * word. Each says what she is deciding and what each choice does, and opens its own screen. An
 * approval and the task that waits on it are ONE decision, shown once (2 Nov 2026: the same duty
 * change came as items 3 and 4).
 */
export function bossDecisions(data) {
  const out = [];
  const tasks = data.tasks ?? [];
  const approvalIds = new Set((data.approvals ?? []).map((a) => a.id));
  const covered = new Set((data.approvals ?? []).map(approvalTaskId).filter(Boolean));
  for (const a of data.approvals ?? []) {
    // The approval's own task, wherever it sits: the task list is the newest 100 only, so `read`
    // fetches any older one by id (`approvalTasks`). An old repair's approval printed as a card
    // ('Kendra's alarm: "Kendra's alarm: …"', 13 Nov 2026) because its task had left that window.
    const task = [...tasks, ...(data.approvalTasks ?? [])].find((t) => t.id === approvalTaskId(a)) ?? null;
    if (task && isRepairTask(task)) continue; // a repair is the team's, never her decision (7 Nov 2026)
    const worker = a.employee_name ?? task?.employee_name ?? null;
    const duty = dutyChangeCard(a.title, task, worker);
    const own = plainSummary(a);
    out.push({
      key: `approval:${a.id}`, title: duty?.title ?? a.title,
      body: duty?.body ?? `${own ? `${own} ` : ""}${worker ?? "Your team"} waits for your word. Yes lets it go ahead; no keeps things as they are.`,
      details: [],
      buttons: [{ label: "Open it to approve or decline", url: `${ORIGIN}/?tab=inbox&approval=${encodeURIComponent(a.id)}` }], priority: 2,
    });
  }
  // A superseded plan email no longer waits on her (25 Oct 2026); only a row still asking counts.
  for (const r of (data.repoChanges ?? []).filter((x) => (x.phase === "asking" || x.phase === "previewing") && !x.superseded_at)) {
    const firstLine = String(r.instruction ?? "").split("\n")[0].trim();
    out.push(r.phase === "asking"
      ? { key: `rc:${r.id}`, title: `Start Danielle's plan for ${r.repo ?? "your change"}?`, body: `${firstLine ? `You asked: "${firstLine}". ` : ""}Danielle wrote a plan and builds nothing until you say yes.`, details: ["Yes: reply approved to her email and she starts the build.", "No: reply with what to change, or drop it."], plan: r.plan_text ?? null, buttons: [], priority: 1 }
      : { key: `rc:${r.id}`, title: `Make Danielle's preview of ${r.repo ?? "your change"} live?`, body: `${firstLine ? `You asked: "${firstLine}". ` : ""}The preview is built; nothing is live until you say so.`, details: ["Yes: reply approved to her email and it goes live.", "No: reply with what to change."], plan: r.plan_text ?? null, buttons: [], priority: 1 });
  }
  // A REPAIR IS NEVER A DECISION (owner, 7 Nov 2026: Kendra's reports "should not need my constant
  // approval"). A task Boss OS opened to fix itself that stops on approval is the team's to unblock.
  // A task whose approval she already answered (it is no longer pending) is not asking again: it is
  // held up, and the team's to move (`selfStartedWaiting`; 13 Nov 2026: a change she approved on
  // 2 Nov came back as a card every morning).
  for (const t of tasks.filter((x) => x.status === "awaiting_approval" && !covered.has(x.id) && !x.approval_id && !isRepairTask(x))) {
    const dg = digestOf(data, t);
    // WORK BOSS OS STARTED ITSELF NEVER WAITS FOR HER WORD (owner, 2 Nov and 13 Nov 2026): with no
    // approval of hers behind it there is nothing for her to decide. It is one Done line and a repair
    // (`selfStartedWaiting`). A real decision (money, a send in her name) is an approval, shown above.
    if (!dg && startedBySystem(t.input)) continue;
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
    const duty = dutyChangeCard(t.title, t, t.employee_name ?? null);
    out.push({
      key: `task:${t.id}`, title: duty?.title ?? `${t.employee_name ?? "Your team"} is waiting for your word: ${toYou(t.title)}`,
      body: duty?.body ?? "Nothing happens on it until you answer.",
      buttons: [{ label: "Open it", url: taskUrl(t.id) }], priority: 1,
    });
  }
  return out;
}

/**
 * HELD WITH NOTHING OF HERS TO ANSWER: never a Decide card. A job Boss OS started itself that sits
 * "awaiting approval" with no approval of hers behind it and no comments to answer (the Worker no
 * longer parks these; this catches one parked before), and any job whose approval she has already
 * answered and which still has not moved. `read`-shaped data in, the tasks out. Pure.
 */
export function selfStartedWaiting(data) {
  const approvalIds = new Set((data.approvals ?? []).map((a) => a.id));
  const covered = new Set((data.approvals ?? []).map(approvalTaskId).filter(Boolean));
  return (data.tasks ?? []).filter((t) => t.status === "awaiting_approval" && !covered.has(t.id) && !approvalIds.has(t.approval_id)
    && !isRepairTask(t) && !digestOf(data, t) && (Boolean(t.approval_id) || startedBySystem(t.input)));
}

/** What Monique did with the comments that did not need her (owner, 24 Oct 2026: fix it, then tell me). */
function commentDoneLines(data, now) {
  const out = [];
  for (const d of data.commentWatch ?? []) {
    if (d.task_id || !(d.items ?? []).length || now - Number(d.created_at) > DAY_MS) continue;
    const faults = d.items.filter((i) => i.product_note);
    out.push({
      text: `What happened: ${plural(d.items.length, "new comment")} on ${CHANNEL}${faults.length ? `, ${faults.length} pointing at a fault in a video (${faults.map((i) => i.product_note).join("; ")})` : ""}. What we did: Monique left ${d.items.length === 1 ? "it" : "them"} alone, as none needed an answer${faults.length ? ", and Danielle has the fault to fix for future videos" : ""}. Status: done.`,
    });
  }
  return out;
}

/**
 * ─── SEQUOIA'S COPY OF VALERIE'S LIST, CALM (owner, 25 Oct 2026; make-it-calm) ───
 *
 * Only Simone's copy changes; the site's feed and Valerie's own 7 am email are untouched. Read-only,
 * short, ONE line per customer: the booking and the money for the same customer merge, feed codes
 * ("① All of it · now $180") are dropped or said in words, the money keeps the wording every P&P
 * screen uses ("$180 due ($130 + $50 refundable deposit)"), and a hold says what happens next —
 * never a time already passed as if it were current. Pure.
 */
const FEED_CODE = /[①②③④⑤⑥⑦⑧⑨⑩]\s*([^·]*?)\s*·\s*now\s*(\$[\d,.]+)/;
function holdWords(text, now) {
  return String(text).replace(/\b(?:games\s+)?reserved until (today|tomorrow)\s+(\d{1,2}):(\d{2})\s*([AP]M)\b/gi, (_m, when, h, mi, ap) => {
    const clock = `${Number(h)}:${mi} ${ap.toUpperCase()}`;
    if (when.toLowerCase() === "tomorrow") return `hold ends ${clock} tomorrow`;
    const p = parts(now);
    const hour24 = (Number(h) % 12) + (ap.toUpperCase() === "PM" ? 12 : 0);
    const passed = p.hour > hour24 || (p.hour === hour24 && p.minute >= Number(mi));
    return passed ? `hold ended ${clock}: still no deposit` : `hold ends ${clock} today`;
  });
}
const lower = (t) => (t ? t[0].toLowerCase() + t.slice(1) : t);
export function valerieItems(feed, now = Date.now()) {
  if (!feed) return null;
  const order = [];
  const byCustomer = new Map();
  const loose = [];
  for (const i of feed.items ?? []) {
    const bits = String(i.title ?? "").split(/\s+·\s+/).map((x) => x.trim()).filter(Boolean);
    if (/^Your week\b/.test(bits[0] ?? "")) continue;
    if (i.kind === "renewal" || i.kind === "id_delete") {
      loose.push(`${i.kind === "renewal" ? "Marketplace" : "ID photo"}: ${holdWords([bits.join(" · "), i.detail].filter(Boolean).join(" · "), now)}`);
      continue;
    }
    // "9:00 AM · Riley M. · Party setup": a time first, then the customer.
    const timed = /^\d{1,2}:\d{2}\s*[AP]M$/i.test(bits[0] ?? "");
    const who = (timed ? bits[1] : bits[0]) ?? "A customer";
    if (!byCustomer.has(who)) { byCustomer.set(who, { booking: [], money: [] }); order.push(who); }
    const c = byCustomer.get(who);
    const detail = String(i.detail ?? "").trim();
    if (i.kind === "money") {
      const amount = lower(bits.slice(1).join(" · "));
      const code = FEED_CODE.exec(detail);
      const rest = detail.replace(FEED_CODE, "").split(/\s*·\s*/).map((x) => x.trim()).filter(Boolean);
      const words = amount || (code ? `owes ${lower(code[1])}: ${code[2]}` : "");
      c.money.push([words, ...rest.map(lower)].filter(Boolean).join(", "));
    } else {
      if (timed) { c.booking.push([`${bits[0]} ${lower(bits.slice(2).join(" · "))}`.trim(), lower(holdWords(detail, now))].filter(Boolean).join(" · ")); continue; }
      // "Rentals · asked for Fri 30 Oct" → "Fri 30 Oct rental"; "Party & decor · Thu 10 Dec" → "Thu 10 Dec party & decor".
      const kind = bits[1] ? lower(bits[1].replace(/^Rentals$/i, "rental")) : "";
      const date = (bits[2] ?? "").replace(/^asked for\s+/i, "");
      c.booking.push([[date, kind].filter(Boolean).join(" "), lower(holdWords(detail, now))].filter(Boolean).join(" · "));
    }
  }
  const lines = order.map((who) => {
    const c = byCustomer.get(who);
    return [who, ...c.booking, ...c.money].filter(Boolean).join(" · ");
  });
  return [...lines, ...loose];
}

/** How many headlines of Camille's briefing the email carries; the rest is one link away. */
export const MAX_BRIEFING_LINES = 3;

/** The one-minute summary's first lines, as Camille wrote them. `null` when today's report is not in. */
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
  return raw.map((l) => String(l).replace(/^[-*•]\s+/, "").trim()).filter(Boolean).slice(0, MAX_BRIEFING_LINES);
}

/**
 * A HEADLINE IS ONE LINE (owner, 13 Nov 2026): a summary line as Camille wrote it when it is short;
 * a long one stops at its last whole sentence inside HEADLINE_CHARS (its citation kept), or, with no
 * sentence end there, at a word with "…". Never cut mid-word. Pure.
 */
export const HEADLINE_CHARS = 140;
export function headline(line) {
  const t = String(line ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= HEADLINE_CHARS) return t;
  let end = -1;
  for (const m of t.matchAll(/[.!?](?:\s*\[\d+\])*(?=\s+["“*A-Z])/g)) {
    const at = m.index + m[0].length;
    if (at >= 40 && at <= HEADLINE_CHARS) end = at;
  }
  return end > 0 ? t.slice(0, end) : `${t.slice(0, HEADLINE_CHARS).replace(/\s+\S*$/, "")}…`;
}

/**
 * CAMILLE'S BRIEFING IN THREE ONE-LINE HEADLINES, from the report's One-Minute Executive Summary section
 * (key `one_minute_summary`, or its heading on older reports); the report's `summary` sentences when
 * the section is absent. `null` when today's report has not landed. Plain words, no markdown.
 */
export function briefingLines(briefing, today) {
  const raw = briefingRaw(briefing, today);
  return raw ? raw.map((l) => proseText(proseRuns(headline(l))).replace(/⁣/g, "").replace(/[.!?]?\s*$/, ".")) : null;
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

/**
 * THE TIMING RULE (coordinator finding, 23 Oct 2026: the report lands about 07:10, the email went at
 * 06:40 and could never carry it). From 06:40 the run waits for today's report and sends the moment
 * it lands; at 07:45 Central it sends without it, says "Briefing late" in one line, and opens a fix
 * job. `"send" | "wait" | "send_late"`. Pure.
 */
export function briefingDecision(briefing, now, { inProgress = true } = {}) {
  const today = dayOf(now);
  if (briefingReady(briefing, today)) return "send";
  // Nobody is writing it (13 Nov 2026: the report's job had stopped at 06:10, out of usage, and the
  // email waited an hour for a briefing that could not land): send now, as at the cap.
  if (!inProgress) return "send_late";
  const p = parts(now);
  return p.hour * 60 + p.minute >= BRIEFING_CAP.hour * 60 + BRIEFING_CAP.minute ? "send_late" : "wait";
}

/**
 * IS TODAY'S BRIEFING STILL BEING WRITTEN? Read from the task list: the newest briefing job made today
 * (Central) and whether it is running. None today, or one that failed, was cancelled or went back to
 * the queue to wait for usage, means there is nothing to wait for. Pure.
 */
export function briefingInProgress(tasks, now) {
  const today = dayOf(now);
  const mine = (tasks ?? []).filter((t) => { const i = inputOf(t); return (i?.spec_module === "executive_briefing" || i?.delivers === "executive_reports") && dayOf(Number(t.created_at)) === today; })
    .sort((a, b) => Number(b.created_at) - Number(a.created_at))[0];
  return Boolean(mine) && mine.status === "running";
}

/** The exit code that tells duty-run.sh "not yet, ask me again on the next tick": named, never recorded as a run. */
export const NOT_YET = 75;

/** The one "done" line for the bounce agent (rule 4), from GET /outreach/bounce-fixes. */
export function bounceLine(b) {
  if (!b || !(b.replaced || b.dropped || b.restarted?.length)) return null;
  const bits = [];
  if (b.replaced) bits.push(`Replaced ${plural(b.replaced, "outreach address", "outreach addresses")} that bounced with working ones from each company's own site`);
  if (b.dropped) bits.push(`${b.replaced ? "removed" : "Removed"} ${plural(b.dropped, "bounced address", "bounced addresses")} for good (no working address was published)`);
  if (b.restarted?.length) bits.push(`${bits.length ? "outreach restarted" : "Outreach restarted"} (${b.restarted.join(", ")})`);
  return `${bits.join("; ")}.`;
}


const nameOf = (r) => r.name || r.email || "someone";
const whoLine = (r) => `${nameOf(r)}${[r.firm, r.email].filter(Boolean).length ? ` (${[r.firm, r.email].filter(Boolean).join(", ")})` : ""}`;
export const PROSPECTS_URL = `${ORIGIN}/?tab=capital&view=prospects`;

/**
 * "PROSPECT EMAILS": REPLIES ONLY (owner, 13 Nov 2026). Who answered since the last morning and what
 * they said, and who asked not to be written to again. What was sent, what is due, the totals and
 * the emails' words are on the Prospects screen; a morning with no reply has no section at all.
 *
 * ONE LINE MORE, ONLY FOR A REAL STOP: follow-ups that are due and held by something that is wrong
 * (a spam complaint's pause, the kill switch, her lists unreadable), with since when. The clock is
 * never that: before 9 am, after 5 and at weekends they simply go at the next window, so nothing is
 * said (her 6:45 email read "not going out. Why: outside the sending window" every day). No approved
 * email at all is already a Decide card (`prospectDecisions`).
 * From GET /lp/prospects/activity. Pure. `null` when there is nothing to say or it did not load.
 */
const shortDate = (ms) => new Date(Number(ms)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: TZ });
export function prospectSection(a, now = Date.now()) {
  if (!a) return null;
  const items = [];
  for (const r of a.replies ?? []) {
    if (r.status === "bounced") continue;
    const what = r.status === "opted_out" ? "asked not to be written to again (done: they are off every list)." : `answered${r.reply_note ? `: ${quotedSentence(r.reply_note)}` : "."}${r.has_draft ? " Your reply is ready in Decide above." : ""}`;
    items.push(`${whoLine(r)} ${what}`);
  }
  const stops = (a.stops ?? []).filter((x) => !/sending window/i.test(String(x)));
  const due = (a.next ?? []).filter((r) => r.next_at && r.next_at <= now);
  if (due.length && stops.length && (a.approved || a.pending)) {
    const oldest = Math.min(...due.map((r) => Number(r.next_at)));
    const late = now - oldest > 36 * 3_600_000 ? ` since ${shortDate(oldest)} (${Math.floor((now - oldest) / DAY_MS)} days)` : "";
    items.push(`${plural(due.length, "follow-up is", "follow-ups are")} due${late} and not going out. Why: ${stops.join(" ")}`);
  }
  if (!items.length) return null;
  return { title: "Prospect emails", items, link: { label: "See every prospect", url: PROSPECTS_URL }, empty: null };
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
 * THE ANCESTRAL HOUR, ABOVE THE FOLD (owner, 31 Oct 2026: "on the last day of the month and 3 days
 * before u should make the ancestral hour urgent and noticeable"). In the window and not yet done, one
 * line right after the greeting with the same countdown as the Today card — the Worker computes it
 * (`ancestral_hour` on /spirit/day, spirit/ancestralHour.ts); this only says it. Done → no line. Pure.
 */
export function ancestralLine(day) {
  const a = day?.ancestral_hour;
  if (!a?.show || a.done || !a.headline) return null;
  return `${a.headline}. When it's finished, tap Done on Today or in the reminder email.`;
}

/**
 * THE SPIRIT SECTION, built exactly like the sample she approved: the money-map week, the next
 * major lunar event, today's sky in one plain line, the morning practice in one line, the gratitude
 * sentence, this month's Ancestors hour and Contribution, and the week's practice in one line — then
 * one link to the Spirit tab for the rest (owner, 25 Oct 2026: trimmed). Pure.
 */
export function spiritSection(day, week, now = Date.now(), lapseLine = null) {
  if (!day) return null;
  const items = [];
  // A rung day of the practice ladder is ONE line here, never an email of its own (owner, 13 Nov 2026).
  if (lapseLine) items.push(String(lapseLine));
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
    // The Worker's one rule (spirit/ancestralHour.ts) when it sent it; the same count otherwise.
    const [y, mo] = dayOf(now).split("-").map(Number);
    const left = Number.isInteger(day.ancestral_hour?.days_left) ? day.ancestral_hour.days_left : new Date(Date.UTC(y, mo, 0)).getUTCDate() - Number(dayOf(now).slice(8, 10));
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
    .map((t) => ({ id: t.id, text: `What happened: ${t.employee_name ?? "A teammate"}'s ${((j) => (j.quoted ? `"${j.name.slice(0, 80)}"` : j.name))(jobName(t))} stopped (${String(t.error ?? "no reason given").split("\n")[0].slice(0, 120)}). What we did: Danielle has a job to find the cause and fix it at source. Status: being fixed.` }));
}

const DONE_SOURCES = ["pnp_outreach", "bounces", "lp", "prospects", "tail", "notices", "risk", "archive"];
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
export const BRAINS_URL = `${ORIGIN}/?tab=brains`;
export const SCOREBOARD_URL = `${ORIGIN}/?tab=brains&view=scoreboard`;
/** Key numbers per business in the monthly grid: the first few rows of its Numbers table. */
export const SCOREBOARD_KEY_METRICS = 3;

/**
 * MONDAYS: ONE PLAIN LINE ABOUT THE WHOLE SETUP (owner, 31 Oct 2026; Company Brains plan step 10).
 * "Cohesion: all clear", or what the check fixed and what it could not: stale brains, memory strays,
 * repos missing their brain pointer, skills that contradict the house rules, a stale local copy
 * (`cohesionCheckLine`). Never red. A check that did not load, or a Mac check that did not run this
 * week, says so plainly rather than leaving the line out (Rule 0).
 */
export function brainsSectionFor(data, now = Date.now()) {
  if (parts(now).weekday !== "Monday") return null;
  const line = data.brainsCheck?.line ?? "Cohesion: the weekly check did not load this morning; the team is looking.";
  return { title: "Weekly check", tone: "done", items: [{ text: line, links: [{ label: "Open Brains ›", url: BRAINS_URL }] }], empty: null };
}

/**
 * MONDAYS: ONE PLAIN LINE ABOUT TIME-2-READ GROUPS (owner, 31 Oct 2026): "Time-2-Read groups: N
 * emailed, N replied, N codes in use", from Monique's groups duty (the Worker's own counts). A count
 * that did not load says so, rather than leaving the line out (Rule 0).
 */
export function t2rGroupsSectionFor(data, now = Date.now()) {
  if (parts(now).weekday !== "Monday") return null;
  const line = data.t2rGroups?.line ?? "Time-2-Read groups: the counts did not load this morning; the team is looking.";
  return { title: "Time-2-Read groups", tone: "done", items: [{ text: line, links: [] }], empty: null };
}

/**
 * THE 1ST OF THE MONTH: ONE CALM GRID, business × key numbers, from each brain's Numbers table.
 * "not tracked yet" where a value is missing; never an invented number.
 */
export function scoreboardSectionFor(data, now = Date.now()) {
  if (!/-01$/.test(parts(now).date)) return null;
  const rows = data.scoreboard;
  if (!Array.isArray(rows)) {
    return { title: "Scoreboard", items: [{ text: "The scoreboard did not load this morning; it is on its page.", links: [{ label: "Open the scoreboard ›", url: SCOREBOARD_URL }] }], empty: null };
  }
  const byBiz = new Map();
  for (const r of rows) {
    const list = byBiz.get(r.business) ?? [];
    list.push(r);
    byBiz.set(r.business, list);
  }
  const data2 = [...byBiz.entries()].map(([business, list]) => {
    const tracked = list.filter((r) => r.metric);
    const shown = tracked.slice(0, SCOREBOARD_KEY_METRICS).map((r) => `${r.metric}: ${r.value ?? "not tracked yet"}`);
    const latest = tracked.map((r) => r.last_updated).filter(Boolean).sort().pop() ?? null; // ISO days sort as dates
    return { business, numbers: shown.length ? shown.join(" · ") : "not tracked yet", updated: !latest ? "not yet" : /^\d{4}-\d{2}-\d{2}$/.test(latest) ? dayWords(latest, { weekday: false }) : latest };
  });
  return {
    title: "Scoreboard: this month",
    rows: { columns: [{ key: "business", label: "Business" }, { key: "numbers", label: "Key numbers" }, { key: "updated", label: "Last updated" }], data: data2 },
    link: { label: "See the full scoreboard →", url: SCOREBOARD_URL },
    empty: null,
  };
}

/** A company's name as two rows share it: "Fireworks" and "Fireworks AI, Inc." are one company. Pure. */
const COMPANY_TAIL = /\s+(?:ai|inc|incorporated|corp|corporation|co|company|llc|ltd|limited|plc|labs?|technologies|technology|holdings|group)$/;
export function companyKey(name) {
  let k = String(name ?? "").toLowerCase().replace(/[.,'’()]/g, "").replace(/&/g, " and ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3 && COMPANY_TAIL.test(k); i++) k = k.replace(COMPANY_TAIL, "");
  return k;
}

/**
 * ONE ROW PER COMPANY AND SIDE (owner, 13 Nov 2026: "Fireworks" and "Fireworks AI" were two rows for
 * one order). Rows that name the same company on the same side fold into the first (the newest): the
 * fuller name is kept, a missing size or price is filled from the copy that has one, and a second
 * sender is said as "+N more" in From. Order is kept. Pure.
 */
export function mergeDealRows(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    const k = `${companyKey(r.company)}|${String(r.side ?? "").toLowerCase()}`;
    const kept = out.get(k);
    if (!kept) { out.set(k, { ...r, _from: new Set([String(r.from ?? "")]) }); continue; }
    const blank = (v) => v == null || v === "" || v === "—";
    if (String(r.company).length > String(kept.company).length) kept.company = r.company;
    if (blank(kept.size) && !blank(r.size)) kept.size = r.size;
    if (blank(kept.price) && !blank(r.price)) kept.price = r.price;
    kept._from.add(String(r.from ?? ""));
  }
  return [...out.values()].map(({ _from, ...r }) => (_from.size > 1 && r.from ? { ...r, from: `${r.from} (+${_from.size - 1} more)` } : r));
}

export function buildDay(data, now = Date.now()) {
  const yours = yoursThisWeek(data.waiting ?? [], now);
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
  const quiet = data.quietPeople ?? [];
  const isQuiet = (d) => quiet.some((r) =>
    [`lp:${r.id}`, `lp-again:${r.id}`, `lpnudge:${r.id}`, `lp:${r.address}`, `lp-again:${r.address}`, `lpnudge:${r.address}`].includes(d.key) ||
    (r.name && String(d.title ?? "").toLowerCase().includes(r.name.toLowerCase())) ||
    (r.address && JSON.stringify(d).toLowerCase().includes(r.address.toLowerCase())));
  const m = {};
  for (const [name, sec] of Object.entries(data.morning ?? {})) {
    m[name] = {
      ...sec,
      decide: (sec.decide ?? []).filter((d, i) => !isQuiet(d) && passes(`${name} decide ${i + 1}`, d.title, d.body, ...(d.details ?? []), ...(d.buttons ?? []).map((b) => b.label))),
      rows: (sec.rows ?? []).filter((r, i) => !isQuiet(r) && passes(`${name} row ${i + 1}`, r.company, r.side, r.size, r.price, r.from)),
      lines: (sec.lines ?? []).filter((l, i) => !isQuiet(typeof l === "string" ? { title: l } : { ...l, title: l.text }) && passes(`${name} line ${i + 1}`, typeof l === "string" ? l : l.text)),
    };
  }
  const used = new Set();
  const idFor = (kind, key) => { let id = itemId(kind, key); let n = 2; while (used.has(id)) id = itemId(kind, `${key}#${n++}`); used.add(id); return id; };
  const more = (url) => ({ label: "See everything ›", url });

  // 1. Decide: Boss OS's own, then every producer's (catch-ups have their own section). ALL of them.
  const decideRaw = [...bossDecisions(data)];
  /*
   * A PRODUCER'S PROSPECT-TEMPLATE CARD IS CHECKED AGAINST THE LIVE TEMPLATE (26 Oct 2026). Monday's
   * email asked her to approve a template retired the evening before (her "only 3 companies" change
   * had been recorded and a new one approved), from a section file written that morning, and its
   * counts contradicted the live Prospect emails section. With the live activity loaded, only the
   * template actually waiting for her may be a Decide card.
   */
  const livePending = data.prospects ? String(data.prospects.pending?.id ?? data.prospects.pending?.hash ?? "") : null;
  const staleTemplate = (d) => livePending !== null && String(d.key ?? "").startsWith("prospect-template:") && String(d.key).slice("prospect-template:".length) !== livePending;
  for (const [name, sec] of Object.entries(m)) if (name !== "catchups") for (const d of sec.decide ?? []) if (!staleTemplate(d)) decideRaw.push({ priority: 0, from: name, ...d });
  decideRaw.push(...prospectDecisions(data.prospects ?? null, new Set(decideRaw.map((d) => d.key).filter(Boolean)), now));
  for (let i = decideRaw.length - 1; i >= 0; i--) if (isQuiet(decideRaw[i])) decideRaw.splice(i, 1);
  // A carried card whose approval she already answered, or whose job no longer waits, is not hers
  // any more (morningMemory.mjs `answeredUnderneath`; Today applies the same rule).
  const underneath = { pending: new Set((data.approvals ?? []).map((a) => a.id)), waiting: new Set((data.tasks ?? []).filter((t) => t.status === "awaiting_approval").map((t) => t.id)) };
  data = { ...data, carried: (data.carried ?? []).filter((d) => !isQuiet(d) && !answeredUnderneath(d.key, underneath)) };
  decideRaw.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  // One card per key: the same decision from two producers is one decision.
  const cardKeys = new Set();
  for (let i = 0; i < decideRaw.length; i++) {
    const k = decideRaw[i].key;
    if (k && cardKeys.has(k)) decideRaw.splice(i--, 1);
    else if (k) cardKeys.add(k);
  }
  /*
   * EVERY DECIDE CARD SAYS HOW TO ANSWER IT BY REPLY (owner, 25 Oct 2026): its number in this email.
   * The prospect-email card's reply goes to Monique's template (src/worker/boss/lp/templateReply.ts),
   * which reads the number against this morning as kept in Boss OS.
   */
  const replyHint = (d, n) => (String(d.key ?? "").startsWith("prospect-template:")
    ? `Reply "${n}: your changes" to change it, "${n}: try again" for a different draft, or "${n}: approved" to approve it.`
    : `Reply "${n}: …" to this email to answer this one.`);
  /*
   * A DECIDE ITEM SHE HAS ALREADY SEEN IS ONE THIN LINE (owner, 26 Oct 2026: "kenneth goodwin should
   * be a thin line not taking up much space after the first time"). Full the first morning; on later
   * days "Still yours to answer: name · N days · Open ›", kept in the list, not counted as fresh.
   */
  const repeats = splitRepeats(decideRaw, { told: data.told?.decide ?? {}, today, now });
  const decide = repeats.full.map((d, i) => {
    const id = idFor("decide", d.key ?? d.title);
    const screen = itemUrl(today, id);
    return { ...d, id, screen, details: [...(d.details ?? []), replyHint(d, i + 1)], buttons: [...(d.buttons ?? []), more(screen)] };
  });
  const stillYours = repeats.thin.map((d) => {
    const id = idFor("decide", d.key ?? d.title);
    const screen = itemUrl(today, id);
    return { ...d, id, screen, buttons: [more(screen)] };
  });
  stillYours.push(...carriedLines(data.carried ?? [], { shown: new Set([...decide, ...stillYours].map((d) => d.id)), keys: new Set(decideRaw.map((d) => d.key).filter(Boolean)), today }));
  // A row here shows on three mornings, then leaves the email; it stays on Today until she answers it.
  const stillSeen = withinShowings(stillYours.map((d) => ({ ...d, seenKey: d.id })), data.told?.still ?? {});
  stillYours.length = 0;
  stillYours.push(...stillSeen.shown);
  // A held reply rides its line: "✓ Send as is" only with the words shown word for word (CLAUDE.md:
  // "Send as is" never sends what was not shown), then "✎ Change it" on Today.
  for (const d of stillYours) {
    const c = (data.carried ?? []).find((x) => x.id === d.id);
    if (c?.send_url && c.reply?.text) { d.reply_text = c.reply.text; d.send_url = c.send_url; d.change_url = c.change_url; }
  }

  // 2. Deals: each opens its own screen there; the source email is one more tap from it.
  const deals = mergeDealRows(m.deals?.rows ?? []).map((r) => {
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

  // The matches stay; the totals line and "Still looking" are gone (owner, 13 Nov 2026). A copy
  // written before the producer stopped sending them is read the same way.
  const foundItems = found.filter((f) => !f.counts && !/^Still looking:/.test(f.text)).map((f) => ({ text: f.text, links: f.links?.length ? f.links.slice(0, 1).concat([{ label: "See it", url: f.screen }]) : [{ label: "See it", url: f.screen }] }));
  const foundShown = (max) => foundItems.slice(0, max);

  // 3. Briefing: three one-line headlines, and "Read the full briefing →" to its screen. The whole briefing is never
  // in the email (owner, 24 Oct 2026: "never risk the size limit"); `briefingFull` is its screen's shape.
  const raw = briefingRaw(data.briefing, today);
  const src = briefingSourceUrl(data.briefing);
  const briefTop = raw ? raw.map((l) => ({ runs: proseRuns(headline(l), src) })) : null;

  /*
   * 4. Done for you (owner, 26 Oct 2026: "no need to repeat ever and do not use a lot of space"): each
   * item once, the first morning after it happened; never twice in one email (a failed job's family
   * is one line however often it failed); one short plain line each, at most three, then "+N more on
   * Today ›". The full What happened / What we did / Status stays on Today (the digest), not here.
   */
  const doneRaw = [];
  const bl = bounceLine(data.bounceFixes);
  if (bl) doneRaw.push({ text: bl, links: [] });
  doneRaw.push(...commentDoneLines(data, now));
  /*
   * A TEAM JOB THAT STOPPED IS ONE COUNT LINE, NEVER A LINE EACH (owner, 7 Nov 2026: "Fix a held
   * email…", "Zora's archive audit", "Tools worth knowing about" in her Done for you). Danielle's
   * repairs and the duties' own runs live on Systems; only a job she asked for gets its own line.
   */
  let teamStops = 0;
  for (const f of failedTaskLines(data.tasks, now)) {
    const t = (data.tasks ?? []).find((x) => x.id === f.id) ?? {};
    if (isTeamJob(t)) { teamStops++; continue; }
    doneRaw.push({ key: `failed:${jobFamily(t.title).toLowerCase()}`, text: failedDoneLine(t), full: f.text, links: [] });
  }
  const selfWaiting = selfStartedWaiting(data);
  if (selfWaiting.length) {
    // One job Boss OS started is said by name; one she already answered is said as that (its long
    // title, cut, read as a typo on 13 Nov 2026); several are one count.
    const one = selfWaiting.length === 1 ? selfWaiting[0] : null;
    const what = !one ? `${selfWaiting.length} of the team's jobs were held up`
      : one.approval_id ? "A job you already answered was held up"
      : `${one.employee_name ?? "The team"}'s ${((j) => (j.quoted ? `"${j.name.slice(0, 80)}"` : j.name))(jobName(one))} was held up`;
    doneRaw.push({ key: `self-waiting:${today}`, text: `${what}, and Danielle is getting ${one ? "it" : "them"} moving again.`, links: [] });
  }
  if (teamStops) doneRaw.push({ key: `team-stops:${today}`, text: `${teamStops} team job${teamStops === 1 ? "" : "s"} stopped and ${teamStops === 1 ? "is" : "are"} being fixed by Danielle.`, links: [{ label: "Open ›", url: `${ORIGIN}/?tab=systems` }] });
  const prospects = prospectSection(data.prospects ?? null, now);
  const spirit = spiritSection(data.spirit ?? null, data.practiceWeek ?? null, now, data.lapseLine ?? null);
  const ancestral = ancestralLine(data.spirit ?? null);
  // The prospects producer's count line is in "Prospect emails" when that loaded; not said twice.
  for (const name of DONE_SOURCES.filter((n) => !(data.prospects && n === "prospects"))) for (const l of m[name]?.lines ?? []) doneRaw.push(typeof l === "string" ? { text: l, links: [] } : { links: [], ...l });
  const doneOnce = doneForYou(doneRaw, { told: new Set(data.told?.done ?? []), max: MAX_DONE });
  const done = doneOnce.all.map((l) => { const id = idFor("done", l.text); return { ...l, id, screen: itemUrl(today, id) }; });
  // A line that carries its own links inline (`runs`: the filed meeting preps, each with its "Open ›") keeps them.
  const doneShown = done.slice(0, MAX_DONE).map((l) => (Array.isArray(l.runs) && l.runs.some((r) => r.url) ? { runs: l.runs, links: [] } : { text: l.text, links: [{ label: "See it", url: l.screen }] }));
  // Three lines and nothing after them (owner, 13 Nov 2026): no "+N more" and no count of the Updates
  // page. Everything done is on Today, and the updates are on their page.

  // 4b. The grid repos: the weekly Search Readiness check (Mondays; owner, 25 Oct 2026). Its own short
  // section — what is broken, what was fixed, what is being built — never pooled into "Done for you",
  // where three lines would hide it.
  const gridLines = (m.grid_repos?.lines ?? []).slice(0, 4).map((l) => (typeof l === "string" ? { text: l, links: [] } : { links: [], ...l }));
  const gridRepos = gridLines.length ? { title: "The grid repos: this week's search check", tone: "done", items: gridLines, link: m.grid_repos?.link ?? null, empty: null } : null;

  // 4b'. The Scorecard (Mondays; owner ruling, 1 Nov 2026): its own section with its own count title —
  // switches, pauses and rows with no number only; a quiet week is one line.
  const scLines = (m.scorecard?.lines ?? []).map((l) => (typeof l === "string" ? { text: l, links: [] } : { links: [], ...l }));
  const scorecardSection = scLines.length ? { title: m.scorecard.title ?? "📊 Scorecard", tone: "done", items: scLines, empty: null } : null;

  // 4b''. Your open loops (owner, 13 Nov 2026): her own overdue rows only (written by the Worker's
  // tick, openLoops.mjs `morningSection`), the same row once however many copies the list holds, five
  // at most, each on three mornings and then only on its page. No counts, no "+N more", no team line
  // (a copy written before the writer dropped them carries no "Open ›" to a row, and is skipped).
  // A row about the system's own work is never hers, whatever copy carries it (`systemRow`).
  const olSeen = withinShowings((m.open_loops?.lines ?? []).map((l) => (typeof l === "string" ? { text: l, links: [] } : { links: [], ...l }))
    .filter((l) => (l.links ?? []).some((k) => /[?&]loop=/.test(String(k.url ?? ""))) && !systemRow({ title: l.text }))
    .map((l) => ({ ...l, seenKey: String(l.key ?? l.text).toLowerCase() })), data.told?.loops ?? {});
  const olLines = olSeen.shown.slice(0, MAX_OPEN_LOOP_LINES).map(({ text, links }) => ({ text, links }));
  const openLoopsSection = olLines.length ? { title: "Your open loops", items: olLines, link: null, empty: null } : null;

  // 4c. Brains (31 Oct 2026): Mondays one plain line, never red; the 1st of the month the scoreboard.
  const brainsSection = brainsSectionFor(data, now);
  const t2rGroupsSection = t2rGroupsSectionFor(data, now);
  const scoreSection = scoreboardSectionFor(data, now);

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

  const val = valerieItems(data.feed, now);
  // A section expected today that did not report in: one thin line near the top (rule 0, 1 Nov 2026).
  const notReported = notReportedLine(data.notReported);
  // Every call and meeting of the day, once (the diary merges a copy on a second calendar), with who
  // and the join link when there is one (owner, 26 Oct 2026: "tell me when i have calls").
  const calls = callsOn(data.diary, today).map((c) => `${timeOf(c.scheduled_at, data.ownerTz)} ${c.title}${c.with ? ` with ${c.with}` : ""}${/^https:\/\/\S+$/.test(String(c.location ?? "")) ? ` (join: ${c.location})` : ""}`);
  // The postscript is the 8Raise line, only when something is wrong (the seat-order line left 13 Nov 2026).
  const ps = eightRaiseLine(m.eightraise?.credits ?? null);

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
  /*
   * THE OWNER LAYOUT'S DIGEST (B, owner 7 Nov 2026): line 1 says why (her morning) and whether she must
   * do anything (the Decide count, or "Nothing to do."); the day's law, a report that did not arrive,
   * the ancestral hour and her calendar follow, each on its own line, above the fold (31 Oct 2026).
   */
  // Each its own line under line 1. A section that did not report in is the team's: it goes to the
  // Updates page (`teamNotes`, posted by the run), never her email (7 Nov 2026).
  const morningRest = [lawLine(data.law), ancestral, calls.length ? `On your calendar: ${calls.join("; ")}.` : null].filter(Boolean);
  const lay = ({ foundMax = MAX_FOUND_LINES, dealMax = MAX_DEAL_ROWS } = {}) => ownerEmail({
    who: "Simone",
    layout: "digest",
    why: `Good morning. Here is your ${dayWords(today)}`,
    act: decide.length ? `${decide.length === 1 ? "One thing" : `${decide.length} things`} to decide, below.` : NOTHING_TO_DO,
    kind: "morning",
    maxDecide: Infinity,
    subject,
    lineTail: morningRest,
    decide,
    sections: [
      ...(stillYours.length ? [{ title: "Still yours to answer", items: stillYours.map((d) => ({
        text: `${d.thin.replace(/^Still yours to answer: /, "")}${d.reply_text ? `. Your reply, word for word: “${oneLine(d.reply_text)}”` : ""}`,
        links: [...(d.send_url ? [{ label: "✓ Send as is", url: d.send_url }, { label: "✎ Change it", url: d.change_url }] : []), { label: "Open ›", url: d.screen }],
      })), empty: null }] : []),
      // A block with nothing in it is left out, never "nothing here" (owner, 13 Nov 2026).
      ...(deals.length ? [{ title: `New deals since yesterday (${deals.length})`, note: deals.length > dealMax ? `The ${dealMax} newest are here; all ${deals.length} are on the Deals screen.` : null, rows: { columns: [{ key: "company", label: "Company" }, { key: "side", label: "Side" }, { key: "size", label: "Size @ price" }, { key: "from", label: "From" }], data: dealRowsAll.slice(0, dealMax) }, link: m.deals?.link ?? null, empty: null }] : []),
      ...(foundGrid.length || foundItems.length ? [{ title: "Monique found", rows: foundGrid.length ? { columns: [{ key: "company", label: "Company" }, { key: "trade", label: "Seller → buyer" }, { key: "fit", label: "Fit" }], data: foundGrid } : null, items: foundShown(foundMax), link: m.monique_found?.link ?? { label: "See every match", url: `${ORIGIN}/?tab=capital&view=matches` }, empty: null }] : []),
      ...(prospects ? [prospects] : []),
      ...(spirit ? [spirit] : []),
      // A briefing that is not in is said in one line (rule 0: a failed source says so), with its link.
      { title: "This morning's briefing (Camille)", items: briefTop ?? ["Briefing late — it will be on your Today page."], link: { label: "Read the full briefing →", url: BRIEFING_URL } },
      ...(doneShown.length ? [{ title: "Done for you", tone: "done", items: doneShown, empty: null }] : []),
      ...(gridRepos ? [gridRepos] : []),
      ...(openLoopsSection ? [openLoopsSection] : []),
      ...(scorecardSection ? [scorecardSection] : []),
      ...(scoreSection ? [scoreSection] : []),
      ...(brainsSection ? [brainsSection] : []),
      ...(t2rGroupsSection ? [t2rGroupsSection] : []),
      { title: "Catch up with", cards: catchCards, items: catchLines, empty: null },
      // Her own to-dos (owner, 26 Oct 2026): told once, then Mondays or two days before a date. Reply
      // "add to my list: …" or "done: …" to change it.
      ...(yours.length ? [{ title: "Yours this week", note: "Reply \"add to my list: …\" or \"done: …\" to change it.", items: yours.map((i) => `${i.what}${i.due_on ? ` (by ${dayWords(i.due_on, { weekday: false })})` : ""}`), empty: null }] : []),
      ...(monday && deadlines.length ? [{ title: "This week", items: deadlines, empty: null }] : []),
      // Valerie's list only when it holds something. A feed that did not load is the team's fix job
      // (main), never a line here; Valerie still gets her own copy at 7 am.
      ...(val?.length ? [{ title: "Porch & Party: To do for Valerie", note: `From the Porch & Party site at ${timeOf(now, data.ownerTz)}. Valerie gets her own copy at 7 am CT.`, boxed: true, items: val, empty: null }] : []),
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
    // `key` rides along so her "N: …" reply reaches the card it numbers (src/worker/boss/lp/decideReply.ts).
    decide: decide.map(({ id, key, title, body, details, draft, buttons, plan, from, screen }) => ({ id, key: key ?? null, title, body: body ?? "", details: details ?? [], draft: draft ?? null, buttons, plan: plan ?? null, from: from ?? "boss", screen })),
    deals: deals.map(({ id, company, side, size, price, structure, from, when, received_on, url, screen }) => ({ id, company, side, size, price: price ?? "—", structure: structure ?? "—", from, when, received_on: received_on ?? null, email_url: /^https:\/\/mail\.google\.com\//.test(String(url ?? "")) ? url : null, screen })),
    found: found.map(({ id, text, links, deal, holders, screen }) => ({ id, text, links: links ?? [], deal: deal ?? null, holders, screen })),
    found_grid: foundGrid,
    done: done.map(({ id, text, full, links, screen }) => ({ id, text: full ?? text, links: links ?? [], screen })),
    // `key` rides here too: a thin line is still a reminder about that person (lp/reminders.ts counts it).
    still_yours: stillYours.map(({ id, key, title, thin, screen }) => ({ id, key: key ?? null, title, line: thin, screen })),
    catchups: catchCards.map(({ id, title, body, details, draft, buttons, screen }) => ({ id, title, body: body ?? "", details: details ?? [], draft: draft ?? null, buttons, screen })),
    briefing: raw ? { for_day: data.briefing.for_day, top: raw.map((l) => proseText(proseRuns(l)).replace(/⁣/g, "")) } : null,
    prospects: data.prospects ? { items: (prospects?.items ?? []).map((i) => (typeof i === "string" ? i : i.text)), sent: (data.prospects?.sent ?? []).map((r) => ({ name: r.name, firm: r.firm, email: r.email, touch: r.touch_no, sent_at: r.sent_at, subject: r.sent_subject ?? r.subject, body: r.body ?? null })) } : null,
    eightraise: ps,
  };
  // What this email told her, so tomorrow's says it once more at most as a thin line (morningMemory.mjs).
  const memory = { decide: repeats.memory, done: [...new Set([...(data.told?.done ?? []), ...doneOnce.keys])].slice(-500), still: stillSeen.memory, loops: olSeen.memory };
  return { ...laid, dropped, digest, cuts, bytes: bytes(laid), memory, yoursTold: yours.map((i) => i.id), teamNotes: notReported ? [notReported] : [] };
}

/**
 * What her reply carries to Simone's task. Her reply's task runs on a model, so the calendar (meeting
 * titles and the people in them) stays out of it. Everything else is Boss OS's own rows, the section
 * files and Valerie's list.
 */
/** A held reply on one line, every word kept. */
export const oneLine = (t) => String(t ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean).join(" ");

/**
 * THE CARRY-OVER IN THE EMAIL (owner, Today v4, 31 Oct 2026): every Decide item Boss OS still holds
 * as unanswered (`/practice/waiting`, src/worker/boss/today/waiting.ts) and that this morning's
 * producers did not send again is one thin "Still yours to answer" line, "waiting N days" from the
 * morning it first appeared. Pure, so it is pinned (tests/boss/todayV4.test.ts).
 */
export function carriedLines(carried, { shown = new Set(), keys = new Set(), today }) {
  return (carried ?? [])
    .filter((c) => c?.id && !shown.has(c.id) && !(c.key && keys.has(c.key)))
    .map((c) => ({
      id: c.id, key: c.key ?? null, title: c.title, screen: `${ORIGIN}/?waiting=${encodeURIComponent(c.id)}`,
      thin: `Still yours to answer: ${c.title} · waiting ${c.days} day${c.days === 1 ? "" : "s"}`,
      buttons: [], first_day: c.first_day ?? today,
    }));
}

/**
 * A task Boss OS opened to repair itself (input.origin "repair"). A dated waiting-on check-in is not:
 * its result can need her own account (the Friday unsubscribe taps in her personal Gmail). Pure.
 */
export function isRepairTask(t) {
  let input = {};
  try { input = typeof t?.input === "string" ? JSON.parse(t.input) : (t?.input ?? {}); } catch { input = {}; }
  return input?.origin === "repair" && input?.repair_kind !== "waiting_on";
}

/** A job the team started (a repair, a duty's run, Danielle's desk), not one she asked for. Pure. */
export function isTeamJob(t) {
  let input = {};
  try { input = typeof t?.input === "string" ? JSON.parse(t.input) : (t?.input ?? {}); } catch { input = {}; }
  if (typeof input?.from === "string" && input.from.includes("@") && input.origin !== "repair") return false;
  return t?.employee_id === "emp_repo" || input?.origin === "repair" || input?.delivers !== undefined || input?.duty_id !== undefined;
}

export function replyContext(text) {
  return String(text).split("\n").map((line) => line.replace(/\s*On your calendar: .*$/, "")).join("\n");
}

// ─── Reading ───────────────────────────────────────────────────────────────────

export async function session() {
  if (!process.env.BOSS_PASSCODE) throw new Error("NAMED STOP [NO_PASSCODE] run through the vault: npm run your-day");
  const u = await fetch(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
  if (!u.ok) throw new Error(`NAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${u.status})`);
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const get = async (p) => { const r = await fetch(`${ORIGIN}/api/boss${p}`, { headers: { cookie } }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return (await r.json()).data; };
  const post = async (p, body) => { const r = await fetch(`${ORIGIN}/api/boss${p}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return (await r.json()).data; };
  return { get, post };
}

const briefingOf = (today) => today.blocks.find((b) => b.key === "executive_briefing")?.content ?? null;
const lawOf = (today) => today.blocks.find((b) => b.key === "coaching_focus")?.content?.law ?? null;

/**
 * TODAY'S LAW, THE EMAIL'S FIRST LINE (owner approved the new Today, 31 Oct 2026: "the law in the
 * morning email's first line"). The same law as the bold card on Today, read from the same block.
 * `null` when the coaching focus did not load: the email then opens as it always did.
 */
/** The most open-loop rows the morning email shows; the rest is one "See all ›" line. */
export const MAX_OPEN_LOOP_LINES = 5;

export function lawLine(law) {
  if (!law?.n || !law?.title || !law?.text) return null;
  return `Today's law, Law ${law.n}, ${law.title}: "${law.text}" Read it aloud.`;
}

export async function read(api, now) {
  const [today, diary, tasks, approvals, rc] = await Promise.all([api.get("/today"), api.get("/diary"), api.get("/tasks"), api.get("/approvals"), api.get("/repo-changes")]);
  // Every job still held, however old: the list above is the newest 100 only, so a held job older
  // than that had no card and no repair (13 Nov 2026).
  const held = await api.get("/tasks?status=awaiting_approval").catch((e) => { console.error(`your-day: the held jobs were not read (${e.message})`); return []; });
  const seenTasks = new Set(tasks.map((t) => t.id));
  for (const t of held ?? []) if (!seenTasks.has(t.id)) { seenTasks.add(t.id); tasks.push(t); }
  const withDue = tasks.map((t) => { let input = {}; try { input = typeof t.input === "string" ? JSON.parse(t.input) : (t.input ?? {}); } catch { input = {}; } return { ...t, due: input?.due ?? null }; });
  // The bounce agent's last day (rule 4): one "done" line. A failed read is said in the log, not to her.
  const bounceFixes = await api.get("/outreach/bounce-fixes").catch((e) => { console.error(`your-day: bounce fixes not read (${e.message})`); return null; });
  // The channel's comment digests: what a comment task is about, and the ones Monique left alone.
  const prospects = await api.get(`/lp/prospects/activity?since=${now - 30 * 3_600_000}`).catch((e) => { console.error(`your-day: prospect activity not read (${e.message})`); return null; });
  const spirit = await api.get("/spirit/day").catch((e) => { console.error(`your-day: spirit day not read (${e.message})`); return null; });
  const practiceWeek = await api.get("/spirit/practice-week").catch(() => null);
  const lapseLine = await api.get("/practice/lapse-line").then((d) => d?.line ?? null).catch((e) => { console.error(`your-day: the practice streak not read (${e.message})`); return null; });
  const waiting = await api.get("/waiting-on").then((d) => d?.items ?? []).catch((e) => { console.error(`your-day: the waiting-on register not read (${e.message})`); return []; });
  // Every unanswered Decide item from earlier mornings (Today v4: they never drop off), with one-tap send.
  const quietPeople = await api.get("/lp/replies").then((d) => (d.rows ?? []).filter((r) => r.quiet));
  const carried = await api.get("/practice/waiting").then((d) => d?.items ?? []).catch((e) => { console.error(`your-day: the carried decisions not read (${e.message})`); return []; });
  const commentWatch = await api.get("/comment-watch-items").then((d) => d?.digests ?? []).catch((e) => { console.error(`your-day: comment digests not read (${e.message})`); return []; });
  // Brains (31 Oct 2026): Monday's one-line check and, on the 1st, the scoreboard grid.
  const brainsCheck = await api.get("/brains/cohesion").catch((e) => { console.error(`your-day: brains check not read (${e.message})`); return null; });
  // Monique's Time-2-Read groups (31 Oct 2026): Monday's one line.
  const t2rGroups = await api.get("/t2r-groups/summary").catch((e) => { console.error(`your-day: t2r groups not read (${e.message})`); return null; });
  const scoreboard = await api.get("/brains/scoreboard").then((d) => d?.rows ?? null).catch((e) => { console.error(`your-day: scoreboard not read (${e.message})`); return null; });
  // The sections live in Boss OS (1 Nov 2026, so cloud producers reach the email); the Mac files are
  // the cutover fallback, newer copy wins per section. A store that cannot be read leaves the files.
  const store = await api.get("/morning/sections").then((d) => d?.rows ?? []).catch((e) => { console.error(`your-day: the morning sections in Boss OS not read (${e.message}); the Mac files only`); return null; });
  const { sections, skipped } = readMorningSections({ now, store });
  for (const s of skipped) console.error(`your-day: morning section skipped — ${s}`);
  // A section expected today that did not report in is said in one line and repaired (rule 0).
  const reported = sectionsNotReported(sections, { weekday: parts(now).weekday, now });
  for (const m of reported.missing) console.error(`your-day: morning section not reported in — ${m.name}`);
  // Her zone for the times shown (Central when unread: never a guess).
  const ownerTz = await api.get("/system/owner-timezone").then((d) => d?.tz ?? null).catch((e) => { console.error(`your-day: her time zone not read (${e.message}); times in Central`); return null; });
  // Job 6: an approval whose task is older than the newest 100 is read by id, so a repair's approval is known as one.
  const known = new Set(tasks.map((t) => t.id));
  const approvalTasks = (await Promise.all([...new Set((approvals ?? []).map(approvalTaskId).filter((id) => id && !known.has(id)))].slice(0, 100)
    .map((id) => api.get(`/tasks/${encodeURIComponent(id)}`).then((d) => d?.task ?? null).catch((e) => { console.error(`your-day: the task behind an approval was not read (${e.message})`); return null; })))).filter(Boolean);
  return { approvalTasks, ownerTz, quietPeople, brainsCheck, t2rGroups, scoreboard, diary: diary?.rows ?? null, tasks: withDue, approvals, repoChanges: rc?.items ?? [], briefing: briefingOf(today), law: lawOf(today), bounceFixes, commentWatch, prospects, spirit, practiceWeek, lapseLine, waiting, carried, morning: reported.sections, notReported: reported.missing };
}

export async function feedOf(range) {
  if (!process.env.PNP_OWNER_FEED_TOKEN) return { feed: null, error: "the feed key is not in the vault" };
  const r = await fetch(`${FEED}?range=${range}`, { headers: { authorization: `Bearer ${process.env.PNP_OWNER_FEED_TOKEN}` } }).catch((e) => ({ ok: false, status: String(e?.message ?? e) }));
  return r.ok ? { feed: await r.json() } : { feed: null, error: `the site answered ${r.status}` };
}

/** A source that did not load is the team's job, never her email (rule 3). Best effort, logged. */
/** A repair Boss OS opens itself: Danielle builds and lands it without asking her (25 Oct 2026). */
async function fixJob(api, title, prompt, kind = "self_repair") {
  try { await api.post("/tasks", { title, lane: "ops", employee_id: "emp_repo", input: { origin: "repair", repair_kind: kind, prompt: `seq23/boss-os — ${prompt}` } }); console.log(`your-day: fix job opened — ${title}`); }
  catch (e) { console.error(`your-day: the fix job "${title}" was not opened (${e.message})`); }
}

/**
 * ONE REPAIR PER SECTION THAT DID NOT REPORT IN (rule 0, 1 Nov 2026), none while one for it is still
 * open, so a job broken for days is one repair, not one a morning. Pure.
 */
export function notReportedRepairs(missing, tasks = []) {
  const open = new Set((tasks ?? []).filter((t) => OPEN.has(t.status)).map((t) => t.title));
  return (missing ?? []).map((m) => ({
    title: `The morning section "${m.name}" did not report in`,
    prompt: `the section "${m.name}" (${m.label}) was expected in Simone's morning email today and Boss OS held no copy written in the last 24 hours (src/shared/boss/mail/morningSections.mjs MORNING_SECTION_SPECS). Its producer did not run, failed, or its post to /api/boss/morning/sections failed. Read the producer's log (on her Mac: ~/Library/Logs/boss-duty/ for a local_job's own dated run, ~/Library/Logs/boss-agent/ for the launchd chain it ran inside; in the cloud: the job's private R2 log), fix the cause at source, and run it again.`,
  })).filter((r) => !open.has(r.title));
}

/** ONE repair per self-started job held for a word nobody asked her for, none while one for it is open. Pure. */
export function selfWaitingRepairs(waiting, tasks = []) {
  const open = new Set((tasks ?? []).filter((t) => OPEN.has(t.status)).map((t) => t.title));
  return (waiting ?? []).map((t) => ({
    title: `Unblock "${String(t.title).slice(0, 80)}": it waits for an approval nobody was asked for`,
    prompt: `the task ${t.id} ("${t.title}") sits in awaiting_approval with no pending approval row, so nothing can release it and the owner is not asked. Either Boss OS started it itself (a duty's run; her ruling, 2 Nov and 13 Nov 2026: the employee takes her own default) or she already answered its approval and the task never moved. Read its task_events and its approval to see what parked it; if she approved it, do what she approved; otherwise take the default (accept the result, or run it again). Fix at source whatever left it parked (money, a send in her name, legal and invitations stay approvals).`,
  })).filter((r) => !open.has(r.title));
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
const TOLD_ONCE = ["pnp_outreach", "pnp_marketplace", "tail", "risk", "archive", "notices", "grid_repos"];

async function main() {
  const DRY = process.argv.includes("--dry-run");
  const pi = process.argv.indexOf("--preview");
  const PREVIEW = pi === -1 ? null : process.argv[pi + 1];
  const FORCE = process.argv.includes("--force");
  const NOW_WAIT = process.argv.includes("--no-wait");
  const day = dayOf(Date.now());
  const marker = path.join(SENT_DIR, `sent-${day}`);
  // The count is the day's morning email: a later tick that finds it sent says 1, the floor's "it went".
  if (!DRY && !PREVIEW && !FORCE && fs.existsSync(marker)) { console.log(`your-day: already sent for ${day}`); console.log(outputLine(1, "emails sent")); return; }

  const api = await session();
  // Wait for Camille's briefing (lands about 07:10), sending the moment it does; 07:45 at the latest.
  const toldFile = path.join(SENT_DIR, "told.json");
  let told = { decide: {}, done: [] }; try { told = { ...told, ...JSON.parse(fs.readFileSync(toldFile, "utf8")) }; } catch { /* first run */ }
  const data = { ...(await read(api, Date.now())), told };
  const decision = briefingDecision(data.briefing, Date.now(), { inProgress: briefingInProgress(data.tasks, Date.now()) });
  /*
   * THE WAIT IS THE NEXT TICK, NEVER A SLEEP (13 Nov 2026: the 06:40 run slept an hour inside the
   * runner, holding the 07:50 safety tick behind it). While the briefing is still being written this
   * run ends by name and the next tick (job-your-day.yml: 07:10, 07:30, then 07:50, past the cap)
   * asks again; duty-run.sh reads NOT_YET as "not a run", so nothing is recorded as sent or failed.
   */
  if (decision === "wait" && !DRY && !PREVIEW && !NOW_WAIT) {
    console.log(`NAMED WAIT [BRIEFING_NOT_IN] today's briefing is still being written; the next tick sends the morning email (07:45 Central at the latest).`);
    process.exit(NOT_YET);
  }
  const now = Date.now();
  const d = await feedOf("day");
  const email = buildDay({ ...data, feed: d.feed, feedError: d.error }, now);

  if (PREVIEW) {
    fs.mkdirSync(PREVIEW, { recursive: true });
    fs.writeFileSync(path.join(PREVIEW, "your-day.html"), email.html, { mode: 0o600 });
    // The preview is what ships: the gate's invisible prose marks are stripped here as at the send.
    fs.writeFileSync(path.join(PREVIEW, "your-day.txt"), `${email.subject}\n\n${email.text.replace(/\u2063/g, "")}`, { mode: 0o600 });
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
  let failTold = []; try { failTold = JSON.parse(fs.readFileSync(failMarks, "utf8")); } catch { failTold = []; }
  // ONE fix job per failed job family, and none while a repair for that family is still open (26 Oct 2026).
  const failedNow = failedTaskLines(data.tasks, now);
  for (const j of fixJobsToOpen(failedNow, { tasks: data.tasks, repoChanges: data.repoChanges, told: failTold, now })) {
    const t = j.task;
    await fixJob(api, `Find why "${j.family.slice(0, 60)}" failed`, `the task ${j.id} (${t?.employee_name ?? "an employee"}) failed: ${String(t?.error ?? "").slice(0, 400)}. Find the cause, fix it at source with a test, and run the job again or close it with the reason.`, "failed_task");
  }
  failTold.push(...failedNow.map((f) => f.id));
  try { fs.mkdirSync(SENT_DIR, { recursive: true }); fs.writeFileSync(failMarks, JSON.stringify(failTold.slice(-500))); } catch { /* best effort */ }

  for (const r of notReportedRepairs(data.notReported, data.tasks)) await fixJob(api, r.title, r.prompt);
  for (const r of selfWaitingRepairs(selfStartedWaiting(data), data.tasks)) await fixJob(api, r.title, r.prompt);
  // The team's own note (a section that did not report in) is a row on ☰ More → Updates, once a day.
  for (const line of email.teamNotes ?? []) {
    await api.post("/task-notices/update", { key: `morning-not-reported-${day}`, from_name: "Simone", subject: "Not in this morning's email", body: line })
      .catch((e) => console.error(`your-day: the Updates row for "${line}" was not written: ${e?.message ?? e}`));
  }
  if (d.error) await fixJob(api, "Valerie's list did not load for the morning email", `the Porch & Party owner feed answered: ${d.error}. Simone's morning email said so in one line. Fix the read (PNP_OWNER_FEED_TOKEN, ${FEED}).`);

  // The morning goes to Boss OS FIRST: every link in the email opens one of its items, and Today
  // lists its decisions. A failed post still sends (the email carries everything) and opens a fix job.
  const kept = await postDigest(api, email.digest);
  if (!kept) await fixJob(api, "The morning email's screens were not saved", `Simone's morning email (scripts/ops/your-day.mjs) could not post its items to Boss OS (POST /morning), so its "See everything" links and Today's contract are empty for ${email.digest.day}. Find why and fix it at source (src/worker/boss/routes/morning.ts).`);
  const r = await sendAsEmployee("Simone", { to: ownerTo(), subject: email.subject, text: email.text, prelaid: email, context: replyContext(email.text) });
  if (!r.ok) { console.error(`NAMED STOP [SEND_REFUSED] "${email.subject}" was not sent: ${r.error}`); process.exit(9); }
  console.log(`your-day: sent "${email.subject}" from ${r.from}`);
  console.log(outputLine(1, "emails sent"));
  if (kept) await api.post(`/morning/${email.digest.day}/sent`, {}).catch((e) => console.error(`your-day: the morning was not marked sent (${e.message})`));
  clearToldSections(TOLD_ONCE);
  await api.post("/morning/sections/told", { sections: TOLD_ONCE }).catch((e) => console.error(`your-day: the told sections not marked in Boss OS (${e.message})`));
  for (const id of email.yoursTold ?? []) await api.post(`/waiting-on/${id}`, { told_at: now }).catch((e) => console.error(`your-day: "yours this week" not marked told (${e.message})`));
  try { fs.writeFileSync(toldFile, JSON.stringify(email.memory)); } catch (e) { console.error(`your-day: what was told was not kept (${e.message})`); }
  fs.mkdirSync(SENT_DIR, { recursive: true });
  fs.writeFileSync(marker, new Date(now).toISOString());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
}
