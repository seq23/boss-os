/**
 * SIMONE'S TRIAGE — UNTAGGED MAIL GOES TO THE SEAT THAT CAN DO IT.
 *
 * Owner, 22 Oct 2026: "i should not have to put an employee name, my main assistant should find out
 * who does it for me." And: "i should be able email simone or whomever and get them to get to work
 * building a studio like this."
 *
 * So an email to `boss@sequoiataylor.com` with NO tag is the normal case. Simone (Chief of Staff)
 * reads it, splits a multi-part email into its asks, gives each ask to the seat that can execute it,
 * and the reply says in one line per ask who has what. Tags stay as optional shortcuts: a tag she
 * typed, or the name@ address she wrote to, is her decision and this module never overrides it.
 *
 * NEVER BOUNCES TO HER. An ask no seat clearly fits goes to the CLOSEST seat (the highest score, or
 * Simone herself when nothing scores), and the reply says so in plain words. There is no "I could
 * not tell who this was for" outcome any more.
 *
 * Pure and deterministic — no model is asked. The seats are named by id because `SEAT_EXECUTORS`
 * (src/shared/boss/duties/executors.mjs) names them that way, and a seat id missing from the live
 * roster is skipped rather than guessed (`triage` takes the roster read from D1).
 */

/**
 * The seats and what each one does, in her words (the 22 Oct brief). `signals` are scored: each
 * distinct match is one point; `strong` matches are three. Order breaks ties.
 */
export const TRIAGE_SEATS = Object.freeze([
  Object.freeze({
    id: "emp_repo", does: "builds and repo changes",
    strong: /\b(build|rebuild|landing(?:\s+page)?|one[- ]page|website|web\s?site|site|studio|repo(?:sitory)?|deploy|pull request|github\.com|seq23\/)\b/gi,
    signals: /\b(page|app|feature|bug|fix|code|ship|launch|homepage|domain|branch|component|template|redesign|css|html|footer|header|form)\b/gi,
  }),
  Object.freeze({
    id: "emp_research", does: "research",
    strong: /\b(research|find out|look into|investigate|compare|comparison|what (?:is|are|does|do)|how (?:much|many|does|do|can)|which (?:is|are)|who (?:is|are))\b/gi,
    signals: /\b(why|options|cheapest|best|markets?|analy[sz]e|analysis|study|sources?|evidence|landscape|benchmarks?|report on|what changed|trends?|news)\b|\?/gi,
  }),
  Object.freeze({
    id: "emp_relationship", does: "outreach and relationships",
    strong: /\b(outreach|reach out|pitch|introduce|introduction|intro to|follow up with|cold email|email (?:them|these|those|the list|people|prospects))\b/gi,
    signals: /\b(prospects?|buyers?|sellers?|sponsors?|partners?|contacts?|leads?|networking|relationship)\b/gi,
  }),
  Object.freeze({
    id: "emp_chief", does: "scheduling and running the day",
    strong: /\b(schedule|reschedule|calendar|meeting|appointment|book (?:a |the )?(?:call|time|slot)|remind me|reminder|agenda)\b/gi,
    // Weekdays are NOT a signal: "every friday" is a duty's cadence, not a scheduling job.
    signals: /\b(tomorrow|next week|travel|errands?|plan my|my day|inbox)\b/gi,
  }),
  Object.freeze({
    id: "emp_knowledge", does: "records and the archive",
    strong: /\b(archive|file (?:this|it|these|that) away|records?|receipts?|keep a copy|log this|gallery)\b/gi,
    signals: /\b(documents?|notes|minutes|filing|save (?:this|it)|history)\b/gi,
  }),
  Object.freeze({
    id: "emp_risk", does: "risk, legal and money exposure",
    strong: /\b(risk|legal|contract|compliance|fraud|insurance|liabilit(?:y|ies)|exposure|charge(?:d|s)? (?:i|we) didn'?t)\b/gi,
    signals: /\b(lawsuit|terms|policy|security|breach|dispute|refund|audit|trade|position)\b/gi,
  }),
  Object.freeze({
    id: "emp_practice", does: "her practice: body and spirit",
    strong: /\b(practice|workout|exercise|meditat(?:e|ion)|movement|yoga|gratitude|manifest(?:ation)?|spirit(?:ual)?|astrology)\b/gi,
    signals: /\b(sleep|water|stretch|breath(?:ing|work)?|body|walk|journal)\b/gi,
  }),
  Object.freeze({
    id: "emp_continuity", does: "tools and systems",
    strong: /\b(tool|tools|automation|automate|integration|launchd|cron|backup|install|set ?up (?:the |a )?(?:mac|app|tool)|vault)\b/gi,
    signals: /\b(settings?|system|mac|laptop|app|software|plugin|sync|update)\b/gi,
  }),
]);

const CHIEF = "emp_chief";

/** Score one ask against each seat. Pure. */
export function scoreAsk(text) {
  const t = String(text ?? "").replace(/#[a-z0-9][a-z0-9_-]*/gi, " ");
  return TRIAGE_SEATS.map((s) => {
    const strong = new Set((t.match(s.strong) ?? []).map((m) => m.toLowerCase()));
    const weak = new Set((t.match(s.signals) ?? []).map((m) => m.toLowerCase()));
    return { id: s.id, score: strong.size * 3 + weak.size, matched: [...strong, ...weak] };
  });
}

/** The seat for one ask, out of the live roster. Never null when the roster has anybody. */
export function seatForAsk(text, roster) {
  const live = new Map((roster ?? []).filter((s) => s && s.id && s.name).map((s) => [s.id, s]));
  if (live.size === 0) return null;
  const chief = live.get(CHIEF) ?? [...live.values()].find((s) => /chief of staff/i.test(String(s.role ?? ""))) ?? [...live.values()][0];
  const scored = scoreAsk(text).filter((x) => live.has(x.id));
  let best = null;
  for (const x of scored) if (x.score > 0 && (!best || x.score > best.score)) best = x;
  if (!best) {
    return { seat: chief, score: 0, matched: [], closest: true,
      why: `No seat clearly fits this, so ${chief.name} (${chief.role}) is doing it herself — the closest desk to anything without a specialist.` };
  }
  const seat = live.get(best.id);
  const spec = TRIAGE_SEATS.find((s) => s.id === best.id);
  const closest = best.score < 3;
  return {
    seat, score: best.score, matched: best.matched, closest,
    why: closest
      ? `${seat.name} is the closest fit (${spec.does}; matched ${best.matched.join(", ")}) — no seat matched it squarely.`
      : `${seat.name} does ${spec.does} (matched ${best.matched.slice(0, 4).join(", ")}).`,
  };
}

const ITEM_RE = /^\s*(?:\d{1,2}[.)]|[-*•])\s+(\S.*)$/;
const ALSO_RE = /^\s*(?:also|and also|plus|separately|another thing|one more thing)\b[\s,:-]*/i;

/**
 * The asks in one email. A numbered or bulleted list is a list of asks; a paragraph that opens with
 * "also" / "separately" is a new ask. Everything before the first ask is shared context and rides
 * along with each one.
 *
 * THEN ADJACENT ASKS FOR THE SAME SEAT ARE MERGED. A list of build steps for one site is one job
 * for Danielle, not eight; an email splits only where the work changes hands.
 */
export function splitAsks(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const asks = [];
  const pre = [];
  let cur = null;
  let listed = false;
  for (const line of lines) {
    const item = ITEM_RE.exec(line);
    const also = !item && ALSO_RE.test(line) && line.trim().length > 12;
    if (item) listed = true;
    if (item || also) {
      if (cur) asks.push(cur);
      cur = [item ? item[1] : line.replace(ALSO_RE, "")];
      continue;
    }
    if (cur) {
      if (!line.trim()) { asks.push(cur); cur = null; continue; }
      cur.push(line);
    } else pre.push(line);
  }
  if (cur) asks.push(cur);
  // With no list, the text before an "also" is the first ask, not a preamble.
  if (!listed && asks.length && pre.join("").trim()) { asks.unshift(pre.slice()); pre.length = 0; }
  const context = pre.join("\n").trim();
  const parts = asks.map((a) => a.join("\n").trim()).filter(Boolean);
  if (parts.length < 2) return { context: "", parts: [String(text ?? "").trim()].filter(Boolean) };
  return { context, parts: parts.slice(0, 8) };
}

/**
 * The whole triage: split, assign, merge neighbours on the same seat. Returns one entry per job, each
 * `{ seat, text, why, closest }`, where `text` carries the shared context so the seat reads the ask
 * the way she wrote it. At least one job whenever the roster has anybody.
 */
export function triage({ subject = "", text = "", roster = [] } = {}) {
  const { context, parts } = splitAsks(text);
  const asks = parts.length ? parts : [String(subject ?? "").trim()].filter(Boolean);
  if (asks.length === 0) asks.push(String(subject ?? "") || "(no text)");
  const jobs = [];
  for (const ask of asks) {
    // A one-part email is judged with its subject; a part of a list on its own words plus context.
    const judged = asks.length === 1 ? `${subject}\n${ask}` : `${ask}\n${context}`;
    const pick = seatForAsk(judged, roster);
    if (!pick) return [];
    const last = jobs[jobs.length - 1];
    if (last && last.seat.id === pick.seat.id) { last.asks.push(ask); continue; }
    jobs.push({ seat: pick.seat, asks: [ask], why: pick.why, closest: pick.closest });
  }
  // One job: the whole email is the ask, preamble included.
  const whole = String(text ?? "").trim() || String(subject ?? "").trim();
  return jobs.map((j) => ({
    seat: j.seat, why: j.why, closest: j.closest,
    ask: jobs.length === 1 ? whole : j.asks.join("\n"),
    text: [context, ...j.asks].filter(Boolean).join("\n\n"),
  }));
}

/** One line per job for the reply: who has what. */
export function triageLines(jobs) {
  return jobs.map((j) => `${j.seat.name} has: ${oneLine(j.ask)}${j.closest ? " (closest fit — say so if you meant someone else)" : ""}`);
}

/**
 * The ask's first paragraph, whole, on one line. NOT its first line: mail clients hard-wrap plain
 * text at ~76 characters, so "the first line" of her live proof email (22 Oct 2026) was "What are
 * the three cheapest ways to host a static website with a custom" — her request cut mid-sentence in
 * Simone's acknowledgement. A paragraph is never cut, with or without an ellipsis.
 */
export function oneLine(s) {
  const para = String(s ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).find(Boolean) ?? "";
  return para.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}
