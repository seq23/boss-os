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
export const MAX_OPEN_PER_BUSINESS = 3;
/** A Decide card she answered (or one still waiting) is not raised again for this many days. */
export const ASKED_DAYS = 28;
export const STATES = Object.freeze(["decided", "paused", "held: no data", "held: no model", "held: roster", "held: error"]);

/**
 * The risk rules every draft of a brand is checked against, whatever its roster entry lists (the
 * roster's `limits:` add to these, never remove). A rule whose words are not in the risk brain holds
 * the draft: a check against a rule the model never saw is not a check.
 */
export const REQUIRED_RULES = Object.freeze({
  "*": Object.freeze(["R-PRF-01", "R-PRF-02", "R-END-01"]),
  "approvalprep": Object.freeze(["R-ADV-13"]),
  "a-player-mode": Object.freeze(["R-ADV-05", "R-ADV-06"]),
  "porch-and-party": Object.freeze(["R-END-03"]),
  "peace-be-still": Object.freeze(["R-END-03"]),
  "dream-wedding": Object.freeze(["R-END-03"]),
});
export function rulesFor(entry) {
  return [...new Set([...(REQUIRED_RULES["*"] ?? []), ...(REQUIRED_RULES[entry?.key] ?? []), ...(entry?.limits ?? [])])];
}

/** The claims rules with their words, or the ids whose words are missing (the draft is then held). */
export function claimRules(entry, riskMd) {
  const rules = rulesFor(entry).map((id) => ({ id, text: ruleText(riskMd, id) }));
  return { rules: rules.filter((r) => r.text), missing: rules.filter((r) => !r.text).map((r) => r.id) };
}

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

/**
 * THE NAMING GUARD (her ruling, spry brain 21 Nov 2026; USPTO sn 98839129). A hard stop on exact
 * names, so it is code, run on every draft of every brand before the claims model, and its words are
 * in the claims prompt too:
 *   - "Black Bible Chat" only as Hush Harbor's subtitle, right after "Hush Harbor · ";
 *   - never "Black Bible Stories" as one phrase, nor #blackbiblestories (say "Bible Stories with Black Faces").
 * Nothing else about a post (hashtags, music, format) is ever required per post: those are judgement.
 */
export const NAMING_RULE = 'NAMING: "Black Bible Chat" appears only as "Hush Harbor · Black Bible Chat & Stories"; never "Black Bible Stories" or #blackbiblestories (a third party\'s trademark application) — say "Bible Stories with Black Faces".';
export function namingProblems(draft) {
  const t = String(draft ?? "");
  const out = [];
  const W = "[\\s\\-–—_.]*";
  if (new RegExp(`black${W}bible${W}stories`, "i").test(t.replace(/#/g, " "))) out.push('says "Black Bible Stories" (a third party\'s trademark application): say "Bible Stories with Black Faces"');
  const bare = t.replace(/Hush Harbor\s*·\s*Black Bible Chat\s*(&|and)\s*Stories/gi, "").replace(/#blackbiblechat\b/gi, "");
  if (new RegExp(`black${W}bible${W}chat`, "i").test(bare)) out.push('says "Black Bible Chat" outside "Hush Harbor · Black Bible Chat & Stories"');
  return out;
}

/** The claims-check prompt: the brand's own risk rules, read from the risk brain by id. */
export function claimsPrompt({ entry, rules, draft }) {
  return [
    { role: "system", content: 'You check one social post or page lead against a business\'s legal and honesty rules. Answer with JSON only: {"pass": true|false, "broken": ["rule id", ...], "why": "one sentence"}. Fail it if it breaks any rule, names or describes a real child, names a client, investor or customer, invents a review, a person, a result or scarcity, or leaves out a label a rule requires.' },
    { role: "user", content: `Business: ${entry.label}\n\nRULES\n${rules.map((r) => `${r.id}: ${r.text}`).join("\n")}\n${NAMING_RULE}\n\nDRAFT\n${draft}` },
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

/**
 * THE SPEND AND ACCOUNT CHECK on a proposal is read by a model (meaning), with a narrow backstop of
 * paying-out words that can only ADD a refusal. No answer is a refusal: a spend never slips through
 * because a route was busy.
 */
export function spendPrompt(p) {
  return [
    { role: "system", content: 'You check one growth proposal for a small business. Answer with JSON only: {"costs_money": true|false, "creates_account": true|false}. costs_money is true when doing it means the business PAYS anyone (ads, boosts, a paid tool or plan upgrade, a freelancer, a sponsorship, a purchase). A price the business would CHARGE customers is not a cost. creates_account is true when it means signing up for or opening a new account, profile or channel on any outside platform. A new page on its own website is not an account.' },
    { role: "user", content: `PROPOSAL\n${p.what}\n\nWHY\n${p.why ?? ""}` },
  ];
}
export function parseSpend(text) {
  let j = null;
  try { j = JSON.parse(/\{[\s\S]*\}/.exec(String(text ?? ""))?.[0] ?? "null"); } catch { j = null; }
  if (!j || typeof j.costs_money !== "boolean" || typeof j.creates_account !== "boolean") return null;
  return { costs_money: j.costs_money, creates_account: j.creates_account };
}
const PAYING_OUT = /\b(run (paid )?ads|(facebook|meta|google|tiktok|instagram|pinterest) ads|ad (spend|budget)|advertis(e|ing) (on|with)|boost(ed|ing)? (the|a|our|this|it)|sponsor(ed)? (post|placement)|pay (for|a|an|someone)|hire|purchase|buy (ads|followers|reviews|a|an)|upgrade (to|the|our)|pro plan|premium plan)\b/i;
const NEW_ACCOUNT = /\b(new|open|create|start|sign up for)\b.{0,30}\b(account|profile|handle)\b/i;

/** A proposal: a Decide card unless it is a spend or a new account (refused, written down). `check`
 * is the model's answer (parseSpend); null means no answer, which refuses. */
export function routeProposal(roster, business, p, check) {
  if (check == null) return { to: "refused", stop: "NO_SPEND_CHECK", why: "the spend and account check got no model answer, so it is refused, never carded" };
  const spend = check.costs_money || p.costs_money === true || PAYING_OUT.test(p.what);
  const account = check.creates_account || NEW_ACCOUNT.test(p.what);
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
