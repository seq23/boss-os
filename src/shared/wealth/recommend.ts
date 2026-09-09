/**
 * WHICH BUYERS ARE WORTH AN EMAIL THIS WEEK, AND WHY EACH ONE.
 *
 * ─── Her words, 9 September 2026 ───────────────────────────────────────────
 *
 *   "id rather the capital tab just not list buyers like this. just have a recommendation section
 *    with a list of names to send an email to and a sample of the emails that should be sent"
 *
 * And, a few minutes earlier:
 *
 *   "the capital tab - i need it to do more. it should suggest an email to the firms i have
 *    reviewed or something? what is next? ok i've reviewed them....then what?"
 *
 * ─── What was actually on the screen when she said it ──────────────────────
 *
 * Twenty-eight firms, every single one already `reviewed` — verified against production D1 on
 * 9 September: `SELECT status, COUNT(*) FROM sourcing_candidates GROUP BY status` returns exactly
 * one row, `reviewed 28`. Above them, three counters reading 0 / 2 / 0. Below each, a paragraph of
 * research. She had done every job the screen asked of her and the screen had nothing left to say.
 *
 * A CATALOGUE IS NOT A RECOMMENDATION. Twenty-eight rows sorted by a field that is null on
 * twenty-five of them is a list in an arbitrary order wearing a sort. The fix is not better rows: it
 * is to answer a different question — *which five, and what do I write?* — and to be able to say why
 * for each one.
 *
 * ─── Every point of the score is a fact from the row ───────────────────────
 *
 * There is no model here and no hand-tuned mystery. Each signal below reads one column, carries the
 * sentence that explains it, and appears on her screen next to the recommendation it produced. A
 * ranking she cannot interrogate is a ranking she should not act on, and this repository has already
 * shipped that mistake once: the People roster showed `importance 100 · trust 100 · recency 0` on
 * two hundred consecutive rows because three of those four numbers were read from columns nothing
 * ever wrote.
 *
 * ─── THE FLOOR-VERSUS-POSITION JOIN, AND WHAT IS HONESTLY MISSING ──────────
 *
 * Buyers publish a minimum cheque. Three of the twenty-eight carry one: $50M (Pinegrove), $11M
 * (Committed Advisors), $10M (137 Ventures). A buyer whose floor is above the position she is
 * actually working cannot transact with her at all, and until now looked identical on screen to her
 * best fit.
 *
 * BOSS OS DOES NOT KNOW HER POSITIONS. Verified, not assumed: `SELECT COUNT(*) FROM position` on
 * production returns 0, and so do `position_mark`, `portfolio_vehicles` and `deals`. Her brokerage
 * supply lives in her mail until it closes; it has never been typed into this system, and inventing
 * a number to rank against would be worse than not ranking.
 *
 * So the join runs off ONE figure she can state in one field — the size of the position she is
 * working right now — and when it is unset the ranking says so on the screen and no reachability
 * point is awarded to anybody. An unset figure suppresses nothing and flatters nothing.
 */

/** One column, read, weighed, and explained in the same object. */
export interface Signal {
  code: string;
  /** Points this contributed. Negative is allowed and is shown as such. */
  weight: number;
  /** The sentence she reads. Contains the fact, not the rule. */
  says: string;
}

export interface CandidateFacts {
  id: string;
  name: string;
  status: string;
  ticket_floor_usd: number | null;
  thesis: string | null;
  source_url: string | null;
  source_name: string | null;
  read_at: number | null;
  history_kind: string | null;
  history_exchanges: number | null;
  history_last_at: number | null;
}

export interface CrossmatchFacts {
  id: string;
  candidate_id: string;
  lp_firm: string;
  lp_list: string;
  confidence: string;
  why: string;
}

export interface Recommendation {
  candidate_id: string;
  name: string;
  score: number;
  /** One sentence: why this firm, this week. Assembled from the signals that actually fired. */
  headline: string;
  signals: Signal[];
  research: string | null;
  source_url: string | null;
  source_name: string | null;
  read_at: number | null;
}

export interface Withheld {
  candidate_id: string;
  name: string;
  /** Why she is not being offered a letter to this firm. Always populated. */
  because: string;
  /**
   * The cross-match that caused a suppression, so she can overturn it.
   *
   * A NAME MATCH IS A GUESS AND SHE IS THE ONLY ONE WHO CAN SETTLE IT. "StepStone Group (VC
   * Secondaries Fund VI)" and the LP row "StepStone" are almost certainly the same house; the day
   * they are not, this silently costs her a buyer with no way to say so. The id travels with the
   * refusal so the screen can offer "not the same firm" beside the reason.
   */
  crossmatch_id?: string;
}

export interface Basis {
  /** The position figure the reachability test ran against, or null when she has not stated one. */
  working_position_usd: number | null;
  /** How many of the candidates considered carry a published minimum cheque. */
  with_a_published_floor: number;
  candidates_considered: number;
  /** Said on the screen, verbatim, whenever the join could not run. */
  limitation: string | null;
}

export interface Recommended {
  recommendations: Recommendation[];
  suppressed: Withheld[];
  out_of_reach: Withheld[];
  already_moving: Withheld[];
  basis: Basis;
}

/** How many make the cut. A handful, because a list of twenty-eight is the thing she rejected. */
export const HOW_MANY = 5;

const DAY = 86_400_000;

/**
 * Phrases a firm uses about itself when it buys SHARES IN A COMPANY from the people who hold them.
 *
 * THIS IS THE DISCRIMINATOR THAT MATTERS AND IT WAS NOWHERE ON THE OLD SCREEN. Her business is
 * matching a holder of private shares with an institution that buys them. A secondaries firm that
 * buys LP interests in funds is a real secondaries firm and cannot buy what she sells. Both classes
 * were on the list, adjacent, indistinguishable.
 *
 * Matched against the firm's OWN words — the thesis and the source line the sweep recorded — and the
 * matched phrase is quoted back on the screen, so a wrong call is visible rather than buried in a
 * weight.
 */
const DIRECT_TELLS = [
  "directly from employees",
  "shares directly",
  "direct secondar",
  "employee shares",
  "employees, founders",
  "founders and early",
  "secondary directs",
  "purchase shares",
  "buys shares",
  "acquiring both single company stakes",
  "single company stakes",
  "stakes of",
  "secondary stakes",
  "existing shares",
  "company positions",
];

/**
 * Phrases a firm uses when it buys POSITIONS IN FUNDS.
 *
 * Only counted against a firm that says nothing about direct purchases. Several of the largest
 * buyers do both, and penalising them for mentioning fund interests at all would push exactly the
 * wrong names down.
 */
const FUND_TELLS = [
  "limited partnership position",
  "lp fund transfers",
  "fund interests",
  "owners of fund interests",
  "portfolios of fund",
  "gp-led",
];

const money = (usd: number) =>
  usd >= 1_000_000 ? `$${Math.round(usd / 1_000_000)}M` : `$${Math.round(usd / 1_000).toLocaleString()}k`;

const onDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Everything the firm has said about itself, lowercased once. */
const ownWords = (c: CandidateFacts) => `${c.thesis ?? ""} ${c.source_name ?? ""}`.toLowerCase();

function firstMatch(haystack: string, needles: string[]): string | null {
  for (const n of needles) if (haystack.includes(n)) return n;
  return null;
}

/**
 * Rank the candidates and say why, for every one — including the ones that do not make it.
 *
 * NOTHING IS SILENTLY DROPPED. A firm that is suppressed, out of reach, or already in flight leaves
 * with a sentence attached, because "it is not on the list" and "it was never considered" look
 * identical on a screen and only one of them is information.
 */
export function recommendBuyers(
  candidates: CandidateFacts[],
  crossmatches: CrossmatchFacts[],
  inFlight: Set<string>,
  workingPositionUsd: number | null,
  now: number,
): Recommended {
  const byCandidate = new Map<string, CrossmatchFacts[]>();
  for (const m of crossmatches) {
    byCandidate.set(m.candidate_id, [...(byCandidate.get(m.candidate_id) ?? []), m]);
  }

  const suppressed: Withheld[] = [];
  const outOfReach: Withheld[] = [];
  const alreadyMoving: Withheld[] = [];
  const scored: Recommendation[] = [];

  for (const c of candidates) {
    const matches = byCandidate.get(c.id) ?? [];

    /*
     * SUPPRESSION FIRST, AND IT IS ABSOLUTE.
     *
     * A firm on West Peek's do-not-contact list gets no letter and she is told which firm and why.
     * This is the same refusal `composeOutreach` makes when a letter is actually drafted; it is
     * repeated here so the firm never reaches the recommendation list in the first place, rather
     * than being recommended and then refused at the last moment.
     */
    const banned = matches.find((m) => m.lp_list !== "sequence" && m.confidence === "confirmed");
    if (banned) {
      suppressed.push({
        candidate_id: c.id,
        name: c.name,
        crossmatch_id: banned.id,
        because:
          `${banned.lp_firm} is on West Peek's do-not-contact list and this is the same firm. ` +
          "Brokerage outreach to a suppressed LP is the one crossing between the two businesses that costs " +
          "something real, so no letter is offered. Take the firm off that list first if you want one.",
      });
      continue;
    }

    if (inFlight.has(c.id) || c.status === "contacted") {
      alreadyMoving.push({
        candidate_id: c.id,
        name: c.name,
        because:
          c.status === "contacted"
            ? "You have already approached them. They come back onto this list when there is a reason to write again."
            : "A letter to them is already drafted and waiting on your verdict in the Inbox.",
      });
      continue;
    }
    if (c.status === "rejected") continue;

    const signals: Signal[] = [];
    const words = ownWords(c);

    // ─── Do they buy the thing she sells? ─────────────────────────────────
    const direct = firstMatch(words, DIRECT_TELLS);
    const fundOnly = direct ? null : firstMatch(words, FUND_TELLS);
    if (direct) {
      signals.push({
        code: "buys_company_shares",
        weight: 25,
        says: `Their own description says "${direct}" — they buy shares in companies, which is what you sell.`,
      });
    } else if (fundOnly) {
      signals.push({
        code: "buys_fund_interests",
        weight: -15,
        says: `Their own description says "${fundOnly}" and nothing about buying shares directly, so they may only buy positions in funds.`,
      });
    } else {
      signals.push({
        code: "unclear_what_they_buy",
        weight: -5,
        says: "Nothing on their row says whether they buy company shares or only fund positions.",
      });
    }

    // ─── Have you two met? ────────────────────────────────────────────────
    if (c.history_kind === "dealt") {
      signals.push({
        code: "dealt_before",
        weight: 50,
        says:
          `You have transacted with them before` +
          `${c.history_last_at ? `, most recently around ${onDay(c.history_last_at)}` : ""}` +
          `${c.history_exchanges ? ` — ${c.history_exchanges} exchanges on the record` : ""}.`,
      });
    } else if (c.history_kind === "discussed") {
      signals.push({
        code: "discussed_before",
        weight: 35,
        says:
          "You have talked about buying with them before and it never got to a trade" +
          `${c.history_last_at ? `; the last of it around ${onDay(c.history_last_at)}` : ""}.`,
      });
    }

    // ─── Can she reach them at all? ───────────────────────────────────────
    const floor = c.ticket_floor_usd && c.ticket_floor_usd > 0 ? c.ticket_floor_usd : null;
    if (floor !== null && workingPositionUsd !== null) {
      if (floor > workingPositionUsd) {
        outOfReach.push({
          candidate_id: c.id,
          name: c.name,
          because:
            `They start at ${money(floor)} and the position you are working is ${money(workingPositionUsd)}. ` +
            "They cannot buy what you have right now, so writing to them costs you a first impression you " +
            "will want later. Raise the position figure above and they come back.",
        });
        continue;
      }
      signals.push({
        code: "within_reach",
        weight: 20,
        says: `They start at ${money(floor)} and you are working ${money(workingPositionUsd)}, so the cheque fits.`,
      });
    } else if (floor !== null) {
      signals.push({
        code: "floor_untested",
        weight: 0,
        says: `They start at ${money(floor)}. Nothing here knows the size you are working, so that was not tested.`,
      });
    } else {
      signals.push({
        code: "floor_unknown",
        weight: 0,
        says: "They have not published a minimum cheque, so nothing was assumed about size either way.",
      });
    }

    // ─── Can she actually send it? ────────────────────────────────────────
    if (c.source_url) {
      signals.push({
        code: "route_exists",
        weight: 10,
        says: `The page you found them on is the contact route: ${c.source_name ?? c.source_url}.`,
      });
    } else {
      signals.push({
        code: "no_route",
        weight: -10,
        says: "No source page was recorded, so you would have to find the contact route yourself first.",
      });
    }

    // ─── Is the evidence still warm? ──────────────────────────────────────
    if (c.read_at && now - c.read_at <= 60 * DAY) {
      signals.push({
        code: "evidence_fresh",
        weight: 5,
        says: `Read on ${onDay(c.read_at)}, so what they say about themselves is current.`,
      });
    } else if (c.read_at) {
      signals.push({
        code: "evidence_stale",
        weight: -5,
        says: `Last read on ${onDay(c.read_at)}, over two months ago — worth a glance at the source before you send.`,
      });
    }

    const score = signals.reduce((n, s) => n + s.weight, 0);
    /*
     * THE HEADLINE IS THE SIGNALS THAT PAID, IN ORDER, NOT A TEMPLATE.
     *
     * A recommendation whose reason is generated from a shape rather than from what fired is a
     * recommendation that reads the same for every firm — which is how twenty-eight identical rows
     * happened in the first place.
     */
    const positive = signals.filter((s) => s.weight > 0).sort((a, b) => b.weight - a.weight);
    const headline = positive.length
      ? positive.map((s) => s.says).join(" ")
      : "Nothing on their row argues for writing to them this week.";

    scored.push({
      candidate_id: c.id,
      name: c.name,
      score,
      headline,
      signals,
      research: c.thesis,
      source_url: c.source_url,
      source_name: c.source_name,
      read_at: c.read_at,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const considered = candidates.length;
  const withFloor = candidates.filter((c) => (c.ticket_floor_usd ?? 0) > 0).length;

  return {
    recommendations: scored.slice(0, HOW_MANY),
    suppressed,
    out_of_reach: outOfReach,
    already_moving: alreadyMoving,
    basis: {
      working_position_usd: workingPositionUsd,
      with_a_published_floor: withFloor,
      candidates_considered: considered,
      limitation:
        workingPositionUsd === null
          ? "Boss OS holds no record of your positions — the brokerage supply lives in your mail until it " +
            "closes, and `position` is empty. So nobody was ranked up or down for cheque size, and a firm " +
            "that starts above what you are working is still on this list. State the size you are working " +
            "and the ranking uses it."
          : withFloor === 0
            ? "None of these firms publishes a minimum cheque, so the size test could not run against any of them."
            : withFloor < considered
              ? `Only ${withFloor} of ${considered} firms publish a minimum cheque, so the size test ran on those and ` +
                "was silent about the rest rather than guessing."
              : null,
    },
  };
}
