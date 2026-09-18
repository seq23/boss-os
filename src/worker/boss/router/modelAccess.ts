/**
 * MODEL ACCESS — which models may see this work.
 *
 * The owner's ruling is one sentence: LP NAMES AND DEAL TERMS ARE CONFIDENTIAL. Her label for the
 * consequence of that is the one used here and everywhere else:
 *
 *   "I'D ALSO LIKE TO CHANGE THE TERMINOLOGY FROM CONFIDENTIAL / NOT — MAYBE JUST LABEL IT
 *    PUBLIC MODEL APPROVED / PRIVATE MODEL ONLY"
 *
 * `public_model_approved` is the default and covers most work. `private_model_only` is the fund's
 * private side, and it may not reach a route whose terms permit training on what it is sent.
 *
 * ─── THIS AXIS IS NOT THE AUDIENCE AXIS ─────────────────────────────────────────────────────────
 *
 * Nothing in this file reads `internal` or `external`, and nothing may be added that does. Who
 * receives the OUTPUT is a question about approval; which models may see the INPUT is a question
 * about training terms. Deriving one from the other is the defect this file was rewritten to
 * remove — see `shared/boss/governance.ts` for the owner's words on what that cost.
 *
 * ─── WHY IT IS NOT A PROMPT, A WRAPPER, OR A CHECK ON THE WAY BACK ──────────────────────────────
 *
 * Three shapes were available and two of them are not controls:
 *
 *   · A SENTENCE IN THE SYSTEM PROMPT asking the model not to remember. That is a request made to
 *     the very party the rule exists to constrain, and it arrives after the material has already
 *     been sent. v20.1 §3 says the equivalent rule must be "enforced technically, not merely by
 *     prompt wording or an approval card".
 *   · A CALLER THAT REMEMBERS TO SET THE LABEL. Every caller, for ever, including ones written next
 *     year by somebody who has not read this file. The one that forgets is the one that leaks, and
 *     it leaks silently. `routeCompletion` accepts a caller-declared label and that stays — it is
 *     useful — but it cannot be the whole of the mechanism, because a promise made by the party
 *     being checked is not a check.
 *   · REFUSED AT THE ROUTER, FROM THE CONTENT ITSELF. What this file does.
 *
 * ─── HOW IT DECIDES ─────────────────────────────────────────────────────────────────────────────
 *
 * The router reads the outgoing messages against a lexicon built from the tables that actually hold
 * this material — the LP names and counterparty names the database knows — plus patterns for the
 * SHAPE of a deal term, which catches material about an LP whose name is not in the database yet.
 *
 * WHAT IT NEVER DOES IS FILTER. There is no redaction, no scrubbing, no "send it with the names
 * removed". A hit removes CANDIDATES, never words: the models whose terms permit training on
 * prompts stop being eligible, and if none is left the run stops and says so. Rewriting her content
 * to fit a cheaper route is exactly the quiet downgrade §3.1 forbids, and a scrubber that missed
 * one name would be worse than no scrubber at all, because it would have been trusted.
 *
 * ─── FAILING CLOSED, INCLUDING ON ITS OWN FAILURE ───────────────────────────────────────────────
 *
 * If the lexicon cannot be built — a table missing, a query that throws, a result truncated at the
 * cap — this does NOT return "nothing found". It returns `established: false`, and the scan treats
 * an unestablished lexicon as `private_model_only`. The consequence is bounded and deliberate: work
 * still runs, on the routes that do not train, which is Workers AI and today nothing else. The
 * system gets slower and safer rather than faster and leakier, which is the correct direction for
 * a failure nobody noticed.
 */

import {
  DEFAULT_MODEL_ACCESS,
  isModelAccess,
  modelAccessFromLegacySensitivity,
  type ModelAccess,
} from "../../../shared/boss/governance";
import type { ChatMessage } from "./types";

/**
 * The three states a route's data-use terms can be in, matching `models.data_use` from 0249.
 *
 * `UNKNOWN` IS NOT A THIRD BEHAVIOUR. It reads differently and it enforces identically to
 * `TRAINS_ON_PROMPTS`: "we could not find out" and "yes it trains" have the same consequence for a
 * name that must not leak. The distinction is kept so the REPORT can say which it was.
 */
export type DataUse = "NO_TRAINING_CONTRACTUAL" | "TRAINS_ON_PROMPTS" | "UNKNOWN";

/**
 * Is this route a PRIVATE MODEL — one whose own terms forbid training on what it is sent?
 *
 * ONE VALUE SAYS YES AND EVERYTHING ELSE SAYS NO, including null, including a string nobody
 * recognises, including a column that has not been added yet. A future `data_use` value invented by
 * somebody adding a provider is refused until this function is changed in a diff.
 *
 * NOTE WHICH VOCABULARY IS WHICH, because there are two and they are not duplicates.
 * `models.data_use` is EVIDENCE about a route — a finding with a citation behind it, recorded in
 * 0249. `ModelAccess` is a LABEL on the work. This function is the single join between them, and it
 * is the only place either vocabulary has to know the other exists.
 */
export function isPrivateModelRoute(dataUse: string | null | undefined): boolean {
  return dataUse === "NO_TRAINING_CONTRACTUAL";
}

/**
 * Where the private material lives, and which column carries the NAME.
 *
 * Only name-bearing columns. Free text is deliberately absent: `notes`, `claim_text` and `bio` hold
 * prose, and turning prose into a lexicon of "names" produces a list of ordinary English words that
 * matches every prompt and takes the whole system off the cloud. The patterns below are what covers
 * the material this list cannot.
 *
 * SOME OF THESE ARE CHASSIS TABLES (`lp_record`, `lp_claim`, `diligence_claim`,
 * `investment_opportunity`). They are read anyway. A name is private because of what it is, not
 * because of which half of this Worker's history the table came from, and the owner's ruling named
 * `lp_claim` and `diligence_claim` explicitly.
 */
export const PRIVATE_SOURCES: readonly { table: string; column: string; what: string }[] = [
  { table: "lps", column: "name", what: "an LP" },
  { table: "lp_record", column: "legal_name", what: "an LP" },
  { table: "organizations", column: "name", what: "a counterparty" },
  { table: "deals", column: "name", what: "a deal" },
  { table: "investment_opportunity", column: "title", what: "a deal" },
  { table: "investment_opportunity", column: "seller_name", what: "a counterparty" },
  { table: "investment_opportunity", column: "broker_name", what: "a counterparty" },
  { table: "capital_book_line", column: "asset", what: "a position" },
];

/**
 * How many names the lexicon may hold before the scan declares itself unestablished.
 *
 * IT IS A LIMIT ON THE SCAN, NOT A SILENT TRUNCATION. Exceeding it does not mean "check the first
 * 4,000 and hope"; it means the scan cannot answer and the run is `private_model_only`. The number
 * is generous against a database holding single-digit LPs and is here so a Worker with a 10 ms CPU
 * budget cannot be made to scan an unbounded list.
 */
export const LEXICON_CAP = 4000;

/**
 * Names shorter than this are not matched.
 *
 * A two-letter organisation name substring-matches half the English language, and a lexicon that
 * fires on every prompt is a lexicon that gets switched off. Longer names are what actually
 * identify a counterparty.
 */
const MIN_NAME_LENGTH = 4;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE SHAPE OF A DEAL TERM, IN TWO TIERS, AND THE SECOND TIER IS WHY.
 *
 * ─── WHAT THE ONE-TIER VERSION DID ──────────────────────────────────────────────────────────────
 *
 * This list used to be flat, every pattern sufficient on its own, defended by an asymmetry
 * argument: "a false positive costs a run the OpenRouter tier and routes it to Workers AI instead,
 * which is free". The argument is sound about MONEY and wrong about everything else, and the flat
 * list misfired twice over in one night:
 *
 *   · A FIRM NOTICE containing the words "a commitment made" — boilerplate about employees
 *     proposing rather than acting — rode in front of every prompt in the system and made EVERY
 *     EMPLOYEE RUN scan as LP material, firm-wide. It was noticed only because a router test
 *     reported "2 of 6 refused".
 *   · ORDINARY WORK. A hiring search naming a salary band tripped the money pattern. An event kit
 *     describing the seating tripped "allocation language". Measured against twelve real
 *     not-confidential work cards, the flat list misfired on two of them.
 *
 * AND THE COST OF A MISFIRE IS NOT NOTHING HERE, even though it is not a bill. `private_model_only`
 * leaves exactly one eligible route — Workers AI — so a misfire deletes the fallback tier, and for
 * the kinds on the 8B allowlist (0251) it can narrow the field to a single model or to none at all,
 * which blocks the run outright. The owner's ruling is the other half of the same point:
 *
 *   "ITS NOT DEAL TERMS OR LP INFORMATION SO IT DOESNT MATTER IF ITS USING THIS DATA TO TRAIN.
 *    WHO CARES ABOUT HIRING SEARCH AND EVENT KITS AND ROOM KITS. THEY ARE NOT PRIVATE INFO."
 *
 * ─── WHAT REPLACES IT, AND WHY THIS SHAPE ───────────────────────────────────────────────────────
 *
 * The material that must not leak is a PARTY plus a TERM. The lexicon already covers every party
 * this database knows. What the patterns are for is the party it does NOT know yet — and the
 * signal that distinguishes "an LP conversation about someone new" from "a hiring search" is not
 * one word, it is the vocabulary arriving together.
 *
 * So: FUND INSTRUMENT words are sufficient alone, because a room packet does not contain the phrase
 * "capital call" and if one ever does, being routed to the free private lane costs it nothing.
 * AMBIGUOUS words are sufficient only TOGETHER — two distinct ones, or one plus a money figure.
 * "Allocation" in an event kit is one signal and stays public. "Allocation" next to a cheque and a
 * figure is three, and is not.
 *
 * NOTHING WAS DELETED. Every pattern that used to be here is still here; what changed is that the
 * ones that also occur in ordinary English now need corroboration. The strong half behaves exactly
 * as it did, which is why the real-material fixtures below all still fail closed.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Tier one. Fund and deal instruments. A single hit is enough, on its own, every time. */
export const FUND_INSTRUMENT_PATTERNS: readonly { re: RegExp; what: string }[] = [
  { re: /\b(capital call|called capital|drawdown|subscription agreement)\b/i, what: "capital-call language" },
  { re: /\b(carried interest|hurdle rate|preferred return|waterfall|clawback|management fee)\b/i, what: "fund-economics language" },
  { re: /\b(side letter|most favou?red nation|\bmfn\b|lpa\b|limited partnership agreement|capital account)\b/i, what: "side-letter language" },
  { re: /\b(pre-?money|post-?money|cap ?table|fully diluted|term sheet)\b/i, what: "deal-term language" },
  { re: /\b(data ?room|diligence request|diligence memo|investment memo)\b/i, what: "diligence language" },
  { re: /\b(cheque size|check size|capital commitment|lp commitment)\b/i, what: "commitment language" },
];

/**
 * Tier two. Words that mark a deal term AND appear in ordinary firm writing.
 *
 * Each of these has a legitimate non-fund reading that this firm actually produces: a salary band
 * is a money figure, an event kit allocates seats, a site audit discusses ownership of a page, a
 * Kindle listing carries a price, a partner "is committed" to a date. ONE OF THESE IS NOT A
 * FINDING. Two distinct ones is.
 */
export const AMBIGUOUS_TERM_PATTERNS: readonly { re: RegExp; what: string }[] = [
  { re: /\$\s?\d[\d,.]*\s?(k\b|m\b|bn\b|b\b|million|billion|thousand)/i, what: "a money figure" },
  { re: /\b(commitments?|committed)\b/i, what: "commitment wording" },
  { re: /\b(carry|hurdle|subscription)\b/i, what: "economics wording" },
  { re: /\b(valuation|ownership|equity stake)\b/i, what: "valuation wording" },
  { re: /\b(ticket size|allocation|pro rata)\b/i, what: "allocation wording" },
  { re: /\b(due diligence|diligence)\b/i, what: "diligence wording" },
  /*
   * A PERCENTAGE, which is here to corroborate rather than to accuse.
   *
   * "Their carry is 20%" has no money figure in it and no instrument word, and without this it
   * would read as one ambiguous hit and go public. A rate next to fund vocabulary is the second
   * signal that makes it deal material. On its own a percentage is a bounce rate, an open rate or
   * a discount, which is why it is in this tier and not the one above.
   */
  { re: /\b\d{1,3}(\.\d+)?\s?%/, what: "a rate" },
];

/**
 * Every pattern, both tiers, in one list.
 *
 * THIS IS THE LIST FIRM BOILERPLATE IS HELD TO, and it is deliberately stricter than routing is.
 * `scripts/validate/a-notice-reaches-the-employee.mjs` fails the build if any seeded notice trips
 * ANY pattern here, tier two included. Routing can afford to ask for corroboration because it is
 * judging one run; a notice rides in front of EVERY prompt in the system for ever, so its wording
 * gets no benefit of the doubt. That asymmetry is the point of exporting the union separately
 * rather than letting the validator reach for the routing rule.
 */
export const DEAL_TERM_PATTERNS: readonly { re: RegExp; what: string }[] = [
  ...FUND_INSTRUMENT_PATTERNS,
  ...AMBIGUOUS_TERM_PATTERNS,
];

export interface PrivateLexicon {
  /** Lower-cased names, deduplicated. Never logged, never returned to a caller. */
  names: string[];
  /**
   * FALSE MEANS THE SCAN COULD NOT ANSWER, and the run is `private_model_only`.
   * A missing table, a query that threw, or more names than the cap all land here.
   */
  established: boolean;
  /** Why, in one sentence, for the decision log. Never contains a name. */
  note: string;
}

/**
 * Build the lexicon in ONE round trip.
 *
 * `db.batch` because on this runtime the round trip is the cost, not the SQL — `lib/batchReads.ts`
 * measured it and says so. Eight statements in one batch is 1–2 ms; eight awaited separately is
 * closer to six, and this runs on every routed completion inside a 10 ms budget.
 *
 * A MISSING TABLE IS NOT A CRASH AND NOT A PASS. `db.batch` rejects the whole batch if any
 * statement fails, which is caught here and reported as `established: false` — so a table dropped
 * by a future migration makes the router restrictive rather than silently blind.
 */
export async function privateLexicon(db: D1Database): Promise<PrivateLexicon> {
  try {
    const results = await db.batch<{ v: string | null }>(
      PRIVATE_SOURCES.map((s) =>
        db.prepare(`SELECT ${s.column} AS v FROM ${s.table} WHERE ${s.column} IS NOT NULL LIMIT ${LEXICON_CAP + 1}`),
      ),
    );

    const names = new Set<string>();
    for (const r of results) {
      for (const row of r.results ?? []) {
        const v = typeof row.v === "string" ? row.v.trim().toLowerCase() : "";
        if (v.length >= MIN_NAME_LENGTH) names.add(v);
      }
    }

    if (names.size > LEXICON_CAP) {
      return {
        names: [],
        established: false,
        note:
          `The private-name lexicon holds more than ${LEXICON_CAP} names, which is more than this ` +
          `Worker may scan inside its CPU budget. The scan cannot answer, so this run is private ` +
          `model only rather than waved through.`,
      };
    }

    return { names: [...names], established: true, note: `${names.size} names on file` };
  } catch (err) {
    return {
      names: [],
      established: false,
      note:
        `The private-name lexicon could not be read (${(err as Error).message.slice(0, 120)}), so ` +
        `nothing can establish that this content is free of LP names. Private model only.`,
    };
  }
}

export interface ModelAccessVerdict {
  /** The label this run carries, after the scan and the caller are both taken into account. */
  access: ModelAccess;
  /** True exactly when `access === "private_model_only"`. Kept for call sites that read a boolean. */
  privateOnly: boolean;
  /**
   * WHAT KIND OF THING WAS FOUND, NEVER THE THING ITSELF.
   *
   * "an LP" and "a money figure", not the name and not the number. These strings go into
   * `routing_decisions.candidates` and into a refusal a person reads, and a refusal that quotes the
   * private material back into the log has moved the leak rather than stopped it.
   */
  kinds: string[];
  /** One sentence for the decision log and for the refusal. */
  reason: string;
}

const PUBLIC_VERDICT: ModelAccessVerdict = {
  access: DEFAULT_MODEL_ACCESS,
  privateOnly: false,
  kinds: [],
  reason: "",
};

const privateVerdict = (kinds: string[], reason: string): ModelAccessVerdict => ({
  access: "private_model_only",
  privateOnly: true,
  kinds,
  reason,
});

/** How many distinct ambiguous patterns must appear together before they mean anything. */
export const AMBIGUOUS_CORROBORATION = 2;

export interface DeclaredAccess {
  /** The work card's own label, written at intake. The axis that governs routing. */
  modelAccess?: string | null;
  /**
   * The legacy four-point scale, still on every task row.
   *
   * IT MAY ONLY TIGHTEN. `restricted` raises the run to `private_model_only`; `public`, `internal`
   * and `private` are ignored here entirely, which is the fix — `internal` is a fact about the
   * RECIPIENT and it must never again decide which models may see the work.
   */
  sensitivity?: string | null;
}

/**
 * Read the outgoing messages and the work card's own labels, and say which models may see this.
 *
 * A DECLARED LABEL IS AN OR, NOT A PREREQUISITE. A caller that says `private_model_only` is
 * believed immediately; a caller that says nothing, or says `public_model_approved`, is still
 * scanned and the scan can still raise it. The two mechanisms cover each other's gap — a caller can
 * be more careful than the scan, and the scan does not depend on the caller being careful at all.
 *
 * NOTHING A CALLER SAYS CAN LOWER THE VERDICT. `public_model_approved` is the default, so declaring
 * it changes nothing; there is no value that switches the scan off.
 */
export function scanForModelAccess(
  messages: readonly ChatMessage[],
  lexicon: PrivateLexicon,
  declared: DeclaredAccess = {},
): ModelAccessVerdict {
  if (isModelAccess(declared.modelAccess) && declared.modelAccess === "private_model_only") {
    return privateVerdict(
      ["declared private model only"],
      "this work card is labelled private model only",
    );
  }

  if (modelAccessFromLegacySensitivity(declared.sensitivity) === "private_model_only") {
    return privateVerdict(
      ["declared restricted"],
      "the caller declared this content restricted",
    );
  }

  if (!lexicon.established) {
    return privateVerdict(["scan unavailable"], lexicon.note);
  }

  const haystack = messages.map((m) => m.content).join("\n").toLowerCase();
  if (!haystack) return PUBLIC_VERDICT;

  // ONE GENERIC LABEL FOR EVERY NAME HIT, deliberately. The lexicon is flat, and saying "an LP"
  // rather than "a counterparty" would narrow a reader's guess about WHICH name was found. Less is
  // the right direction for a string that goes into a log.
  for (const name of lexicon.names) {
    if (haystack.includes(name)) {
      return privateVerdict(
        ["a name this system holds as private"],
        "this content carries a name this system holds as private",
      );
    }
  }

  const instrument = FUND_INSTRUMENT_PATTERNS.filter((p) => p.re.test(haystack)).map((p) => p.what);
  if (instrument.length) {
    return privateVerdict([...new Set(instrument)], `this content carries ${[...new Set(instrument)].join(", ")}`);
  }

  /*
   * CORROBORATION, AND THE COUNT IS OF DISTINCT PATTERNS RATHER THAN OF MATCHES.
   *
   * Two money figures are one signal seen twice — a price list, a budget, a salary band — and
   * counting them as two would put every quote back on the private lane. A money figure NEXT TO
   * commitment wording is two different things saying the same thing, which is what corroboration
   * means.
   */
  const ambiguous = [...new Set(AMBIGUOUS_TERM_PATTERNS.filter((p) => p.re.test(haystack)).map((p) => p.what))];
  if (ambiguous.length >= AMBIGUOUS_CORROBORATION) {
    return privateVerdict(
      ambiguous,
      `this content carries ${ambiguous.join(" and ")}, which together read as deal material`,
    );
  }

  return PUBLIC_VERDICT;
}
