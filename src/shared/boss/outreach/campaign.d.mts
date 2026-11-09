export const STAGGER_DAYS: number;
export function neverPitchReason(email: string): string | null;
export function isTopExec(title: string): boolean;
export function isCampaignAsk(text: string): boolean;
export function businessIn<T extends { key: string; brand: string; domain: string }>(text: string, businesses: readonly T[]): T | null;
export function brandNamedIn(text: string, brands: readonly string[]): string | null;
export function angleFor(x?: { title?: string; note?: string }): "brand" | "distribution";
export function contactLine(line: string): { name: string; first: string; title: string; email: string } | null;
export function orgNameFor(domain: string, text: string): string;
export interface PlannedContact { name: string; first: string; title: string; email: string; note: string; role: "send" | "held"; order?: number; why?: string; angle: "brand" | "distribution" | "alliance" }
export function campaignPlan<T extends { key: string; brand: string; domain: string }>(text: string, businesses: readonly T[]): {
  business: T | null; org: string | null; orgDomain: string | null;
  contacts: PlannedContact[]; skipped: Array<{ email: string; why: string }>; problems: string[];
};
export function firstSendOffsetDays(order: number): number;
export function holdOrgsIn(text: string): { orgs: string[]; after: string | null } | null;
export function researchedContact(row: unknown): PlannedContact | null;
export function capabilitiesFrom(md: string): string[];
export function pageProblems(text: string, outbound?: (t: string) => string[]): string[];
