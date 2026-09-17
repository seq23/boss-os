/**
 * THE CONFIDENTIAL LINE.
 *
 * The owner's ruling is one sentence: LP NAMES AND DEAL TERMS ARE CONFIDENTIAL. This turns it into
 * something the router can refuse on, before a request is formed.
 *
 * ─── WHY IT IS NOT A PROMPT, A WRAPPER, OR A CHECK ON THE WAY BACK ──────────────────────────────
 *
 * Three shapes were available and two of them are not controls:
 *
 *   · A SENTENCE IN THE SYSTEM PROMPT asking the model not to remember. That is a request made to
 *     the very party the rule exists to constrain, and it arrives after the material has already
 *     been sent. v20.1 §3 says the equivalent rule must be "enforced technically, not merely by
 *     prompt wording or an approval card".
 *   · A CALLER THAT REMEMBERS TO SET `sensitivity: "restricted"`. Every caller, for ever, including
 *     ones written next year by somebody who has not read this file. The one that forgets is the
 *     one that leaks, and it leaks silently. `routeCompletion` already accepts a caller-declared
 *     sensitivity and that stays — it is useful — but it cannot be the whole of the mechanism,
 *     because a promise made by the party being checked is not a check.
 *   · REFUSED AT THE ROUTER, FROM THE CONTENT ITSELF. What this file does.
 *
 * ─── HOW IT DECIDES ─────────────────────────────────────────────────────────────────────────────
 *
 * The router reads the outgoing messages against a lexicon built from the tables that actually hold
 * this material — the LP names and counterparty names the database knows — plus a small set of
 * patterns for the SHAPE of a deal term, which catches material about an LP whose name is not in
 * the database yet. Either kind of hit makes the content confidential for this run, whatever the
 * caller declared.
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
 * cap — this does NOT return "nothing confidential found". It returns `established: false`, and the
 * router treats an unestablished scan as a hit. The consequence is bounded and deliberate: work
 * still runs, on the routes that do not train, which is Workers AI and today nothing else. The
 * system gets slower and safer rather than faster and leakier, which is the correct direction for
 * a failure nobody noticed.
 */

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
 * May this route be shown an LP name or a deal term?
 *
 * ONE VALUE SAYS YES AND EVERYTHING ELSE SAYS NO, including null, including a string nobody
 * recognises, including a column that has not been added yet. A future `data_use` value invented by
 * somebody adding a provider is restricted until this function is changed in a diff.
 */
export function mayHoldConfidential(dataUse: string | null | undefined): boolean {
  return dataUse === "NO_TRAINING_CONTRACTUAL";
}

/**
 * Where the confidential material lives, and which column carries the NAME.
 *
 * Only name-bearing columns. Free text is deliberately absent: `notes`, `claim_text` and `bio` hold
 * prose, and turning prose into a lexicon of "names" produces a list of ordinary English words that
 * matches every prompt and takes the whole system off the cloud. The patterns below are what covers
 * the material this list cannot.
 *
 * SOME OF THESE ARE CHASSIS TABLES (`lp_record`, `lp_claim`, `diligence_claim`,
 * `investment_opportunity`). They are read anyway. A name is confidential because of what it is,
 * not because of which half of this Worker's history the table came from, and the owner's ruling
 * named `lp_claim` and `diligence_claim` explicitly.
 */
export const CONFIDENTIAL_SOURCES: readonly { table: string; column: string; what: string }[] = [
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
 * 4,000 and hope"; it means the scan cannot answer and the router restricts the run. The number is
 * generous against a database holding single-digit LPs and is here so a Worker with a 10 ms CPU
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

/**
 * THE SHAPE OF A DEAL TERM, for material about a counterparty this database has never heard of.
 *
 * The lexicon can only know the names it holds, and the case that matters most is the one where it
 * cannot help: a draft to a prospective LP who is not a row yet. These patterns catch the terms
 * rather than the party — a commitment figure, a cheque size, the vocabulary of a side letter.
 *
 * THEY ARE ALLOWED TO BE BROAD. A false positive costs a run the OpenRouter tier and routes it to
 * Workers AI instead, which is free and which may hold the material. A false negative costs an LP
 * name in somebody's training corpus. Those are not symmetric and this list is tuned accordingly.
 */
export const DEAL_TERM_PATTERNS: readonly { re: RegExp; what: string }[] = [
  { re: /\$\s?\d[\d,.]*\s?(k\b|m\b|bn\b|b\b|million|billion|thousand)/i, what: "a money figure" },
  { re: /\b(commitment|committed|capital call|called capital|drawdown|subscription)\b/i, what: "commitment language" },
  { re: /\b(carry|carried interest|hurdle|preferred return|waterfall|clawback)\b/i, what: "economics language" },
  { re: /\b(side letter|most favou?red nation|\bmfn\b|lpa\b|limited partnership agreement)\b/i, what: "side-letter language" },
  { re: /\b(pre-?money|post-?money|valuation|cap table|ownership|fully diluted)\b/i, what: "deal-term language" },
  { re: /\b(cheque size|check size|ticket size|allocation|pro rata)\b/i, what: "allocation language" },
  { re: /\b(term sheet|due diligence|data ?room|diligence request)\b/i, what: "diligence language" },
];

export interface ConfidentialLexicon {
  /** Lower-cased names, deduplicated. Never logged, never returned to a caller. */
  names: string[];
  /**
   * FALSE MEANS THE SCAN COULD NOT ANSWER, and the router must treat the run as confidential.
   * A missing table, a query that threw, or more names than the cap all land here.
   */
  established: boolean;
  /** Why, in one sentence, for the decision log. Never contains a name. */
  note: string;
}

const EMPTY_LEXICON: ConfidentialLexicon = { names: [], established: true, note: "" };

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
export async function confidentialLexicon(db: D1Database): Promise<ConfidentialLexicon> {
  try {
    const results = await db.batch<{ v: string | null }>(
      CONFIDENTIAL_SOURCES.map((s) =>
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
          `The confidential lexicon holds more than ${LEXICON_CAP} names, which is more than this ` +
          `Worker may scan inside its CPU budget. The scan cannot answer, so this run is treated as ` +
          `confidential rather than waved through.`,
      };
    }

    return { names: [...names], established: true, note: `${names.size} names on file` };
  } catch (err) {
    return {
      names: [],
      established: false,
      note:
        `The confidential lexicon could not be read (${(err as Error).message.slice(0, 120)}), so ` +
        `nothing can establish that this content is free of LP names. Treated as confidential.`,
    };
  }
}

export interface ConfidentialVerdict {
  /** True when this content may not be shown to a route whose terms permit training on it. */
  confidential: boolean;
  /**
   * WHAT KIND OF THING WAS FOUND, NEVER THE THING ITSELF.
   *
   * "an LP" and "a money figure", not the name and not the number. These strings go into
   * `routing_decisions.candidates` and into a refusal a person reads, and a refusal that quotes the
   * confidential material back into the log has moved the leak rather than stopped it.
   */
  kinds: string[];
  /** One sentence for the decision log and for the refusal. */
  reason: string;
}

const NOT_CONFIDENTIAL: ConfidentialVerdict = { confidential: false, kinds: [], reason: "" };

/**
 * Read the outgoing messages for confidential material.
 *
 * DECLARED SENSITIVITY IS AN OR, NOT A PREREQUISITE. A caller that says `restricted` is believed
 * immediately; a caller that says nothing is still scanned. The two mechanisms cover each other's
 * gap — a caller can be more careful than the scan, and the scan does not depend on the caller
 * being careful at all.
 */
export function scanForConfidential(
  messages: readonly ChatMessage[],
  lexicon: ConfidentialLexicon,
  declaredSensitivity?: string | null,
): ConfidentialVerdict {
  if (declaredSensitivity === "restricted") {
    return {
      confidential: true,
      kinds: ["declared restricted"],
      reason: "the caller declared this content restricted",
    };
  }

  if (!lexicon.established) {
    return { confidential: true, kinds: ["scan unavailable"], reason: lexicon.note };
  }

  const haystack = messages.map((m) => m.content).join("\n").toLowerCase();
  if (!haystack) return NOT_CONFIDENTIAL;

  const kinds = new Set<string>();

  // ONE GENERIC LABEL FOR EVERY NAME HIT, deliberately. The lexicon is flat, and saying "an LP"
  // rather than "a counterparty" would narrow a reader's guess about WHICH name was found. Less is
  // the right direction for a string that goes into a log.
  for (const name of lexicon.names) {
    if (haystack.includes(name)) {
      kinds.add("a name this system holds as confidential");
      break;
    }
  }
  for (const p of DEAL_TERM_PATTERNS) {
    if (p.re.test(haystack)) kinds.add(p.what);
  }

  if (kinds.size === 0) return NOT_CONFIDENTIAL;

  return {
    confidential: true,
    kinds: [...kinds],
    reason: `this content carries ${[...kinds].join(", ")}`,
  };
}
