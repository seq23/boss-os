export interface LeverView {
  position: string | null;
  known: boolean;
  open: boolean;
  spent: number;
  allowance: number;
  moderate: number;
  pct: number;
  remedy: string | null;
  spentScope: "dearest_backend" | "ops_month";
}
/** Derive what the spend-lever panel shows from the route's envelope. Never invents a position. */
export function leverView(envelope: unknown, opsMonth?: unknown): LeverView;
