export function offeredIn(text: unknown): { side: "sell" | null; why: string | null };
export function decideSide(row: { side?: string | null; side_note?: string | null; quote?: string | null } | null | undefined): { side: "buy" | "sell" | null; side_note: string | null };
export function isRelayedNote(msg: { outbound?: boolean; excerpt?: string; text?: string } | null | undefined): boolean;
