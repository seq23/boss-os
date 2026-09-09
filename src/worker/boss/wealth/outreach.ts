/**
 * THE LETTER A REVIEWED BUYER PRODUCES.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "the capital tab has all these prospective buyers and i reviewed them ....now what? it doesn't
 *    suggest an email already crafted to send to them?"
 *
 * `reviewed` has been a status since 0185 and has never done anything. She read eleven firms, said
 * "reviewed" eleven times, and the world was exactly as it had been — which is the defect this
 * repository produces most often, landing on the one screen whose entire purpose is to start a
 * conversation.
 *
 * ─── Composed from the row, not from a model ───────────────────────────────
 *
 * There is no `run_ai` call here and that is a decision rather than a shortcut.
 *
 * Everything a first approach to a secondaries buyer needs is already on the candidate: who they
 * are, why they plausibly buy what she sells, the minimum they write, the source that says so and
 * when it was read, and — new in 0221 — whether she has actually dealt with them before. A model
 * would restate those facts in different words each time, cost money on every review, fail on a
 * budget ceiling at the exact moment she pressed a button, and could invent a fact about a firm
 * that she would then send to that firm. A deterministic composition cannot, and it is testable:
 * `tests/boss/buyerOutreach.test.ts` asserts the letters against real rows rather than against
 * prose.
 *
 * IT IS NOT A TEMPLATE WITH BLANKS. Every sentence that appears is a sentence whose facts exist;
 * a fact that is missing removes its sentence rather than leaving a gap, and `built_from` records
 * exactly which facts were present so an approval can be audited against what was true when it was
 * drafted.
 *
 * ─── Three letters, because three situations ───────────────────────────────
 *
 * The one thing that must never happen is a stranger's letter sent to someone she has already
 * transacted with. That is not a worse email — it is a message that says she does not remember her
 * own customers, and there is no recovering from it. So history decides the opening, and where the
 * history exists the letter says so in HER voice, from dates and counts, never from anything
 * anybody wrote.
 *
 * ─── And one refusal ───────────────────────────────────────────────────────
 *
 * A firm on the LP do-not-contact list gets NO letter. Brokerage outreach to a suppressed LP is the
 * one crossing of the West Peek boundary that costs something real, and the right answer is to say
 * so on her screen rather than to draft a letter and hope she notices the warning under it.
 */

const USD = 1_000_000;

export interface CandidateRow {
  id: string;
  name: string;
  kind: string;
  ticket_floor_usd: number | null;
  thesis: string | null;
  source_url: string | null;
  source_name: string | null;
  read_at: number | null;
  origin: string;
  history_kind: string | null;
  history_note: string | null;
  history_exchanges: number | null;
  history_last_at: number | null;
}

export interface CrossmatchFact {
  lp_firm: string;
  lp_list: string;
  confidence: string;
}

export interface Draft {
  subject: string;
  body: string;
  to_hint: string;
  built_from: Record<string, unknown>;
}

export interface Refusal {
  refused: string;
  because: string;
}

const money = (usd: number) =>
  usd >= 1_000_000 ? `$${Math.round(usd / 1_000_000)}M` : `$${Math.round(usd / 1000)}k`;

const onDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

const months = (from: number, to: number) => Math.max(1, Math.round((to - from) / (30 * 86_400_000)));

/**
 * Compose one letter, or refuse with a reason.
 *
 * Returns a `Refusal` rather than throwing: a refusal is an answer she needs to see on the screen,
 * and an exception here would surface as "something failed" — which is the least useful sentence
 * this system can print about a decision it made deliberately.
 */
export function composeOutreach(
  candidate: CandidateRow,
  crossmatches: CrossmatchFact[],
  note: string | null,
  now: number,
): Draft | Refusal {
  const suppressed = crossmatches.find((m) => m.lp_list !== "sequence" && m.confidence === "confirmed");
  if (suppressed) {
    return {
      refused: `No letter was drafted to ${candidate.name}.`,
      because:
        `${suppressed.lp_firm} is on West Peek's do-not-contact list, and this is the same firm. ` +
        "Brokerage outreach to a suppressed LP is the one crossing between the two businesses that costs something real, " +
        "so nothing was written. Reject the candidate, or take the firm off that list first.",
    };
  }

  const lines: string[] = [];
  const built: Record<string, unknown> = {
    candidate_id: candidate.id,
    name: candidate.name,
    drafted_at: now,
    used: [] as string[],
  };
  const used = built.used as string[];

  // ─── The opening, decided by history ───────────────────────────────────────
  //
  // A letter to someone she has transacted with that opens like a cold approach is the single worst
  // outcome available here, so this branch is first and everything else is written under it.
  if (candidate.history_kind === "dealt") {
    used.push("history_dealt");
    lines.push(
      `We have worked together before${candidate.history_last_at ? `, most recently around ${onDay(candidate.history_last_at)}` : ""}` +
        `${candidate.history_exchanges ? ` — ${candidate.history_exchanges} exchanges between us on the record` : ""}. ` +
        "I am writing because I have new late-stage secondary supply and you were one of the first people I thought of.",
    );
  } else if (candidate.history_kind === "discussed") {
    used.push("history_discussed");
    lines.push(
      `We have talked about buying before${candidate.history_last_at ? ` — the last of it around ${onDay(candidate.history_last_at)}` : ""}` +
        `${candidate.history_last_at ? `, about ${months(candidate.history_last_at, now)} months ago` : ""}, ` +
        "and it never got to a trade. I have new late-stage secondary supply and I would rather bring it to you than to somebody who has not already told me what they want.",
    );
  } else {
    lines.push(
      "I broker private, late-stage technology secondaries — I match holders of shares in private companies with institutions that buy them.",
    );
  }

  // ─── Why them specifically, with the source that says so ───────────────────
  //
  // The one sentence that separates a real approach from a blast. If the sweep could not produce a
  // thesis, this sentence does not appear — a letter that cannot say why it is addressed to this
  // firm should not pretend it can.
  if (candidate.thesis) {
    used.push("thesis");
    lines.push(
      `I am approaching ${candidate.name} because ${candidate.thesis.replace(/\.$/, "")}` +
        (candidate.source_name ? `, which I read on ${candidate.source_name}${candidate.read_at ? ` on ${onDay(candidate.read_at)}` : ""}.` : "."),
    );
  }

  if (candidate.ticket_floor_usd) {
    used.push("ticket_floor");
    lines.push(
      `The positions I work are ${money(candidate.ticket_floor_usd)} and up, which is where I understand you start.`,
    );
  }

  // ─── The ask, and it is one ask ────────────────────────────────────────────
  lines.push(
    "If it is useful, I will send you what is currently available and the terms, and you can tell me whether any of it is a fit. " +
      "If it is not, tell me what you are actually looking for and I will only come back when I have it.",
  );

  // ─── An LP overlap she should know she is carrying into the room ───────────
  //
  // Stated in the letter's notes rather than in the letter itself: the recipient knowing that West
  // Peek is raising from them is not information this message should carry, and she is the one who
  // decides whether the two conversations meet.
  const alsoLp = crossmatches.find((m) => m.lp_list === "sequence" && m.confidence === "confirmed");
  if (alsoLp) used.push("lp_overlap");

  // ─── A redraft answers her note explicitly ─────────────────────────────────
  //
  // "Try again" with a reason that the second attempt does not visibly respond to is a second
  // attempt she has no way to evaluate. The note is carried into `built_from` and named at the top
  // of the letter's own notes so she can see what changed and why.
  if (note) used.push("her_note");

  const historyLabel =
    candidate.history_kind === "dealt" ? "someone you have dealt with"
      : candidate.history_kind === "discussed" ? "someone who has discussed buying with you"
      : "a firm from public research — no mail history with them";

  built.history_kind = candidate.history_kind ?? null;
  built.lp_overlap = alsoLp ? alsoLp.lp_firm : null;
  built.her_note = note;

  return {
    subject:
      candidate.history_kind === "dealt"
        ? "New late-stage secondary supply"
        : candidate.history_kind === "discussed"
          ? "Following up — late-stage secondaries"
          : `Late-stage secondaries — ${candidate.name}`,
    body: lines.join("\n\n"),
    /*
     * NO ADDRESS, AND THE REASON IS NOT SQUEAMISHNESS. `sourcing_candidates` genuinely does not hold
     * one — it holds public institutions found on the open web — so any address this printed would
     * be invented. Naming the source page she read is the honest answer and it is also the useful
     * one: that page is where the contact route actually is.
     */
    to_hint: candidate.source_url
      ? `The contact route on ${candidate.source_name ?? "their site"}: ${candidate.source_url}`
      : `No source page was recorded for ${candidate.name}, so find the contact route before sending this.`,
    built_from: { ...built, history_label: historyLabel },
  };
}

export const isRefusal = (d: Draft | Refusal): d is Refusal => "refused" in d;
