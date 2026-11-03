/** Types for the leads line (site-leads.mjs). */
export const LEADS: { WINDOW_DAYS: number };
export const OWN_CATEGORIES: readonly string[];
export const LEAD_KINDS: readonly string[];
export function isOwnSite(site: any): boolean;
export function leadWindows(now?: number, days?: number): { current: { from: number; to: number }; previous: { from: number; to: number }; days: number };
export function leadSourceProblems(sitesJson: any): string[];
export type LeadVerdict = { status: "read" | "not_tracked" | "not_read"; red: boolean; action: string; line: string; current?: number; previous?: number; clicks?: number | null; note?: string | null; why?: string };
export function leadVerdict(a: { site: any; read?: any; outcome?: any }): LeadVerdict | null;
export function leadRedLine(site: any, v: LeadVerdict | null | undefined): string | null;
export function leadsMorningLines(siteResults: any[], opts?: { max?: number }): string[];
