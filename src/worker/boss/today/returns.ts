/**
 * THE RETURN-ON-EFFORT LEDGER — effort against outcome, per income line, per month.
 *
 * ─── The problem this exists for ─────────────────────────────────────────────
 *
 * Six income lines and finite hours. The system counted activity on all six and outcome on none, so
 * every line looked equally worthy: the one that has produced nothing in a year renders identically
 * to the one that pays for everything, and the tiebreak that is left is mood. Her own numbers, none
 * of which this system could previously state:
 *
 *   542 LP emails → 4 replies (0.7%)   ·   23 properties → 24 clicks in 28 days   ·   0 deals closed
 *
 * ─── Four rules the shape of this file follows ───────────────────────────────
 *
 * 1. RATIOS, NOT TOTALS. Every measurement is a pair — an effort and the outcome it produced. "542
 *    emails" alone is the number that makes a bad month feel like a busy one. A pair with no
 *    outcome is not a measurement and is labelled as one that is missing.
 *
 * 2. UNMEASURED IS NOT ZERO. `outcome_count: null` means nothing in this system can see the result,
 *    and every such pair carries the sentence saying why. Rendering a blind spot as "0" is how she
 *    would conclude a line is dead when it is merely unobserved, and the correct action for those
 *    two is opposite: stop working the first, instrument the second.
 *
 * 3. NO RANKING. Lines come back in the order `projects.ts` declares them — her order, by lane —
 *    and nothing here sorts by return or emits a score. Her instruction, and the reason is hers
 *    too: the brokerage cannot carry a periodic target because a deal takes two weeks to six
 *    months, so any ranking would put the engine of the business last in every month it happened to
 *    be mid-cycle. The ledger reports. The judgement is hers.
 *
 * 4. THE SPLIT IS THE ARCHITECTURE. The Worker computes what D1 holds and nothing more. The LP
 *    tracker and Search Console are unreachable from here on purpose — the Claude Code runner
 *    strips every credential from its environment — so those numbers arrive as contributed rows in
 *    `line_returns`, POSTed by `scripts/ops/line-returns.mjs` running as her. A line whose only
 *    signal is contributed and has never been contributed says exactly that.
 *
 * ─── Why the D1 half is computed and not stored ──────────────────────────────
 *
 * Touch counts, candidate counts, deal stages and prospect outcomes are all already in D1 with
 * timestamps. Copying them into `line_returns` would create a second source of truth that drifts
 * from the first the moment anything is backfilled or corrected, and this repo has already paid for
 * that class of mistake. So the contributed table holds only what cannot be recomputed.
 */

import { PROJECTS, type Project } from "./projects";

/** One effort→outcome pair. The unit of this whole ledger. */
export interface ReturnPair {
  /**
   * 'measurement' is an effort that produced (or failed to produce) a countable outcome.
   * 'blind_spot' is a statement that something this line is FOR cannot be seen at all. They render
   * differently because reading the second as the first is the mistake this whole file guards
   * against, and a shared shape with a flag would eventually be rendered by one code path.
   */
  kind: "measurement" | "blind_spot";
  /** What was done, in her words. */
  effort_label: string;
  effort_count: number;
  /** What it produced. */
  outcome_label: string;
  /** null means unmeasured, which is never the same as 0. */
  outcome_count: number | null;
  /** Required whenever `outcome_count` is null. A blank that explains itself is information. */
  unmeasured_why: string | null;
  /**
   * outcome per 1,000 units of effort, as an integer, or null when either side is missing.
   *
   * PER MILLE RATHER THAN A PERCENTAGE, because the interesting rates here are all under 1%: 4
   * replies from 542 emails is 0.7%, and 24 clicks from 7,642 impressions is 0.31%. Rendered as
   * whole percentages both are "0%", which is the vanity failure in the opposite direction — a real
   * signal rounded into nothing.
   */
  per_mille: number | null;
  /** 'computed' when D1 holds it, otherwise the contributing job's source key. */
  source: string;
  window_days?: number | null;
  note?: string | null;
}

export interface LineReturn {
  line: string;
  name: string;
  lane: Project["lane"];
  status: Project["status"];
  pairs: ReturnPair[];
  /** True when at least one pair has a real outcome number. Drives "measured" vs "unmeasured". */
  measured: boolean;
}

export interface Ledger {
  period: string;
  period_label: string;
  lines: LineReturn[];
  /** Said on the screen rather than only enforced here. */
  ordering_note: string;
  measured_lines: number;
  unmeasured_lines: number;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' for a timestamp, in her timezone rather than UTC — a month boundary is local or wrong. */
export function monthKey(ts: number, timeZone = "America/Chicago"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(new Date(ts));
  return parts.slice(0, 7);
}

/**
 * The half-open millisecond range of a 'YYYY-MM' key, in America/Chicago.
 *
 * WHY THE ARITHMETIC LOOKS LIKE THIS. Workers have full ICU but no timezone maths, so the honest
 * way to find the local start of a month is to ask the formatter what the offset was at a candidate
 * instant and correct by it. Doing it naively in UTC would put every month boundary five or six
 * hours early, which silently moves a whole evening of activity — and an LP email sent at 7pm on
 * the 31st is precisely the kind of row that would land in the wrong month and never be noticed.
 */
export function monthRange(period: string, timeZone = "America/Chicago"): { from: number; to: number } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const startOfMonthUtc = Date.UTC(y, m - 1, 1);
  const nextMonthUtc = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
  return { from: startOfMonthUtc - offsetMs(startOfMonthUtc, timeZone), to: nextMonthUtc - offsetMs(nextMonthUtc, timeZone) };
}

function offsetMs(utc: number, timeZone: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(utc))) if (part.type !== "literal") p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return asUtc - utc;
}

export function isMonth(period: string): boolean {
  return MONTH.test(period);
}

function perMille(effort: number, outcome: number | null): number | null {
  if (outcome === null || effort <= 0) return null;
  return Math.round((outcome / effort) * 1000);
}

function pair(p: Omit<ReturnPair, "per_mille" | "kind"> & { kind?: ReturnPair["kind"] }): ReturnPair {
  return { kind: "measurement", ...p, per_mille: perMille(p.effort_count, p.outcome_count) };
}

/**
 * WHAT REMAINS UNOBSERVED ON EACH LINE, one sentence each, written out rather than generated.
 *
 * These are the most important strings in the file, and they are ALWAYS RENDERED — not only when a
 * line has no numbers at all. That is the correction that matters: once Search Console starts
 * contributing clicks, the ads line shows "24 clicks from 7,642 impressions" and reads as measured,
 * while the thing that line is actually for — revenue from leads sold to service providers — is
 * still invisible to every part of this system. A ledger that let a proxy stand in silently for the
 * real outcome would be worse than the one that measured nothing, because it would look finished.
 *
 * So each line carries its blind spot as a pair with a null outcome, beside whatever it does
 * measure. A generated sentence would blur the distinction this whole design rests on.
 */
const BLIND_SPOTS: Record<string, { label: string; why: string }> = {
  brokerage: {
    label: "commission earned",
    why:
      "Nothing in Boss OS records what a closed deal paid. `deals.check_size_micros` is the size of the " +
      "trade rather than her fee, so the brokerage can be measured in closings and never in money.",
  },
  west_peek_raise: {
    label: "capital committed",
    why:
      "No LP commitment or dollar raised is recorded anywhere in this system; a reply is the furthest " +
      "outcome visible. Reply counts also depend on the Reply Log being kept by hand, because " +
      "sequoia@westpeek.ventures is still not connected — the same gap that has hidden opt-out requests " +
      "since 19 August.",
  },
  ads: {
    label: "leads sold to service providers",
    why:
      "The revenue this line exists for is invoiced outside Boss OS and reaches nothing here. Search " +
      "Console traffic is a proxy for reach, not a measure of income.",
  },
  saas: {
    label: "partnership conversations",
    why:
      "Both apps are looking for distribution partners rather than direct sales, and no conversation with " +
      "a partner is recorded here. Traffic says the sites exist, not that the strategy is working.",
  },
  digital_products: {
    label: "sales",
    why:
      "Sales sit in the payment processor, which nothing in this system reads, so revenue per visit " +
      "cannot be stated for three products that are supposed to sell without attention.",
  },
  youtube: {
    label: "views, watch time and subscribers",
    why:
      "Nothing in this system reads YouTube. This line has no outcome signal of any kind, which is a gap " +
      "in the instruments rather than a verdict on the channel.",
  },
  authority_network: {
    label: "ranking movement from a won link",
    why:
      "A link won is counted; whether it moved a page from position 70 is not. That answer is in Search " +
      "Console weeks later and nothing joins the two, so this line can show work and never show effect.",
  },
};

/** What a line still needs before it can be measured at all, when it has no numbers whatsoever. */
const NO_SIGNAL_YET: Record<string, string> = {
  west_peek_raise:
    "The LP tracker is a Google Sheet only her Mac can read. Run `npm run returns:contribute` to bring " +
    "sends and replies in; until then this line is unmeasured, not empty.",
  ads: "Search Console holds the traffic and only her Mac has the credential. Run `npm run returns:contribute`.",
  saas: "Search Console holds the traffic and only her Mac has the credential. Run `npm run returns:contribute`.",
  digital_products:
    "Search Console holds the traffic and only her Mac has the credential. Run `npm run returns:contribute`.",
};

/**
 * The whole ledger for one month.
 *
 * Every count is a COUNT over a timestamp range in D1. No table is written and nothing is cached:
 * the numbers are cheap, and a cached ratio that disagrees with the rows underneath it is worse
 * than no ratio.
 */
export async function buildLedger(db: D1Database, period: string): Promise<Ledger> {
  const { from, to } = monthRange(period);

  const n = async (sql: string, ...binds: unknown[]): Promise<number> => {
    const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
    return row?.n ?? 0;
  };

  const [
    touches, closedDeals, candidatesFound, candidatesWorked, prospectsFound, prospectsWon,
  ] = await Promise.all([
    /*
     * A TOUCH IS A `last_contact_at` INSIDE THE MONTH, which undercounts and is the honest reading
     * available. `relationships` keeps one last-contact timestamp per person rather than a log, so
     * three conversations with the same counterparty in March count once. Overstating reach would be
     * the worse error: this number exists to be divided into closings.
     */
    n(`SELECT COUNT(*) AS n FROM relationships WHERE last_contact_at >= ? AND last_contact_at < ?`, from, to),
    /*
     * A CLOSE IS A DEAL SITTING AT `closed` WHOSE STAGE MOVED INSIDE THE MONTH. 0188 added
     * `stage_since` precisely so that "when did this become closed" is answerable; `updated_at`
     * would count a note edited in April as an April close.
     */
    n(`SELECT COUNT(*) AS n FROM deals WHERE stage = 'closed' AND stage_since >= ? AND stage_since < ?`, from, to),
    n(`SELECT COUNT(*) AS n FROM sourcing_candidates WHERE created_at >= ? AND created_at < ?`, from, to),
    /*
     * THE OUTCOME OF SOURCING IS HER ACTING ON A NAME, not the name existing. `contacted` and
     * `promoted` are the only two statuses that mean the candidate left the list and became work;
     * `reviewed` means she looked, which is effort of a second kind rather than a result.
     */
    n(
      `SELECT COUNT(*) AS n FROM sourcing_candidates
        WHERE status IN ('contacted','promoted') AND updated_at >= ? AND updated_at < ?`,
      from, to,
    ),
    n(`SELECT COUNT(*) AS n FROM link_prospects WHERE created_at >= ? AND created_at < ?`, from, to),
    n(`SELECT COUNT(*) AS n FROM link_prospects WHERE status = 'won' AND updated_at >= ? AND updated_at < ?`, from, to),
  ]);

  const contributed = await db
    .prepare(
      `SELECT line, source, effort_label, effort_count, outcome_label, outcome_count,
              unmeasured_why, window_days, note
         FROM line_returns WHERE period = ? ORDER BY source ASC`,
    )
    .bind(period)
    .all<{
      line: string; source: string; effort_label: string; effort_count: number;
      outcome_label: string; outcome_count: number | null; unmeasured_why: string | null;
      window_days: number | null; note: string | null;
    }>();

  const byLine = new Map<string, ReturnPair[]>();
  for (const row of contributed.results ?? []) {
    const list = byLine.get(row.line) ?? [];
    list.push(pair({
      effort_label: row.effort_label,
      effort_count: row.effort_count,
      outcome_label: row.outcome_label,
      outcome_count: row.outcome_count,
      unmeasured_why: row.outcome_count === null ? row.unmeasured_why : null,
      source: row.source,
      window_days: row.window_days,
      note: row.note,
    }));
    byLine.set(row.line, list);
  }

  const computed: Record<string, ReturnPair[]> = {
    brokerage: [
      pair({
        effort_label: "counterparty touches logged",
        effort_count: touches,
        outcome_label: "deals closed",
        outcome_count: closedDeals,
        unmeasured_why: null,
        source: "computed",
      }),
      pair({
        effort_label: "buyer candidates surfaced",
        effort_count: candidatesFound,
        outcome_label: "moved to contacted or promoted",
        outcome_count: candidatesWorked,
        unmeasured_why: null,
        source: "computed",
      }),
    ],
    authority_network: [
      pair({
        effort_label: "backlink prospects found",
        effort_count: prospectsFound,
        outcome_label: "links won",
        outcome_count: prospectsWon,
        unmeasured_why: null,
        source: "computed",
      }),
    ],
  };

  const lines: LineReturn[] = PROJECTS.map((project) => {
    const pairs = [...(computed[project.key] ?? []), ...(byLine.get(project.key) ?? [])];

    /*
     * A LINE WITH NOTHING AT ALL GETS ONE HONEST ROW rather than an empty list. An empty list
     * renders as blank space, and blank space beside a line with numbers reads as zero — which is
     * the exact confusion this file exists to prevent.
     */
    if (pairs.length === 0) {
      pairs.push(pair({
        effort_label: "no effort signal in this system",
        effort_count: 0,
        outcome_label: "no outcome signal in this system",
        outcome_count: null,
        unmeasured_why: NO_SIGNAL_YET[project.key] ?? "Nothing in this system observes this line yet.",
        source: "none",
      }));
    }

    const measured = pairs.some((p) => p.outcome_count !== null);

    // The blind spot goes last, so it reads as the caveat on the numbers above it rather than as a
    // number of its own. It is present whether or not anything else was measured.
    const blind = BLIND_SPOTS[project.key];
    if (blind) {
      pairs.push(pair({
        kind: "blind_spot",
        effort_label: "",
        effort_count: 0,
        outcome_label: blind.label,
        outcome_count: null,
        unmeasured_why: blind.why,
        source: "none",
      }));
    }

    return {
      line: project.key,
      name: project.name,
      lane: project.lane,
      status: project.status,
      pairs,
      measured,
    };
  });

  return {
    period,
    period_label: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${period}-15T12:00:00Z`)),
    lines,
    ordering_note:
      "Lines are in her own order, by lane. Nothing here ranks them by return: the brokerage takes " +
      "two weeks to six months to produce an outcome, so a ranking would put the engine of the " +
      "business last in every month it happened to be mid-cycle.",
    measured_lines: lines.filter((l) => l.measured).length,
    unmeasured_lines: lines.filter((l) => !l.measured).length,
  };
}

/** The line keys the ledger accepts, and the properties each Spry line owns. */
export function lineDefinitions() {
  return PROJECTS.map((p) => ({
    line: p.key,
    name: p.name,
    lane: p.lane,
    status: p.status,
    properties: p.properties ?? [],
  }));
}

export const LINE_KEYS = new Set(PROJECTS.map((p) => p.key));
