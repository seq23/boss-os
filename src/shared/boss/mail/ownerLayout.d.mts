/** Types for the owner layout. See ownerLayout.mjs for the rules. */
import type { LaidOutEmail, DecideItem, EmailSection, DetailItem } from "./plain.mjs";
export { refCode, NOTHING_TO_DO, REF_CODE_RE } from "./plain.mjs";
export type OwnerLayoutName = "approve" | "delivered" | "digest" | "alarm" | "note";
export const LAYOUTS: Readonly<Record<OwnerLayoutName, string>>;
export function layoutOf(name: unknown): OwnerLayoutName;
export function saysNothingToDo(act: unknown): boolean;
export function defaultAct(decideCount: number, layout?: string): string;
export function ownerLine(why: unknown, act: unknown): string;
export interface OwnerMinimum { why: string; act: string; ref: string | null; refShown: boolean; declared: boolean; layout?: string }
export interface OwnerSpec {
  who: string; subject: string; layout?: OwnerLayoutName | string; why?: string; act?: string | null;
  ref?: string | null; refs?: string[]; happened?: string; decide?: Array<DecideItem | string>; needs?: string[] | string;
  sections?: EmailSection[]; details?: DetailItem[]; footer?: string | null; postscript?: string | null; maxDecide?: number; moreDecide?: string | null;
  kind?: "plain" | "morning" | "report"; text?: string; lineTail?: string | string[] | null;
  version?: number; changed?: string[]; thing?: { title?: string; heading?: string; text: string } | null;
  broke?: string; lost?: string | null; doing?: string; did?: string; status?: string; done?: boolean; happenedLabel?: string;
}
export type OwnerEmail = LaidOutEmail & { layout: OwnerLayoutName; minimum: OwnerMinimum };
export function ownerEmail(spec: OwnerSpec): OwnerEmail;
export function minimumProblems(payload: Record<string, any>, minimum: OwnerMinimum | null | undefined, opts?: { routed?: string[] | null }): string[];
export function notesLine(count: number, days?: number): string;
