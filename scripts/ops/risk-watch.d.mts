/** Types for risk-watch.mjs. See that file. */
import type { Reading } from "./lib/duty-kit.mjs";
export const THRESHOLDS: Readonly<Record<string, number>>;
export function openrouterReading(credits: unknown, prevUsage: number): Reading & { usage?: number };
export function rdapExpiry(rdap: unknown): number | null;
export function renewalReading(domain: string, expiresAt: number | null, now: number): Reading;
export function senderPauseReason(b: unknown): string | null;
export function hasDkim(txts: string[]): boolean;
