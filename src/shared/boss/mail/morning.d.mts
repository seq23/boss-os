/** Types for the morning email's section files. See morning.mjs for the interface. */
import type { Button, DecideItem } from "./plain.mjs";
export interface MorningDecide extends DecideItem { priority?: number }
export interface MorningSection {
  section: string; at: string;
  decide?: MorningDecide[];
  rows?: Array<{ company: string; side?: string; size?: string; price?: string; structure?: string; from?: string; when?: string; url?: string; tag?: string }>;
  lines?: Array<string | { text: string; links?: Button[] }>;
  link?: Button | null;
  credits?: { used: number; budget: number; kept: number };
}
export const MORNING_SECTIONS: readonly string[];
export const STALE_MS: number;
export function morningDir(): string;
export function morningSectionProblems(obj: unknown): string[];
export function writeMorningSection(section: string, data: Partial<MorningSection>, opts?: { dir?: string; now?: number }): MorningSection;
export function addMorningLines(section: string, add: { lines?: MorningSection["lines"]; decide?: MorningDecide[] }, opts?: { dir?: string; now?: number }): MorningSection;
export function readMorningSections(opts?: { dir?: string; now?: number }): { sections: Record<string, MorningSection>; skipped: string[] };
export function clearToldSections(names: string[], opts?: { dir?: string }): void;
