/** Types for risk-watch.mjs. See that file. */
import type { Reading } from "./lib/duty-kit.mjs";
export const THRESHOLDS: Readonly<Record<string, number>>;
export function openrouterReading(credits: unknown, prevUsage: number): Reading & { usage?: number };
export function rdapExpiry(rdap: unknown): number | null;
export function renewalReading(domain: string, expiresAt: number | null, now: number): Reading;
export function senderPauseReason(b: unknown): string | null;
export function hasDkim(txts: string[]): boolean;
export function rdapUrl(domain: string): string;
import type { DecideItem, Button } from "../../src/shared/boss/mail/plain.mjs";
export function planRisk(moved: Array<{ key: string; state: string; line: string; was?: string | null }>): {
  urgent: { subject: string; happened: string; did: string; status: string } | null;
  decide: Array<DecideItem & { body: string; buttons: Button[]; priority?: number }>;
  lines: Array<string | { text: string; links: Button[] }>;
  fixes: Array<{ title: string; prompt: string }>;
};
