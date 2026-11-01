/**
 * HER RULING ON A DUTY THAT ALREADY EXISTS, BY EMAIL (owner incident, 1 Nov 2026).
 *
 * She typed "Change to Camille's Marketplace listings duty … your call" into Boss OS. Nothing read
 * it as a change to that duty: Simone's triage sent it to Camille as a research page, the page said
 * "Done as you ruled", and the duty never changed. The duty lane only knew NEW duties.
 *
 * This is the pure half: which existing duty an email is about (or none, or "which one?"), the
 * instructions after her change, and where a fixed duty's steps live so the right seat can change
 * the code. The Worker half is `src/worker/boss/duties/editByMail.ts`; the edit itself goes through
 * `ownerEdits.ts` (a `duty_versions` row, undoable), the same path the employee page uses.
 */
import { seatTag } from "../intake/mail.mjs";
import { preApprovalIn } from "../repoChange/lane.mjs";
import { NEW_DUTY_RE, UNTAGGED_NEW_DUTY_RE } from "./lane.mjs";

/** She names a duty she already has: "duty", "standing job", "regular job". */
const DUTY_WORD_RE = /\b(?:duty|duties|standing\s+job|regular\s+job)\b/i;
/** …and asks for it to change. */
const CHANGE_RE = /\b(?:change|changes|changing|update|edit|amend|add\s+this|from\s+now\s+on|going\s+forward|keep\s+doing|stop\s+doing|no\s+longer|instead|ruling|ruled)\b/i;

/** Words a duty name shares with everything, so they never decide which duty she means. */
const STOP = new Set([
  "with", "from", "that", "this", "them", "they", "their", "then", "than", "when", "what", "which",
  "keep", "true", "every", "each", "your", "into", "onto", "over", "only", "also", "about", "after",
  "before", "daily", "weekly", "monthly", "morning", "evening", "duty", "duties", "job", "jobs",
  "check", "make", "send", "sends", "tell", "read", "reads", "write", "writes", "owner", "boss",
]);

function tokens(s) {
  return new Set(String(s ?? "").toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
}

/**
 * Which existing duty her email changes. Null when the email is not a change to a duty she has.
 *   { duty, seat, phrase, preApproved, matched }   — one duty, clearly
 *   { ambiguous: [duty, …], seat }                 — two or more fit about as well: ask which
 * `duties` are the live rows ({ id, name, employee_id }); `roster` the seats ({ id, name }).
 * A seat named in the email narrows the search to that seat's duties. Pure.
 */
export function dutyEditRequestIn(subject, text, { roster = [], duties = [] } = {}) {
  const haystack = `${String(subject ?? "")}\n${String(text ?? "")}`;
  if (!DUTY_WORD_RE.test(haystack) || !CHANGE_RE.test(haystack)) return null;
  // A new duty is the duty lane's other door, never an edit.
  if (NEW_DUTY_RE.test(haystack) || UNTAGGED_NEW_DUTY_RE.test(haystack)) return null;
  const live = (duties ?? []).filter((d) => d && d.id && d.name && !d.removed_at);
  if (!live.length) return null;

  const words = tokens(haystack);
  const seat = (roster ?? []).find((s) => s?.name && words.has(seatTag(s.name).replace(/^#/, ""))) ?? null;
  const pool = seat && live.some((d) => d.employee_id === seat.id) ? live.filter((d) => d.employee_id === seat.id) : live;

  // A word every duty in the pool carries says nothing about which one; a word one duty alone carries says most.
  const df = new Map();
  for (const d of pool) for (const w of tokens(d.name)) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = pool.map((d) => {
    const matched = [...tokens(d.name)].filter((w) => words.has(w));
    return { duty: d, matched, score: matched.reduce((n, w) => n + 1 / (df.get(w) ?? 1), 0) };
  }).filter((s) => s.matched.length >= 2).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;

  const [best, second] = scored;
  const theSeat = (roster ?? []).find((s) => s.id === best.duty.employee_id) ?? seat;
  if (second && second.score * 1.5 > best.score) {
    return { ambiguous: scored.filter((s) => s.score * 1.5 > best.score).slice(0, 4).map((s) => s.duty), seat: theSeat };
  }
  return {
    duty: best.duty, seat: theSeat, matched: best.matched,
    phrase: String(text ?? "").trim().slice(0, 8000) || String(subject ?? "").trim(),
    preApproved: preApprovalIn(haystack),
  };
}

/** The duty's instructions after her change: what it said, then her words, dated. Pure. */
export function editedInstructions(current, phrase, day) {
  return `${String(current ?? "").trimEnd()}\n\n## Her change (${day}, by email)\n${String(phrase ?? "").trim()}\n`;
}

/**
 * Where a duty with fixed steps keeps them, so the seat that changes code can change them:
 * a Mac job's job description under ~/bin is seq23/seq-bin, under ~/GitHub/<repo> that repo;
 * anything else is Boss OS's own code. Pure.
 */
export function dutyCodeHome(duty) {
  let input = {};
  try { input = duty?.task_input ? JSON.parse(duty.task_input) : {}; } catch { input = {}; }
  const where = [input.job_description, input.local_job].find((x) => typeof x === "string" && x.trim()) ?? null;
  const gh = where && /(?:^|\/)GitHub\/([A-Za-z0-9._-]+)\//.exec(where);
  if (gh) return { github_repo: `seq23/${gh[1]}`, path: where };
  if (where && /^(?:~|\/Users\/[^/]+)\/bin\//.test(where)) return { github_repo: "seq23/seq-bin", path: where };
  return { github_repo: "seq23/boss-os", path: where };
}
