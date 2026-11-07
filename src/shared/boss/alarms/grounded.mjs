/**
 * A REPORT SAYS ONLY WHAT WAS READ (owner, 7 Nov 2026). Kendra's "Morning System Report: 31 Oct 2026"
 * was written by a free model with no data: "Task D", "Database Integrity Sync", "dev-sandbox-04",
 * "84GB headroom" (the real disk line that week said 10 to 15 GB), "standard: 9 minutes". None of it
 * was in anything the model was given. The model may phrase facts it is handed; it may not add any.
 *
 * `ungroundedClaims(text, facts)` lists every checkable claim in `text` that `facts` does not hold:
 * ids, quoted names, proper names, a "Task X" name, host-like names, web domains and every number. A report with
 * any is refused and the plain recorded lines go instead (`groundedOr`). Pure.
 */

const ID = /\b(?:tsk|alm|rpg|rc|apr|tnt|dr|brn|emp|duty)_[A-Za-z0-9_]{3,}\b/g;
const QUOTED = /["“]([^"”\n]{2,80})["”]/g;
const TASK_NAME = /\bTask\s+["“]?([A-Z0-9])["”]?(?![\w])/g;
const HOST = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+[a-z0-9-]*\b/gi;
const DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|ai|app|vc|live|co|ventures)\b/gi;
const NUMBER = /\d+(?:[.,]\d+)?/g;
/** A proper name: three or more capitalised words in a row ("Database Integrity Sync"). */
const PROPER = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,}\b/g;

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const numbersIn = (s) => new Set([...String(s ?? "").matchAll(NUMBER)].map((m) => m[0].replace(",", ".").replace(/^0+(?=\d)/, "")));

/** Every checkable claim in `text`, as `{ kind, value }`. Pure. */
export function claimsIn(text) {
  const t = String(text ?? "");
  const out = [];
  for (const m of t.matchAll(ID)) out.push({ kind: "id", value: m[0] });
  for (const m of t.matchAll(QUOTED)) out.push({ kind: "name", value: m[1] });
  for (const m of t.matchAll(TASK_NAME)) out.push({ kind: "task", value: `Task ${m[1]}` });
  for (const m of t.matchAll(PROPER)) out.push({ kind: "name", value: m[0] });
  for (const m of t.matchAll(HOST)) out.push({ kind: "host", value: m[0] });
  for (const m of t.matchAll(DOMAIN)) out.push({ kind: "host", value: m[0] });
  for (const m of t.matchAll(NUMBER)) out.push({ kind: "number", value: m[0].replace(",", ".").replace(/^0+(?=\d)/, "") });
  return out;
}

/** The claims in `text` that `facts` (a string, or a list of strings) does not hold. Pure. */
export function ungroundedClaims(text, facts) {
  const f = Array.isArray(facts) ? facts.join("\n") : String(facts ?? "");
  const hay = norm(f);
  const nums = numbersIn(f);
  const missing = [];
  const seen = new Set();
  for (const c of claimsIn(text)) {
    const k = `${c.kind}:${c.value.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const held = c.kind === "number" ? nums.has(c.value) : hay.includes(norm(c.value));
    if (!held) missing.push(c);
  }
  return missing;
}

/** `text` when every claim in it is in `facts`; otherwise `fallback` (the plain recorded lines). Pure. */
export function groundedOr(text, facts, fallback) {
  const t = String(text ?? "").trim();
  if (!t) return fallback;
  return ungroundedClaims(t, facts).length ? fallback : t;
}
