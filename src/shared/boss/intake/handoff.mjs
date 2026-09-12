/**
 * "ROUTE THIS TO WHOMEVER SHOULD HANDLE THIS" — BY RULE, NOT BY A MODEL'S OPINION.
 *
 * ─── The capability that did not exist ─────────────────────────────────────
 *
 * On 12 September 2026 she wrote: "please help me find a seller of $1B+ of OpenAI shares. Route this
 * to whomever should handle this." It carried no tag, so it DEFAULTED to the Chief of Staff, and
 * there it stayed. Grepping the whole repository for a statement that changes `tasks.employee_id`
 * returns exactly one: inside employee MERGE, at `routes/employees.ts`. Handing a piece of work to a
 * colleague was not a slow capability or a broken one. It did not exist.
 *
 * ─── Why this is keywords and not a model ──────────────────────────────────
 *
 * The obvious implementation is to ask a language model which seat should take it. That is precisely
 * what already failed: the same message, handed to a model, produced "Classification: General
 * Inquiry. Routing: Route to Customer Service Team." — a department this company does not have, for
 * a request to place a billion dollars of stock.
 *
 * So the rule is DETERMINISTIC and it runs BEFORE any model. It is allowed to be narrow. A handoff
 * that fires on a clear signal and stays silent otherwise is useful; one that guesses is the routing
 * hallucination coming back through a different door.
 *
 * ─── What it may and may not do ────────────────────────────────────────────
 *
 *   - It names a DEPARTMENT, never an employee id. The seat is looked up in the `employees` table by
 *     whoever calls this, so the roster stays derived and never becomes a second list. Hire someone
 *     into Relationships and the handoff follows them with no code change.
 *   - It only ever moves work AWAY from the Chief of Staff's desk. She is the default holder — where
 *     untagged mail lands — so moving work off that desk is completing a routing decision that was
 *     never really made. Moving work off a desk the owner NAMED with a tag would be overruling her,
 *     and this must never do that.
 *   - It returns null far more often than it returns a department, and null is the ordinary path.
 *
 * Plain ESM with a hand-written `.d.mts`, like its neighbours, so `scripts/validate` exercises these
 * rules directly rather than asserting a copy of them.
 */

/** The desk the owner's untagged mail lands on. Work may be moved off it, and off no other. */
export const HOLDING_DEPARTMENT = "Office of the Principal";

/**
 * THE SIGNALS, ONE DEPARTMENT AT A TIME.
 *
 * `needs` is read as: at least one word from EVERY group must appear. One group alone is not a
 * signal — "shares" is in half her mail and "find" is in the other half; "find … a seller of …
 * shares" is a placement instruction. Requiring a word from each group is what keeps this from
 * firing on ordinary correspondence.
 */
export const HANDOFF_RULES = [
  {
    department: "Relationships",
    why: "it names a counterparty and a trade in her book — that is the Relationships desk's whole job",
    needs: [
      // Something being placed or found.
      /\b(?:find|finding|source|sourcing|hunt|hunting|place|placing|sell|selling|seller|sellers|buy|buying|buyer|buyers|match|matching|introduce|introduction|intro)\b/i,
      // Something to place it in.
      /\b(?:capital|shares?|stock|equity|block|blocks|lot|lots|position|positions|secondary|secondaries|spv|allocation|bid|offer|book)\b/i,
    ],
    /*
     * OR a dollar size on its own, which is unambiguous in her mail: she does not write "$1B" about
     * anything except a trade. This is the half that catches "route this to whomever should handle
     * this" when the nouns are thin.
     */
    orAny: [/\$\s?\d[\d,.]*\s*(?:k|m|mm|b|bn|billion|million|thousand)\b/i],
  },
];

/**
 * SHE ASKED FOR IT TO BE PASSED ON.
 *
 * The `DEFAULTED` gate below exists because a tag she typed is a decision she made, and it is
 * right. It has one blind spot, and it is the exact sentence that started all of this:
 *
 *   "#simone please help me find a seller of $1B+ of OpenAI shares.
 *    Route this to whomever should handle this."
 *
 * She named a seat AND asked that seat to pass it on. That is not a decision to overrule — it is an
 * instruction to carry out, and the gate refused it because the outcome was `ROUTED`. Re-admitted in
 * production on 12 September with the body fix in place, the model read the whole instruction and
 * then INVENTED A COLLEAGUE to satisfy it: "I will route this task to our Financial Acquisitions
 * team, specifically to Alex, who handles high-value transactions." There is no Alex. There is no
 * Financial Acquisitions team. That is the routing hallucination coming back through the door this
 * module was built to close, because the deterministic rule declined to answer and the model would
 * not decline.
 *
 * So an EXPLICIT instruction to pass the work on lifts the outcome gate — and only that. It must be
 * something she actually wrote, not an inference: "route this", "pass this to", "hand this to",
 * "send this to", followed by whoever/whomever/the right person. Nothing here fires on a message
 * that merely mentions routing.
 */
export const ROUTE_ONWARD = [
  /\b(?:route|pass|hand|send|forward|give|assign)\s+(?:this|it|these|them)\b[^.]{0,40}?\b(?:who(?:m)?ever|who(?:m)?\s+should|the\s+right\s+(?:person|desk|seat|employee)|whoever\s+handles)\b/i,
  /\bwho(?:m)?ever\s+should\s+(?:handle|take|own|run)\b/i,
  /\b(?:route|assign|hand)\s+(?:this|it)\s+(?:on|onward|onwards|along)\b/i,
];

/** Did she explicitly ask for this to be passed to somebody else? */
export function asksToBeRouted(text) {
  const v = String(text ?? "");
  return ROUTE_ONWARD.some((re) => re.test(v));
}

/** The text she actually wrote, with employee tags removed so a tag is never a keyword. */
function said(text) {
  return String(text ?? "").replace(/#[a-z0-9][a-z0-9_-]*/gi, " ");
}

/**
 * Which department should take this instead, if any.
 *
 * `outcome` is the routing outcome from `routeToSeat`: only a DEFAULTED message — one where she
 * named nobody — may be moved.
 *
 * @returns `{ department, why, matched }` or null. Null is the ordinary answer.
 */
export function handoffFor({ text = "", subject = "", fromDepartment = "", outcome = "DEFAULTED" } = {}) {
  /*
   * ─── A TAG SHE TYPED IS A DECISION SHE MADE ───────────────────────────────
   *
   * `outcome` is the FIRST gate and it is the one that matters. THE BUG IT FIXES, caught in
   * production on the very first re-admission: the Chief of Staff is both the named seat `#simone`
   * AND the desk untagged mail defaults to, so a department check alone moved a message she had
   * explicitly addressed to Simone — "make sure the spirit page … displays astrology" — onto
   * Monique's desk, on the words "source" and "capital" appearing somewhere in a 30 KB report.
   *
   * `DEFAULTED` means no tag matched anybody: nobody has chosen yet, and a rule may complete that.
   * `ROUTED` means she named a seat. `AMBIGUOUS` means two seats share a first name and the Chief of
   * Staff is holding it until she says which — also her decision to make, not this rule's.
   *
   * The department check stays as well, because the two say different things: `outcome` says nobody
   * chose, and the department says the message is sitting on the desk this rule is allowed to clear.
   */
  const haystack = said(`${subject}\n${text}`);

  /*
   * The outcome gate, with the one exception she wrote herself. `DEFAULTED` means nobody has chosen
   * and a rule may complete that. An explicit "route this to whoever should handle it" means she
   * chose to delegate the choice — see ROUTE_ONWARD above, and the invented "Alex" that came of
   * refusing it. Everything else she addressed by name stays where she put it.
   */
  const decided = String(outcome ?? "");
  const mayMove =
    decided === "DEFAULTED"
    // She named ONE seat and asked that seat to pass it on. Obeying her is not overruling her.
    || (decided === "ROUTED" && asksToBeRouted(haystack));
  /*
   * `AMBIGUOUS` is deliberately NOT in that list, and the validator holds the line. It means two
   * seats share a first name and nobody can tell which she meant — so "route this to whoever should
   * handle this" cannot resolve it either, and a keyword rule picking one would be guessing at the
   * very moment the system has already admitted it does not know. That one stays hers.
   */
  if (!mayMove) return null;

  /*
   * The desk check is NOT relaxed by that exception. Work may be moved off the Chief of Staff's
   * desk and off no other, so an instruction to route something that is already on a specialist's
   * desk still does nothing — she would be asking that specialist, not this rule.
   */
  if (String(fromDepartment ?? "").trim() !== HOLDING_DEPARTMENT) return null;

  if (!haystack.trim()) return null;

  for (const rule of HANDOFF_RULES) {
    const matched = [];
    let ok = rule.needs.every((re) => {
      const m = re.exec(haystack);
      if (m) matched.push(m[0].trim());
      return Boolean(m);
    });
    if (!ok && rule.orAny) {
      ok = rule.orAny.some((re) => {
        const m = re.exec(haystack);
        if (m) matched.push(m[0].trim());
        return Boolean(m);
      });
    }
    if (ok) return { department: rule.department, why: rule.why, matched };
  }
  return null;
}

/**
 * The seat in that department, out of the roster that was read from D1.
 *
 * THE ROSTER IS THE ROSTER. This takes the list the caller already read from `employees` and never
 * holds one of its own — the defect this repo names most often is two components each keeping their
 * own list with no link between them, and a hardcoded `emp_relationship` here would be exactly that.
 * Null when the department has nobody in it, and null must leave the message where it was: a handoff
 * to an empty desk is worse than no handoff.
 */
export function seatInDepartment(roster, department) {
  const want = String(department ?? "").trim().toLowerCase();
  if (!want) return null;
  return (roster ?? []).find((s) => String(s?.department ?? "").trim().toLowerCase() === want) ?? null;
}

/**
 * ─── "FIND ME A SELLER OF $1B+ OPENAI" — THE ASSET AND THE SIZE, OUT OF HER SENTENCE ─────────────
 *
 * A handoff moves the work to the right desk. This says what the work IS, so the desk does not have
 * to guess and no model has to be asked. `scripts/ops/buyer-hunt.mjs` already takes `--asset`,
 * `--size` and `--side`; all that was missing was the sentence-to-arguments step.
 *
 * DETERMINISTIC, AND IT REFUSES RATHER THAN GUESSES. A request with no readable asset, or no
 * readable size, returns null and the task is ordinary work on the right desk — which is still
 * strictly better than what happened before. Queueing a hunt for an asset nobody named is exactly
 * the "runs but inert" outcome: a real search, run against nothing, reported as a quiet week.
 *
 * THE SIDE IS THE VERB SHE USED. "find me a SELLER" means she is buying and wants the sell side;
 * "find BUYERS for" means the opposite. There is no default — a hunt whose direction was assumed
 * would return the wrong half of the market and look exactly like it worked.
 */
const SIZE_UNITS = { k: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** A dollar figure written the way she writes them: $1B+, $600M, up to $1B, $50 million. */
export function sizeUsdIn(text) {
  const m = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|mm|m|bn|b|million|billion)?\b/i.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = String(m[2] ?? "").toLowerCase();
  return unit ? n * (SIZE_UNITS[unit] ?? 1) : n;
}

/** The side of the market being hunted, from the noun she used. Null when she did not say. */
export function huntSideIn(text) {
  const t = String(text ?? "");
  if (/\b(?:sellers?|sell[-\s]?side|someone\s+selling|who(?:'s| is)\s+selling)\b/i.test(t)) return "sell";
  if (/\b(?:buyers?|buy[-\s]?side|someone\s+buying|bid|bidders?)\b/i.test(t)) return "buy";
  return null;
}

/**
 * The asset, which is the word between the size and the paper.
 *
 * "a seller of $1B+ of OpenAI shares" -> OpenAI. Matched on the SHAPE of the phrase rather than on a
 * list of company names: a list would be a second copy of her book, and the next name she trades
 * would silently not be on it.
 */
export function assetIn(text) {
  const t = withoutTags(text);
  /*
   * THE UNITS ARE CASE-INSENSITIVE AND THE NAME IS NOT, so these are written as explicit character
   * classes rather than with the `i` flag. An `i` flag here makes `[A-Z]` match lowercase too, and
   * the first draft of this duly returned "the Databricks" as the name of a company.
   */
  const SIZE = "\\$\\s?\\d[\\d,.]*\\s*(?:[kK]|[mM][mM]?|[bB][nN]?|[mM]illion|[bB]illion|[tT]housand)?\\+?";
  const NAME = "([A-Z][A-Za-z0-9.&'\u2019-]*(?:\\s+[A-Z][A-Za-z0-9.&'\u2019-]*)?)";
  const patterns = [
    // "$1B+ of OpenAI shares" / "$600M in Anthropic"
    new RegExp(`${SIZE}\\s+(?:of|in)\\s+${NAME}`),
    // "seller of OpenAI shares" / "buyers for Databricks"
    new RegExp(`(?:[sS]ellers?|[bB]uyers?)\\s+(?:of|for|in)\\s+(?:the\\s+)?${NAME}`),
    // "$1B+ OpenAI"
    new RegExp(`${SIZE}\\s+${NAME}`),
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (!m) continue;
    const asset = m[1].replace(/\s+(?:shares?|stock|equity|paper|block|blocks|secondary|secondaries)$/i, "").trim();
    if (asset && !NOT_A_NAME_HERE.test(asset)) return asset;
  }
  return null;
}

/** Words that are grammar rather than a company. */
const NOT_A_NAME_HERE = /^(?:the|a|an|of|in|for|this|that|shares?|stock|equity|block|blocks|it|them|and|or|to)$/i;

/** Text with the employee tags taken out — the same rule `clarify.mjs` uses. */
function withoutTags(text) {
  return String(text ?? "").replace(/#[a-z0-9][a-z0-9_-]*/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * The whole hunt request, or null.
 *
 * @returns `{ asset, size_usd, side }` — everything `buyer-hunt.mjs` needs on its command line.
 */
export function huntRequestIn(text) {
  const side = huntSideIn(text);
  if (!side) return null;
  const asset = assetIn(text);
  if (!asset) return null;
  const sizeUsd = sizeUsdIn(text);
  if (!sizeUsd) return null;
  return { asset, size_usd: sizeUsd, side };
}
