/**
 * THE ONE LIST of fund terms that never go on the Boss OS email map, and the crossings she OK'd one by
 * one. Read by tests/outboundEmailMap.test.ts (the map file) AND e2e/boss-duties.spec.ts (the rendered
 * path rows on Team -> Duties), so the two can never keep their own lists again: on 23 Oct 2026 the
 * e2e kept a private copy without her OK'd crossings and main went red on #116.
 */
export const FUND_TERMS: Array<[string, RegExp]> = [
  ["a west-peek-* repo", /\bwest-?peek-[a-z]/i],
  ["a westpeek domain", /@?\bwestpeek\.[a-z]+/i],
  ["a joinwestpeek.com sender", /joinwestpeek\.com/i],
  ["West Peek", /west\s*peek/i],
  ["Porter", /\bporter\b/i],
  ["Scooter", /\bscooter\b/i],
  ["LP", /\bLPs?\b/i],
  ["investor", /\binvestors?\b/i],
];

/**
 * CROSSINGS SHE OK'D, ONE BY ONE (owner, 23 Oct 2026: "separation relaxes per item she OKs"; Monique
 * may read and write the fund's LP mailbox for LP replies). A CLOSED list: each entry names one map
 * row and only the terms that row may carry. Every other term, row, owner entry and line of the map
 * is still guarded, and the test below fails if an entry here names a row the map no longer has.
 */
export const OWNER_OK_CROSSINGS: Record<string, string[]> = {
  // Names the constant that holds the mailbox she OK'd (ruling 11), never the address itself.
  "monique-prospects": ["LP"],
  "her-tap-send": ["LP"], // her tap sends a held LP reply (ruling 10)
  "simone-your-day": ["LP"], // her one morning email carries the held LP replies she taps (ruling 10): its `lp` section file
};

export function fundCrossings(entries: Array<[string, string]>): string[] {
  const hits: string[] = [];
  for (const [where, text] of entries) {
    const id = (/^\|\s*`([^`]+)`\s*\|/.exec(text) ?? /^owner (\S+)$/.exec(where) ?? [])[1];
    const allowed = (id && OWNER_OK_CROSSINGS[id]) || [];
    for (const [name, re] of FUND_TERMS) if (re.test(text) && !allowed.includes(name)) hits.push(`${where}: names ${name}`);
  }
  return hits;
}
