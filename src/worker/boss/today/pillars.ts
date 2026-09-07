import type { Env } from "../env";
import { PROJECTS, activeProjects, firstMoneyProject, type Project } from "./projects";
import { gratitudeFor, MANIFESTATION_SEQUENCE, HARD_DAY_FLOOR } from "../spirit/practice";
import { isWestPeekDay } from "../spirit/arcs";

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
export async function wealthContract(env: Env, weekday: number): Promise<PillarContract> {
  const project = firstMoneyProject();

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
        action: "Write down five people who have ever sent you a deal, or realistically could. Code names only.",
        why:
          "Your funnel is thin because a referral business decays silently — nobody tells you they " +
          "stopped thinking of you. The system has the ranked-touch engine and no names in it, so " +
          "this is the one move that turns every following morning into a specific person.",
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
    action: `Touch ${rows[0]!.full_name}. ${names.length > 1 ? `Then ${rows[1]!.full_name}.` : ""}`.trim(),
    why: "§5.3 — the brokerage has right of first refusal, and these are the names that have gone quiet.",
    detail: names,
  };
}

/**
 * EXECUTION — the first completion action.
 *
 * COMPLETION, NOT PROGRESS, and the distinction is hers: §5.7 defines meaningful work as "at least
 * one concrete asset-advancing action". The oldest open loop comes first because an open loop is
 * something already started that is decaying — finishing it is worth more than beginning a fourth
 * thing, and it is the specific failure mode a person with six side projects has.
 */
export async function executionContract(env: Env, weekday: number): Promise<PillarContract> {
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
      action: wp.next_action ?? "Advance the raise.",
      why: "§5.4 — Wednesday is the West Peek cadence, and the meeting is the deadline.",
    };
  }

  const active = activeProjects().filter((p) => p.pillar === "execution" || p.key !== "brokerage");
  const pick = active.find((p) => p.next_action) ?? null;
  if (pick) {
    return { available: true, action: pick.next_action!, why: `${pick.name} — the active project in its lane.` };
  }

  /*
   * NO OPEN LOOP AND NOTHING ACTIVE IS A GOOD DAY, and it must not read as a broken screen. §5.2
   * says parked lines have no next action ON PURPOSE, so "nothing is owed" is the system working.
   */
  return {
    available: true,
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
  const out: { text: string; source: string }[] = [
    { text: wealth.action, source: "wealth — §5.3, right of first refusal" },
  ];

  const wp = PROJECTS.find((p) => p.key === "west_peek_raise")!;
  if (isWestPeekDay(weekday)) {
    out.push({ text: wp.next_action ?? "Advance the raise.", source: "west peek — §5.4, Wednesday is the meeting" });
  }

  if (out.length < 3 && execution.action !== wealth.action) {
    out.push({ text: execution.action, source: "execution — §5.7, one concrete asset-advancing action" });
  }

  if (out.length < 3) {
    out.push({ text: wp.next_action ?? "Advance the raise.", source: "west peek — the second active lane" });
  }

  // §17's cap is three. More than three priorities is no priorities.
  return out.slice(0, 3);
}

/** Everything the Morning Gate needs, assembled once. */
export async function buildPillars(
  env: Env,
  dayId: string,
  dayMode: string | null,
  weekday: number,
): Promise<{ spirit: PillarContract; wealth: PillarContract; execution: PillarContract; proposed: { text: string; source: string }[] }> {
  const hardDay = dayMode === "recovery" || dayMode === "mvd";
  const [spirit, wealth, execution] = await Promise.all([
    spiritContract(env, dayId, hardDay),
    wealthContract(env, weekday),
    executionContract(env, weekday),
  ]);
  return { spirit, wealth, execution, proposed: proposedPriorities(weekday, wealth, execution) };
}

export type { Project };
