/**
 * THE SERVICE PRACTICES EVERY BOSS OS EMPLOYEE KEEPS, ON EVERY KIND OF WORK (6 Oct 2026).
 *
 * The owner, 6 Oct 2026: "i need to make sure all of these things we just did for porter and west
 * peek OS agents — we need to apply it to boss os repo for all the boss os agents — same
 * capabilities and friction reduction."
 *
 * A COPY, NEVER AN IMPORT. West Peek OS keeps its own (`src/shared/work/partnerPractices.ts`); this
 * is Boss OS's, and the two diverge where the businesses do — see docs/SERVICE_RULES.md, which
 * names every rule this file enforces and every place it differs.
 *
 * ONE FRAGMENT, AND EVERY EMPLOYEE RUN READS IT:
 *
 *   · `queue/consumer.ts#buildPrompt` — the one path every task goes through, cloud rung and Mac
 *     dispatch alike (the same insertion point the firm's notices use);
 *   · `scripts/ops/repo-change.mjs` — Danielle's Mac lane, through `{{PRACTICES}}` in its prompt;
 *   · `src/worker/boss/duties/author.ts` reaches every duty through the same `buildPrompt`, since a
 *     duty run is a task.
 *
 * `npm run validate:service-rules` reads every inclusion and every rule number below.
 *
 * Plain ESM with a hand-written `.d.mts`, like its neighbours, so the Worker, the Mac scripts and
 * the validators all run the SAME function.
 */

/** Where every clearing email goes. Boss OS's own mailbox, never West Peek's. */
export const SERVICE_INTAKE_ADDRESS = "boss@sequoiataylor.com";

export const SERVICE_PRACTICES_HEADING =
  "STANDING SERVICE PRACTICES — every employee, every kind of work (how to report back to the Boss; never a change to what was asked):";

/** One line per rule in docs/SERVICE_RULES.md that is enforced by the prompt. */
export const SERVICE_PRACTICES = [
  { rule: "R6", line: "If the work needs a key or token you were not given, write one line `Missing key: VENDOR_NAME` (the vendor's own name, e.g. RUNWARE_API_KEY) and do everything that does not need it; the vault is checked first, the Boss is asked once, and the work resumes by itself when it arrives. Never ask for a login, only the key." },
  { rule: "R7", line: "Anything you wait on from the Boss is said in three parts: what is waiting, why, and the exact reply or email that clears it." },
  { rule: "R8", line: `Every way to clear a wait is an email reply or a new email to ${SERVICE_INTAKE_ADDRESS} — never "open Boss OS", never "on the task", never "in Diagnostics" or "on the desk".` },
  { rule: "R13", line: "\"Let me know what's realistic\" (or any ask for an estimate) gets the estimate FIRST — per item: today / next week / not possible as worded, with the nearest version — then the work." },
  { rule: "R14", line: "Work the Boss dates for later (\"for next week …\") is not dropped: write one line per item, exactly `Deferred to YYYY-MM-DD: <the ask>` — it becomes its own task that runs on that date." },
  { rule: "R15", line: "Several asks in one message → one done-line per ask, in order: `<ask> — done | partial | not done (what is missing)`; partial completion is said per item, never averaged into \"done\"." },
  { rule: "R16", line: "A question nobody answered is settled by its recommended default, said ONCE (\"I went with X; reply with Y and it changes\"); never re-list open questions in later replies — raise one again only when something changed." },
  { rule: "R17", line: "Honest limits: when the ask cannot be done as worded, do the nearest version and state the limit in that item's done-line — never silently narrower, never a question instead of the work." },
  { rule: "R19", line: "The Boss's standing constraints below are law for this work: obey every one silently, never ask about them, never list them back." },
  { rule: "R21", line: "Files that arrive later in a Drive folder the Boss named are loaded for you automatically; if the folder is still empty, it has already been said once — do not ask for the files again." },
  { rule: "R22", line: "When a shared or firm-wide key or account stands in for one of the Boss's own, say so in the reply: the cap it carries, what happens when the cap is hit, the upgrade price if known — and that her own key can be emailed as `SECRET NAME=value` to replace it." },
  { rule: "R23", line: "A promised later migration (\"under this account for now, move it later\") is a stated deviation in the reply plus a `Deferred to YYYY-MM-DD: <the move>` line." },
];

/** The one block every employee prompt carries. Constraints are her register (R19); none → the line says so. */
export function servicePracticesBlock(constraints = []) {
  const kept = [...new Set((constraints ?? []).map((c) => String(c ?? "").replace(/\s+/g, " ").trim()).filter((c) => c.length >= 4))].slice(0, 40);
  return [
    SERVICE_PRACTICES_HEADING,
    ...SERVICE_PRACTICES.map((p) => `  • ${p.line}`),
    kept.length
      ? `STANDING_CONSTRAINTS (hers; obey without restating): ${kept.map((c) => `· ${c}`).join(" ")}`
      : "STANDING_CONSTRAINTS: none on record.",
  ].join("\n");
}

// ─── R6: a key the work needs and was not given ──────────────────────────────

/** Every `Missing key: VENDOR_NAME` line in an employee's result. Names only; reserved-looking names are dropped. */
export function missingKeysIn(text) {
  const out = new Set();
  for (const m of String(text ?? "").matchAll(/^\s*(?:[-•*]\s*)?Missing key:\s*`?([A-Z][A-Z0-9]*_[A-Z0-9_]{2,60})`?\s*$/gm)) {
    if (!/^(ANTHROPIC|CLAUDE|BOSS_OS_SECRET)/.test(m[1])) out.add(m[1]);
  }
  return [...out].slice(0, 5);
}

// ─── R14 / R23: dated deferred work ──────────────────────────────────────────

const DEFERRED_LINE = /^\s*(?:[-•*]\s*)?Deferred to (\d{4}-\d{2}-\d{2}):\s*(.{4,400}?)\s*$/gim;

/** Every `Deferred to YYYY-MM-DD: <ask>` line in an employee's result, deduplicated. A bad date is skipped. */
export function deferredItemsIn(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text ?? "").matchAll(DEFERRED_LINE)) {
    const due = Date.parse(`${m[1]}T09:00:00-05:00`);
    if (!Number.isFinite(due)) continue;
    const ask = (m[2] ?? "").trim();
    const key = `${m[1]}|${ask.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ask, due_at: new Date(due).toISOString() });
  }
  return out.slice(0, 5);
}

/**
 * THE IDENTITY OF ONE DEFERRED ITEM, for the duplicate check — compared by EQUALITY on a JSON field,
 * never by LIKE. West Peek OS #228 found D1 refusing `LIKE '%<key>%'` ("LIKE or GLOB pattern too
 * complex") for every deferred item, so every deferral threw. Short, fixed alphabet, no wildcard.
 */
export function deferKey(sourceTaskId, item) {
  const ask = String(item?.ask ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
  let h = 2166136261;
  for (const ch of `${sourceTaskId}|${String(item?.due_at ?? "").slice(0, 10)}|${ask}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `dfr_${h.toString(36)}_${String(item?.due_at ?? "").slice(0, 10)}`;
}

// ─── R21: Drive folders named in an ask ──────────────────────────────────────

/** Every Drive FOLDER link in her words (folders only; a single file is an attachment, not a watch). */
export function driveFoldersIn(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text ?? "").matchAll(/https?:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})[^\s<>"')\]]*/g)) {
    const id = m[1] ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, url: m[0] });
  }
  return out.slice(0, 5);
}

// ─── R19: her standing constraints, read from her own words ──────────────────

/**
 * A LINE SHE MARKED AS STANDING. Unlike West Peek OS, which reads constraints out of a repo's README,
 * Boss OS registers only what she says is standing — `Always: …`, `Never: …`, `Standing rule: …`,
 * `Constraint: …` at the start of a line — because her personal mail is full of "never" and "only"
 * that describe one job, and a register that swallowed those would rule every later run by accident.
 */
export function standingConstraintsIn(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:[-*•]\s*)?(always|never|standing rule|constraint)\s*:\s*(.{6,400})$/i.exec(raw);
    if (!m) continue;
    const body = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}: ${m[2].trim()}`;
    const key = body.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(body.slice(0, 400));
  }
  return out.slice(0, 20);
}
