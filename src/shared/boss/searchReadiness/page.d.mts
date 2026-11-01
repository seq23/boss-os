/** Types for the checklist page renderer (page.mjs). */
export const TEMPLATE_PATH: string;
export function loadTemplate(): string;
export function renderItem(item: any): string;
export function renderPhase(phase: any, items: any[]): string;
export function renderChecklistPage(checklist: any, template: string, opts?: { results?: any; categories?: any }): string;
export function renderStandings(results: any, checklist: any, opts?: { categories?: any }): string;
export function standingsSummary(results: any, opts?: { categories?: any; section?: "mine" | "friends" | "system" }): { sites: number; checks: number; failing: number; notChecked: number; day: string | null };
