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
export function morningSection(loops, today, { origin, names = {} } = {}) {
  const { shown } = visibleLoops(loops);
  const overdue = sortLoops(shown.filter((l) => isOverdue(l, today)), today);
  const url = `${origin ?? ""}${PAGE_PATH}`;
  const title = `Open loops: ${shown.length}${overdue.length ? `, ${overdue.length} overdue` : ", none overdue"}`;
  const lines = overdue.map((l) => ({
    text: `${l.title}: ${l.next_step ? `${l.next_step} ` : ""}(${ownerWords(l.owner, names)}, due ${dayWords(l.next_date)}). Did this happen?`,
    links: [{ label: "Open ›", url: `${url}&loop=${encodeURIComponent(l.id)}` }],
  }));
  return { title, lines, link: { label: "See every open loop →", url } };
}

/**
 * THE REPAIRS: a row the team owns (an employee, Claude or Codex) more than REPAIR_AFTER_DAYS past its
 * date opens ONE repair task per date (`repair_for` keeps the date it was opened for; moving the date
 * and missing again opens a new one). Her own rows are only ever in the email. Pure.
 */
export function repairsDue(loops, today) {
  return (loops ?? []).filter((l) =>
    l.owner !== HER && isOverdue(l, today) && daysBetween(l.next_date, today) > REPAIR_AFTER_DAYS && l.repair_for !== l.next_date);
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
