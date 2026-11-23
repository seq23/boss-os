export const MAX_CARDS: number;
export const STATES: readonly string[];
export const ASKED_DAYS: number;
export const BACKLINKS: string;
export const TOPIC_MAX: number;
export function topicOf(v: unknown): string | null;
export interface BacklinkOrder { business: string; topic: string; draft: string; why: string }
export function backlinkOrders(rows: { id: string; business: string; state: string; actions: string; created_at: number }[]): { orders: BacklinkOrder[]; skipped: string[] };
export const NAMING_RULE: string;
export function namingProblems(draft: string): string[];
export const REPORT_EVERY_DAYS: number;
export function reportDue(lastDay: string | null, today: string): boolean;
export function numbersLine(summary: any): string | null;
export function reportSection(rows: { label: string; state: string; decision: string; business?: string; actions?: any[]; evidence?: string[] }[], o: { cards: number; origin: string; at: number; summaries?: any[]; scorecard?: any }): { section: string; at: string; title: string; decide: never[]; rows: never[]; lines: string[]; link: { label: string; url: string } };
export function floorValues(summaries: any[], labelOf?: (key: string) => string): { first: number | null; real: number | null; realMissing: string[] };
