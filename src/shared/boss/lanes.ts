import type { LaneId } from "./types";

export const LANES: Record<LaneId, { label: string; accent: string; isolated: boolean }> = {
  ops: { label: "Operations", accent: "var(--lane-ops)", isolated: false },
  trading: { label: "Trading", accent: "var(--lane-trading)", isolated: true },
};

export function isLane(v: unknown): v is LaneId {
  return v === "ops" || v === "trading";
}
