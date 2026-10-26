/**
 * WHAT SIMONE'S MORNING EMAIL ALREADY TOLD HER, SO IT IS NEVER TOLD AT FULL LENGTH TWICE (26 Oct 2026).
 *
 * Three rulings, one mechanism (a small memory of keys and the day each was first shown):
 *
 *   · A DECIDE ITEM SHE HAS ALREADY SEEN is one thin line on later days — "kenneth goodwin should be
 *     a thin line not taking up much space after the first time". Name, days waiting, one link; kept
 *     in the list (she said don't dismiss it), and never counted as a fresh decision in the subject.
 *   · DONE FOR YOU — "no need to repeat ever and do not use a lot of space i wont focus on that as
 *     much". An item shows once, the first morning after it happened; never twice in one email
 *     (deduped by family: three failures of one job are one line); one short plain line each, at
 *     most three, then "+N more on Today ›". No What happened / What we did / Status blocks here.
 *   · ONE FIX JOB PER FAILED JOB FAMILY. Camille's report failed twice on 25 Oct and Danielle got two
 *     repairs (then a third), each of which stopped and emailed her. A family that already has a
 *     live repair is not opened again.
 *
 * Pure functions; `scripts/ops/your-day.mjs` keeps the memory file. Pinned by tests/morningMemory.test.ts.
 */

const DAY_MS = 86_400_000;

/** "Find why "Find why "X" failed" failed" → "X". The job a failure belongs to, however nested. */
export function jobFamily(title) {
  let t = String(title ?? "").trim();
  for (let i = 0; i < 5; i++) {
    const m = /^Find why "(.+)" failed$/.exec(t);
    if (!m) break;
    t = m[1].trim();
  }
  return t;
}

/** The first whole sentence of a line, never cut mid-word or mid-sentence. */
export function firstSentence(text) {
  let t = String(text ?? "").replace(/\s+/g, " ").trim();
  const happened = /^What happened:\s*(.*?)(?:\s*What we did:.*)?$/i.exec(t);
  if (happened) t = happened[1].trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return (m ? m[1] : t).trim();
}

/** One short Done-for-you line for a failed task. */
export function failedDoneLine(task) {
  const who = task?.employee_name ? `${task.employee_name}'s` : "A";
  return `${who} "${jobFamily(task?.title)}" job stopped; Danielle is fixing it.`;
}

/**
 * DONE FOR YOU: items `{ key, text, links? }` → `{ shown, more, keys }`. `told` holds keys shown on an
 * earlier morning; those never show again. Duplicates by key show once. `keys` is what to remember.
 */
export function doneForYou(items, { told = new Set(), max = 3 } = {}) {
  const seen = new Set();
  const fresh = [];
  for (const it of items ?? []) {
    const key = String(it.key ?? firstSentence(it.text)).toLowerCase();
    if (told.has(key) || seen.has(key)) continue;
    seen.add(key);
    fresh.push({ ...it, key, full: it.full ?? it.text, text: firstSentence(it.text) });
  }
  return { shown: fresh.slice(0, max), more: Math.max(0, fresh.length - max), keys: fresh.map((f) => f.key), all: fresh };
}

/** The short label for a Decide item: "Waiting 12 days: Answer Kenneth Goodwin: they wrote…" → "Kenneth Goodwin (LP)". */
export function decideLabel(d) {
  let t = String(d?.title ?? "").replace(/^Waiting \d+ days?:\s*/i, "");
  const answer = /^(?:Answer|Reply to)\s+([^:—]+?)(?:\s*[:—]|$)/i.exec(t);
  if (answer) t = answer[1];
  else t = t.split(/\s*[:—]\s*/)[0];
  t = t.trim();
  if (t.length > 48) t = t.slice(0, 48).replace(/\s+\S*$/, "");
  return /^lp/i.test(String(d?.key ?? "")) && answer ? `${t} (LP)` : t;
}

/** Days she has been waiting on this one: the title's own count, else since it was first shown. */
export function daysWaiting(d, firstShown, now) {
  const own = /Waiting (\d+) days?/i.exec(String(d?.title ?? ""));
  if (own) return Number(own[1]);
  return firstShown ? Math.max(1, Math.round((now - Date.parse(`${firstShown}T12:00:00Z`)) / DAY_MS)) : 1;
}

/** "Still yours to answer: Kenneth Goodwin (LP) · 13 days · Open ›" — always under ~120 characters. */
export function thinDecideLine(d, firstShown, now) {
  const n = daysWaiting(d, firstShown, now);
  return `Still yours to answer: ${decideLabel(d)} · ${n} day${n === 1 ? "" : "s"}`;
}

/**
 * Split Decide into the cards shown in full (first time) and the thin lines (seen on an earlier day).
 * `told` maps key → the day it was first shown. Returns the new memory too.
 */
export function splitRepeats(decide, { told = {}, today, now }) {
  const full = [], thin = [], memory = { ...told };
  for (const d of decide ?? []) {
    const key = String(d.key ?? d.title);
    const first = told[key];
    if (first && first < today) thin.push({ ...d, thin: thinDecideLine(d, first, now) });
    else { full.push(d); memory[key] = first ?? today; }
  }
  return { full, thin, memory };
}

/**
 * Which failed tasks get a fix job: one per job FAMILY, and none for a family that already has a
 * repair that is not finished (or a fix job opened this run).
 */
export function fixJobsToOpen(failed, { tasks = [], repoChanges = [], told = [], now = Date.now() } = {}) {
  // A repair that stopped more than a day ago no longer holds its family: the next morning reopens it once.
  const holds = (r) => r.phase !== "done" && !r.superseded_at && !(r.phase === "failed" && Number(r.updated_at ?? 0) < now - DAY_MS);
  const live = new Set(
    (repoChanges ?? [])
      .filter((r) => (r.origin ?? "repair") === "repair" && holds(r))
      .map((r) => jobFamily(r.task_title ?? /^([^\n]+)/.exec(String(r.instruction ?? ""))?.[1] ?? "")),
  );
  const out = [];
  for (const f of failed ?? []) {
    if (told.includes(f.id)) continue;
    const t = (tasks ?? []).find((x) => x.id === f.id) ?? f;
    const fam = jobFamily(t.title);
    if (!fam || live.has(fam)) continue;
    live.add(fam);
    out.push({ id: f.id, family: fam, task: t });
  }
  return out;
}
