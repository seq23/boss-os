export const STATES: readonly string[];
export const BACKLINKS: string;
export const TOPIC_MAX: number;
export function topicOf(v: unknown): string | null;
export interface BacklinkOrder { business: string; topic: string; draft: string; why: string }
export function backlinkOrders(rows: { id: string; business: string; state: string; actions: string; created_at: number }[]): { orders: BacklinkOrder[]; skipped: string[] };
export const NAMING_RULE: string;
export function namingProblems(draft: string): string[];
