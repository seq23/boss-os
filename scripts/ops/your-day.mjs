#!/usr/bin/env node
/**
 * SIMONE'S ONE MORNING EMAIL (owner, 22 Oct 2026; reshaped 23 Oct 2026, rule 1 of the email fix).
 *
 * Her ruling: "ONE morning email from Simone (06:40)", in this order:
 *
 *   1. Decide — at most three things only she can decide, each with one-tap buttons: her Inbox
 *      decisions, Danielle's plans and previews, work held for her word, and every Decide item the
 *      other producers wrote (an intro to approve, an LP reply to send) — highest priority first;
 *   2. New deals since yesterday (the grid rows Monique's deal reader wrote) and "Monique found";
 *   3. Camille's briefing in five lines or fewer, with the link to the whole thing;
 *   4. Done for you — three lines at most (bounced addresses replaced, prospecting, the tail on the
 *      jobs she emailed, Zora's and Toni's quiet work);
 *   5. Catch up with — 0–3, only when a live reason exists (rule 14);
 *   6. Porch & Party: To do for Valerie — the site's own owner feed, unchanged;
 *   7. the sign-off, then "8Raise: Monique used N of her 75 credits this month (30 always kept for you)".
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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sendAsEmployee } from "./notify.mjs";
import { layoutEmail, clockWords, lineProblems } from "../../src/shared/boss/mail/plain.mjs";
import { readMorningSections, clearToldSections } from "../../src/shared/boss/mail/morning.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const FEED = process.env.PNP_OWNER_FEED_URL ?? "https://porchandparty901.com/api/owner-feed";
const TZ = "America/Chicago";
const SENT_DIR = path.join(os.homedir(), ".boss-os", "your-day");
const DAY_MS = 86_400_000;
const OPEN_BOSS = { label: "Open Boss OS", url: `${ORIGIN}/` };

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

/** Boss OS's own decisions for her: Inbox approvals, Danielle's plans and previews, held work. */
function bossDecisions(data) {
  const out = [];
  for (const a of data.approvals ?? []) out.push({ title: a.title, body: "It is waiting in your Inbox.", buttons: [{ label: "Open your Inbox", url: `${ORIGIN}/` }], priority: 2 });
  for (const r of (data.repoChanges ?? []).filter((x) => x.phase === "asking" || x.phase === "previewing")) {
    out.push(r.phase === "asking"
      ? { title: `Start Danielle's plan for ${r.repo ?? "your change"}?`, body: "Reply approved to her email to start the build.", buttons: [OPEN_BOSS], priority: 1 }
      : { title: `Make Danielle's preview of ${r.repo ?? "your change"} live?`, body: "Look at the preview, then reply approved to her email.", buttons: [OPEN_BOSS], priority: 1 });
  }
  for (const t of (data.tasks ?? []).filter((x) => x.status === "awaiting_approval")) {
    out.push({ title: `Approve or change: ${t.title}`, body: t.employee_name ? `${t.employee_name} is holding it for your word.` : "", buttons: [OPEN_BOSS], priority: 1 });
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

/**
 * CAMILLE'S BRIEFING IN FIVE LINES OR FEWER, from the report's One-Minute Executive Summary section
 * (key `one_minute_summary`, or its heading on older reports); the report's `summary` sentences when
 * the section is absent. `null` when today's report has not landed.
 */
export function briefingLines(briefing, today) {
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
  return raw.map((l) => String(l).replace(/^[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 5).map((l) => l.replace(/[.!?]?\s*$/, "."));
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

const lineOf = (l) => (typeof l === "string" ? l : l);

/** The one "done" line for the bounce agent (rule 4), from GET /outreach/bounce-fixes. */
export function bounceLine(b) {
  if (!b || !(b.replaced || b.dropped || b.restarted?.length)) return null;
  const bits = [];
  if (b.replaced) bits.push(`Replaced ${plural(b.replaced, "outreach address", "outreach addresses")} that bounced with working ones from each company's own site`);
  if (b.dropped) bits.push(`${b.replaced ? "removed" : "Removed"} ${plural(b.dropped, "bounced address", "bounced addresses")} for good (no working address was published)`);
  if (b.restarted?.length) bits.push(`${bits.length ? "outreach restarted" : "Outreach restarted"} (${b.restarted.join(", ")})`);
  return `${bits.join("; ")}.`;
}

const DONE_SOURCES = ["bounces", "lp", "prospects", "tail", "notices", "risk", "archive"];

/** The one morning email. `data` is everything read; `data.morning` the section files by name. */
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
      decide: (sec.decide ?? []).filter((d, i) => passes(`${name} decide ${i + 1}`, d.title, d.body, ...(d.buttons ?? []).map((b) => b.label))),
      rows: (sec.rows ?? []).filter((r, i) => passes(`${name} row ${i + 1}`, r.company, r.side, r.size, r.price, r.from)),
      lines: (sec.lines ?? []).filter((l, i) => passes(`${name} line ${i + 1}`, typeof l === "string" ? l : l.text)),
    };
  }

  // 1. Decide: Boss OS's own, then every producer's (catch-ups have their own section).
  const decide = [...bossDecisions(data)];
  for (const [name, sec] of Object.entries(m)) if (name !== "catchups") for (const d of sec.decide ?? []) decide.push({ priority: 0, ...d });
  decide.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // 2. Deals and Monique found.
  const deals = m.deals?.rows ?? [];
  const dealRows = deals.map((r) => ({
    company: r.company, side: r.side ?? "—", size: [r.size, r.price ? `@ ${r.price}` : ""].filter(Boolean).join(" ") || "—",
    from: r.tag === "Rainmaker" ? "Rainmaker" : (r.from ?? "—"), url: r.url ?? null, url_label: "Open the email",
  }));
  const found = (m.monique_found?.lines ?? []).map(lineOf);

  // 3. Briefing.
  const brief = briefingLines(data.briefing, today);

  // 4. Done for you: the bounce agent's line first, then each producer's lines.
  const done = [];
  const bl = bounceLine(data.bounceFixes);
  if (bl) done.push(bl);
  for (const name of DONE_SOURCES) for (const l of m[name]?.lines ?? []) done.push(lineOf(l));
  const doneShown = done.slice(0, 3);
  if (done.length > 3) doneShown.push(`And ${done.length - 3} more on your Today page.`);

  // 5. Catch up with.
  const catchCards = m.catchups?.decide ?? [];
  const catchLines = (m.catchups?.lines ?? []).map(lineOf);

  // Mondays: this week's deadlines, in the same email.
  const deadlines = [];
  if (monday) {
    const end = addDays(today, 6);
    for (const t of data.tasks ?? []) {
      const due = typeof t.due === "string" ? t.due.slice(0, 10) : null;
      if (due && due >= today && due <= end && OPEN.has(t.status)) deadlines.push(`${shortDay(due)}: ${t.title}${t.employee_name ? ` (${t.employee_name})` : ""}.`);
    }
  }

  const val = valerieItems(data.feed);
  const calls = callsOn(data.diary, today).map((c) => `${timeOf(c.scheduled_at)} ${c.title}${c.with ? ` with ${c.with}` : ""}`);
  const credits = m.eightraise?.credits;

  const subjBits = [];
  if (decide.length) subjBits.push(plural(decide.length, "decision"));
  if (dealRows.length) subjBits.push(plural(dealRows.length, "new deal"));
  if (val?.length) subjBits.push("Valerie's list");

  const laid = layoutEmail({
    who: "Simone",
    subject: `${p.weekday}: ${subjBits.length ? subjBits.join(", ") : "nothing to decide"}`,
    happened: `Good morning. Here is your ${dayWords(today)}.${calls.length ? ` On your calendar: ${calls.join("; ")}.` : ""}`,
    decide,
    moreDecide: decide.length > 3 ? `And ${decide.length - 3} more on your Today page.` : null,
    sections: [
      { title: `New deals since yesterday (${dealRows.length})`, rows: dealRows.length ? { columns: [{ key: "company", label: "Company" }, { key: "side", label: "Side" }, { key: "size", label: "Size" }, { key: "from", label: "From" }], data: dealRows } : null, link: m.deals?.link ?? null, empty: m.deals ? "No new deals since yesterday." : null },
      { title: "Monique found", items: found, link: m.monique_found?.link ?? null, empty: null },
      { title: "This morning's briefing (Camille)", items: brief ?? ["Briefing late — it will be on your Today page."], link: { label: "Read the full briefing", url: `${ORIGIN}/` } },
      { title: "Done for you", tone: "done", items: doneShown, empty: null },
      { title: "Catch up with", cards: catchCards, items: catchLines, empty: null },
      ...(monday ? [{ title: "This week", items: deadlines, empty: "No deadlines this week." }] : []),
      { title: "Porch & Party: To do for Valerie", note: val ? `From the Porch & Party site at ${timeOf(now)}. Valerie gets her own copy at 7 am.` : null, boxed: true, items: val ?? [], empty: val ? "All clear for Valerie today." : "Valerie's list did not load this morning; the team is fixing it and Valerie still gets her own copy at 7 am." },
    ],
    footer: 'Reply to change anything, for example "move the intro to Monday".',
    postscript: credits ? `8Raise: Monique used ${credits.used} of her ${credits.budget ?? 75} credits this month (${credits.kept ?? 30} always kept for you)` : null,
    refs: [`yd_${today.replace(/-/g, "")}`],
  });
  return { ...laid, dropped };
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
  const { sections, skipped } = readMorningSections({ now });
  for (const s of skipped) console.error(`your-day: morning section skipped — ${s}`);
  return { diary: diary?.rows ?? null, tasks: withDue, approvals, repoChanges: rc?.items ?? [], briefing: briefingOf(today), bounceFixes, morning: sections };
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

/** The morning sections this email told her once and clears after it goes (producers that append). */
const TOLD_ONCE = ["tail", "risk", "archive", "notices"];

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
    fs.writeFileSync(path.join(PREVIEW, "your-day.html"), email.html);
    fs.writeFileSync(path.join(PREVIEW, "your-day.txt"), `${email.subject}\n\n${email.text}`);
    console.log(`your-day: wrote the preview to ${PREVIEW}${email.problems.length ? ` — it would be HELD: ${email.problems.join("; ")}` : ""}`);
    return;
  }
  if (DRY) { console.log(`--- ${email.subject}\n${email.text}\n${email.problems.length ? `HELD: ${email.problems.join("; ")}` : ""}`); return; }

  if (decision === "send_late") await fixJob(api, "Camille's briefing was late for the morning email", `today's executive report had not landed by 07:45 Central, so Simone's morning email (scripts/ops/your-day.mjs) went without it. Find why the briefing duty ran late and fix it at source.`);
  if (email.dropped.length) await fixJob(api, "A morning-email section wrote a line that is not plain", `Simone's morning email dropped these lines because they failed the plain-email check (src/shared/boss/mail/plain.mjs lineProblems): ${email.dropped.join(" | ")}. Fix the producer that wrote them (~/.boss-os/morning/<section>.json, src/shared/boss/mail/morning.mjs).`);
  if (d.error) await fixJob(api, "Valerie's list did not load for the morning email", `the Porch & Party owner feed answered: ${d.error}. Simone's morning email said so in one line. Fix the read (PNP_OWNER_FEED_TOKEN, ${FEED}).`);

  const r = await sendAsEmployee("Simone", { to: process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com", subject: email.subject, text: email.text, prelaid: email, context: replyContext(email.text) });
  if (!r.ok) { console.error(`NAMED STOP [SEND_REFUSED] "${email.subject}" was not sent: ${r.error}`); process.exit(9); }
  console.log(`your-day: sent "${email.subject}" from ${r.from}`);
  clearToldSections(TOLD_ONCE);
  fs.mkdirSync(SENT_DIR, { recursive: true });
  fs.writeFileSync(marker, new Date(now).toISOString());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
}
