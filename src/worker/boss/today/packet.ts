import type { Env } from "../env";
import { isWestPeekDay } from "../spirit/arcs";

/**
 * THE WEDNESDAY PACKET — what she did this week, and what she needs to say to him.
 *
 * Her words: "a packet prepared before each meeting on wed with scooter showing what ive done for
 * the week and anything i need to discuss with him."
 *
 * ─── It is partner-facing, which was worth asking about ─────────────────────
 *
 * Asked what it is FOR, her answer was "showing Scooter I did the work" — accountability between
 * partners, evidence of a week rather than an assertion about it. Not private prep, which is what
 * the first version assumed and built.
 *
 * That decides content. HER ANCHOR RECORD IS NOT IN HERE: whether she held her own morning floor is
 * her business and belongs nowhere near a document a business partner reads. The Night Gate keeps
 * it; this does not, and if it ever reappears here it is a mistake rather than an improvement.
 *
 * And it decides order. She wanted "what changed since last Wednesday" first, not the blocking asks
 * — a partner meeting opens on movement.
 *
 * ─── Computed here, not researched by an agent ─────────────────────────────
 *
 * Every number in it is already in her own record: anchors kept, deals moved, candidates reviewed,
 * touches made. An agent run would cost money and minutes to fetch what a query returns instantly,
 * and it could be wrong — a model summarising a database is a second source of truth for facts the
 * database already holds exactly. So this is deterministic, free, and available on any day rather
 * than only on the morning a duty happened to fire.
 *
 * ─── IT REPORTS WEST PEEK WORK, AND BOSS OS CANNOT SEE ANY OF IT ────────────
 *
 * The first version counted deals advanced, counterparties touched and buyer candidates reviewed.
 * Every one of those is BROKERAGE activity — the relationships were derived from her brokerage
 * mailbox, and the candidates are secondaries buyers. Her correction: "in west peek we have LP
 * outreach, in brokerage they are not LPs." A West Peek partner document was reporting her other
 * business's numbers as if they were his.
 *
 * That is worse than a wrong number. Her two businesses are deliberately separate, and a packet
 * that blends them puts brokerage counterparty activity in front of a fund partner.
 *
 * So this side now contributes what it legitimately holds — the agenda, and what it cannot see —
 * and the WEST PEEK numbers are added by `scripts/ops/packet-remind.mjs`, which can read the
 * outreach sheets. The Worker holds no LP row and should not: her naming rule keeps counterparty
 * names out of the OS, and the sheets already hold them.
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
  /** Named plainly when the week was thin, rather than left for her to work out from zeros. */
  headline: string;
  to_raise: PacketItem[];
  /** One-offs she added by hand. Nothing derives these and nothing ever will. */
  misc: PacketItem[];
  /** What this packet could not see. Never silent about it. */
  gaps: string[];
}

const DAY_MS = 86_400_000;

function shiftDay(dayId: string, days: number): string {
  const t = Date.parse(`${dayId}T12:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The last meeting, not seven days ago.
 *
 * "Since last Wednesday" has to mean since last Wednesday, or the packet quietly reports a window
 * that overlaps or skips the previous one — and a partner reading two consecutive packets would see
 * the same work twice, or a gap with nothing in it.
 */
function lastMeeting(dayId: string): string {
  const weekday = new Date(`${dayId}T12:00:00Z`).getUTCDay();
  // On Wednesday itself the window is the full previous week, not zero days.
  const back = weekday === 3 ? 7 : (weekday + 4) % 7 || 7;
  return shiftDay(dayId, -back);
}

export async function weeklyPacket(env: Env, dayId: string, counterpart = "scooter"): Promise<WeeklyPacket> {
  const from = lastMeeting(dayId);
  const fromTs = Date.parse(`${from}T00:00:00Z`);

  const [items, misc] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, detail, priority, source
         FROM meeting_agenda_items
        WHERE counterpart = ? AND status = 'open' AND section = 'raise'
        ORDER BY priority ASC, created_at ASC`,
    ).bind(counterpart).all<PacketItem>(),

    /*
     * THE FLEX SECTION. Everything else here is derived, and derived means it can only contain what
     * the system already knows. A number he asked for, a document to bring, something said on a
     * call — none of that has a table and never will.
     */
    env.DB.prepare(
      `SELECT id, title, detail, priority, source
         FROM meeting_agenda_items
        WHERE counterpart = ? AND status = 'open' AND section = 'misc'
        ORDER BY created_at ASC`,
    ).bind(counterpart).all<PacketItem>(),
  ]);

  /*
   * NO COUNTERS HERE AT ALL, and their absence is the point rather than an omission. Everything
   * this side can count is brokerage: `relationships` came from her brokerage mailbox,
   * `sourcing_candidates` are secondaries buyers, `deals` is the brokerage pipeline. None of it is
   * West Peek and none of it belongs in his packet.
   *
   * THE HEADLINE IS DELIBERATELY NOT A SUMMARY OF THE WEEK, because this side cannot summarise a
   * week it cannot see. Her description of the meeting: "every wednesday i put together a packet
   * for scooter to talk about what ive been working on and what i did for west peek specifically.
   * so we can talk about how many LPs i reached out to via my twin agent." Those numbers live in
   * the outreach sheets, and `scripts/ops/packet-remind.mjs` writes the real headline from them.
   * Claiming one here would be a sentence about nothing.
   */
  const headline =
    (items.results?.length ?? 0) + (misc.results?.length ?? 0) > 0
      ? "LP outreach numbers are added by the reminder. Below is what needs saying."
      : "LP outreach numbers are added by the reminder. Nothing else is outstanding.";

  /*
   * WHAT THE PACKET CANNOT SEE IS PART OF THE PACKET.
   *
   * The LP numbers he actually cares about live in two spreadsheets this system cannot read. A
   * packet that quietly omitted them would let her walk in believing it was complete.
   */
  /*
   * WHAT THE PACKET CANNOT SEE IS PART OF THE PACKET, and here that is almost all of it. This side
   * holds the agenda and nothing else about West Peek — the numbers are added downstream by the
   * reminder, which can read the sheets. Said plainly so a packet assembled without them is
   * obviously incomplete rather than quietly thin.
   */
  const gaps = [
    "West Peek numbers are added by the local reminder, which reads the outreach sheets. Boss OS holds no LP data and is not meant to.",
    "Brokerage activity is deliberately absent: it is a different business and not his to review.",
  ];

  return {
    counterpart,
    window: { from, to: shiftDay(dayId, -1) },
    headline,
    to_raise: items.results ?? [],
    misc: misc.results ?? [],
    gaps,
  };
}

/**
 * Should the packet be on today's screen?
 *
 * TUESDAY AND WEDNESDAY, WHILE THE REMINDER FIRES ONLY ON WEDNESDAY, and that difference is
 * deliberate rather than a leftover. A block costs nothing to render and being able to look at
 * tomorrow's packet on a Tuesday is useful; a notification on a day she did not ask for one is the
 * thing that gets it muted. The screen may be early. The interruption may not.
 */
export function packetIsDue(weekday: number): boolean {
  return isWestPeekDay(weekday) || weekday === 2;
}
