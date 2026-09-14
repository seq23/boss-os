import type { Env } from "../env";
import { batchReads } from "../lib/batchReads";
import { propertyFor, suggestingKeys } from "../../../shared/boss/grid.mjs";
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

/** Monday to Friday. 0 is Sunday, per `duties/cadence.ts`. */
export function isWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/**
 * ONE CONCRETE BROKERAGE THING SHE COULD DO TODAY — Monday to Friday, or nothing at all.
 *
 * ─── Her instruction ───────────────────────────────────────────────────────
 *
 *   "my today's contract should suggest something in brokerage M-F"
 *
 * ─── Why the contract was not already doing it ─────────────────────────────
 *
 * §5.3 gives the brokerage right of first refusal on the first money move and `wealthContract`
 * honours that — on paper. In practice the two brokerage sources above it are frequently empty
 * (`mailbox_findings` pairs and `sourcing_candidates`), so a real weekday fell through to the
 * relationship touch or, on an empty `relationships` table, to the bootstrap line. She was being
 * handed set-up work on a business that has live inventory sitting in the system.
 *
 * ─── What it is allowed to read, which is narrower than it looks ───────────
 *
 * The 2,145-row interest ledger is NOT in this database and must not be: `interest-match.mjs`
 * states the standing rule — "Named counterparties, assets and sizes never reach the Boss OS
 * database" — and it lives on her Mac.
 *
 * WHAT CHANGED IN 0234, AND WHAT DID NOT. The ledger still does not cross, and never will. What
 * crosses is a POINTER: Monique computes the crossings on her Mac where the ledger is, emails her
 * the full detail from monique@sequoiataylor.com — counterparty, asset, size, next action — and
 * posts back a count, a kind and the minute the mail went. Nothing else can cross, because
 * `brokerage_pointers` has no free TEXT column to put it in. This is the same shape
 * `buyer-hunt.mjs --from-boss` already uses: compute where the data is, report back what is safe.
 *
 * So the contract can finally lead with her real book without the book being here.
 *
 * What IS here, sovereign and hers:
 *   - `brokerage_pointers` — how many crossings Monique found in the ledger and when she sent them.
 *     A count and a clock. No name has ever been in this table and none can be put in it.
 *   - `capital_book_line` — her own live inventory, stored because she is the counterparty and no
 *     third party is named in it.
 *   - `counterparty_crossmatches` — a buyer candidate who also appears on her LP tracker. Public
 *     institutions with aggregate counts, never a person.
 *
 * ─── AND IT IS ALLOWED TO SAY NOTHING ──────────────────────────────────────
 *
 * Returning null is a correct and frequent answer. Her standing rule on this lane is that coming
 * back empty-handed is fine and returning noise is not, and a filler suggestion every weekday is
 * worse than a quiet day — she would stop reading the section, which costs more than the days it
 * covered. So there is no fallback here and nothing is invented: two real sources, then null.
 */
export async function brokerageMove(
  env: Env,
  weekday: number,
): Promise<{ action: string; why: string; detail?: string[] } | null> {
  if (!isWeekday(weekday)) return null;

  /*
   * ─── HER OWN BOOK, WORKED THIS MORNING, POINTED AT WITHOUT BEING NAMED ────
   *
   * FIRST, AND THE POSITION IS THE ARGUMENT. Everything below this is a candidate the system
   * inferred; this is two live sides of the same name out of her own ledger, which is the most
   * valuable thing any part of this machine can find and the reason the ledger was built. A
   * crossmatch with an LP is a maybe. A crossing is a commission.
   *
   * FRESH ONLY, AND ONCE. A pointer is a pointer to a specific email that arrived this morning; one
   * from Tuesday would send her looking for a message she has already read, which is how she learns
   * the line is decorative. `seen_at` is stamped when it is shown, so the same mail is pointed at
   * exactly once, and the window is eighteen hours so a 07:45 send is still live at midnight and
   * gone by the next morning's run.
   *
   * NO NAMES, AND THE QUERY IS THE PROOF. It selects three columns — a count, a kind and a clock —
   * because those are the only columns there are. `validate:pointer-has-no-names` fails the build
   * if that ever stops being true.
   */
  const FRESH_MS = 18 * 60 * 60 * 1000;
  const pointer = await env.DB
    .prepare(
      `SELECT id, kind, crossings, sent_at
         FROM brokerage_pointers
        WHERE seen_at IS NULL AND sent_at >= ?
        ORDER BY sent_at DESC
        LIMIT 1`,
    )
    .bind(Date.now() - FRESH_MS)
    .first<{ id: number; kind: string; crossings: number; sent_at: number }>()
    .catch(() => null);

  if (pointer) {
    await env.DB
      .prepare(`UPDATE brokerage_pointers SET seen_at = ? WHERE id = ?`)
      .bind(Date.now(), pointer.id)
      .run()
      .catch(() => null);

    const clock = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Chicago",
    }).format(new Date(pointer.sent_at));
    const n = pointer.crossings;
    const noun = pointer.kind === "cross"
      ? `crossing${n === 1 ? "" : "s"} from your book`
      : `conversation${n === 1 ? "" : "s"} worth restarting`;

    return {
      action: `Monique has ${n} ${noun} — she sent them at ${clock} and they are in your inbox. Work them before anything else today.`,
      why:
        `She read your interest ledger on your own Mac, where it stays, and crossed it against your ` +
        `live book. Both sides of ${n === 1 ? "this one" : "each of these"} have already told you what they ` +
        `wanted. The names, the sizes and the next move are in the email — they are deliberately not ` +
        `on this screen and never will be.`,
    };
  }

  /*
   * A FIRM SHE IS ALREADY TALKING TO, AS A BUYER FOR SOMETHING SHE IS CARRYING.
   *
   * CONFIRMED ONLY, and that threshold is load-bearing for the same reason the missed-deal pairing
   * takes `high` alone: a `near` match is a maybe, and a maybe at the top of her morning is a guess
   * presented as a plan. One wrong "approach them about this" costs a call and some credibility.
   *
   * `lp_list` IS SAID OUT LOUD rather than filtered on. Suppressed means suppressed AS AN LP, which
   * says nothing whatever about approaching the same firm as a buyer — the table's own comment
   * makes that point, and dropping those rows would hide real opportunities while looking careful.
   * Naming the list lets her make that call in a second, which is a decision she is qualified to
   * make and this function is not.
   */
  const cross = await env.DB
    .prepare(
      `SELECT candidate_name, lp_firm, lp_list, lp_last_sent, why
         FROM counterparty_crossmatches
        WHERE status = 'new' AND confidence = 'confirmed'
        ORDER BY created_at ASC
        LIMIT 3`,
    )
    .all<{ candidate_name: string; lp_firm: string; lp_list: string; lp_last_sent: string | null; why: string }>()
    .catch(() => null);

  const matches = cross?.results ?? [];
  if (matches.length > 0) {
    const top = matches[0]!;
    return {
      // NAMES THE FIRM AND THE NEXT ACT. "Review your crossmatches" is a queue; this is a thing to do.
      action: `${top.lp_firm} is on your LP tracker and came up as a buyer for ${top.candidate_name} — decide whether to approach them on the buy side, and say no if not.`,
      why:
        `${top.why} You are already in contact with them${top.lp_last_sent ? ` (last LP send ${top.lp_last_sent})` : ""}, ` +
        `so this is a conversation you are already having rather than a cold approach. They are on the ` +
        `"${top.lp_list}" list, which is a fact about them as an LP and says nothing about them as a buyer.`,
      detail: matches.slice(1).map((m) => `${m.lp_firm} ↔ ${m.candidate_name} — ${m.lp_list}`),
    };
  }

  /*
   * A LOT ON HER BOOK THAT NOBODY CAN SIZE A BUYER FOR.
   *
   * `storeLiveBook` deliberately keeps a sizeless lot when she typed `add` or `book` — "if `add` can
   * hold a name with no number" — rather than throwing the name away. That is right at intake and it
   * leaves a real gap at the other end: Monique matches on size, so a lot with no number is
   * inventory that cannot be worked. It is hers to close, in one line, and nobody else can.
   *
   * THE BOOK'S AGE IS NOT CHECKED HERE. A stale book is machinery-adjacent nagging and already has
   * a home in `capital/bookNag.ts` on the alert surface. Two places raising the same fact is the
   * defect this repository names; one fact, one place.
   */
  const sizeless = await env.DB
    .prepare(
      `SELECT l.asset, l.side, l.size_text
         FROM capital_book_line l
         JOIN capital_book b ON b.id = l.book_id
        WHERE b.superseded_at IS NULL
          AND l.size_usd IS NULL AND l.size_min_usd IS NULL
          AND l.size_max_usd IS NULL AND l.size_shares IS NULL
        ORDER BY l.rowid
        LIMIT 3`,
    )
    .all<{ asset: string; side: string; size_text: string | null }>()
    .catch(() => null);

  const unsized = sizeless?.results ?? [];
  if (unsized.length > 0) {
    const top = unsized[0]!;
    return {
      action: `Put a size on ${top.asset} (${top.side}) — reply to boss@sequoiataylor.com with #monique and the number.`,
      why:
        `It is on your live book with no size, and Monique matches buyers on size — so that lot is ` +
        `inventory nobody can work. One line closes it, and only you know the number.`,
      detail: unsized.slice(1).map((l) => `${l.asset} (${l.side}) — ${l.size_text || "no size given"}`),
    };
  }

  // Nothing worth saying. That is an answer, and it is the right one more often than not.
  return null;
}

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
  /*
   * A DEAL SHE ALREADY HAS OUTRANKS A BUYER SHE HAS NOT MET.
   *
   * 0204. Monique's mailbox sweep finds pairs: someone asked about a company, someone else later
   * had access to it, and nothing connected them. That is not a lead — it is two people who have
   * both already talked to her about the same asset, which is the shortest distance to a
   * commission in this business and is therefore the first money move whenever one exists.
   *
   * HIGH CONFIDENCE ONLY, and that threshold is load-bearing. `high` means both sides were explicit
   * and within six months. A `medium` at the top of her morning would be a maybe presented as a
   * plan, and one wrong "these two should talk" costs her a phone call and some credibility — the
   * same reason the sourcing sweep drops a candidate with no checkable source.
   *
   * WHY IT LANDS HERE RATHER THAN AS A FOURTEENTH BLOCK. Today has thirteen elements and the
   * Wealth Pillar Contract already answers "what is the first money move". A finding that arrived
   * as its own panel would be a second answer to the same question sitting next to the first, which
   * is how a screen starts disagreeing with itself.
   */
  /*
   * THE CASCADE'S READS GO OUT TOGETHER. This is a chain of fallbacks — a mailbox pairing, else
   * fresh candidates, else the brokerage pointer, else a touch due, else the empty-network ask —
   * and it read each rung only after the one above came back empty: up to five serial round trips
   * on a runtime where each is most of a millisecond of a 10 ms budget. The rungs are decided in
   * the same order from the same rows; they are simply all read at once. `brokerageMove` stays
   * lazy because it writes.
   */
  const reads = batchReads(env.DB);
  const pairingP = reads.all<{
      subject_code: string; counterpart_code: string | null; subject_matter: string | null;
      headline: string; because: string; suggested_action: string;
    }>(true, () => env.DB
    .prepare(
      `SELECT subject_code, counterpart_code, subject_matter, headline, because, suggested_action
         FROM mailbox_findings
        WHERE kind = 'missed_deal' AND confidence = 'high'
          AND status = 'new' AND archived_at IS NULL
        ORDER BY found_at DESC LIMIT 3`,
    ));
  const freshP = reads.first<{ n: number }>(true, () => env.DB
    .prepare(`SELECT COUNT(*) AS n FROM sourcing_candidates WHERE status = 'new'`));
  const topP = reads.all<{ name: string; ticket_floor_usd: number | null; thesis: string | null; source_name: string | null }>(true, () => env.DB
      .prepare(
        `SELECT name, ticket_floor_usd, thesis, source_name
           FROM sourcing_candidates
          WHERE status = 'new'
          ORDER BY COALESCE(ticket_floor_usd, 0) DESC, created_at DESC
          LIMIT 3`,
      ));
  const dueP = reads.all<{ id: string; full_name: string; cadence_days: number | null; last_contact_at: number | null; strategic_importance: number | null }>(true, () => env.DB
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
    .bind(Date.now()));
  const anyRowsP = reads.first<{ n: number }>(true, () => env.DB.prepare(`SELECT COUNT(*) AS n FROM relationships WHERE status = 'active'`));
  await reads.flush();
  const pairing = await pairingP;

  const pairs = pairing.results ?? [];
  if (pairs.length > 0) {
    const top = pairs[0]!;
    return {
      available: true,
      means: WEALTH_MEANS,
      action: top.suggested_action,
      why:
        "Monique found both sides of this in your own mailbox. Two people who have already talked " +
        "to you about the same asset is the shortest route to a commission you have — shorter than " +
        "any buyer a sweep can source, because the trust already exists.",
      detail: pairs.map((p) =>
        `${p.subject_code}${p.counterpart_code ? ` ↔ ${p.counterpart_code}` : ""}` +
        `${p.subject_matter ? ` · ${p.subject_matter}` : ""} — ${p.because}`,
      ),
    };
  }

  const fresh = await freshP;
  const waiting = fresh?.n ?? 0;

  if (waiting > 0) {
    const top = await topP;

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
   * ─── SOMETHING IN BROKERAGE, MONDAY TO FRIDAY ─────────────────────────────
   *
   * Her instruction: "my today's contract should suggest something in brokerage M-F."
   *
   * PLACED HERE, AND THE POSITION IS THE ARGUMENT. §5.3 already gives the brokerage right of first
   * refusal, and the two sources above are brokerage too — a missed-deal pairing out of her own
   * mailbox and a reviewed sourcing candidate are both stronger than anything below, so they keep
   * their rank. What was missing is that when BOTH are empty — which is most days — the contract
   * fell through to a relationship touch or, on an empty table, to the bootstrap line. She was
   * being handed set-up work on a business with live inventory sitting in the system.
   *
   * So this sits above the touch and below the two stronger brokerage sources: live inventory and a
   * firm she is already talking to beat a generic touch, and lose to a deal already half-made.
   *
   * IT IS ALLOWED TO BE SILENT, and usually is. `brokerageMove` returns null on weekends and on any
   * weekday with nothing real to say, and there is deliberately no filler behind it — a suggestion
   * every weekday whether or not one exists is how she learns to skip the section.
   */
  const brokerage = await brokerageMove(env, weekday);
  if (brokerage) {
    return { available: true, means: WEALTH_MEANS, ...brokerage };
  }

  /*
   * TOUCHES DUE, FROM THE RANKED LIST — the instrument the system already has and has never had a
   * row in. `relationships` carries strategic importance, trust, opportunity value, cadence days and
   * last contact, with a scoring engine behind it. Built, never populated, invisible because empty.
   *
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
  const due = await dueP;

  const rows = due.results ?? [];

  if (rows.length === 0) {
    const anyRows = await anyRowsP;
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
/**
 * AT MOST ONE SIDE-HUSTLE ITEM A DAY, AND ONLY WHERE A HUMAN IS ACTUALLY REQUIRED.
 *
 * ─── Her instructions ──────────────────────────────────────────────────────
 *
 *   "should suggest something that requires a human touch from one of the side hustles when
 *    appropriate n o more than 1 per day as appropriate"
 *
 *   "the system should know all of my side hustles......all of the repos that i care about for
 *    making money. the grid repos are my side hustles"
 *
 *   "the agent needs to examine what is going on with those businesses and give me stuff to do
 *    for those"
 *
 * ─── What was broken, and it was not the reasoning ─────────────────────────
 *
 * 0233 made "needs a human" a DECLARED flag rather than something read out of a free-text blocker,
 * and that argument still stands: matching by resemblance is what this repository refuses everywhere
 * it matters, and one wrong guess at the top of her day teaches her to skim. What it missed is that
 * NOTHING EVER SET THE FLAG. The slot has been silent since it shipped. A slot that only echoes her
 * own flags is not a suggestion — it is a to-do list she has to write first.
 *
 * ─── The fix is not inference. It is EXAMINATION. ──────────────────────────
 *
 * `scripts/ops/grid-watch.mjs` runs daily on her Mac and READS the grid repositories — workflows
 * still red, pull requests ageing, lanes that stopped shipping — and files what it found with the
 * URL behind each one. The flag is still declared; what changed is that something which went and
 * looked now declares it, on the strength of a fact she can open.
 *
 * ─── THREE SOURCES, IN THIS ORDER, AND THE ORDER IS AN ARGUMENT ────────────
 *
 *   1. DECLARED — `owned_deliverables.needs_owner`, set by hand. FIRST, because a flag she or an
 *      employee set deliberately outranks anything a job inferred. This is 0233 unchanged: the
 *      inference is added BESIDE the declaration, never in place of it.
 *   2. EXAMINED — a `needs_her` observation from today's grid examination. The bar is deliberately
 *      almost impossible to clear: a pull request where SHE is the requested reviewer, or one on a
 *      CLIENT property opened by somebody else and left sitting. Red builds and quiet lanes are
 *      dispatched to Danielle and never appear here.
 *   3. ASKED — an employee's judgement call that has been waiting. Somebody took the work as far as
 *      she could and asked a question only the owner can answer. LAST, because it is already in the
 *      approvals Inbox: it earns a place in the contract only once it has been sitting for days,
 *      which is the point at which the Inbox has demonstrably failed to get it in front of her.
 *
 * ─── THE CAP IS A PRIMARY KEY, WHICH IS WHY IT NOW HOLDS ───────────────────
 *
 * `LIMIT 1` caps a QUERY, not a DAY. Reload the page and the query runs again; with two candidates
 * open she would get a different item each time and "no more than 1 per day" would be true of no day
 * at all. So the day is the PRIMARY KEY of `human_touch_days`: SQLite cannot hold two rows for one
 * day, two concurrent renders converge on whichever inserted first, and every later render reads the
 * same one back. The cap is the shape of the table rather than the discipline of a caller.
 *
 * ─── AND SILENCE IS THE COMMON ANSWER ──────────────────────────────────────
 *
 * Most days all three sources are empty and this returns null. "When appropriate" is permission to
 * have nothing, and a slot that always says something is a dashboard she scrolls past.
 */

/**
 * The side hustles: THE GRID, and only the properties allowed to propose work to her.
 *
 * `suggestingKeys()` is the `primary` tier. It excludes `local-guides-generator` — her words: "we
 * really just include it in case something needs to be fixed but the content generator and all the
 * real work is in velocity" — and the authority network, which `projects.ts` excludes in terms: "A
 * cost centre, not a line — never a day's work." Both are still EXAMINED and their breaks are still
 * fixed; what they do not do is ask for her.
 */
export const SIDE_HUSTLE_KEYS = suggestingKeys();

/** One item, and the row it came out of so the day's choice can be pinned and re-read. */
type Touch = { ref_id: string; action: string; why: string; detail?: string[] };

/**
 * The day, in HER timezone, as `YYYY-MM-DD`.
 *
 * A UTC day would roll over at seven in the evening Chicago time and hand her a second touch before
 * dinner, which is the cap failing in the one direction nobody would notice.
 */
export function herDay(at: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(at));
}

/**
 * 1. DECLARED — somebody filed this and said, explicitly, that it cannot move without her.
 *
 * 0233's query, unchanged in substance. "Needs a human" is DECLARED, never inferred from prose:
 * `blocker` is free text — "waiting on the cover files", "Amazon has not replied" — and reading her
 * out of that would be matching by RESEMBLANCE.
 *
 * AND IT MUST SAY WHY. A row claiming "this needs you" that cannot say what only she can do is a
 * puzzle, not a task, and she has enough of those.
 */
async function declaredTouch(env: Env, pin: string | null = null): Promise<Touch | null> {
  // RULE 0 AT THE CALL SITE: an empty key list would make this `IN ()`, which matches nothing in
  // SQLite and would silently retire the feature rather than failing visibly.
  if (SIDE_HUSTLE_KEYS.length === 0) return null;
  const placeholders = SIDE_HUSTLE_KEYS.map(() => "?").join(",");

  const row = await env.DB
    .prepare(
      `SELECT d.id, d.name, d.project_key, d.needs_owner_why, d.blocker, d.blocked_since, e.name AS employee
         FROM owned_deliverables d
         LEFT JOIN employees e ON e.id = d.employee_id
        WHERE d.needs_owner = 1
          AND d.state IN ('open','blocked')
          AND d.project_key IN (${placeholders})
          AND (? IS NULL OR d.id = ?)
        ORDER BY COALESCE(d.blocked_since, d.last_activity_at, 0) ASC
        LIMIT 1`,
    )
    .bind(...SIDE_HUSTLE_KEYS, pin, pin)
    .first<{
      id: string; name: string; project_key: string; needs_owner_why: string | null;
      blocker: string | null; blocked_since: number | null; employee: string | null;
    }>()
    .catch(() => null);

  if (!row || !row.needs_owner_why || !row.needs_owner_why.trim()) return null;

  const project = PROJECTS.find((p) => p.key === row.project_key);
  const days = row.blocked_since ? Math.floor((Date.now() - row.blocked_since) / 86_400_000) : null;

  return {
    ref_id: row.id,
    action: `${project?.name ?? row.project_key}: ${row.needs_owner_why.trim()}`,
    why:
      `${row.name} cannot move without you${row.employee ? ` — ${row.employee} owns it and has taken it as far as she can` : ""}` +
      `${days !== null ? `, and it has been waiting ${days} day${days === 1 ? "" : "s"}` : ""}.` +
      ` Everything on this line that someone else could do has been done.`,
    ...(row.blocker ? { detail: [row.blocker] } : {}),
  };
}

/**
 * 2. EXAMINED — what the daily grid examination found and could not dispatch.
 *
 * `disposition = 'needs_her'` is written by `POST /api/boss/grid/examination`, which REFUSES the
 * value on any property that is not `primary` and refuses it outright without a sentence saying what
 * only she can do. So the two rules that keep this narrow are enforced at the door, in D1, rather
 * than here — and this repeats the `primary` filter anyway, because a guard on one side of a
 * boundary is a guard with a one-refactor life expectancy.
 *
 * OLDEST FIRST, by when it was FIRST seen. `observed_at` is deliberately not reset on a repeat
 * sighting: the age of the problem is the reason to report it, and a daily job that refreshed it
 * would make a three-week-old block permanently one day old.
 */
async function examinedTouch(env: Env, pin: string | null = null): Promise<Touch | null> {
  if (SIDE_HUSTLE_KEYS.length === 0) return null;
  const placeholders = SIDE_HUSTLE_KEYS.map(() => "?").join(",");

  const row = await env.DB
    .prepare(
      `SELECT o.id, o.property_key, o.repo, o.kind, o.needs_her_why, o.headline, o.evidence, o.observed_at
         FROM grid_observations o
        WHERE o.disposition = 'needs_her'
          AND o.state IN ('open','shown')
          AND o.property_key IN (${placeholders})
          AND (? IS NULL OR o.id = ?)
        ORDER BY o.observed_at ASC
        LIMIT 1`,
    )
    .bind(...SIDE_HUSTLE_KEYS, pin, pin)
    .first<{
      id: string; property_key: string; repo: string; kind: string;
      needs_her_why: string | null; headline: string; evidence: string; observed_at: number;
    }>()
    .catch(() => null);

  if (!row || !row.needs_her_why || !row.needs_her_why.trim()) return null;

  const property = propertyFor(row.property_key);
  const days = Math.floor((Date.now() - row.observed_at) / 86_400_000);

  return {
    ref_id: row.id,
    /*
     * A CLIENT PROPERTY SAYS SO, IN FRONT. "Answer the PR on hicksconsulting" and "answer the client
     * waiting on hicksconsulting" are different sentences and she prioritises them differently.
     */
    action: `${property?.owner === "client" ? "Client — " : ""}${property?.label ?? row.property_key}: ${row.needs_her_why.trim()}`,
    why:
      `Danielle's daily pass over your repos found this${days > 0 ? ` ${days} day${days === 1 ? "" : "s"} ago` : " this morning"} ` +
      `and could not hand it to anyone: it needs your name on it. Everything else she found in the grid ` +
      `today went to her, not to you.`,
    // THE THING SHE CAN OPEN. An observation she cannot check is an assertion.
    detail: [row.evidence],
  };
}

/**
 * 3. ASKED — an employee's judgement call that has been sitting.
 *
 * `judgement_calls` is the mechanism by which an employee who does not understand ASKS, and a row in
 * `awaiting` is a question addressed to her by name with the work paused behind it.
 *
 * IT IS ALREADY IN THE INBOX, AND THE AGE IS WHAT RESOLVES THAT. One fact belongs in one place, so a
 * fresh judgement call has no business also occupying the one slot in her contract — the Inbox is
 * where it goes and the Inbox is doing its job. After two days the Inbox has demonstrably NOT got it
 * in front of her, and an employee is still stopped. That is when it becomes her day's work rather
 * than an item on a list.
 */
const ASKED_AFTER_DAYS = 2;

async function askedTouch(env: Env, pin: string | null = null): Promise<Touch | null> {
  if (SIDE_HUSTLE_KEYS.length === 0) return null;
  const placeholders = SIDE_HUSTLE_KEYS.map(() => "?").join(",");

  const row = await env.DB
    .prepare(
      `SELECT j.id, j.title, j.question, j.created_at, d.project_key, e.name AS employee
         FROM judgement_calls j
         JOIN owned_deliverables d ON d.id = j.deliverable_id
         LEFT JOIN employees e ON e.id = j.employee_id
        WHERE j.state = 'awaiting'
          AND j.created_at <= ?
          AND d.state IN ('open','blocked')
          AND d.project_key IN (${placeholders})
          AND (? IS NULL OR j.id = ?)
        ORDER BY j.created_at ASC
        LIMIT 1`,
    )
    .bind(Date.now() - ASKED_AFTER_DAYS * 86_400_000, ...SIDE_HUSTLE_KEYS, pin, pin)
    .first<{
      id: string; title: string; question: string; created_at: number;
      project_key: string; employee: string | null;
    }>()
    .catch(() => null);

  if (!row || !row.question.trim()) return null;

  const project = PROJECTS.find((p) => p.key === row.project_key);
  const days = Math.floor((Date.now() - row.created_at) / 86_400_000);

  return {
    ref_id: row.id,
    action: `${project?.name ?? row.project_key}: ${row.question.trim()}`,
    why:
      `${row.employee ?? "An employee"} asked you this ${days} day${days === 1 ? "" : "s"} ago and the work ` +
      `has been stopped since. It is in your Inbox as well; it is here because the Inbox has not got ` +
      `it in front of you and somebody is waiting.`,
  };
}

/**
 * THE ONE THING THAT NEEDS HER TODAY, OR NOTHING.
 *
 * The three sources in order, and the day as a primary key so the answer cannot change on a refresh
 * and cannot become two.
 */
export async function humanTouch(
  env: Env,
): Promise<{ action: string; why: string; detail?: string[] } | null> {
  const SOURCES: Array<[string, (env: Env, pin: string | null) => Promise<Touch | null>]> = [
    ["declared", declaredTouch],
    ["examined", examinedTouch],
    ["asked", askedTouch],
  ];

  const day = herDay();

  /*
   * ALREADY CHOSEN TODAY? Then it is that one, re-read from its own table so the sentence stays
   * current — a pull request that was merged since this morning drops out rather than sitting on her
   * screen claiming somebody is waiting.
   */
  const already = await env.DB
    .prepare(`SELECT source, ref_id FROM human_touch_days WHERE day = ?`)
    .bind(day)
    .first<{ source: string; ref_id: string }>()
    .catch(() => null);

  if (already) {
    const fn = SOURCES.find(([name]) => name === already.source)?.[1];
    const pinned = fn ? await fn(env, already.ref_id) : null;
    if (!pinned) return null;
    return { action: pinned.action, why: pinned.why, ...(pinned.detail ? { detail: pinned.detail } : {}) };
  }

  for (const [source, fn] of SOURCES) {
    const candidate = await fn(env, null);
    if (!candidate) continue;

    /*
     * OR IGNORE, AND THEN READ BACK. Two renders racing at 06:00 both find a candidate; one insert
     * wins, the other is ignored, and BOTH then read the winner. Without the read-back the loser
     * would render its own candidate and the day would have had two.
     */
    await env.DB
      .prepare(`INSERT OR IGNORE INTO human_touch_days (day, source, ref_id, chosen_at) VALUES (?,?,?,?)`)
      .bind(day, source, candidate.ref_id, Date.now())
      .run()
      .catch(() => null);

    const chosen = await env.DB
      .prepare(`SELECT source, ref_id FROM human_touch_days WHERE day = ?`)
      .bind(day)
      .first<{ source: string; ref_id: string }>()
      .catch(() => null);

    if (!chosen) return { action: candidate.action, why: candidate.why, ...(candidate.detail ? { detail: candidate.detail } : {}) };

    const winner = chosen.source === source && chosen.ref_id === candidate.ref_id
      ? candidate
      : await (SOURCES.find(([name]) => name === chosen.source)?.[1] ?? (async () => null))(env, chosen.ref_id);

    if (!winner) return null;

    if (chosen.source === "examined") {
      await env.DB
        .prepare(`UPDATE grid_observations SET state = 'shown', shown_at = ? WHERE id = ? AND state = 'open'`)
        .bind(Date.now(), chosen.ref_id)
        .run()
        .catch(() => null);
    }

    return { action: winner.action, why: winner.why, ...(winner.detail ? { detail: winner.detail } : {}) };
  }

  // Nothing declared, nothing found and nobody waiting. The answer on most days.
  return null;
}

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

  /*
   * ─── WHAT USED TO BE FIRST HERE, AND WHY IT IS GONE ────────────────────────
   *
   * This slot held `siteAuditGap()`, which composed:
   *
   *     "Danielle's Ahrefs pass has not reported — run `ahrefs-audit-fix.sh` or find out why
   *      launchd did not."
   *
   * and returned it AHEAD of a stalling deal and the oldest open loop. The owner found it in her
   * contract and named the general rule, which is worth more than the instance:
   *
   *     "something not working should never be in today's contract it should be in the inbox."
   *
   * She is right, and the file already knew it. Fifteen lines below, the comment on the West Peek
   * fallthrough argues the same thing about a different leak, and `today/runOfShow.ts` deleted the
   * five machine stages for the identical reason: "'0 of 5 stages complete' told her how far the
   * MACHINERY had got, on a screen whose whole job is telling her how far SHE had got."
   *
   * TODAY'S CONTRACT IS WHAT SHE IS DOING TODAY. A job that did not run is not her work — it is a
   * notification about her own machinery, and putting it here did not merely misfile it: it
   * DISPLACED real work, because it returned first. A stalling deal is the symptom this pillar
   * exists to catch and it was being pushed down the page by a cron.
   *
   * NOTHING IS LOST BY DELETING IT, and that is the reason there is no replacement call here.
   * `routes/today.ts` already raises a HIGH alert for EVERY duty that has not fired within twice
   * its cadence — `"<name>" has not fired for N days` — on the same alert surface that carries the
   * other thirty machinery items (credentials, budget, cron, kill switch, stuck tasks). This duty
   * was never exempt from that. So the contract loses a line it should not have had, and the alert
   * surface keeps the one it already carried. One fact, one place, which is the rule this
   * repository states everywhere and broke here.
   *
   * Guarded by `scripts/validate/todays-contract-is-her-work.mjs` so the next one cannot be added.
   */

  // The oldest loop is read alongside the stalled deals rather than after the human touch: it is
  // the last rung of this cascade, and reading it in parallel costs less than reading it in turn.
  const loopP = env.DB
    .prepare(`SELECT id, title, created_at, priority FROM open_loops WHERE status = 'open' ORDER BY priority ASC, created_at ASC LIMIT 1`)
    .first<{ id: string; title: string; created_at: number; priority: number }>();
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
   * ─── ONE SIDE-HUSTLE ITEM THAT NEEDS HER, ABOVE THE OLDEST OPEN LOOP ──────
   *
   * "should suggest something that requires a human touch from one of the side hustles when
   *  appropriate n o more than 1 per day as appropriate"
   *
   * WHY IT OUTRANKS THE OLDEST LOOP, which is the only interesting choice here. An open loop is HER
   * OWN work waiting on her; a `needs_owner` item is SOMEBODY ELSE'S work waiting on her. Holding
   * the second one up spends two people's time instead of one, and the employee has already taken
   * it as far as she can. §5.7's "finishing beats starting a fourth thing" is about her own pile and
   * is not in tension with unblocking someone.
   *
   * AND IT LOSES TO A STALLING DEAL, because a deal that has stopped moving is money leaving, and
   * because §5.5 keeps side projects out of the weekday foreground. This is the narrow exception
   * §5.5 tolerates: not working the side project, but signing the one thing only she can sign.
   *
   * THE CAP IS STRUCTURAL. `humanTouch` returns one item or none, and the contract has one action,
   * so "no more than 1 per day" cannot be violated by a caller forgetting. Most days it is null —
   * a declaration is required, the reason is required, and absent either the answer is silence.
   */
  const touch = await humanTouch(env);
  if (touch) return { available: true, means: MEANS, ...touch };

  /*
   * OLDEST FIRST, BY `created_at` — the column this table actually has. An earlier draft ordered by
   * `opened_at`, which does not exist, behind a `.catch()` that would have reported "nothing is
   * owed" on a day with a month-old loop rotting in it. Priority breaks the tie, so a high-priority
   * loop is not outranked by an older trivial one.
   */
  const loop = await loopP;

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
