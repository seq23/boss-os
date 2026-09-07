import type { Env } from "../env";
import { isWestPeekDay } from "../spirit/arcs";

/**
 * THE WEDNESDAY PACKET — what she did this week, and what she needs to say to him.
 *
 * Her words: "maybe i should have a packet prepared before each meeting on wed with scooter showing
 * what ive done for the week and anything i need to discuss with him."
 *
 * ─── Computed here, not researched by an agent ─────────────────────────────
 *
 * Every number in it is already in her own record: anchors kept, deals moved, candidates reviewed,
 * touches made. An agent run would cost money and minutes to fetch what a query returns instantly,
 * and it could be wrong — a model summarising a database is a second source of truth for facts the
 * database already holds exactly. So this is deterministic, free, and available on any day rather
 * than only on the morning a duty happened to fire.
 *
 * ─── It reports what happened, not what was planned ────────────────────────
 *
 * The temptation in a "what I did this week" packet is to list the week's intentions, because those
 * are easier to query and always look complete. This counts CLOSED loops, MOVED stages, ANSWERED
 * anchors and REVIEWED candidates. A week where nothing moved produces a packet that says so, which
 * is the only version worth walking into a meeting with.
 *
 * ─── The agenda list is the half she asked for ─────────────────────────────
 *
 * "Anything I need to discuss with him" was the actual ask, and it is the half that cannot be
 * derived: it is things said in passing that would otherwise have to survive in her head until
 * Wednesday. The system can add to it the moment something is discovered — an access grant only he
 * can give, a duty stalled on his sign-off — rather than waiting for her to remember.
 */

export interface PacketItem {
  id: string;
  title: string;
  detail: string | null;
  priority: number;
  source: string;
}

export interface WeeklyPacket {
  counterpart: string;
  /** The seven days ending the day before the packet, as ISO day ids. */
  window: { from: string; to: string };
  done: {
    anchors_kept: number;
    anchors_missed: number;
    anchors_unanswered: number;
    loops_closed: number;
    deals_advanced: number;
    candidates_reviewed: number;
    touches_logged: number;
  };
  /** Named plainly when the week was thin, rather than left for her to work out from zeros. */
  headline: string;
  to_raise: PacketItem[];
  /** What this packet could not see. Never silent about it. */
  gaps: string[];
}

const DAY_MS = 86_400_000;

function shiftDay(dayId: string, days: number): string {
  const t = Date.parse(`${dayId}T12:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export async function weeklyPacket(env: Env, dayId: string, counterpart = "scooter"): Promise<WeeklyPacket> {
  const from = shiftDay(dayId, -7);
  const fromTs = Date.parse(`${from}T00:00:00Z`);

  const [anchors, loops, deals, candidates, touches, items] = await Promise.all([
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN anchor_outcome = 'done' THEN 1 ELSE 0 END) AS kept,
         SUM(CASE WHEN anchor_outcome = 'missed' THEN 1 ELSE 0 END) AS missed,
         SUM(CASE WHEN anchor_outcome IS NULL OR anchor_outcome = 'unknown' THEN 1 ELSE 0 END) AS unanswered
       FROM days WHERE id >= ? AND id < ? AND morning_completed_at IS NOT NULL`,
    ).bind(from, dayId).first<{ kept: number | null; missed: number | null; unanswered: number | null }>(),

    env.DB.prepare(`SELECT COUNT(*) AS n FROM open_loops WHERE status = 'resolved' AND resolved_at >= ?`)
      .bind(fromTs).first<{ n: number }>(),

    /*
     * A DEAL THAT ADVANCED, not one that was edited. `stage_since` moves only when the stage does,
     * which is the same distinction the stall detector rests on — and the reason a week of diligent
     * note-taking does not read as a week of progress.
     */
    env.DB.prepare(`SELECT COUNT(*) AS n FROM deals WHERE stage_since >= ?`).bind(fromTs).first<{ n: number }>(),

    env.DB.prepare(`SELECT COUNT(*) AS n FROM sourcing_candidates WHERE status != 'new' AND updated_at >= ?`)
      .bind(fromTs).first<{ n: number }>(),

    env.DB.prepare(`SELECT COUNT(*) AS n FROM relationships WHERE last_contact_at >= ?`)
      .bind(fromTs).first<{ n: number }>(),

    env.DB.prepare(
      `SELECT id, title, detail, priority, source
         FROM meeting_agenda_items
        WHERE counterpart = ? AND status = 'open'
        ORDER BY priority ASC, created_at ASC`,
    ).bind(counterpart).all<PacketItem>(),
  ]);

  const done = {
    anchors_kept: anchors?.kept ?? 0,
    anchors_missed: anchors?.missed ?? 0,
    anchors_unanswered: anchors?.unanswered ?? 0,
    loops_closed: loops?.n ?? 0,
    deals_advanced: deals?.n ?? 0,
    candidates_reviewed: candidates?.n ?? 0,
    touches_logged: touches?.n ?? 0,
  };

  const moved = done.loops_closed + done.deals_advanced + done.candidates_reviewed + done.touches_logged;

  /*
   * THE HEADLINE SAYS THE HONEST THING FIRST.
   *
   * A packet of zeros with no sentence on top invites her to read it as a broken report rather than
   * as a quiet week — and a quiet week is information she is walking into a meeting to explain. It
   * is stated as a fact, without a verdict attached: §14 scores days, and a partner meeting is not
   * the place a system gets to grade her.
   */
  const headline =
    moved === 0
      ? done.anchors_unanswered >= 5
        ? "Nothing recorded this week, and most nights went unclosed — so this is a gap in the record as much as in the work."
        : "Nothing moved that the system can see this week."
      : `${moved} thing${moved === 1 ? "" : "s"} moved: ` +
        [
          done.deals_advanced ? `${done.deals_advanced} deal${done.deals_advanced === 1 ? "" : "s"} advanced` : null,
          done.touches_logged ? `${done.touches_logged} counterpart${done.touches_logged === 1 ? "" : "s"} touched` : null,
          done.candidates_reviewed ? `${done.candidates_reviewed} candidate${done.candidates_reviewed === 1 ? "" : "s"} reviewed` : null,
          done.loops_closed ? `${done.loops_closed} loop${done.loops_closed === 1 ? "" : "s"} closed` : null,
        ].filter(Boolean).join(", ") + ".";

  /*
   * WHAT THE PACKET CANNOT SEE IS PART OF THE PACKET.
   *
   * The LP numbers he actually cares about live in two spreadsheets this system cannot read. A
   * packet that quietly omitted them would let her walk in believing it was complete.
   */
  const gaps = [
    "LP outreach volume and replies are not in here: they live in Scooter's tracker and the outreach log, which Boss OS cannot read yet.",
  ];
  if (done.anchors_unanswered > 0) {
    gaps.push(`${done.anchors_unanswered} night${done.anchors_unanswered === 1 ? "" : "s"} closed without saying whether the first money move happened, so those days are unknown rather than missed.`);
  }

  return {
    counterpart,
    window: { from, to: shiftDay(dayId, -1) },
    done,
    headline,
    to_raise: items.results ?? [],
    gaps,
  };
}

/**
 * Should the packet be on today's screen?
 *
 * TUESDAY AS WELL AS WEDNESDAY, and that is the whole point of preparing a packet rather than
 * printing one. Seeing "ask him for the Google grant" at 6am on Wednesday is seeing it as the
 * meeting starts. Seeing it on Tuesday is time to do something first.
 */
export function packetIsDue(weekday: number): boolean {
  return isWestPeekDay(weekday) || weekday === 2;
}
