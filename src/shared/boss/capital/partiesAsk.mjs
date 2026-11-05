/**
 * "FIND ALL BUYERS OF <COMPANY>" — answered from her deal grid, not by a model (5 Nov 2026).
 *
 * She wrote "I need to find all buyers if moonshot ai … Monique needs to go into my inbox and find
 * any buyers for moonshot. Give me their emails." The ordinary triage gave it to a cloud model with
 * no way into her inbox, and it failed. The grid IS her inbox's deal emails, parsed on her Mac
 * (`npm run capital:grid`) and pushed to `capital_deal_rows` with each order's people and addresses.
 * So the answer is a read: every buy (or sell) order on that company in the last twelve months,
 * nobody on her do-not-suggest list, her own orders left out, one line per person (a broker who
 * re-sends the same order every week is counted once, CLAUDE.md "Deals" rule 5), newest first.
 */

const ASK_RE = /\b(?:find|get|list|show|pull|give\s+me|send\s+me|who\s+are|need)\b[^.\n?!]{0,40}?\b(buyers?|sellers?)\s+(?:of|for|in|on)\s+([A-Za-z0-9][A-Za-z0-9 .&'’-]{1,40}?)(?=\s*(?:[.?!,;:\n]|$)|\s+(?:and|in|from|give|shares?|stock|please|for\s+me)\b)/i;

/** Her words → `{ company, side: "buy" | "sell" }`, or null. */
export function partiesAskIn(text) {
  const m = ASK_RE.exec(String(text ?? ""));
  if (!m) return null;
  const company = m[2].replace(/\s+(?:the|a|an|any|all)$/i, "").trim();
  // "buyers for my book" is a sales question, not a company on the grid.
  if (norm(company).length < 3 || /^(?:my|our|her|his|their|this|that|these|those|it|them|me|you)\b/i.test(company)) return null;
  return { company, side: /^buy/i.test(m[1]) ? "buy" : "sell" };
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Moonshot AI" asks for rows named "Moonshot", "MoonshotAI" or "Moonshot AI". */
export function companyMatches(rowCompany, asked) {
  const a = norm(asked), r = norm(rowCompany);
  if (a.length < 3 || r.length < 3) return false;
  return r === a || a.startsWith(r) || r.startsWith(a);
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const day = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/** The grid rows that name this company, any side. None means the ask is not about the grid. */
export function rowsForCompany(rows, company) {
  return rows.filter((r) => companyMatches(r.company, company));
}

/**
 * The reply. `rows` are grid rows already filtered for the window and her do-not-suggest list.
 * Stale wording follows the grid's: over 60 days "may be stale", over six months "old".
 */
export function partiesReply({ company, side }, rows, now = Date.now()) {
  const want = side === "buy" ? "buyers" : "sellers";
  const hits = rows.filter((r) => r.side === side && companyMatches(r.company, company))
    .sort((x, y) => String(y.received_on).localeCompare(String(x.received_on)));
  const people = new Map();
  for (const r of hits) {
    const emails = [...new Set(String(r.parties ?? "").match(EMAIL_RE) ?? [])].map((e) => e.toLowerCase());
    const key = emails.length ? emails.slice().sort().join(",") : norm(r.from_text);
    const seen = people.get(key);
    if (seen) { seen.times += 1; continue; }
    people.set(key, { from: String(r.from_text ?? "").trim() || "Someone", emails, size: r.size_text, price: r.price_text, on: r.received_on, times: 1 });
  }
  if (people.size === 0) {
    return `I found no ${want} of ${company} in your deal emails from the last twelve months. Your deals grid is built from your inbox every morning, so a new order shows up there and I'll include it next time you ask.`;
  }
  const lines = [...people.values()].map((p) => {
    const age = (now - Date.parse(`${p.on}T12:00:00Z`)) / 86_400_000;
    const fresh = age > 183 ? " (old)" : age > 60 ? " (may be stale: check it's still live)" : "";
    const what = [p.size && p.size !== "—" ? p.size : null, p.price && p.price !== "—" ? `at ${p.price}` : null].filter(Boolean).join(" ");
    const again = p.times > 1 ? `, sent ${p.times} times` : "";
    return `- ${p.from}: ${p.emails.length ? p.emails.join(", ") : "no address in the email"}${what ? `, ${side === "buy" ? "wants" : "has"} ${what}` : ""}, ${day(p.on)}${again}${fresh}`;
  });
  const n = people.size;
  return [
    `${n} ${n === 1 ? want.slice(0, -1) : want} of ${company} in your deal emails from the last twelve months, newest first:`,
    ...lines,
    "",
    "Your own orders and anyone on your do-not-suggest list are left out. The full grid is on the Deals screen.",
  ].join("\n");
}
