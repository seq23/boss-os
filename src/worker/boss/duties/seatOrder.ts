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

/**
 * AN LP OR DEAL-TERMS DRAFT RUNS ON THE CLAUDE SEAT ONLY (owner, Today v4, 31 Oct 2026): never Codex /
 * ChatGPT, never a free or training route, never a cloud rung. A task marks itself with
 * `input.confidential_draft = true` (or `input.draft_kind` "lp_reply" / "deal_terms"); its ladder is cut
 * to Claude's seat, the "OpenAI first" switch cannot reorder it, and the cloud fallback is off. A ladder
 * without Claude's seat becomes EMPTY: the task fails closed, it is never moved to another seat.
 */
export const CONFIDENTIAL_DRAFT_KINDS = ["lp_reply", "lp_scheduling", "deal_terms"] as const;
export function isConfidentialDraft(input: { confidential_draft?: unknown; draft_kind?: unknown } | null | undefined): boolean {
  return input?.confidential_draft === true || (CONFIDENTIAL_DRAFT_KINDS as readonly string[]).includes(String(input?.draft_kind ?? ""));
}
export function confidentialLadder(ladder: string[]): string[] {
  return ladder.filter((x) => x === CLAUDE_SEAT);
}
