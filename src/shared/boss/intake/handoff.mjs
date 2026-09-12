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

/** The text she actually wrote, with employee tags removed so a tag is never a keyword. */
function said(text) {
  return String(text ?? "").replace(/#[a-z0-9][a-z0-9_-]*/gi, " ");
}

/**
 * Which department should take this instead, if any.
 *
 * @returns `{ department, why, matched }` or null. Null is the ordinary answer.
 */
export function handoffFor({ text = "", subject = "", fromDepartment = "" } = {}) {
  /*
   * ONLY OFF THE HOLDING DESK. If she typed `#simone`, she chose Simone; if she typed nothing, the
   * message defaulted there and no one has chosen anything yet. Only the second is a routing
   * decision still waiting to be made, and only the second may be completed by a rule.
   */
  if (String(fromDepartment ?? "").trim() !== HOLDING_DEPARTMENT) return null;

  const haystack = said(`${subject}\n${text}`);
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
