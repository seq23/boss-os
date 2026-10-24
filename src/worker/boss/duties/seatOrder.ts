/**
 * WHICH SUBSCRIPTION SEAT GOES FIRST (owner, 24 Oct 2026: "Use OpenAI first for everything (saves
 * Claude usage)"). ONE PLACE: the queue consumer resolves every task's seat ladder through
 * `orderSeats`, and the Mac's /claim walks the ladder the consumer stamped, so nothing else orders
 * seats. Off: each duty's own order. On: OpenAI's seat (`bk_codex`) is tried before Claude's
 * (`bk_claude_code`) on every ladder that has Claude's seat in it. A seat that cannot do the work
 * refuses and the walk moves on, as it always has. The briefing is OpenAI first either way
 * (`briefingLadder.ts`). Paid cloud rungs are unaffected: they stay unreachable for the briefing.
 */
export const OPENAI_FIRST_KEY = "seat_order_openai_first";
export const OPENAI_SEAT = "bk_codex";
export const CLAUDE_SEAT = "bk_claude_code";

export function orderSeats(ladder: string[], openaiFirst: boolean): string[] {
  if (!openaiFirst || !ladder.includes(CLAUDE_SEAT)) return ladder;
  const rest = ladder.filter((x) => x !== OPENAI_SEAT);
  const at = rest.indexOf(CLAUDE_SEAT);
  return [...rest.slice(0, at), OPENAI_SEAT, ...rest.slice(at)];
}

export const isOn = (v: string | null | undefined) => v === "on" || v === "true";
