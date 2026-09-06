/**
 * DOES ONE EMPLOYEE ACTUALLY COVER ANOTHER'S GROUND?
 *
 * THE DEFECT THIS REPLACES. The sprawl report ran
 *
 *     GROUP BY lane, department HAVING COUNT(*) > 1
 *
 * and the Team screen rendered the result as "Two employees cover the same ground: Chief of Staff,
 * Task Intake; Model Router, Continuity. Merge one before the roster grows again."
 *
 * That query measures how many people share a department. The sentence claims they do the same
 * job. On the live roster it accused four employees who do nothing of the sort - Continuity keeps
 * the system rebuildable and runs restore drills; Model Router decides where work runs, honouring
 * privacy class and budget. They share the label "Continuity + Local Model" and nothing else.
 *
 * A department with two people in it is the normal, intended shape of a department. A detector
 * that fires on the normal shape of the thing it watches is as useless as one that never fires,
 * and worse than useless when it fires as an accusation with a recommended action attached: the
 * standing advice on that screen was to merge two employees who each do a job nobody else does.
 *
 * WHAT REPLACES IT. Charters are standing orders - the closest thing this schema has to a
 * statement of what an employee is FOR. Two employees cover the same ground when their charters
 * say close to the same thing, which is measurable, and not when a grouping column matches, which
 * is not. Sharing a department is still reported, as the roster fact it is, with no verb attached.
 */

/**
 * Words that carry no information about what an employee does.
 *
 * Charters are written in the imperative and share a house style, so without this the baseline
 * similarity between any two of them is high enough to swamp the signal. Kept deliberately short:
 * an over-eager stop list is another way to make everything look alike.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "by", "for", "with",
  "from", "as", "is", "are", "was", "be", "been", "it", "its", "this", "that", "these", "those",
  "you", "your", "do", "does", "did", "not", "no", "never", "always", "what", "who", "which",
  "when", "where", "how", "than", "then", "so", "up", "out", "into", "over", "under", "before",
  "after", "every", "each", "any", "all", "one", "two", "own", "boss", "system", "work", "make",
]);

/** Charter text to the set of words that say something about the job. */
export function charterTerms(charter: string | null | undefined): Set<string> {
  if (!charter) return new Set();
  return new Set(
    charter
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      // Two-letter words are almost all function words, and keeping them adds noise on both sides
      // of the ratio.
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Jaccard similarity: shared terms over total distinct terms, 0 to 1.
 *
 * Symmetric and length-aware, which matters here because charters vary from one sentence to four.
 * A containment measure would call a short charter a duplicate of any long one that happened to
 * mention the same few words.
 */
export function charterSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = charterTerms(a);
  const right = charterTerms(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * The bar for calling two employees the same.
 *
 * 0.55 is high on this measure - it means most of what each charter says, the other one says too.
 * Chosen against the real roster rather than picked as a round number: the closest genuine pair on
 * the live roster (Chief of Staff and Task Intake, which both triage incoming work) scores well
 * under it, and they are correctly two jobs. A threshold that flagged them would be the old bug
 * with extra arithmetic.
 *
 * Erring high is the right direction. A missed duplicate costs a roster review that finds nothing;
 * a false one recommends merging an employee whose job then belongs to nobody.
 */
export const SAME_GROUND = 0.55;

export interface RosterMember {
  id: string;
  name: string;
  lane: string;
  department: string | null;
  charter: string | null;
}

export interface CharterOverlap {
  lane: string;
  department: string | null;
  a: { id: string; name: string };
  b: { id: string; name: string };
  similarity: number;
}

/**
 * Pairs whose standing orders genuinely say the same thing.
 *
 * Compared within a LANE, never across one. Trading and operations are isolated by design and
 * employees cannot be merged across them, so a cross-lane pair is not an actionable finding even
 * when the text matches - it is two lanes each needing the same job done.
 */
export function overlappingCharters(
  roster: RosterMember[],
  threshold = SAME_GROUND,
): CharterOverlap[] {
  const found: CharterOverlap[] = [];
  for (let i = 0; i < roster.length; i += 1) {
    for (let j = i + 1; j < roster.length; j += 1) {
      const a = roster[i]!;
      const b = roster[j]!;
      if (a.lane !== b.lane) continue;
      const similarity = charterSimilarity(a.charter, b.charter);
      if (similarity < threshold) continue;
      found.push({
        lane: a.lane,
        department: a.department === b.department ? a.department : null,
        a: { id: a.id, name: a.name },
        b: { id: b.id, name: b.name },
        similarity: Math.round(similarity * 100) / 100,
      });
    }
  }
  return found.sort((x, y) => y.similarity - x.similarity);
}
