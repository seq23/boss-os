/**
 * THE GROWTH RECORD'S PURE RULES (21 Nov 2026; trimmed 23 Nov 2026 when Noelle became a scheduled Claude
 * agent; her plan gate was removed 24 Nov 2026 when she became full Claude Code). What stays here
 * is what the record and its readers share, tested by tests/growthDirector.test.ts:
 *   - the backlink orders the network reads (topicOf, backlinkOrders; GET /api/boss/growth/backlink-orders);
 *   - the naming guard run on every draft (namingProblems).
 * Her 14-day report is rebuilt on the new path from the ledger (ledger.mjs fortnightReport).
 */

/**
 * BACKLINK REQUESTS (her words, 22 Nov 2026: "i thought the backlink network was going to defer to the
 * growth director"; "we are suppposed to assume we are not related and there is a separate cloudflare acct
 * the director needs to know that"). A queue item on the `backlinks` channel is a link REQUEST to the
 * backlink network, an outside publisher. How it works with us (requests not commands, mostly other
 * subjects, a topic one of our pages answers) is HER RULING in the spry brain's Settled "### Growth"
 * group, which the model reads with the rest of her rulings (rulingsFor, roster.mjs); code keeps only
 * the hard limits: TOPIC_MAX (one request per four articles is her ruling in the spry brain, which Noelle reads), and
 * never calling the network ours. It is never a to-do or a card for her; the network reads the last week's
 * requests (GET /api/boss/growth/backlink-orders, `backlinkOrders` below, field names unchanged).
 */
export const BACKLINKS = "backlinks";
export const TOPIC_MAX = 120;
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
