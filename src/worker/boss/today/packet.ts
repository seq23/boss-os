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
  /** open | raised. `raised` means she said it; it stays until the thing is actually true. */
  status?: string;
  /** When she last carried it into the meeting, so the packet can say how long he has had it. */
  raised_at?: number | null;
}

/**
 * One line of what she actually did, and where that line came from.
 *
 * HER PREP, NOT HIS PACKET. "there is no packet to prepare me for the meeting with scooter (even if
 * its empty this time) it needs to show what ive accomplished in the week prior". The rest of this
 * document is written for a partner to read; this section is written for her to read before she
 * walks in, and it is labelled that way on the screen and in the file. Keeping the two apart is the
 * same separation rule that keeps brokerage numbers out of a West Peek document — her week spans
 * both businesses and his packet may only report one of them.
 *
 * `source` IS NOT DECORATION. She asks for the method behind a claim, so every line names the table
 * it was counted from. A number with no provenance is one she cannot check and should not repeat.
 */
export interface Accomplishment {
  business: "West Peek" | "Brokerage" | "Publishing" | "Everything";
  line: string;
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
  /** What she did in the window. Hers, not his — see `Accomplishment`. */
  accomplished: Accomplishment[];
  /** Named plainly when a source could not be counted, rather than the line being dropped. */
  accomplished_gaps: string[];
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

  /*
   * ── CLOSED BEFORE THE ITEMS ARE READ, NOT AFTER ───────────────────────────
   *
   * THE BUG THIS FIXES, CAUGHT BY CHECKING RATHER THAN BY ASSUMING. `closeIfGranted` ran after the
   * SELECT, so the read that first saw the grant go live still returned the item — it cleared on the
   * NEXT read. Verified live at 10:47 on 9 September: `cred_westpeek_delegation` was `live` and
   * `mai_wp_gmail_grant` was still in `to_raise`.
   *
   * "Clears itself, but only the second time you look" is worse than not clearing at all, because
   * the first look is the one where she decides whether to raise it with him. The whole design claim
   * of that item was that it tests itself and disappears the morning it becomes true, and it was
   * half true in the way that is hardest to notice.
   */
  await closeIfGranted(env);

  const [items, misc] = await Promise.all([
    /*
     * `raised` STAYS ON THE PACKET, AND THAT IS THE FIX FOR THE ITEM NOBODY NOTICED.
     *
     * `mai_wp_gmail_grant` has appeared here every week since 19 August, worded identically, and
     * three weeks passed with nothing happening. Two different failures were hiding in that: nothing
     * recorded whether she had ever actually said it out loud, and if the query had dropped items
     * once raised, saying it once would have removed it while the grant still did not exist.
     *
     * HANDING SOMEONE THE STEPS IS NOT THE OUTCOME. So an item leaves this list when its condition
     * is TRUE — the prober authenticating, in the grant's case — and never when someone reports
     * having mentioned it. `raised_at` is carried so the packet can say how long he has had it
     * instead of presenting it as new.
     */
    env.DB.prepare(
      `SELECT id, title, detail, priority, source, status, raised_at
         FROM meeting_agenda_items
        WHERE counterpart = ? AND status IN ('open','raised') AND section = 'raise'
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
        WHERE counterpart = ? AND status IN ('open','raised') AND section = 'misc'
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

  const { accomplished, accomplished_gaps } = await herWeek(env, fromTs);

  return {
    counterpart,
    window: { from, to: shiftDay(dayId, -1) },
    headline,
    to_raise: items.results ?? [],
    misc: misc.results ?? [],
    accomplished,
    accomplished_gaps,
    gaps,
  };
}

/**
 * The grant item, retired the morning it stops being true.
 *
 * `dropped` rather than deleted: the history of an item that took three weeks is worth more than the
 * row it occupies, and the packet only lists `open` and `raised`.
 */
async function closeIfGranted(env: Env): Promise<void> {
  const probe = await env.DB
    .prepare(`SELECT state FROM credential_probes WHERE id = 'cred_westpeek_delegation'`)
    .first<{ state: string }>()
    .catch(() => null);
  // `unknown` is not `live`. A probe that could not decide has decided nothing.
  if (probe?.state !== "live") return;
  await env.DB
    .prepare(
      `UPDATE meeting_agenda_items SET status = 'dropped', updated_at = ?
        WHERE id = 'mai_wp_gmail_grant' AND status IN ('open','raised')`,
    )
    .bind(Date.now())
    .run();
}

/**
 * WHAT SHE ACTUALLY DID, COUNTED FROM HER OWN RECORDS.
 *
 * "it needs to show what ive accomplished in the week prior... even if its empty this time."
 *
 * THAT LAST CLAUSE IS AN INSTRUCTION, NOT A DISCLAIMER. She has said in advance that a truthful
 * empty answer is acceptable, which removes the only reason anything here would ever be padded. A
 * week with two things in it lists two things. The temptation in a "what I did" section is to list
 * intentions, because those are easy to query and always look complete; every count below is of
 * something that FINISHED — a loop closed, a title Live, a candidate reviewed, a deliverable met.
 *
 * A SOURCE THAT CANNOT BE READ IS NAMED RATHER THAN OMITTED. An empty section and an unreadable
 * one look identical, and only one of them means she had a quiet week.
 */
export async function herWeek(
  env: Env,
  fromTs: number,
): Promise<{ accomplished: Accomplishment[]; accomplished_gaps: string[] }> {
  const accomplished: Accomplishment[] = [];
  const accomplished_gaps: string[] = [];

  const count = async (label: string, sql: string, bind: unknown[] = [fromTs]): Promise<number | null> => {
    try {
      const row = await env.DB.prepare(sql).bind(...bind).first<{ n: number }>();
      return row?.n ?? 0;
    } catch {
      accomplished_gaps.push(`${label} could not be counted — the query failed, so this week's figure is missing rather than zero.`);
      return null;
    }
  };

  const loops = await count("Closed loops", `SELECT COUNT(*) AS n FROM open_loops WHERE status IN ('resolved','dismissed') AND resolved_at >= ?`);
  if (loops !== null) {
    accomplished.push({
      business: "Everything",
      line: loops === 0 ? "No open loops were closed." : `${loops} open loop${loops === 1 ? "" : "s"} closed.`,
      source: "open_loops.resolved_at",
    });
  }

  const live = await count("Titles published", `SELECT COUNT(*) AS n FROM kdp_titles WHERE went_live_at >= ?`);
  if (live !== null) {
    accomplished.push({
      business: "Publishing",
      line: live === 0 ? "No Kindle title reached Live." : `${live} Kindle title${live === 1 ? "" : "s"} reached Live on Amazon.`,
      source: "kdp_titles.went_live_at",
    });
  }

  const candidates = await count("Buyer candidates", `SELECT COUNT(*) AS n FROM sourcing_candidates WHERE status != 'new' AND updated_at >= ?`);
  if (candidates !== null) {
    accomplished.push({
      business: "Brokerage",
      line: candidates === 0 ? "No buyer candidates were reviewed." : `${candidates} buyer candidate${candidates === 1 ? "" : "s"} reviewed.`,
      source: "sourcing_candidates.updated_at, anything past new",
    });
  }

  const reports = await count("Briefings", `SELECT COUNT(*) AS n FROM executive_reports WHERE generated_at >= ?`);
  if (reports !== null) {
    accomplished.push({
      business: "Everything",
      line: reports === 0 ? "No executive briefing was delivered." : `${reports} executive briefing${reports === 1 ? "" : "s"} delivered.`,
      source: "executive_reports.generated_at",
    });
  }

  const finished = await count("Owned work", `SELECT COUNT(*) AS n FROM owned_deliverables WHERE done_at >= ?`);
  if (finished !== null && finished > 0) {
    accomplished.push({
      business: "Everything",
      line: `${finished} owned deliverable${finished === 1 ? "" : "s"} finished.`,
      source: "owned_deliverables.done_at",
    });
  }

  /*
   * THE ONE SHE ASKED ABOUT AND THIS SIDE CANNOT ANSWER. LP outreach is the West Peek number, it
   * lives in the two spreadsheets, and Boss OS deliberately holds no LP row. Said here rather than
   * silently absent, because "no LP outreach this week" and "this system cannot see LP outreach"
   * are opposite facts and the second one is true.
   */
  accomplished_gaps.push(
    "LP outreach is not counted here. It lives in the outreach sheets, which only the local reminder can read, and Boss OS holds no LP data by design.",
  );

  return { accomplished, accomplished_gaps };
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
