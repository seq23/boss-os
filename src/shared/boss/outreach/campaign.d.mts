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

export function sendableVerdict(verdict: string | undefined): boolean;
export const MAX_ADDRESSES_PER_PERSON: number;
export const GUESS_PATTERNS: string[];
export function nameParts(name: string): { first: string; last: string };
export function localFor(pattern: string, first: string, last: string): string;
export function patternOf(email: string, name: string): string | null;
export interface AddressToTry { email: string; how: "published" | "her email" | "guess"; source_url?: string }
export function addressesToTry(x: { name: string; given?: string | null; published?: { email: string; source_url?: string } | null; domain?: string | null; seen?: Array<{ name: string; email: string }>; tried?: Array<{ email: string } | string> }): AddressToTry[];
export function advanceContact<T extends Record<string, any>>(c: T, outcome: string): T & { tried: Array<{ email: string; how: string; outcome: string }>; no_address?: boolean };
export function contactPending(c: unknown): boolean;
