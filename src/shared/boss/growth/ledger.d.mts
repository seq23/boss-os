export const LEDGER_KINDS: readonly string[];
export const MAX_ACTED: number;
export const READ_WINDOW_DAYS: number;
export function measureFor(manifest: any, business: string, channel: string): any | null;
export function cleanActed(a: any, rosterKeys: Set<string>): { kind: string; business: string; channel: string; item: string; at: string | null; scorecard: { floor30: number; floor60: number } | null } | null;
export function floorsFor(scorecard: { floor30: number; floor60: number } | null, baseline: number | null | undefined): { floor30: number | null; floor60: number | null; source: string };
export function resultAt(row: any, readings: any[] | undefined, today: string, n: 30 | 60): "met" | "missed" | "not read" | "not yet";
export function resultLines(rows: any[], readingsByMeasure: Record<string, any[]>, o: { today: string; labels?: Record<string, string>; names?: Record<string, string> }): string[];
export const MEASURE_CHANNEL: Readonly<Record<string, string>>;
