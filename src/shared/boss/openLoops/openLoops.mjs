/**
 * OPEN LOOPS — THE PURE PARTS (owner ruling, 1 Nov 2026: "Open Loops is the one list of everything
 * approved but not finished"). Shared by the Worker (routes/openLoops.ts, the daily chase) and the
 * page (pages/OpenLoops.tsx), so what "overdue", "hidden behind a step" and "the morning line" mean is
 * one rule in one place. No node imports: the Worker and the client bundle this file.
 *
 *   Not finished: every row has a finish line in plain words, a next step, an owner and a next date.
 *                 Her rows show only once the step before them (`blocked_by`) is closed.
 *   Parked ideas: no dates, no chasing.
 *   A row closes only on the real outcome ("live, selling, in store"), never on "PR merged".
 */

export const SECTIONS = Object.freeze(["not_finished", "parked"]);
export const SOURCES = Object.freeze(["manual", "named_stop", "agent_report"]);
export const OWNER_WORDS = Object.freeze(["claude", "codex", "sequoia"]);
export const HER = "sequoia";
/** A team-owned row this many days past its date opens one repair task (owner ruling, 1 Nov 2026). */
export const REPAIR_AFTER_DAYS = 3;
export const PAGE_PATH = "/?tab=loops";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMP_RE = /^emp_[a-z0-9_]{1,40}$/;

export const isOwner = (o) => OWNER_WORDS.includes(o) || EMP_RE.test(String(o ?? ""));
export const isDay = (d) => DAY_RE.test(String(d ?? "")) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

/** Whole days from `a` to `b` (YYYY-MM-DD). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** An open, not-finished row whose next date has passed (`today` is the Central day). Pure. */
export function isOverdue(loop, today) {
  return loop?.status === "open" && loop.section === "not_finished" && isDay(loop.next_date) && loop.next_date < today;
}

/**
 * THE MAIN LIST: open, not-finished rows, minus HER rows whose blocker is still open (owner: "her rows
 * show only once the step before them is done"). A team row waiting on a step still shows: the team
 * is chasing it. Returns `{ shown, waiting }` where `waiting` is the hidden count. Pure.
 */
export function visibleLoops(loops) {
  const byId = new Map((loops ?? []).map((l) => [l.id, l]));
  const blockerOpen = (l) => {
    const b = l.blocked_by ? byId.get(l.blocked_by) : null;
    return Boolean(b && b.status === "open");
  };
  const open = (loops ?? []).filter((l) => l.status === "open" && l.section === "not_finished");
  const hidden = open.filter((l) => l.owner === HER && blockerOpen(l));
  const hiddenIds = new Set(hidden.map((l) => l.id));
  return { shown: open.filter((l) => !hiddenIds.has(l.id)), waiting: hidden.length };
}

/** Overdue first (oldest date first), then by date, undated last. Pure. */
export function sortLoops(loops, today) {
  return [...(loops ?? [])].sort((a, b) => {
    const oa = isOverdue(a, today) ? 0 : 1;
    const ob = isOverdue(b, today) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const da = a.next_date ?? "9999-12-31";
    const db = b.next_date ?? "9999-12-31";
    return da < db ? -1 : da > db ? 1 : String(a.title).localeCompare(String(b.title));
  });
}

/** Group by business in the brains' order (`order` = slugs), unknown slugs last. Pure. */
export function groupLoops(loops, order, today) {
  const keys = [...order, ...[...new Set((loops ?? []).map((l) => l.business))].filter((k) => !order.includes(k))];
  return keys
    .map((key) => ({ key, rows: sortLoops((loops ?? []).filter((l) => l.business === key), today) }))
    .filter((g) => g.rows.length);
}

/** How a row's owner reads: an employee's first name, "Claude", "Codex", "You". Pure. */
export function ownerWords(owner, names = {}) {
  if (owner === HER) return "You";
  if (owner === "claude") return "Claude";
  if (owner === "codex") return "Codex";
  return names[owner] ?? "The team";
}

/** "Sun 1 Nov" from YYYY-MM-DD. Pure. */
export function dayWords(d) {
  if (!isDay(d)) return "";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
}

/**
 * THE MORNING SECTION (section "open_loops" in MORNING_SECTION_SPECS): a title with the counts and
 * one line per overdue row on the main list, each linking to the page. Rows hidden behind an open
 * step are neither counted nor chased. Written every morning, an empty list included, so a missing
 * copy means the writer did not run (rule 0). Pure.
 */
/*
 * ONLY HER OWN ROWS IN HER EMAIL (owner, 7 Nov 2026: the morning email listed 28 rows, mostly Claude's
 * own tasks asking her "Did this happen?"). Her overdue rows are one short list; the team's rows are
 * ONE count line to the Open Loops page. A row with no title is never drawn (it read "(Claude, due Fri
 * Nov 6). Did this happen?").
 */
export const MAX_HER_LINES = 5;

/**
 * IS THIS ROW TRULY HERS? (owner, 13 Nov 2026: "Codex stopped (Stopped:) on Tuesday queue job … Did
 * this happen?" was an alarm about the system's own work, in system words, filed under her name.)
 * A row is hers only when it is in her name AND is not about the system's own work: a stopped or
 * failed job, an agent, a queue, a Codex or Claude run, a usage limit, a stop code. Those are repairs,
 * which Boss OS or an employee can check itself. A repo's named stop is hers only when its name says a
 * key, account, payment or legal step she alone holds. What this cannot place is NOT hers: it stays
 * on the Open Loops page and off her email. Pure.
 */
const SYSTEM_TITLE = /\b(stopped|failed|failing|fails|crashed|timed out|stuck|did not run|not running|queue|queued|agents?|codex|claude|retr(?:y|ies|ying)|alarm|named stop|usage limit|weekly limit|rate limit)\b|\[[A-Z][A-Z0-9_]{3,}\]/i;
export function systemRow(loop) {
  if (SYSTEM_TITLE.test(String(loop?.title ?? ""))) return true;
  const stop = String(loop?.source_key ?? "").split("#")[1] ?? "";
  return Boolean(loop?.source_key) && !HER_STOP.test(stop.toUpperCase());
}
export const trulyHers = (loop) => loop?.owner === HER && Boolean(String(loop?.title ?? "").trim()) && !systemRow(loop);

/** The words two rows share when they are the same loop: the title, case and spacing aside. Pure. */
export const loopKey = (title) => String(title ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * ONE ROW PER LOOP, HERS ONLY, FIVE AT MOST (owner, 13 Nov 2026: one stopped job, posted every few
 * hours, filled the whole list with the same line). Rows with the same title are one line (the
 * oldest date). No "+N more" and no team count: the page has the rest. Each line carries `key`, so
 * the email can stop repeating it (morningMemory.mjs `withinShowings`).
 */
export function morningSection(loops, today, { origin, names: _names = {} } = {}) {
  const { shown } = visibleLoops(loops);
  const seen = new Set();
  const mine = sortLoops(shown.filter(trulyHers), today)
    .filter((l) => { const k = loopKey(l.title); if (seen.has(k)) return false; seen.add(k); return true; });
  const overdue = mine.filter((l) => isOverdue(l, today));
  const url = `${origin ?? ""}${PAGE_PATH}`;
  const title = `Your open loops: ${mine.length}${overdue.length ? `, ${overdue.length} overdue` : ", none overdue"}`;
  const lines = overdue.slice(0, MAX_HER_LINES).map((l) => ({
    key: loopKey(l.title),
    text: `${String(l.title).trim()} (due ${dayWords(l.next_date)}). Did this happen?`,
    links: [{ label: "Open ›", url: `${url}&loop=${encodeURIComponent(l.id)}` }],
  }));
  return { title, lines, link: { label: "See every open loop →", url } };
}

/**
 * THE REPAIRS: a row the team owns (an employee, Claude or Codex) more than REPAIR_AFTER_DAYS past its
 * date opens ONE repair task per date (`repair_for` keeps the date it was opened for; moving the date
 * and missing again opens a new one), only for a row Danielle can do (`overdueRoute`). Pure.
 */
export function repairsDue(loops, today) {
  return (loops ?? []).filter((l) =>
    overdueRoute(l) === "danielle" && isOverdue(l, today) && daysBetween(l.next_date, today) > REPAIR_AFTER_DAYS && l.repair_for !== l.next_date);
}

/**
 * ─── AN OVERDUE LOOP: DANIELLE DOES IT, OR IT STOPS AND REMINDS HER (owner, 2 Nov 2026) ────────
 *
 * "Over due open loops should be reminder emails to me and nothing else. Well if Danielle can do it
 * she should but if not stop and remind me". One reader decides, from what the row carries:
 *   her   — her own row; a named stop whose name says a key, account, sign-in, payment, legal step or
 *           an LP/investor (e.g. PLAY_ACCOUNT_MISSING, X_KEY_MISSING, LP_*); or words in the row that
 *           need her hand (her account or sign-in, an ID check, money, legal, her decision, an investor
 *           reply, Google Ads, Blogger, WordPress). No Danielle job — a reminder email.
 *   danielle — a team-owned row with a written next step and none of the above: a silent repair.
 * Anything it cannot place (no next step written) is hers: fail closed, never a Danielle job.
 */
const HER_STOP = /(^|_)(ACCOUNT|KEY|SECRET|TOKEN|LOGIN|SIGN_?IN|OAUTH|PAYMENT|BILLING|PURCHASE|LEGAL|OWNER|IDENTITY|ID_CHECK|VERIFY)(_|$)|^LP_|_LP_|INVESTOR/;
const HER_WORDS = /\b(her (own )?(account|sign-?in|login|key|card|decision|call|ok|approval)|sign(s|ed)? in|log(s|ged)? in|signs? up|identity|id (check|verification)|verify (her|the owner)|pays?|payment|purchase|buy|checkout|subscription|billing|legal|lawyer|contract|sign(s|ed)? the|her (yes|word)|she (decides|picks|chooses|approves)|investor|lp replies|\blps?\b|google ads|blogger|wordpress|play (console )?id)\b/i;
export function overdueRoute(loop) {
  if (!loop || loop.owner === HER || !isOwner(loop.owner)) return "her";
  const stop = String(loop.source_key ?? "").split("#")[1] ?? "";
  if (stop && HER_STOP.test(stop.toUpperCase())) return "her";
  if (HER_WORDS.test(`${loop.title ?? ""} ${loop.next_step ?? ""} ${loop.finish_line ?? ""}`)) return "her";
  if (!String(loop.next_step ?? "").trim()) return "her";
  return "danielle";
}

/** Reminders: on the first day late, then every REMIND_EVERY_DAYS, at most REMIND_MAX per date. */
export const REMIND_EVERY_DAYS = 3;
export const REMIND_MAX = 3;

/** The reminders due today, each with its one-per-slot key `<next_date>#<n>`. Pure. */
export function remindersDue(loops, today) {
  const out = [];
  for (const l of loops ?? []) {
    if (overdueRoute(l) !== "her" || !isOverdue(l, today) || !l.next_date) continue;
    const late = daysBetween(l.next_date, today);
    if (late < 1) continue;
    const n = Math.floor((late - 1) / REMIND_EVERY_DAYS);
    if (n >= REMIND_MAX || (late - 1) % REMIND_EVERY_DAYS !== 0) continue;
    out.push({ loop: l, slot: `${l.next_date}#${n + 1}`, nth: n + 1, late });
  }
  return out;
}

/** The reminder email in three parts (R7): what is waiting, why it is hers, the step that clears it. Pure. */
export function reminderEmail(loop, { origin, late, nth, names = {} }) {
  const stop = String(loop.source_key ?? "").split("#")[1] ?? "";
  const why = loop.owner === HER
    ? "It is yours on the list."
    : stop ? `It needs something only you hold (${stop.toLowerCase().replace(/_/g, " ")}), so nobody on the team can finish it for you.`
    : "It needs your account, your sign-in, money or your decision, so the team stopped instead of guessing.";
  const step = loop.next_step ? String(loop.next_step).trim() : "Do the next step, or tell Boss OS what it is.";
  const url = `${origin}${PAGE_PATH}&loop=${encodeURIComponent(loop.id)}`;
  return {
    subject: `Reminder: ${String(loop.title).slice(0, 120)}`,
    body: [
      `What is waiting: ${loop.title}. It was due ${dayWords(loop.next_date)} and is ${late} day${late === 1 ? "" : "s"} late. Finish line: ${loop.finish_line}.`,
      `Why it is yours: ${why}`,
      `What clears it: ${step} Then mark it done or give it a new date on Open Loops: ${url}`,
      "",
      nth >= REMIND_MAX ? "This is the last reminder for this date; it stays on Open Loops and in your morning email." : `Reminder ${nth} of ${REMIND_MAX}; the next is in ${REMIND_EVERY_DAYS} days if it is still open.`,
    ].join("\n"),
  };
}

/** What is wrong with a row as sent, by name. `partial` = an update (only the fields sent are checked). Pure. */
export function loopProblems(b, { partial = false, slugs = [] } = {}) {
  const p = [];
  const has = (k) => b && Object.prototype.hasOwnProperty.call(b, k);
  const need = (k) => !partial || has(k);
  if (!b || typeof b !== "object") return ["not an object"];
  if (need("title") && !(typeof b.title === "string" && b.title.trim() && b.title.length <= 200)) p.push("title is the row's name, up to 200 characters");
  if (need("finish_line") && !(typeof b.finish_line === "string" && b.finish_line.trim() && b.finish_line.length <= 300)) p.push("finish_line is the real outcome in plain words");
  if (has("next_step") && b.next_step != null && !(typeof b.next_step === "string" && b.next_step.length <= 400)) p.push("next_step is one plain sentence");
  if (need("owner") && !isOwner(b.owner)) p.push('owner is an employee id, "claude", "codex" or "sequoia"');
  if (need("business") && !slugs.includes(b.business)) p.push(`business is a brain: ${slugs.join(", ")}`);
  if (has("section") && !SECTIONS.includes(b.section)) p.push('section is "not_finished" or "parked"');
  if (has("next_date") && b.next_date != null && b.next_date !== "" && !isDay(b.next_date)) p.push("next_date is YYYY-MM-DD");
  if (has("source") && !SOURCES.includes(b.source)) p.push(`source is one of ${SOURCES.join(", ")}`);
  return p;
}

/** The intake's key for a repo's named stop: "owner/repo#STOP_NAME". Pure. */
export function sourceKeyOf(repo, stop) {
  const r = String(repo ?? "").trim();
  const s = String(stop ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)) return null;
  if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(s)) return null;
  return `${r}#${s}`;
}
