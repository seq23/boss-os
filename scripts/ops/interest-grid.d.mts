/** Loose types so tests can import this node script; the script itself is the authority. */
export const MAILBOX: any;
export const RRLIST: any;
export const DEALS_PAGE: any;
export const HOLDERS_PAGE: any;
export const gmailUrl: any;
export const publicRow: any;
export function loadIdentity(...args: any[]): any;
export function isHerAddress(...args: any[]): any;
export function mentionsHer(...args: any[]): any;
export function isHers(...args: any[]): any;
export function moneyWords(...args: any[]): any;
export function priceWords(...args: any[]): any;
export function sizeWords(...args: any[]): any;
export function structureWords(...args: any[]): any;
export function firmOf(...args: any[]): any;
export function fromWords(...args: any[]): any;
export function gridRow(...args: any[]): any;
export function buildGrid(...args: any[]): any;
export function replyAddress(...args: any[]): any;
export function otherSides(...args: any[]): any;
export function introDecide(...args: any[]): any;
export function holdersLine(...args: any[]): any;
export function moniqueFound(...args: any[]): any;
export function morningDeals(...args: any[]): any;
export function bossSession(...args: any[]): any;
export function loadLists(...args: any[]): any;
export function writeMorning(...args: any[]): any;
export const LOOKBACK_DAYS: number;
export function withinLookback(...args: any[]): any;
export function prospectSellRows(...args: any[]): any;

export const yoursLabel: (direction: string) => string;
export const MATCHES_PAGE: string;
export const MAX_MATCH_DECIDE: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function allMatches(grid: any[], lists: any, opts?: { newIds?: Set<string>; now?: number; tolerance?: number }): any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function matchView(buyer: any, seller: any, rank: any, opts?: { isNew?: boolean; now?: number }): any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function matchDecide(m: any): any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pairDrafts(buyer: any, seller: any): any[];
export function pairFillWords(buyer: { size_usd?: number | null }, seller: { size_usd?: number | null }): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function partyOf(g: any): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pairKeyOf(buyer: any, seller: any): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function matchCounts(all: any[], opts?: { tolerance?: number }): { within: number; companies: number; stale: number; live: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function emailMatches(within: any[], opts?: { firstSeen?: Record<string, number> | null; now?: number; max?: number }): any[];
export const MAX_EMAIL_MATCHES: number;
export const NEW_MATCH_MS: number;
