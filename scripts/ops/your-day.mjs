#!/usr/bin/env node
/**
 * SIMONE'S "YOUR DAY" EVERY MORNING, AND "YOUR WEEK" ON MONDAYS (owner, approved 22 Oct 2026).
 *
 * The Review Pack mock-ups, "Simone's daily and Monday emails", built from data that already exists:
 *
 *   Your day (daily, 06:40 Central, duty_your_day):
 *     1. Yours today — calls on your calendar, decisions in your Inbox, Danielle's plans and previews
 *        waiting on your "approved", and work held for your word;
 *     2. a "Porch & Party: To do for Valerie" box — the site's own owner feed (GET /api/owner-feed,
 *        the same list as Valerie's 7 AM email; p-n-p functions/_lib/owner-feed.mjs);
 *     3. what the team is doing;
 *     4. loose ends.
 *   Your week (Mondays, sent first): deadlines, her calendar, replies waiting on her, Valerie's week,
 *   what each employee is doing.
 *
 * NOTHING IS INVENTED. Every line is a row read from Boss OS (Today, the diary, tasks, the Inbox,
 * repo changes, the roster) or the P&P owner feed — and an empty section says so in one line. A
 * source that cannot be read says THAT, in one line, rather than reading as "nothing today".
 *
 * NO MODEL IS CALLED. AND NOTHING FROM THE FUND: the fund's investor follow-ups are the fund's own
 * work (Boss OS and the fund never cross; tests/outboundEmailMap.test.ts), so "replies waiting on
 * you" is what Boss OS itself is waiting on her for, never the fund's mailbox.
 *
 * "REPLY TO CHANGE ANYTHING." The email carries `yd_<date>` as its job code (hidden, X-Boss-Ref),
 * and `postEmployeeMail` records it with the email's text against the Message-ID her reply quotes.
 * Her reply to simone@ becomes a task for Simone whose body carries this email
 * (src/worker/boss/intake/inboundMail.ts, "She is replying to this email from Boss OS"), so "move
 * the KDP item to Monday" arrives with the list it is about.
 *
 *   npm run your-day                 # send today's (and Monday's week) — once per day
 *   npm run your-day -- --dry-run    # print what would be sent, send nothing
 *   npm run your-day -- --preview <dir>   # write the HTML and text to <dir>, send nothing
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sendAsEmployee } from "./notify.mjs";
import { layoutEmail, clockWords } from "../../src/shared/boss/mail/plain.mjs";

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

/** Danielle's changes waiting on her word: a plan to approve, or a preview to approve. */
function changesWaiting(repoChanges) {
  return (repoChanges ?? []).filter((r) => r.phase === "asking" || r.phase === "previewing").map((r) => (r.phase === "asking"
    ? `Approve Danielle's plan for ${r.repo ?? "your change"} — reply approved to her email to start the build.`
    : `Look at Danielle's preview of ${r.repo ?? "your change"} — reply approved to her email to make it live.`));
}

function callsOn(diary, iso) {
  return (diary ?? []).filter((r) => r.scheduled_at && dayOf(r.scheduled_at) === iso).sort((a, b) => a.scheduled_at - b.scheduled_at);
}

const OPEN = new Set(["queued", "running", "awaiting_approval", "classified", "assigned"]);

/** One line per teammate: what they have open, in their own titles; quiet ones say so. */
function teamLines(roster, tasks, repoChanges, { week = false } = {}) {
  const out = [];
  for (const e of roster ?? []) {
    const mine = (tasks ?? []).filter((t) => t.employee_id === e.id && OPEN.has(t.status));
    const changes = e.id === "emp_repo" ? (repoChanges ?? []).filter((r) => !["done", "failed", "cancelled"].includes(r.phase)) : [];
    const titles = [...changes.map((r) => `${r.repo ?? "a site"} change (${r.phase === "asking" || r.phase === "previewing" ? "waiting on your approved" : "building"})`), ...mine.map((t) => t.title)];
    const duties = Number(e.duties ?? 0);
    if (titles.length) out.push(`${e.name} — ${titles.length} open: ${titles.slice(0, 3).join("; ")}${titles.length > 3 ? `; and ${titles.length - 3} more` : ""}.`);
    else if (week && duties) out.push(`${e.name} — ${plural(duties, "regular job")} on schedule; nothing open right now.`);
    else if (e.health && e.health !== "green") out.push(`${e.name} — ${e.label ?? "needs a look"}.`);
  }
  return out;
}

function valerieItems(feed, { week = false } = {}) {
  if (!feed) return null;
  return (feed.items ?? []).map((i) => {
    const due = i.kind === "money" || !i.detail ? "" : ` — ${i.detail}`;
    const when = week && i.due && /^\d{4}-\d{2}-\d{2}/.test(i.due) && i.kind !== "money" ? `${shortDay(i.due.slice(0, 10))}: ` : "";
    const head = i.kind === "money" ? `Money: ${i.title}` : i.kind === "renewal" ? `Marketplace: ${i.title}` : i.kind === "id_delete" ? `ID photo: ${i.title}` : i.title;
    return `${when}${head}${i.kind === "money" && i.detail ? ` — ${i.detail}` : due}`;
  }).filter((s) => week || !/^Your week\b/.test(s));
}

/** Your day. `data` is everything read; a source that could not be read is `null` with a reason. */
export function buildDay(data, now = Date.now()) {
  const today = dayOf(now);
  const yours = [];
  for (const c of callsOn(data.diary, today)) yours.push(`${timeOf(c.scheduled_at)}: ${c.title}${c.with ? ` with ${c.with}` : ""}${c.location ? ` (${c.location})` : ""}.`);
  for (const a of data.approvals ?? []) yours.push(`Decide: ${a.title} — it is in your Inbox.`);
  yours.push(...changesWaiting(data.repoChanges));
  for (const t of (data.tasks ?? []).filter((x) => x.status === "awaiting_approval")) yours.push(`Approve or change: ${t.title}${t.employee_name ? ` (${t.employee_name})` : ""}.`);

  const val = valerieItems(data.feed);
  const team = teamLines(data.roster, data.tasks, data.repoChanges);
  const loose = [];
  const failed = (data.tasks ?? []).filter((t) => t.status === "failed" && t.finished_at && now - t.finished_at < 2 * DAY_MS);
  for (const t of failed.slice(0, 3)) loose.push(`${t.employee_name ?? "A teammate"} could not finish "${t.title}" — the email about it says what is needed.`);
  if (failed.length > 3) loose.push(`${failed.length - 3} more stopped jobs are on your Today page.`);
  if (data.openLoops) loose.push(`${plural(data.openLoops, "open loop")} on your Today page.`);
  if (data.alerts) loose.push(`${plural(data.alerts, "high alert")} on your Today page.`);
  for (const why of data.unread ?? []) loose.push(why);

  const needs = yours.length <= 3 ? yours : [...yours.slice(0, 2), `And ${yours.length - 2} more, listed under "Yours today" below.`];
  const brief = data.briefing && data.briefing.for_day === today && data.briefing.headline
    ? [`${String(data.briefing.headline).replace(/[.!?]?\s*$/, ".")} The full briefing is on your Today page: ${ORIGIN}/`]
    : [`Camille's briefing will be on your Today page by about 6:30: ${ORIGIN}/`];
  const laid = layoutEmail({
    who: "Simone",
    subject: yours.length ? `Your day: ${plural(yours.length, "thing")} for you` : "Your day: nothing needs you",
    happened: `Good morning. Here is your ${dayWords(today)}.`,
    needs,
    sections: [
      ...(yours.length > 3 ? [{ title: "Yours today", items: yours }] : []),
      { title: "Porch & Party: To do for Valerie", note: val ? `From the Porch & Party site at ${timeOf(now)}. Valerie gets her own copy at 7 am.` : null, boxed: true, items: val ?? [], empty: val ? "All clear for Valerie today." : `I could not read the Porch & Party site this morning (${data.feedError ?? "no answer"}).` },
      { title: "What the team is doing (nothing needed from you)", items: team, empty: "Nobody has anything open right now." },
      { title: "Loose ends", items: loose, empty: "None." },
      { title: "This morning's briefing", items: brief },
    ],
    footer: 'Reply to this email to change anything — for example "move the KDP item to Monday".',
    refs: [`yd_${today.replace(/-/g, "")}`],
  });
  return laid;
}

/** Your week (Mondays). */
export function buildWeek(data, now = Date.now()) {
  const today = dayOf(now);
  const end = addDays(today, 6);
  const deadlines = [];
  for (const t of data.tasks ?? []) {
    const due = typeof t.due === "string" ? t.due.slice(0, 10) : null;
    if (due && due >= today && due <= end && OPEN.has(t.status)) deadlines.push(`${shortDay(due)}: ${t.title}${t.employee_name ? ` (${t.employee_name})` : ""}.`);
  }
  // What Boss OS is waiting on her word for: Inbox decisions, Danielle's plans and previews, held work.
  const replies = [...changesWaiting(data.repoChanges)];
  for (const a of data.approvals ?? []) replies.push(`Decide: ${a.title} — it is in your Inbox.`);
  for (const t of (data.tasks ?? []).filter((x) => x.status === "awaiting_approval")) replies.push(`Approve or change: ${t.title}${t.employee_name ? ` (${t.employee_name})` : ""}.`);

  const calendar = [];
  let clear = [];
  const flush = () => { if (clear.length) calendar.push(`${clear.join(", ")} — clear.`); clear = []; };
  for (let i = 0; i < 7; i += 1) {
    const iso = addDays(today, i);
    const calls = callsOn(data.diary, iso);
    if (!calls.length) { clear.push(shortDay(iso)); continue; }
    flush();
    calendar.push(`${shortDay(iso)} — ${calls.map((c) => `${c.title} at ${timeOf(c.scheduled_at)}`).join("; ")}.`);
  }
  flush();

  const val = valerieItems(data.feed, { week: true });
  const team = teamLines(data.roster, data.tasks, data.repoChanges, { week: true });

  const needs = [...deadlines, ...replies];
  return layoutEmail({
    who: "Simone",
    subject: `Your week: ${dayWords(today, { weekday: false })} to ${dayWords(end, { weekday: false })}`,
    happened: `Here is your week, ${dayWords(today)} to ${dayWords(end)}.`,
    needs: needs.length <= 3 ? needs : [...needs.slice(0, 2), `And ${needs.length - 2} more, listed below.`],
    sections: [
      { title: "Deadlines", items: deadlines, empty: "No deadlines this week." },
      { title: "Your calendar", items: data.diary ? calendar : [], empty: data.diary ? "Nothing on your calendar this week." : "I could not read your calendar this morning." },
      { title: "Replies waiting on you", items: replies, empty: "Nothing is waiting on your reply." },
      { title: "Porch & Party: Valerie's week", note: val ? "From the Porch & Party site. Valerie gets her own \"Your week\" at 7 am." : null, boxed: true, items: val ?? [], empty: val ? "Nothing booked for Valerie this week." : `I could not read the Porch & Party site this morning (${data.feedError ?? "no answer"}).` },
      { title: "What the team is doing this week", items: team, empty: "Nobody has anything open right now." },
    ],
    footer: "Reply to this email to move or drop anything. Your daily list still comes each morning.",
    refs: [`yd_${today.replace(/-/g, "")}w`],
  });
}

/**
 * What her reply carries to Simone's task. Her reply's task runs on a model, so the calendar lines
 * (meeting titles and the people in them, read from every calendar she has) stay out of it: the
 * "Your calendar" section and the call lines under "Yours today" are dropped. Everything else in
 * the email is Boss OS's own rows and Valerie's list.
 */
export function replyContext(text) {
  const out = [];
  let skipping = false;
  for (const line of String(text).split("\n")) {
    if (/^Your calendar$/.test(line)) { skipping = true; continue; }
    if (skipping && line === "") { skipping = false; continue; }
    if (skipping) continue;
    if (/^- \d{1,2}(:\d\d)? (am|pm): /.test(line) || /^- (Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.* — .* at \d/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

// ─── Reading ───────────────────────────────────────────────────────────────────

async function read() {
  if (!process.env.BOSS_PASSCODE) throw new Error("NAMED STOP [NO_PASSCODE] run through the vault: npm run your-day");
  const u = await fetch(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
  if (!u.ok) throw new Error(`NAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${u.status})`);
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const get = async (p) => { const r = await fetch(`${ORIGIN}/api/boss${p}`, { headers: { cookie } }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return (await r.json()).data; };
  const [today, diary, tasks, approvals, rc] = await Promise.all([get("/today"), get("/diary"), get("/tasks"), get("/approvals"), get("/repo-changes")]);
  const block = (k) => today.blocks.find((b) => b.key === k)?.content ?? null;
  const roster = block("employee_status")?.roster ?? [];
  const alerts = (block("critical_alerts")?.alerts ?? []).filter((a) => a.severity === "high").length;
  const openLoops = Number(block("open_loops")?.total ?? 0);
  const briefing = block("executive_briefing");
  const withDue = tasks.map((t) => { let input = {}; try { input = typeof t.input === "string" ? JSON.parse(t.input) : (t.input ?? {}); } catch { input = {}; } return { ...t, due: input?.due ?? null }; });
  const feedOf = async (range) => {
    if (!process.env.PNP_OWNER_FEED_TOKEN) return { feed: null, error: "the feed key is not in the vault" };
    const r = await fetch(`${FEED}?range=${range}`, { headers: { authorization: `Bearer ${process.env.PNP_OWNER_FEED_TOKEN}` } }).catch((e) => ({ ok: false, status: String(e?.message ?? e) }));
    return r.ok ? { feed: await r.json() } : { feed: null, error: `the site answered ${r.status}` };
  };
  return {
    base: { diary: diary?.rows ?? null, tasks: withDue, approvals, repoChanges: rc?.items ?? [], roster, alerts, openLoops, briefing },
    feedOf,
  };
}

async function main() {
  const DRY = process.argv.includes("--dry-run");
  const pi = process.argv.indexOf("--preview");
  const PREVIEW = pi === -1 ? null : process.argv[pi + 1];
  const FORCE = process.argv.includes("--force");
  const now = Date.now();
  const today = dayOf(now);
  // `--week` shows the Monday email on any day, for a preview or dry run only.
  const monday = parts(now).weekday === "Monday" || ((DRY || PREVIEW) && process.argv.includes("--week"));
  const marker = path.join(SENT_DIR, `sent-${today}`);
  if (!DRY && !PREVIEW && !FORCE && fs.existsSync(marker)) { console.log(`your-day: already sent for ${today}`); return; }

  const { base, feedOf } = await read();
  const emails = [];
  if (monday) { const w = await feedOf("week"); emails.push(buildWeek({ ...base, feed: w.feed, feedError: w.error }, now)); }
  const d = await feedOf("day");
  emails.push(buildDay({ ...base, feed: d.feed, feedError: d.error }, now));

  if (PREVIEW) {
    fs.mkdirSync(PREVIEW, { recursive: true });
    emails.forEach((e, i) => { fs.writeFileSync(path.join(PREVIEW, `your-${i === 0 && monday ? "week" : "day"}.html`), e.html); fs.writeFileSync(path.join(PREVIEW, `your-${i === 0 && monday ? "week" : "day"}.txt`), `${e.subject}\n\n${e.text}`); });
    console.log(`your-day: wrote ${emails.length} preview(s) to ${PREVIEW}`);
    return;
  }
  if (DRY) { for (const e of emails) console.log(`--- ${e.subject}\n${e.text}\n`); return; }

  for (const e of emails) {
    const r = await sendAsEmployee("Simone", { to: process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com", subject: e.subject, text: e.text, prelaid: e, context: replyContext(e.text) });
    if (!r.ok) { console.error(`NAMED STOP [SEND_REFUSED] "${e.subject}" was not sent: ${r.error}`); process.exit(9); }
    console.log(`your-day: sent "${e.subject}" from ${r.from}`);
  }
  fs.mkdirSync(SENT_DIR, { recursive: true });
  fs.writeFileSync(marker, new Date(now).toISOString());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
}
