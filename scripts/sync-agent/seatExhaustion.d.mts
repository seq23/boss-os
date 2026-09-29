/** Types for scripts/sync-agent/seatExhaustion.mjs. */
export declare function cooldownSeconds(requested: unknown): number;
export interface SeatExhaustion {
  mark(seat: string, retryAfterSeconds?: number | null): number;
  activeUntil(seat: string): number | null;
  clear(seat: string): void;
}
export declare function createSeatExhaustion(deps?: {
  now?: () => number;
  load?: () => Record<string, number> | null | undefined;
  save?: (state: Record<string, number>) => void;
}): SeatExhaustion;
