/** Types for schedule.mjs. See that file. */
export interface Slot { start: number; zone: string }
export const WORK_DAY: Readonly<{ start: [number, number]; end: [number, number] }>;
export const SLOT_STARTS: readonly (readonly [number, number])[];
export const SLOT_MINUTES: number;
export const MIN_WORKDAYS_OUT: number;
export const MAX_SLOTS: number;
export const MIN_SLOTS: number;
export const ZONE_BY_CITY: Readonly<Record<string, string>>;
export function zoneLabel(zone: string): string;
export function cityKey(city: unknown): string | null;
export function validZone(zone: unknown): boolean;
export function zoneResolver(a?: { awayCity?: string | null; awayUntil?: string | null; homeZone?: string | null }): (ymd: string) => string | null;
export function wall(t: number, zone: string): { weekday: string; ymd: string; hour: number; minute: number };
export function instantIn(zone: string, ymd: string, hour: number, minute: number): number | null;
export function mergeBusy(lists: Array<Array<[number, number]>>): Array<[number, number]>;
export function inWorkingHours(t: number, zone: string | null, minutes?: number): boolean;
export function openSlots(busy: Array<[number, number]>, o?: { now?: number; zoneOn?: (ymd: string) => string | null; want?: number; minutes?: number }): Slot[];
export function slotText(slot: Slot): string;
export function wantsToMeet(text: unknown): boolean;
export function pickedSlot(text: unknown, offered: Slot[] | null | undefined): Slot | null;
export function lpTimesBody(a: { name?: string | null; slots: Slot[] }): string;
export function lpConfirmBody(a: { name?: string | null; slot: Slot & { theirs?: string } }): string;
export function proposedTimes(text: unknown, now?: number): Slot[];
export function proposedFit(text: unknown, o?: { busy?: Array<[number, number]> | null; zoneOn?: (ymd: string) => string | null; now?: number; leadMs?: number; minutes?: number }): (Slot & { theirs: string }) | null;
export const INVITE_TITLE: string;
export const INVITE_MINUTES: number;
export function slotsFrom(json: unknown): Slot[];
