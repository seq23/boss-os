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
 *   backlinks + claims pass      → an `ordered` action only: a link REQUEST to the backlink network, never a to-do or card
 *   backlinks, not approved      → refused (NOT_APPROVED), never a card; no topic, or past the one-a-week cap → dropped by parseDecision
 *
 * PRIVATE DATA: the model sees the Growth roster entry, the playbook, counts and public trend titles only.
 * No request name, contact, LP or client name exists in any of those inputs.
 *
 * RULE 0: `OUTPUT n decisions`; zero businesses measured → NAMED STOP [GROWTH_NOTHING_MEASURED];
 * every active business held → NAMED STOP [HELD_ALL] with the counts.
 */
import { mayAct } from "./roster.mjs";
import { lineProblems } from "../mail/plain.mjs";

export const MAX_CARDS = 3;
export const MAX_QUEUE_PER_BUSINESS = 3;
export const MAX_OPEN_PER_BUSINESS = 3;
/**
 * BACKLINK REQUESTS (her words, 22 Nov 2026: "i thought the backlink network was going to defer to the
 * growth director"; "we are suppposed to assume we are not related and there is a separate cloudflare acct
 * the director needs to know that"). A queue item on the `backlinks` channel is a link REQUEST to the
 * backlink network, an outside publisher. How it works with us (requests not commands, mostly other
 * subjects, a topic one of our pages answers) is HER RULING in the spry brain's Settled "### Growth"
 * group, which the model reads with the rest of her rulings (rulingsFor, roster.mjs); code keeps only
 * the hard limits: TOPIC_MAX (prompt, parser, route), MAX_BACKLINKS_PER_CYCLE (the cycle, run.ts, makes
 * at most that many requests per business per cycle; the rest are held, never requested), and never
 * calling the network ours. It is never a to-do or a card for her; the network reads the newest cycle's
 * requests (GET /api/boss/growth/backlink-orders, `backlinkOrders` below, field names unchanged).
 */
export const BACKLINKS = "backlinks";
export const TOPIC_MAX = 120;
export const MAX_BACKLINKS_PER_CYCLE = 1;
/**
 * The decision prompt's size limit, in characters. The smallest free route the router may pick holds
 * 32,768 tokens; 60,000 characters is about 15,000 tokens, which leaves room for the 1,200-token answer and
 * for text that tokenises worse than English. Over it, fitDecisionPrompt leaves out shared rulings.
 */
export const PROMPT_BUDGET_CHARS = 60_000;
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
/** Her rulings as the prompt shows them: her own group(s) first, then those for every business. */
export function rulingsBlock(rulings) {
  if (!rulings || rulings.notRead) return `HER RULINGS\n- not read${rulings?.notRead ? ` (${rulings.notRead})` : ""}`;
  const groups = [...rulings.own, ...rulings.shared];
  return `HER RULINGS (her Settled decisions, dated, in her words: this business's own, then those for every business)\n${groups.map((g) => `### ${g.heading}\n${g.body}`).join("\n\n") || "- none written"}`;
}

/**
 * The decision prompt within PROMPT_BUDGET_CHARS: over it, the shared rulings are left out from the end
 * of SHARED_RULINGS' order, never the business's own. { messages, chars, rulingChars, left, over }.
 */
export function fitDecisionPrompt(args) {
  const shared = [...(args.rulings?.shared ?? [])];
  const left = [];
  for (;;) {
    const rulings = args.rulings ? { ...args.rulings, shared } : args.rulings;
    const messages = decisionPrompt({ ...args, rulings });
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    if (chars <= PROMPT_BUDGET_CHARS || !shared.length) return { messages, chars, rulingChars: rulingsBlock(rulings).length, left, over: chars > PROMPT_BUDGET_CHARS };
    left.unshift(shared.pop().heading);
  }
}

export function decisionPrompt({ playbook, entry, summary, trends, today, todos, first = false, linked = [], topics = [], rulings = null }) {
  const backlinks = entry.channels.some((c) => c.channel === BACKLINKS);
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

${rulingsBlock(rulings)}

SCOREBOARD (28-day windows; "not read" means unknown, never zero)
${numbersFor(summary)}

OPEN TO-DOS ALREADY ON THE LIST
${(todos ?? []).map((t) => `- ${t}`).join("\n") || "- none"}

OLDER WORK FOR THIS BUSINESS, STARTED BEFORE YOU (you own it now: keep, change or drop each, on the evidence)
${(linked ?? []).map((l) => `- ${l.id}: ${l.what}`).join("\n") || "- none"}

SEARCH TRENDS TODAY (public, US)
${(trends ?? []).slice(0, 20).map((t) => `- ${t}`).join("\n") || "- not read"}
${backlinks ? `
BACKLINK TOPICS ALREADY REQUESTED (the week each was requested)
${(topics ?? []).map((t) => `- ${t}`).join("\n") || "- none yet"}
` : ""}
Return exactly:
{"decision": "one or two plain sentences: what to do more of, less of, or hold, and why",
 "evidence": ["each a number from the scoreboard or a fact from the roster, with its source"],
 "test": null or {"channel": "...", "format": "...", "what": "...", "number": "the number that judges it", "stop": "when it stops"},
 "queue": [up to ${MAX_QUEUE_PER_BUSINESS} {"channel": "...", "format": "...", "draft": "the exact words of the post or page lead", "why": "..."${backlinks ? `, "topic": "backlinks only: the article's subject, at most ${TOPIC_MAX} characters"` : ""}}],
 "proposals": [{"what": "something new that needs her yes (a new channel, format, product, price or list)", "why": "...", "evidence": "...", "costs_money": true or false}],
 "linked": [one per older-work row above: {"id": "olp_…", "verdict": "keep" | "change" | "drop", "why": "the evidence, plainly", "next_step": "for change: the new next step"}],
 "next_check": "YYYY-MM-DD"}
Only approved channels and formats go in "queue"; anything else is a proposal. Never propose spending money or creating an account. "Too little data" holds a comparison between formats; it never holds older work she already approved to start on an approved channel and format: that goes in "queue" this week.${backlinks ? `
BACKLINKS: a "${BACKLINKS}" item in "queue" is one link request to the backlink network; her rulings above say how it works with us. Hard limits. At most ${MAX_BACKLINKS_PER_CYCLE} "${BACKLINKS}" item per week; any more are not sent. Its "topic" is at most ${TOPIC_MAX} characters; an item without one is dropped. Never call the network ours, a partner or related to this business in anything public. The rule (the playbook's backlink row): judge links against this business's search visits 8 weeks later. Search visits rising since the first topics → request more topics; no rise 8 weeks after a topic → change topics (never the same topic again).` : ""}${first && entry.season ? `\nThis is your FIRST decision for this business: it is about the season on its roster (${entry.season}), the money that season can still bring in before it ends.` : ""}` },
  ];
}

/** The model's answer, shaped, or null (never guessed). */
export function parseDecision(text) {
  let j = null;
  try { j = JSON.parse(/\{[\s\S]*\}/.exec(String(text ?? ""))?.[0] ?? "null"); } catch { j = null; }
  if (!j || typeof j.decision !== "string" || !j.decision.trim()) return null;
  const arr = (v) => (Array.isArray(v) ? v : []);
  // A backlinks item is a request: without a topic (or with one past TOPIC_MAX) it is dropped, and counted.
  let noTopic = 0;
  const queue = arr(j.queue).filter((q) => q && q.channel && q.draft).map((q) => {
    const item = { channel: clip(q.channel, 40).toLowerCase(), format: clip(q.format, 40).toLowerCase(), draft: clip(q.draft, 1200), why: clip(q.why, 300) };
    if (item.channel !== BACKLINKS) return item;
    const topic = topicOf(q.topic);
    if (!topic) { noTopic++; return null; }
    return { ...item, topic };
  }).filter(Boolean);
  return {
    decision: clip(j.decision, 600),
    evidence: arr(j.evidence).map((e) => clip(e, 300)).filter(Boolean).slice(0, 8),
    test: j.test && typeof j.test === "object" && j.test.channel ? { channel: clip(j.test.channel, 40).toLowerCase(), format: clip(j.test.format, 40).toLowerCase(), what: clip(j.test.what, 300), number: clip(j.test.number, 200), stop: clip(j.test.stop, 200) } : null,
    queue: queue.slice(0, MAX_QUEUE_PER_BUSINESS),
    noTopic,
    proposals: arr(j.proposals).filter((p) => p && p.what).slice(0, 3).map((p) => ({ what: clip(p.what, 300), why: clip(p.why, 300), evidence: clip(p.evidence, 300), costs_money: p.costs_money === true })),
    next_check: /^\d{4}-\d\d-\d\d$/.test(String(j.next_check)) ? j.next_check : null,
    linked: arr(j.linked).filter((l) => l && /^olp_[a-z0-9]+$/.test(String(l.id)) && ["keep", "change", "drop"].includes(l.verdict) && String(l.why ?? "").trim())
      .map((l) => ({ id: String(l.id), verdict: l.verdict, why: clip(l.why, 400), next_step: l.verdict === "change" ? clip(l.next_step, 400) || null : null }))
      .filter((l) => l.verdict !== "change" || l.next_step),
  };
}

/** A topic as the network gets it: one line, 1 to TOPIC_MAX characters, else null (never cut short). */
export function topicOf(v) {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t && t.length <= TOPIC_MAX ? t : null;
}

/**
 * The backlink network's orders from the NEWEST cycle's decision rows ({ id, business, state, actions,
 * created_at }, any order): per business its newest decided row only (a same-day re-run replaces the
 * first), each `ordered` backlinks item as { business, topic, draft, why }. Nothing else of the row (no
 * evidence, decision text or other channel's draft) leaves. A row whose actions are not a JSON list is
 * skipped and named in `skipped`, never a crash.
 */
export function backlinkOrders(rows) {
  const newest = new Map();
  for (const r of rows ?? []) {
    if (r?.state !== "decided") continue;
    const cur = newest.get(r.business);
    if (!cur || Number(r.created_at) > Number(cur.created_at)) newest.set(r.business, r);
  }
  const orders = []; const skipped = [];
  for (const r of newest.values()) {
    let acts = null;
    try { acts = JSON.parse(r.actions); } catch { acts = null; }
    if (!Array.isArray(acts)) { skipped.push(r.id); continue; }
    for (const a of acts) {
      const it = a?.kind === "ordered" ? a.item : null;
      const topic = topicOf(it?.topic);
      if (!it || it.channel !== BACKLINKS || !topic || typeof it.draft !== "string" || !it.draft.trim()) continue;
      orders.push({ business: String(r.business), topic, draft: it.draft, why: typeof it.why === "string" ? it.why : "" });
    }
  }
  return { orders: orders.sort((a, b) => a.business.localeCompare(b.business)), skipped };
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
  // A backlinks item is an order for the network, never her card: unapproved, it is refused and written down.
  if (gate.stop === "NOT_APPROVED" && String(item.channel ?? "").toLowerCase() !== BACKLINKS) return { to: "card", why: gate.why };
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

/**
 * One pipeline to-do per business × channel × format. A format on the roster queues on it from its
 * first post (her ruling, 22 Nov 2026); her yes to a NEW format's card opens the same row.
 */
export function pipelineKey(business, channel, format) {
  return `growth#${business}#${channel}-${format}`.toLowerCase().replace(/[^a-z0-9#-]+/g, "-");
}

/** Her report runs every two weeks: due when none was written, or the last one is 13+ days old. */
export const REPORT_EVERY_DAYS = 14;
export function reportDue(lastDay, today) {
  if (!lastDay) return true;
  return (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastDay}T12:00:00Z`)) / 86_400_000 >= REPORT_EVERY_DAYS - 1;
}

/** Her words for a held or paused state: why, and who is on it. Never the state code. */
const HELD_WHY = {
  "held: no data": "nothing on its scoreboard could be read yet",
  "held: no model": "no free writer answered; it tries again next Monday",
  "held: roster": "its plan in the brain needs a fix; the team is on it",
  "held: error": "the run failed for it; the team is fixing it",
};
const WORDS = { money: (n) => `$${Math.round(n).toLocaleString("en-US")} in`, sales: (n) => `${n} ${n === 1 ? "sale" : "sales"}`, installs: (n) => `${n} ${n === 1 ? "install" : "installs"}`, requests: (n) => `${n} ${n === 1 ? "request" : "requests"}`, visits: (n) => `${n} ${n === 1 ? "visit" : "visits"}` };
/** "2 requests, $730 in" from a scoreboard summary's totals; null when nothing was read (never 0). */
export function numbersLine(summary) {
  const parts = Object.entries(summary?.totals ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => WORDS[k]?.(v)).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
// A channel in her words: the brand's own spelling where it has one (WordPress, TikTok), else Title Case.
const BRAND_SPELLING = { wordpress: "WordPress", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn" };
const titleCase = (w) => String(w ?? "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  .replace(/\b(Wordpress|Tiktok|Youtube|Linkedin)\b/g, (m) => BRAND_SPELLING[m.toLowerCase()]);
/** The one model sentence kept: its first sentence, only when it passes the plain-words check. */
function modelSentence(text) {
  const first = String(text ?? "").replace(/NAMED STOP \[[A-Z0-9_]+\]\s*/g, "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (!first || first.length > 160 || lineProblems(first).length || /[*_`#]|\b[a-z]+-[a-z]+\b|\b[a-z]{2,4}_[a-z0-9]+|R-[A-Z]+-\d/.test(first)) return null;
  return /[.!?]$/.test(first) ? first : `${first}.`;
}
/** "Porch & Party requests: 2 of 4 by 23 Dec" — a floor from the Scorecard row, "not read" never 0. */
function floorLine(f, start, value, missing = []) {
  if (!f) return null;
  const by = new Date(Date.parse(`${start}T12:00:00Z`) + f.by * 86_400_000).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  const money = (n) => `${f.unit === "$" ? "$" : ""}${Math.round(n).toLocaleString("en-US")}`;
  if (value === null || value === undefined) return `${f.label}: not read yet (the floor is ${money(f.floor.value)} by ${by})`;
  const gap = missing.length ? ` (${missing.join(" and ")} not read yet)` : "";
  return `${f.label}: ${money(value)} of ${money(f.floor.value)} by ${by}${gap}`;
}
/**
 * The two floor numbers, from the scoreboard totals: Porch & Party's requests, and the money in
 * across every business that tracks money. A business whose money could not be read is NAMED, never
 * summed as $0 (22 Nov 2026: "$730 of $1,000" hid that A Player Mode was unread); none read → null.
 */
export function floorValues(summaries, labelOf = (k) => k) {
  const first = summaries.find((x) => x.key === "porch-and-party")?.totals?.requests ?? null;
  const tracked = summaries.filter((x) => x.totals && "money" in x.totals);
  const read = tracked.filter((x) => typeof x.totals.money === "number");
  const missing = tracked.filter((x) => typeof x.totals.money !== "number").map((x) => labelOf(x.key));
  return { first, real: read.length ? read.reduce((a, x) => a + x.totals.money, 0) : null, realMissing: read.length ? missing : [] };
}

/**
 * The fortnightly Growth section of Simone's morning email (repo rule: one morning email; every
 * producer writes a section). Built from the record, never from a model's paragraph: line 1 says
 * whether she must do anything (true for the all-held fortnight too), then the floors, then one line
 * per business (its numbers, what was queued or asked, at most one model sentence that passes the
 * plain-words check), up to three queued examples, then held and paused businesses with the reason
 * in her words. The cards are in Decide already, so they are counted, never repeated.
 */
export function reportSection(rows, { cards, origin, at, summaries = [], scorecard = null }) {
  const sum = (k) => summaries.find((x) => x.key === k);
  const fv = floorValues(summaries, (k) => sum(k)?.label ?? rows.find((r) => r.business === k)?.label ?? "one business");
  const queued = rows.flatMap((r) => (r.actions ?? []).filter((a) => a.kind === "queued").map((a) => ({ label: r.label, item: a.item })));
  const orders = rows.flatMap((r) => (r.actions ?? []).filter((a) => a.kind === "ordered")).length;
  const decided = rows.filter((r) => r.state === "decided");
  const held = rows.filter((r) => String(r.state).startsWith("held"));
  const paused = rows.filter((r) => r.state === "paused");
  const one = (n, a, b) => (n === 1 ? a : b.replace("N", String(n)));
  const lines = [
    cards ? `${one(cards, "One growth idea waits", "N growth ideas wait")} for your yes in Decide. Nothing else to do.`
      : queued.length ? `Nothing to do: ${one(queued.length, "one post was", "N posts were")} queued from formats you already approved.`
      : orders ? `Nothing to do: ${one(orders, "one backlink article was", "N backlink articles were")} requested from the backlink network.`
      : "Nothing to do: nothing new was queued this fortnight. Why, below.",
  ];
  const floors = [floorLine(scorecard?.first, scorecard?.start, fv.first), floorLine(scorecard?.real, scorecard?.start, fv.real, fv.realMissing)].filter(Boolean);
  if (floors.length) lines.push(`Against the floors: ${floors.join("; ")}.`);
  for (const r of decided) {
    const acts = r.actions ?? [];
    const q = acts.filter((a) => a.kind === "queued").length;
    const o = acts.filter((a) => a.kind === "ordered").length;
    const asked = acts.filter((a) => a.kind === "proposal").length;
    const did = [q ? `${q} queued` : null, o ? `${one(o, "1 backlink article", "N backlink articles")} requested` : null, asked ? `${asked} asked in Decide` : null].filter(Boolean).join(", ") || "nothing new queued";
    const said = modelSentence(r.decision);
    lines.push(`${r.label}: ${numbersLine(sum(r.business)) ?? "numbers not read"} in 28 days; ${did}.${said ? ` ${said}` : ""}`);
  }
  if (queued.length) lines.push(`Queued, for example: ${queued.slice(0, 3).map((x) => `${x.label}, ${titleCase(x.item?.channel)} ${String(x.item?.format ?? "post").replace(/[-_]+/g, " ")}`).join("; ")}.`);
  if (held.length) lines.push(`Held, not guessed: ${held.map((r) => `${r.label} (${HELD_WHY[r.state] ?? "held; the team is looking"})`).join("; ")}.`);
  // A paused row's decision is "Paused: <her reason>. Nothing measured…" (run.ts); the reason is hers.
  const pausedWhy = (r) => /^Paused: (.+?)\. Nothing measured/.exec(String(r.decision ?? ""))?.[1] ?? null;
  if (paused.length) lines.push(`Paused: ${paused.map((r) => (pausedWhy(r) ? `${r.label} (${pausedWhy(r)})` : r.label)).join("; ")}.`);
  return { section: "growth", at: new Date(at).toISOString(), title: "📈 Growth, from Noelle", decide: [], rows: [], lines, link: { label: "See every business on the Growth page", url: `${origin}/?tab=growth` } };
}
