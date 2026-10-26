/**
 * ZORA'S WAITING-ON REGISTER — the pure rules (owner-approved 26 Oct 2026: nothing that waits goes
 * unowned). The table is `waiting_on` (migration 0313); Zora's daily run is scripts/ops/waiting-on.mjs.
 */
export const HER = "sequoia";

/** Today, in her zone, as YYYY-MM-DD. */
export const ctDay = (at = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(at));

/**
 * What Zora does today (pure). `act`: open items due today or earlier that carry an owner and an
 * action (the action is opened as a task for the owner). `repair`: an open item with no owner, or
 * with a passed date and no action to take: a repair for Danielle, never a Decide for her.
 */
export function zoraPass(items, now = Date.now()) {
  const today = ctDay(now);
  const act = [];
  const repair = [];
  for (const i of items ?? []) {
    if (i.state !== "open" || i.kind === "her_todo") continue;
    if (!i.owner) { repair.push({ item: i, why: "it has no owner" }); continue; }
    if (i.due_on && i.due_on <= today) {
      if (i.action) act.push(i);
      else repair.push({ item: i, why: `its date (${i.due_on}) has passed and nothing is set to happen` });
    }
  }
  return { act, repair };
}

/**
 * Her own to-dos for Simone's "Yours this week" (pure): an item is mentioned the first time, then
 * only on Mondays or when its date is two days away or less. Never every day.
 */
export function yoursThisWeek(items, now = Date.now()) {
  const today = ctDay(now);
  const monday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
  const soon = (d) => d && (Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000 <= 2;
  return (items ?? []).filter((i) => i.kind === "her_todo" && i.state === "open" && (!i.told_at || monday || soon(i.due_on)));
}

/**
 * Her reply editing her list (pure): "add to my list: X", "done: X", "remove X". A "done" only
 * counts when it names something on her list (the caller matches it); otherwise the email is untouched.
 * `{ add: string[], done: string[] }`.
 */
export function todoEditsIn(text) {
  const add = [];
  const done = [];
  for (const raw of String(text ?? "").split(/\n/)) {
    const line = raw.replace(/^>.*$/, "").trim();
    if (!line) continue;
    // Only the explicit form: "add to my list: X" (a bare "add:" in an ordinary email is not hers to lose).
    let m = /^(?:please\s+)?add\s+to\s+(?:my\s+list|yours\s+this\s+week|my\s+to-?dos?)\s*[:\-–]\s*(.{3,200})$/i.exec(line);
    if (m) { add.push(m[1].trim().replace(/[.]+$/, "")); continue; }
    m = /^(?:done|remove|drop|finished)\s*[:\-–]?\s*(.{3,200}?)(?:\s+from\s+my\s+list)?[.]?$/i.exec(line);
    if (m) done.push(m[1].trim());
  }
  return { add, done };
}

/** The open her_todo that an edit names: the first whose words contain the edit's words. */
export function matchTodo(items, words) {
  const w = String(words ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((x) => x.length > 2);
  return (items ?? []).find((i) => i.kind === "her_todo" && i.state === "open" && w.length && w.every((x) => String(i.what).toLowerCase().includes(x))) ?? null;
}
