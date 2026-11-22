/**
 * THE GROWTH DIRECTOR'S RULES (21 Nov 2026) — pure. The weekly cycle (src/worker/boss/growth/run.ts)
 * does the reading and writing; every rule that must hold is here, tested by tests/growthDirector.test.ts.
 *
 * ONE CYCLE: measure (the scoreboard summary) → free scan (search trends; rivals' ads "not read" until a
 * free source exists) → decide per business (a free model reads the playbook, the roster entry and the
 * counts; code enforces the holds) → queue (each item through roster.mjs mayAct, then a model claims
 * check against that brand's risk rules) → report (decisions written with their evidence).
 *
 * HOLDS, never a decision on zeros:
 *   paused              nothing measured, decided, queued or posted
 *   held: no data       nothing on the scoreboard was read for the business
 *   held: no model      no free route answered (the fallback chain is spent)
 * A format test on a channel held "too little data" or "no data" is dropped by code, whatever the model said.
 *
 * WHAT A QUEUED ITEM BECOMES:
 *   mayAct ok + claims pass      → an Open Loops row for the Director (work on an approved pipeline)
 *   mayAct ok + claims fail/none → held (never queued); the reason is written down
 *   NOT_APPROVED / proposal      → a Decide card for her (at most MAX_CARDS a cycle)
 *   NEVER_SPEND / NO_NEW_ACCOUNTS / PROPOSE_ONLY on a retire → refused, written down, never a card for a spend
 *
 * PRIVATE DATA: the model sees the Growth roster entry, the playbook, counts and public trend titles only.
 * No request name, contact, LP or client name exists in any of those inputs.
 *
 * RULE 0: `OUTPUT n decisions`; zero businesses measured → NAMED STOP [GROWTH_NOTHING_MEASURED];
 * every active business held → NAMED STOP [HELD_ALL] with the counts.
 */
import { mayAct } from "./roster.mjs";

export const MAX_CARDS = 3;
export const MAX_QUEUE_PER_BUSINESS = 3;
export const STATES = Object.freeze(["decided", "paused", "held: no data", "held: no model"]);

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The numbers a model may see for one business: counts by channel, never a row. */
export function numbersFor(summary) {
  return (summary?.channels ?? []).map((c) => `- ${c.label} (${c.channel}, ${c.language}): ${c.value === null ? c.unread : c.value}${c.before != null ? ` (28 days earlier: ${c.before})` : ""}${c.hold ? ` [hold: ${c.hold}]` : ""}`).join("\n");
}

/** The decision prompt for one business. */
export function decisionPrompt({ playbook, entry, summary, trends, today, todos, first = false }) {
  const roster = [
    `Business: ${entry.label}`, `Buyer: ${entry.buyer}`, `Offer: ${entry.offer}`, `Money number: ${entry.money}`,
    `Approved channels and formats: ${entry.channels.map((c) => `${c.channel}${c.formats.length ? ` [${c.formats.join(", ")}]` : ""}${c.note ? ` (${c.note})` : ""}`).join(" · ")}`,
    `Languages (each is a lane): ${entry.languages.join(", ")}`, `Season: ${entry.season ?? "none written"}`, `Risk rules: ${entry.limits.join(", ")}`,
  ].join("\n");
  return [
    { role: "system", content: `${playbook}\n\nYou are the Growth Director. Answer with JSON only, no prose around it.` },
    { role: "user", content: `Today is ${today}. Decide this week's growth moves for one business.

ROSTER ENTRY
${roster}

SCOREBOARD (28-day windows; "not read" means unknown, never zero)
${numbersFor(summary)}

OPEN TO-DOS ALREADY ON THE LIST
${(todos ?? []).map((t) => `- ${t}`).join("\n") || "- none"}

SEARCH TRENDS TODAY (public, US)
${(trends ?? []).slice(0, 20).map((t) => `- ${t}`).join("\n") || "- not read"}

Return exactly:
{"decision": "one or two plain sentences: what to do more of, less of, or hold, and why",
 "evidence": ["each a number from the scoreboard or a fact from the roster, with its source"],
 "test": null or {"channel": "...", "format": "...", "what": "...", "number": "the number that judges it", "stop": "when it stops"},
 "queue": [up to ${MAX_QUEUE_PER_BUSINESS} {"channel": "...", "format": "...", "draft": "the exact words of the post or page lead", "why": "..."}],
 "proposals": [{"what": "something new that needs her yes (a new channel, format, product, price or list)", "why": "...", "evidence": "...", "costs_money": true or false}],
 "next_check": "YYYY-MM-DD"}
Only approved channels and formats go in "queue"; anything else is a proposal. Never propose spending money or creating an account.${first && entry.season ? `\nThis is your FIRST decision for this business: it is about the season on its roster (${entry.season}), the money that season can still bring in before it ends.` : ""}` },
  ];
}

/** The model's answer, shaped, or null (never guessed). */
export function parseDecision(text) {
  let j = null;
  try { j = JSON.parse(/\{[\s\S]*\}/.exec(String(text ?? ""))?.[0] ?? "null"); } catch { j = null; }
  if (!j || typeof j.decision !== "string" || !j.decision.trim()) return null;
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    decision: clip(j.decision, 600),
    evidence: arr(j.evidence).map((e) => clip(e, 300)).filter(Boolean).slice(0, 8),
    test: j.test && typeof j.test === "object" && j.test.channel ? { channel: clip(j.test.channel, 40).toLowerCase(), format: clip(j.test.format, 40).toLowerCase(), what: clip(j.test.what, 300), number: clip(j.test.number, 200), stop: clip(j.test.stop, 200) } : null,
    queue: arr(j.queue).filter((q) => q && q.channel && q.draft).slice(0, MAX_QUEUE_PER_BUSINESS).map((q) => ({ channel: clip(q.channel, 40).toLowerCase(), format: clip(q.format, 40).toLowerCase(), draft: clip(q.draft, 1200), why: clip(q.why, 300) })),
    proposals: arr(j.proposals).filter((p) => p && p.what).slice(0, 3).map((p) => ({ what: clip(p.what, 300), why: clip(p.why, 300), evidence: clip(p.evidence, 300), costs_money: p.costs_money === true })),
    next_check: /^\d{4}-\d\d-\d\d$/.test(String(j.next_check)) ? j.next_check : null,
  };
}

/** Code's holds over the model's test: a channel with too little or no data gets no format test. */
export function enforceHolds(decision, summary) {
  if (!decision?.test) return { decision, dropped: null };
  const chans = (summary?.channels ?? []).filter((c) => c.channel === decision.test.channel);
  const hold = !chans.length ? "no data" : chans.every((c) => c.hold) ? chans.find((c) => c.hold === "no data") ? "no data" : "too little data" : null;
  if (!hold) return { decision, dropped: null };
  return { decision: { ...decision, test: null }, dropped: `held: ${hold} — no new-format test on ${decision.test.channel} (${decision.test.what})` };
}

/** The claims-check prompt: the brand's own risk rules, read from the risk brain by id. */
export function claimsPrompt({ entry, rules, draft }) {
  return [
    { role: "system", content: 'You check one social post or page lead against a business\'s legal and honesty rules. Answer with JSON only: {"pass": true|false, "broken": ["rule id", ...], "why": "one sentence"}. Fail it if it breaks any rule, names or describes a real child, names a client, investor or customer, invents a review, a person, a result or scarcity, or leaves out a label a rule requires.' },
    { role: "user", content: `Business: ${entry.label}\n\nRULES\n${rules.map((r) => `${r.id}: ${r.text}`).join("\n")}\n\nDRAFT\n${draft}` },
  ];
}

/** The claims answer: { pass, broken, why } or null. No answer is held, never passed. */
export function parseClaims(text) {
  let j = null;
  try { j = JSON.parse(/\{[\s\S]*\}/.exec(String(text ?? ""))?.[0] ?? "null"); } catch { j = null; }
  if (!j || typeof j.pass !== "boolean") return null;
  return { pass: j.pass, broken: Array.isArray(j.broken) ? j.broken.map((b) => clip(b, 20)) : [], why: clip(j.why, 300) };
}

/**
 * A risk rule's words from the risk brain: its table row (`| R-XXX-NN | ... |`) plus up to two later
 * rulings that name it (an exception such as R-END-03's P&P filler rule). Structure, not meaning:
 * the model reads the words.
 */
export function ruleText(riskMd, id) {
  const lines = String(riskMd ?? "").split("\n");
  const idRe = new RegExp(`\\b${id.replace(/-/g, "\\-")}\\b`);
  const row = lines.find((l) => new RegExp(`^\\s*\\|\\s*${id.replace(/-/g, "\\-")}\\s*\\|`).test(l));
  const rulings = lines.filter((l) => l !== row && /^\s*-\s/.test(l) && idRe.test(l)).slice(0, 2);
  const parts = [row, ...rulings].filter(Boolean).map((l) => clip(l.replace(/^[\s\-*|]+/, "").replace(/\|/g, " "), 600));
  return parts.length ? parts.join(" / ") : null;
}

/** Where one queued item goes, before the claims check. */
export function routeItem(roster, business, item) {
  const gate = mayAct(roster, { business, channel: item.channel, format: item.format, action: "post" });
  if (gate.ok) return { to: "claims" };
  if (gate.stop === "NOT_APPROVED") return { to: "card", why: gate.why };
  return { to: "refused", stop: gate.stop, why: gate.why };
}

/** A proposal: a Decide card unless it is a spend or a new account (refused, written down). */
export function routeProposal(roster, business, p) {
  // A hard safety stop, so it is code: the model's own flag OR the plain words of paying out. A price
  // she would CHARGE ("a $50 add-on") is not spending; "pay", "buy", "boost", "ads" are.
  const spend = p.costs_money === true || /\b(ads?|advertis\w*|boost(ed|ing)?|paid|pay( for)?|buy|purchase|subscri\w*|sponsor(ed|ship)?|budget|spend\w*)\b/i.test(p.what);
  const account = /\b(new|open|create|start)\b.{0,30}\b(account|profile|channel|page)\b/i.test(p.what);
  const gate = mayAct(roster, { business, action: spend ? "ad" : account ? "create-account" : "propose" });
  return gate.ok ? { to: "card" } : { to: "refused", stop: gate.stop, why: gate.why };
}

/** The cycle's end: OUTPUT line, or a named stop. `results` = [{ key, state }]. */
export function cycleEnd(results) {
  const active = results.filter((r) => r.state !== "paused");
  const decided = active.filter((r) => r.state === "decided").length;
  if (!active.length) return { ok: false, stop: "GROWTH_NOTHING_MEASURED", line: "NAMED STOP [GROWTH_NOTHING_MEASURED] no active business is on the roster and the scoreboard" };
  const counts = STATES.map((s) => `${results.filter((r) => r.state === s).length} ${s}`).join(", ");
  if (!decided) return { ok: false, stop: "HELD_ALL", line: `NAMED STOP [HELD_ALL] every business was held this cycle (${counts})` };
  return { ok: true, line: `OUTPUT ${decided} decisions (${counts})` };
}
