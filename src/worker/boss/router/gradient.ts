/**
 * THE SPEND GRADIENT — how careful to be with money, measured against the month ELAPSED.
 *
 * ─── Her ladder, in her words ───────────────────────────────────────────────────────────────────
 *
 *   under $5   normal
 *   $5 – $10   starts making cheaper choices
 *   over $10   moves cautiously — free-first hard, paid only for protected work
 *   $50        notify her, with the bypass decision in front of her
 *   $75        hard stop, bypass available
 *
 * ─── PRO-RATED, BECAUSE A RAW TOTAL PUNISHES ONE HEAVY DAY FOR THREE WEEKS ──────────────────────
 *
 * Her decision: "$8 on the 3rd is over pace and should tighten; $8 on the 25th is on pace and
 * should not." A raw month-to-date total cannot tell those two apart — it is the same $8 — so it
 * would put the whole rest of the month into austerity on the strength of one busy Tuesday.
 *
 * The formula, and it is one line:
 *
 *     elapsed  = (now − monthStart) / (monthEnd − monthStart)      ← 0…1, clamped below
 *     paced    = spentSoFar / elapsed                              ← what the month is ON COURSE to cost
 *     band     = ladder(paced)
 *
 * Comparing `spent / elapsed` against a fixed threshold is arithmetically identical to comparing
 * `spent` against `threshold × elapsed`, which is the same statement read the other way round: the
 * ladder's rungs slide up through the month. $8 on the 3rd paces to ~$80 and tightens hard; $8 on
 * the 25th paces to ~$9.60 and only nudges. That is exactly the distinction she asked for.
 *
 * `elapsed` IS FLOORED AT ONE DAY'S SHARE. At 00:05 on the 1st the true elapsed fraction is 0.0001
 * and any spend at all would pace to thousands of dollars — an austerity cliff produced by the
 * clock rather than by her spending. A day is the smallest window this system budgets in (`budgets`
 * has `day` and `month` rows and nothing shorter), so a day is the smallest window it may reason
 * about. The first day of the month is judged as a whole day.
 *
 * ─── THE TWO RUNGS THAT ARE NOT PACED, AND WHY ──────────────────────────────────────────────────
 *
 * $50 (notify) and $75 (hard stop) read the RAW month-to-date total, not the paced one. Those are
 * real money that has really left, and a projection must never be able to stop work that has not
 * actually happened yet — nor hide a stop that has. Pacing governs how CAREFUL to be; the raw total
 * governs what has been SPENT. Only the careful half is a forecast.
 *
 * ─── CONTINUOUS, NOT A CLIFF ────────────────────────────────────────────────────────────────────
 *
 * `paidCeilingFactor` slides from 1.0 at $0 paced to 0.2 at the cautious rung, with no step in it.
 * The three band NAMES are a summary of that curve for a person to read, not the mechanism. Nothing
 * in the router branches on the band alone except the one thing her ladder states as a rule —
 * free-first at the top rung.
 *
 * ─── WHAT THIS MAY NEVER DO ─────────────────────────────────────────────────────────────────────
 *
 *   1. IT NEVER MOVES THE LEVER. Her hand always wins. FREE_ONLY stays free at $0 spent; OPEN stays
 *      open at $40 spent. There is no `setSetting` in this file and there never may be — the
 *      gradient decides behaviour BETWEEN her instructions, and `appliesAt()` below is the whole of
 *      its authority: it returns false anywhere but MODERATE.
 *   2. IT NEVER DOWNGRADES PROTECTED WORK. Work that needs a capable model keeps one or fails
 *      loudly. No rung, no factor and no band may create a back door — see `isProtectedWork` and
 *      `gradientEffect`, where protected work is returned the unmodified posture at every level.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { formatMicros, type SpendLeverPosition } from "./spend";
import type { IntakeKind } from "../../../shared/boss/governance";

/** Her ladder, in micros. The only place these five figures are written down. */
export const GRADIENT_CHEAPER_MICROS = 5_000_000;
export const GRADIENT_CAUTIOUS_MICROS = 10_000_000;
export const GRADIENT_NOTIFY_MICROS = 50_000_000;
export const GRADIENT_HARD_STOP_MICROS = 75_000_000;

/** How far the paid per-run ceiling may be squeezed for UNPROTECTED work at the cautious rung. */
export const MIN_PAID_CEILING_FACTOR = 0.2;

export const GRADIENT_BANDS = ["NORMAL", "CHEAPER", "CAUTIOUS"] as const;
export type GradientBand = (typeof GRADIENT_BANDS)[number];

export interface MonthPace {
  monthStart: number;
  monthEnd: number;
  /** 0…1. Floored at one day's share so the 1st is judged as a day, not as a minute. */
  elapsed: number;
  /** Raw month-to-date spend across every lane, in micros. What has actually left. */
  spentMicros: number;
  /** spentMicros / elapsed — what the month is on course to cost. */
  pacedMicros: number;
  /** True when the floor was applied, so a surface can say the figure is a first-day reading. */
  elapsedFloored: boolean;
}

export interface GradientState extends MonthPace {
  band: GradientBand;
  /** Continuous 0…1: 0 at $0 paced, 1 at the cautious rung and beyond. */
  austerity: number;
  /** What an UNPROTECTED run's per-run ceiling is multiplied by. Protected work is never scaled. */
  paidCeilingFactor: number;
  /** Raw total has reached $50. She is told, with the bypass decision attached. */
  notify: boolean;
  /** Raw total has reached $75. The lane budgets' own hard stop is what enforces it. */
  hardStop: boolean;
  /** True only at MODERATE. FREE_ONLY and OPEN are her hand and the gradient does not touch them. */
  applies: boolean;
  /** The lever position this state was computed against, so a reader never has to guess. */
  leverPosition: SpendLeverPosition;
  /** One sentence: where she sits and why. */
  sentence: string;
  /** One sentence: what it is costing her in capability right now. */
  capabilityCost: string;
}

export function monthWindow(now: number): { start: number; end: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end };
}

const DAY_MS = 86_400_000;

/** The pure arithmetic, separated so a test can drive it without a database. */
export function monthPace(spentMicros: number, now: number): MonthPace {
  const { start, end } = monthWindow(now);
  const span = end - start;
  const floor = DAY_MS / span;
  const raw = Math.min(1, Math.max(0, (now - start) / span));
  const elapsed = Math.max(raw, floor);
  const spent = Number.isFinite(spentMicros) && spentMicros > 0 ? Math.floor(spentMicros) : 0;
  return {
    monthStart: start,
    monthEnd: end,
    elapsed,
    spentMicros: spent,
    pacedMicros: Math.round(spent / elapsed),
    elapsedFloored: raw < floor,
  };
}

export function bandFor(pacedMicros: number): GradientBand {
  if (pacedMicros > GRADIENT_CAUTIOUS_MICROS) return "CAUTIOUS";
  if (pacedMicros >= GRADIENT_CHEAPER_MICROS) return "CHEAPER";
  return "NORMAL";
}

/**
 * THE GRADIENT RUNS ONLY INSIDE MODERATE.
 *
 * At FREE_ONLY there is nothing to make cheaper — everything paid is already refused. At OPEN she
 * has said, in as many words, do not apply a ceiling. Tightening either one would be the gradient
 * overruling her hand, which is the one thing it may not do.
 */
export function appliesAt(position: SpendLeverPosition): boolean {
  return position === "MODERATE";
}

/**
 * WHAT COUNTS AS PROTECTED, stated in one place so no threshold can quietly redefine it.
 *
 * The guarantee is behavioural, not advisory: protected work is never downgraded anywhere on the
 * gradient. It either gets a model adequate to the job or it stops and says why.
 *
 * FAIL PROTECTIVE ON ABSENCE. An unstated risk or an unrecognised intake kind is not a licence to
 * economise on it — but neither is everything protected, or the gradient would govern nothing. The
 * rule is: HIGH RISK, RESTRICTED CONTENT, or one of the kinds where a wrong answer costs her real
 * money or a relationship. Everything else is ordinary work the gradient may economise on.
 */
export const PROTECTED_INTAKE_KINDS: ReadonlySet<string> = new Set<IntakeKind>([
  "trading",
  "decision_support",
  "approval_request",
  "relationship",
]);

export function isProtectedWork(work: {
  risk?: string | null;
  sensitivity?: string | null;
  intakeKind?: string | null;
  /** An explicit declaration by a caller. It may only ever ADD protection, never remove it. */
  declaredProtected?: boolean;
}): boolean {
  if (work.declaredProtected === true) return true;
  if (work.risk === "high") return true;
  if (work.sensitivity === "restricted") return true;
  return PROTECTED_INTAKE_KINDS.has(String(work.intakeKind ?? ""));
}

export interface GradientEffect {
  /** Non-protected paid routes are held back until every free route has been tried and failed. */
  freeFirst: boolean;
  /** Non-protected work may not use a paid route at all at this rung. */
  paidForProtectedOnly: boolean;
  /** Multiplies the per-run ceiling for non-protected work. Always 1 for protected work. */
  perRunFactor: number;
  /** Frontier-tier models are not spent on ordinary work while tightening. */
  allowFrontierForOrdinaryWork: boolean;
  /** Why, in one sentence, for the decision log and for her. */
  reason: string;
}

export const NO_EFFECT: GradientEffect = {
  freeFirst: false,
  paidForProtectedOnly: false,
  perRunFactor: 1,
  allowFrontierForOrdinaryWork: true,
  reason: "",
};

/**
 * What the gradient does to ONE run.
 *
 * PROTECTED WORK RETURNS `NO_EFFECT` BEFORE ANY BAND IS READ. That ordering is the guarantee: there
 * is no branch below it in which a rung, a factor or a band can reach protected work, so no
 * threshold added later can create a back door without deleting this line first — and
 * `the-gradient-never-downgrades-protected-work.mjs` fails if it is deleted.
 */
export function gradientEffect(state: GradientState, protectedWork: boolean): GradientEffect {
  if (!state.applies) return NO_EFFECT;
  if (protectedWork) return NO_EFFECT;

  if (state.band === "CAUTIOUS") {
    return {
      freeFirst: true,
      paidForProtectedOnly: true,
      perRunFactor: state.paidCeilingFactor,
      allowFrontierForOrdinaryWork: false,
      reason:
        `Month-to-date spend is ${formatMicros(state.spentMicros)}, which paces to ` +
        `${formatMicros(state.pacedMicros)} — over the ${formatMicros(GRADIENT_CAUTIOUS_MICROS)} rung — so ordinary ` +
        `work runs free-first and paid routes are held for protected work.`,
    };
  }
  if (state.band === "CHEAPER") {
    return {
      freeFirst: true,
      paidForProtectedOnly: false,
      perRunFactor: state.paidCeilingFactor,
      allowFrontierForOrdinaryWork: false,
      reason:
        `Month-to-date spend is ${formatMicros(state.spentMicros)}, which paces to ` +
        `${formatMicros(state.pacedMicros)} — past the ${formatMicros(GRADIENT_CHEAPER_MICROS)} rung — so ordinary ` +
        `work prefers a free route and does not spend on a frontier model.`,
    };
  }
  return NO_EFFECT;
}

/**
 * Read the month's spend and say where she sits.
 *
 * THE FIGURE IS THE ONE THE BUDGETS ALREADY HOLD. `budgets` rows with `period = 'month'` are the
 * dollar authority this system already enforces and already rolls; summing them is reading the
 * existing number rather than introducing a fourth one that could disagree with it. Her $75 is
 * exactly those rows' limits added up ($52.50 ops + $22.50 trading), which is why the hard stop
 * needs no new mechanism — `hard_stop = 1` on both rows already is it.
 */
export async function gradientState(
  db: D1Database,
  leverPosition: SpendLeverPosition,
  now = Date.now(),
): Promise<GradientState> {
  let spent = 0;
  try {
    const row = await db
      .prepare(`SELECT COALESCE(SUM(spent_micros), 0) AS spent FROM budgets WHERE period = 'month'`)
      .first<{ spent: number }>();
    spent = Number(row?.spent ?? 0);
  } catch {
    // A figure that could not be read is not a licence to spend. Zero would read as "nothing spent"
    // and relax the gradient, so an unreadable month is treated as the cautious rung instead.
    return unreadable(leverPosition, now);
  }

  const pace = monthPace(spent, now);
  return assemble(pace, leverPosition);
}

function assemble(pace: MonthPace, leverPosition: SpendLeverPosition): GradientState {
  const band = bandFor(pace.pacedMicros);
  const austerity = Math.min(1, Math.max(0, pace.pacedMicros / GRADIENT_CAUTIOUS_MICROS));
  const paidCeilingFactor = 1 - (1 - MIN_PAID_CEILING_FACTOR) * austerity;
  const applies = appliesAt(leverPosition);

  const where =
    `${formatMicros(pace.spentMicros)} spent ${Math.round(pace.elapsed * 100)}% of the way through the month, ` +
    `which paces to ${formatMicros(pace.pacedMicros)} by month end`;

  const sentence = applies
    ? `${where}. That is the ${bandLabel(band)} rung of the gradient.`
    : `${where}. The gradient is not applied: the lever is at ${leverPosition}, which is your instruction and it wins.`;

  const capabilityCost = !applies
    ? leverPosition === "FREE_ONLY"
      ? "Nothing paid runs at all, and work that needs a paid model stops and says so rather than being given a weaker one."
      : "Nothing is being held back. The lever is OPEN, so no ceiling is applied to any work."
    : band === "CAUTIOUS"
      ? "Ordinary work is running on free routes only and is not spending on frontier models. Protected work — high risk, restricted content, trading, decision support, approvals and relationships — is untouched and still gets a capable model."
      : band === "CHEAPER"
        ? `Ordinary work prefers a free route and will not spend on a frontier model, and its per-run ceiling is at ${Math.round(paidCeilingFactor * 100)}% of normal. Protected work is untouched.`
        : "Nothing is being held back. Every route the lever allows is available to every kind of work.";

  return {
    ...pace,
    band,
    austerity,
    paidCeilingFactor,
    notify: pace.spentMicros >= GRADIENT_NOTIFY_MICROS,
    hardStop: pace.spentMicros >= GRADIENT_HARD_STOP_MICROS,
    applies,
    leverPosition,
    sentence,
    capabilityCost,
  };
}

function bandLabel(band: GradientBand): string {
  return band === "CAUTIOUS" ? "cautious" : band === "CHEAPER" ? "cheaper-choices" : "normal";
}

function unreadable(leverPosition: SpendLeverPosition, now: number): GradientState {
  const { start, end } = monthWindow(now);
  const state = assemble(
    {
      monthStart: start,
      monthEnd: end,
      elapsed: 1,
      spentMicros: GRADIENT_CAUTIOUS_MICROS + 1,
      pacedMicros: GRADIENT_CAUTIOUS_MICROS + 1,
      elapsedFloored: false,
    },
    leverPosition,
  );
  return {
    ...state,
    sentence:
      "This month's spend could not be read from the budgets table, so the gradient holds at its most " +
      "cautious rung. An unreadable figure is not permission to spend.",
    capabilityCost: state.capabilityCost,
  };
}

/**
 * THE $50 NOTICE, WITH THE DECISION ALREADY IN FRONT OF HER.
 *
 * Her instruction is not "tell her the number" — it is "notify her, with the bypass decision in
 * front of her". A notice with nothing to do about it is the thing this repository calls a red
 * light with no remedy, so the sentence names the amount, the stop it is heading for, and the one
 * instrument that moves it.
 */
export function notifySentence(state: GradientState): string {
  const left = Math.max(0, GRADIENT_HARD_STOP_MICROS - state.spentMicros);
  return (
    `This month has cost ${formatMicros(state.spentMicros)} of the ${formatMicros(GRADIENT_HARD_STOP_MICROS)} ` +
    `hard stop — ${formatMicros(left)} left${state.hardStop ? ", and it has been reached" : ""}. ` +
    `${state.hardStop
      ? "Everything that costs money is refused until the month rolls."
      : "At the hard stop everything that costs money is refused until the month rolls."} ` +
    `The decision is yours: raise a month bypass naming an amount, a reason and an expiry, or let it stop.`
  );
}
