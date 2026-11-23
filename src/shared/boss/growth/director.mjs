/**
 * THE GROWTH RECORD'S PURE RULES (21 Nov 2026; trimmed 23 Nov 2026 when Noelle became a scheduled Claude
 * agent, plan artifact 8LfYgMaHj7XLVB1fJ1vYxM). Her decision gate is noelle.mjs (checkPlan); what stays here
 * is what the record and its readers share, tested by tests/growthDirector.test.ts:
 *   - the backlink orders the network reads (topicOf, backlinkOrders; GET /api/boss/growth/backlink-orders);
 *   - the naming guard run on every draft (namingProblems);
 *   - the Decide-card repeat window (ASKED_DAYS);
 *   - her fortnightly Growth section of the morning email (reportDue, reportSection), built from the record,
 *     never from a model's paragraph.
 */
import { lineProblems } from "../mail/plain.mjs";

export const MAX_CARDS = 3;
/**
 * BACKLINK REQUESTS (her words, 22 Nov 2026: "i thought the backlink network was going to defer to the
 * growth director"; "we are suppposed to assume we are not related and there is a separate cloudflare acct
 * the director needs to know that"). A queue item on the `backlinks` channel is a link REQUEST to the
 * backlink network, an outside publisher. How it works with us (requests not commands, mostly other
 * subjects, a topic one of our pages answers) is HER RULING in the spry brain's Settled "### Growth"
 * group, which the model reads with the rest of her rulings (rulingsFor, roster.mjs); code keeps only
 * the hard limits: TOPIC_MAX, at most one request per four articles (noelle.mjs checkPlan, ONE_IN_FOUR), and
 * never calling the network ours. It is never a to-do or a card for her; the network reads the last week's
 * requests (GET /api/boss/growth/backlink-orders, `backlinkOrders` below, field names unchanged).
 */
export const BACKLINKS = "backlinks";
export const TOPIC_MAX = 120;
/** A Decide card she answered (or one still waiting) is not raised again for this many days. */
export const ASKED_DAYS = 28;
export const STATES = Object.freeze(["decided", "paused", "held: no data", "held: no model", "held: roster", "held: error"]);

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
