import type { Env } from "../env";
import { PROJECTS, activeProjects, firstMoneyProject, type Project } from "./projects";
import { gratitudeFor, MANIFESTATION_SEQUENCE, HARD_DAY_FLOOR } from "../spirit/practice";
import { isWestPeekDay } from "../spirit/arcs";
import { stalledDeals, anchorStreak } from "./close";

/**
 * THE THREE PILLAR CONTRACTS THAT SAID `available: false`.
 *
 * §15.4 wants four Pillar Contracts every morning: an exact movement, an exact gratitude sentence,
 * an exact first money move, an exact first completion action. Body was real. The other three
 * returned `{ available: false }` with an honest reason, and the honesty was the only good part —
 * the Morning Gate could not produce them because it collected nothing to produce them FROM.
 *
 * The owner's sentence for what this is all for: "the whole point of this whole thing is to take
 * away the cognitive load of figuring out what i should do each day." A gate that asks her to type
 * three priorities is the load, not the relief. So these are DERIVED — from her projects, her arcs,
 * her practice and her real record — and she overrides them rather than authoring them.
 *
 * ─── Spirit was never missing. It was built and unwired. ────────────────────
 *
 * `spirit/practice.ts` has composed the day's gratitude sentence and held §8.3's seven-step
 * sequence this whole time. The gate simply never called it. That is worth saying plainly because
 * it is the second time today a feature existed and nothing invoked it.
 *
 * ─── What Wealth does when the record is empty ──────────────────────────────
 *
 * `relationships` has zero rows, so there is no ranked list to draw a touch from. The wrong answer
 * is to say "unavailable" and leave the block blank; the right one is an instruction that
 * BOOTSTRAPS the thing it needs. A system that cannot yet do its job should say what would let it,
 * as a first money move she can actually perform this morning.
 */

export interface PillarContract {
  available: boolean;
  /**
   * What this pillar MEANS, in her language, carried on every contract.
   *
   * Added because she said plainly that she did not know what Execution was. A pillar name that
   * needs a canon section to decode is a pillar she skips, and four of these are the whole agenda.
   */
  means?: string;
  /** The one exact act. §15.4 wants an act, not a topic. */
  action: string;
  why: string;
  detail?: string[];
  /** Named when the contract is degraded, so a thin day is never silently thin. */
  gap?: string;
}

/**
 * SPIRIT — the sentence and the sequence, both of which already existed.
 *
 * Composed in the Worker from her own record, no model and no stored row: `spirit` is sovereign on
 * both axes and this is spirit material. Deterministic for a given day, which is what a mantra
 * needs — the same sentence all day, not a new one on every page load.
 */
export async function spiritContract(env: Env, dayId: string, hardDay: boolean): Promise<PillarContract> {
  const gratitude = await gratitudeFor(env, dayId);
  return {
    /*
     * A SENTENCE THAT CANNOT BE COMPOSED SAYS SO. `composeGratitude` returns null rather than a form
     * with a blank in it when there is no real fact to hang the day on — a generic mantra is worse
     * than none, because it teaches her the line means nothing.
     */
    available: gratitude.unavailable === null,
    means: "Your practice — the sentence, the sequence, the ancestral hour. Imani's pillar.",
    action: gratitude.sentence,
    why: "§8.5 — one sentence, spoken out loud, drawn from your real life rather than a quote.",
    ...(gratitude.unavailable ? { gap: gratitude.unavailable } : {}),
    /*
     * THE FLOOR IS A DIFFERENT SEQUENCE, NOT A TRUNCATED ONE. §8.4 lists it separately, and its
     * last step is a real-world action on purpose — §8.2 forbids a practice that terminates in
     * feeling good about itself.
     */
    detail: (hardDay ? HARD_DAY_FLOOR : MANIFESTATION_SEQUENCE).map((s) => `${s.minutes} min — ${s.what}`),
  };
}

/**
 * WEALTH — the first money move, which is the single most load-bearing line on the screen.
 *
 * §5.3: the brokerage has right of first refusal every day. That is not weighed against the other
 * lanes each morning; it is the rule, and this function's only real job is to turn it into an act.
 *
 * WHY A TOUCH AND NOT A DEAL. She named three symptoms — nothing closing, thin top of funnel, deals
 * stalling — and they need different instruments. Only one of them can be committed to on a bad
 * Tuesday. A deal is an outcome and cannot be promised; a touch is an act and can. Continuity over
 * intensity is Law 2, and two touches every day beats ten on Monday and none until Friday.
 */
const WEALTH_MEANS = "Money in. Buyers, LPs, and the people who send you both. Camille and Monique's pillar.";

export async function wealthContract(env: Env, weekday: number): Promise<PillarContract> {
  const project = firstMoneyProject();

  /*
   * THE ANALYST WORKS; SHE REVIEWS. THAT ORDER IS THE WHOLE POINT.
   *
   * Her instruction: "you are my analyst and u need to help me find business", and "what flows down
   * to my agenda should be to review the work an analyst has done for me." Also, plainly: "calls
   * are a no."
   *
   * That reverses what this contract used to hand her. Every earlier version made the first money
   * move HER research — write a list, make touches, do the sourcing. She has an analyst for that
   * now: the Brokerage Sourcing Sweep runs at 06:45 and leaves candidates on the desk. So the first
   * money move is a DECISION on work already done, which is the only thing that cannot be
   * delegated and is also the cheapest thing she does all day.
   *
   * REVIEW COMES BEFORE TOUCHES, not after. An unreviewed pile is what a sourcing agent turns into
   * when nobody looks at it, and a stale pile is worse than none — it teaches her the agent's output
   * does not matter. So new candidates outrank an overdue touch, and the touch is next.
   */
  const fresh = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM sourcing_candidates WHERE status = 'new'`)
    .first<{ n: number }>();
  const waiting = fresh?.n ?? 0;

  if (waiting > 0) {
    const top = await env.DB
      .prepare(
        `SELECT name, ticket_floor_usd, thesis, source_name
           FROM sourcing_candidates
          WHERE status = 'new'
          ORDER BY COALESCE(ticket_floor_usd, 0) DESC, created_at DESC
          LIMIT 3`,
      )
      .all<{ name: string; ticket_floor_usd: number | null; thesis: string | null; source_name: string | null }>();

    return {
      available: true,
      means: WEALTH_MEANS,
      action: `Review ${waiting} candidate${waiting === 1 ? "" : "s"} your analyst found. Keep, reject, or ask for more like one.`,
      why:
        "§5.3 — the brokerage has right of first refusal on the first money move, and the sourcing " +
        "sweep already did the looking. Deciding is the part that cannot be delegated.",
      detail: (top.results ?? []).map((c) => {
        const size = c.ticket_floor_usd ? `$${Math.round(c.ticket_floor_usd / 1_000_000)}M+` : "size unstated";
        return `${c.name} — ${size}${c.thesis ? ` · ${c.thesis}` : ""}${c.source_name ? ` (${c.source_name})` : ""}`;
      }),
    };
  }

  /*
   * TOUCHES DUE, FROM THE RANKED LIST — the instrument the system already has and has never had a
   * row in. `relationships` carries strategic importance, trust, opportunity value, cadence days and
   * last contact, with a scoring engine behind it. Built, never populated, invisible because empty.
   */
  /*
   * TOUCHES DUE, JOINED TO THE PERSON, because the name is not on this table.
   *
   * `relationships` holds the scoring — importance, trust, opportunity value, cadence, last contact
   * — and `people` holds who it is. An earlier draft of this query selected `r.code_name`, a column
   * that does not exist, wrapped in a `.catch()` that turned the error into an empty list. It would
   * have shown the bootstrap message every morning for ever, including long after she had filled
   * the list in, and nothing would have said why. THE CATCH IS GONE: a broken query here must fail
   * loudly rather than quietly mean "nobody is due".
   *
   * `full_name` IS WHERE HER CODE NAME LIVES. `people` is CLOUD_SYNC, and her standing rule is that
   * no company or counterparty name enters the OS — so what is stored here is SANDPIPER, and the
   * mapping to a real person stays with her.
   */
  const due = await env.DB
    .prepare(
      `SELECT r.id, p.full_name, r.cadence_days, r.last_contact_at, r.strategic_importance
         FROM relationships r
         JOIN people p ON p.id = r.person_id
        WHERE r.status = 'active'
          AND r.next_touch_due_at IS NOT NULL
          AND r.next_touch_due_at <= ?
        ORDER BY r.relationship_health DESC, r.next_touch_due_at ASC
        LIMIT 3`,
    )
    .bind(Date.now())
    .all<{ id: string; full_name: string; cadence_days: number | null; last_contact_at: number | null; strategic_importance: number | null }>();

  const rows = due.results ?? [];

  if (rows.length === 0) {
    const anyRows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM relationships WHERE status = 'active'`).first<{ n: number }>();
    const empty = (anyRows?.n ?? 0) === 0;

    /*
     * THE BOOTSTRAP. An empty list is not "no first money move" — it is a different first money
     * move, and a completable one. Thirty minutes, once, and the motion runs itself afterwards.
     * Saying "unavailable" here would leave the most important line on her screen blank on the one
     * morning it could most easily be fixed.
     */
    if (empty) {
      return {
        available: true,
        means: WEALTH_MEANS,
        action: "Name five people who have ever sent you a deal, or realistically could. Code names only.",
        why:
          "The one thing your analyst cannot find for you. New buyers it can source; who already " +
          "trusts you is only in your head — and a referral business decays silently, because " +
          "nobody ever tells you they stopped thinking of you. Ten minutes, once.",
        detail: [
          "Code name, side (buyer or seller), and roughly when you last spoke.",
          "A cadence each: 30, 60 or 90 days. Rough is fine — it is decided once.",
          "No company names. The mapping stays out of the system.",
        ],
        gap: "relationships is empty, so there is no ranked list to draw today's touch from.",
      };
    }

    // Names exist and none is due: that is a real answer and a good day, not a gap.
    return {
      available: true,
      means: WEALTH_MEANS,
      action: `${project.next_action ?? "Advance the engine."} Nobody is overdue, so pick the highest-value name and get ahead.`,
      why: "§5.3 — the brokerage has right of first refusal on the first money move, every day.",
    };
  }

  const names = rows.map((r) => {
    const days = r.last_contact_at ? Math.floor((Date.now() - r.last_contact_at) / 86_400_000) : null;
    return days === null ? `${r.full_name} — never contacted` : `${r.full_name} — ${days} days since last contact`;
  });

  return {
    available: true,
    means: WEALTH_MEANS,
    action: `Touch ${rows[0]!.full_name}. ${names.length > 1 ? `Then ${rows[1]!.full_name}.` : ""}`.trim(),
    why: "§5.3 — the brokerage has right of first refusal, and these are the names that have gone quiet.",
    detail: names,
  };
}

/**
 * EXECUTION — and the first job of this function is to say what that word means.
 *
 * HER WORDS: "idk what Execution is - i know what Body is." A pillar she cannot name is a pillar
 * that is not working, and that is a defect in the system rather than in her: §5.7 defines it as
 * "at least one concrete asset-advancing action", which is a definition only its author could love.
 *
 * IN HER TERMS IT IS THIS: did anything you own actually get built or shipped. Her assets are the
 * properties and the repos behind them, and Execution is the pillar that asks whether they moved.
 * That is why Danielle — Technical Program Manager, Engineering — owns it, and every contract
 * returned here now carries `means` so the word is never bare on the screen again.
 *
 * COMPLETION, NOT PROGRESS. The oldest open loop comes before a fourth new thing, because a person
 * with six side projects fails by starting rather than by finishing.
 */
export async function executionContract(env: Env, weekday: number): Promise<PillarContract> {
  /*
   * A STALLING DEAL OUTRANKS EVERYTHING HERE, because it is the symptom that costs the most and the
   * one nothing could measure. Her third complaint was "deals stalling or falling through", and a
   * deal does not announce that it is dying — it stops moving while the record still looks tended,
   * since `updated_at` moves for any edit at all. `stage_since` is the honest clock.
   *
   * Ahead of the oldest open loop deliberately: a loop is something she wrote down and can see; a
   * deal that has quietly aged past its stage threshold is the one she would otherwise discover at
   * the point it is already dead.
   */
  const MEANS = "Did anything you own actually get built or shipped. Danielle's pillar.";

  const stalled = await stalledDeals(env);
  if (stalled.length > 0) {
    const d = stalled[0]!;
    return {
      available: true,
      means: MEANS,
      action: d.next_step ? `${d.name} — ${d.next_step}` : `${d.name} — decide the next step, or mark it dead.`,
      why:
        `${d.days_in_stage} days in ${d.stage}, past the ${d.threshold}-day mark for that stage. ` +
        `Deals do not announce that they are dying; they stop moving.`,
      detail: stalled.slice(1, 3).map((x) => `${x.name} — ${x.days_in_stage}d in ${x.stage}`),
      ...(stalled.length > 3 ? { gap: `${stalled.length - 3} more deals are also past their stage threshold.` } : {}),
    };
  }

  /*
   * OLDEST FIRST, BY `created_at` — the column this table actually has. An earlier draft ordered by
   * `opened_at`, which does not exist, behind a `.catch()` that would have reported "nothing is
   * owed" on a day with a month-old loop rotting in it. Priority breaks the tie, so a high-priority
   * loop is not outranked by an older trivial one.
   */
  const loop = await env.DB
    .prepare(`SELECT id, title, created_at, priority FROM open_loops WHERE status = 'open' ORDER BY priority ASC, created_at ASC LIMIT 1`)
    .first<{ id: string; title: string; created_at: number; priority: number }>();

  if (loop) {
    const days = Math.floor((Date.now() - loop.created_at) / 86_400_000);
    return {
      available: true,
      means: MEANS,
      action: `Close: ${loop.title}`,
      why: `§5.7 — the oldest open loop, ${days} day${days === 1 ? "" : "s"} old. Finishing beats starting a fourth thing.`,
    };
  }

  /*
   * WEDNESDAY IS THE WEST PEEK MEETING, and on that day the completion action is the thing with a
   * deadline attached rather than whatever is oldest. §5.4 names the cadence; this is it having a
   * consequence instead of being a fact on a screen.
   */
  if (isWestPeekDay(weekday)) {
    const wp = PROJECTS.find((p) => p.key === "west_peek_raise")!;
    return {
      available: true,
      means: MEANS,
      action: wp.next_action ?? "Advance the raise.",
      why: "§5.4 — Wednesday is the West Peek cadence, and the meeting is the deadline.",
    };
  }

  /*
   * WEST PEEK'S WORK DOES NOT LEAK INTO OTHER DAYS.
   *
   * This used to fall through to "the active project in its lane", which on any day with no open
   * loops reached the raise and put the LP list on a Monday. The owner caught it on the first live
   * run: "the LP list is for west peek only not this."
   *
   * She is right, and it is her own rule. §5.4 names Wednesday as the West Peek cadence; §5.5 keeps
   * a weekday vehicle in the background unless it is strategically justified. A generic fallthrough
   * that reaches for the nearest active project quietly promotes one lane's work into every lane's
   * empty slot — which is exactly how a system stops being trusted, because the day it hands you is
   * no longer the day your own rules describe.
   *
   * So there is no fallthrough. Wednesday is handled above; otherwise nothing is owed — and that
   * must not read as a broken screen. §5.2 parks lines with no next action ON PURPOSE, so an empty
   * slot is the system working rather than failing to think of something.
   */
  return {
    available: true,
    means: MEANS,
    action: "Nothing is owed. Take the empty slot or bank it.",
    why: "No open loops, and every other line is parked or self-running. That is the system working, not a gap.",
  };
}

/**
 * The day's three proposed priorities.
 *
 * THE GATE USED TO ASK HER TO TYPE THESE. That is the cognitive load this whole system exists to
 * remove: a blank field at 6am is the moment she has to hold every project in her head and rank
 * them, which is the exact work she asked to be relieved of.
 *
 * So they are PROPOSED, in a fixed order she never has to re-derive, and she overrides them when
 * something has come up. Her own words: the system decides, and she makes last-minute or emergency
 * adjustments. An override is a normal event, not an exception — see `today/adjust.ts`.
 */
export function proposedPriorities(
  weekday: number,
  wealth: PillarContract,
  execution: PillarContract,
): { text: string; source: string }[] {
  const out: { text: string; source: string }[] = [];

  /*
   * DE-DUPLICATED, BECAUSE THREE PRIORITIES WHERE TWO ARE THE SAME IS TWO PRIORITIES.
   *
   * Caught on the first real run against her live day. With no open loops, the Execution contract
   * correctly falls through to the active project in its lane — which is the raise — and the West
   * Peek line was then added again beneath it. The screen listed "Work today's LP list" twice and
   * looked like a full day. §17 caps the list at three because CHOOSING three is the work; padding
   * it with a repeat is the same failure as exceeding it, wearing better clothes.
   */
  const add = (text: string, source: string) => {
    if (!text) return;
    if (out.some((p) => p.text === text)) return;
    out.push({ text, source });
  };

  add(wealth.action, "wealth — §5.3, right of first refusal");

  const wp = PROJECTS.find((p) => p.key === "west_peek_raise")!;
  if (isWestPeekDay(weekday)) {
    add(wp.next_action ?? "Advance the raise.", "west peek — §5.4, Wednesday is the meeting");
  }

  add(execution.action, "execution — §5.7, one concrete asset-advancing action");

  /*
   * NO WEST PEEK FILLER. A third line was appended here from the raise whenever the list was short,
   * which is the same leak as the one in `executionContract` and the owner named it in the same
   * breath. A short list is a real answer: on a quiet Monday two priorities is two priorities, and
   * padding it to three teaches her that the third line never means anything.
   */
  // §17's cap is three. More than three priorities is no priorities.
  return out.slice(0, 3);
}

/** Everything the Morning Gate needs, assembled once. */
export async function buildPillars(
  env: Env,
  dayId: string,
  dayMode: string | null,
  weekday: number,
): Promise<{
  spirit: PillarContract;
  wealth: PillarContract;
  execution: PillarContract;
  proposed: { text: string; source: string }[];
  /** Said only when a run of missed anchors is long enough to be a pattern. Null otherwise. */
  warning: string | null;
}> {
  const hardDay = dayMode === "recovery" || dayMode === "mvd";
  const [spirit, wealth, execution, streak] = await Promise.all([
    spiritContract(env, dayId, hardDay),
    wealthContract(env, weekday),
    executionContract(env, weekday),
    anchorStreak(env, dayId),
  ]);

  /*
   * THE RUN OF MISSES IS SAID AT THE TOP OF THE DAY, ONCE, AND WITHOUT SCOLDING.
   *
   * A system that proposes the same first money move for a fortnight while it goes undone every
   * time has stopped describing her life. It has to be able to say so — and it has to say it as a
   * fact about the plan rather than about her, because "either the day is wrong or the move is" is
   * the useful reading and the only one she can act on.
   */
  return { spirit, wealth, execution, proposed: proposedPriorities(weekday, wealth, execution), warning: streak.warning };
}

export type { Project };
