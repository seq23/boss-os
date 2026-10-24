/** Types for partyLists.mjs, read by the Worker and by the deal scripts on her Mac. */

export type PartyList = "same_firm" | "do_not_suggest";
export type PartyKind = "email" | "domain" | "name";

export interface PartyEntry {
  id?: string;
  list?: PartyList;
  kind: PartyKind;
  value: string;
  label?: string | null;
}

export interface PartyLists {
  same_firm: PartyEntry[];
  do_not_suggest: PartyEntry[];
}

export interface ListEdit extends PartyEntry {
  list: PartyList;
  action: "add" | "remove";
}

export const FIRM_DOMAIN: string;
export const LOOKBACK_DAYS: number;
export function withinLookback(date: unknown, now?: number): boolean;
export function partyStrings(row: Record<string, unknown>): string[];
export function entryMatches(entry: PartyEntry, strings: string[]): boolean;
export function isSameFirm(row: Record<string, unknown>, lists: Partial<PartyLists> | null | undefined): boolean;
export function isDoNotSuggest(row: Record<string, unknown>, lists: Partial<PartyLists> | null | undefined): boolean;
export function pairAllowed(
  a: Record<string, unknown>, b: Record<string, unknown>, lists: Partial<PartyLists> | null | undefined,
  opts?: { aIsHers?: boolean; bIsHers?: boolean },
): boolean;
export function targetOf(phrase: string): (PartyEntry & { label: string }) | null;
export function parseListEdits(text: string): ListEdit[];
export function confirmEdit(e: ListEdit): string;

export const ARCHIVE_DAYS: number;
export function withinArchive(date: unknown, now?: number): boolean;
export function archiveRows<T extends { company: string; direction: string; from_text: string; received_on: string }>(rows: T[], now?: number): T[];
