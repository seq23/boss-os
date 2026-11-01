/** Types for the Marketplace photo ask. See photoAsk.mjs. */
export const NOTHING_NEW_DAYS: number;
export const ASK_EVERY_DAYS: number;
export const STUDIO_URL: string;
export function photoAskDue(input: { newest: number | null; lastAsked: number | null; now: number }): { ask: boolean; days: number | null; why: string };
export function photoAskItem(input: { days: number | null }): { key: string; title: string; body: string; buttons: Array<{ label: string; url: string }> };
