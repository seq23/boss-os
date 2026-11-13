/** Types for the one door every email to her passes. See ownerDoor.mjs for the rules. */
import type { OwnerMinimum } from "./ownerLayout.mjs";
export function bareSubject(subject: unknown): string;
export function decideCount(text: unknown): number;
export function textFromHtml(html: unknown): string;
export function trulyNeedsHer(payload: Record<string, any> | null | undefined, minimum: OwnerMinimum | null | undefined): boolean;
export function ownerDoor(
  payload: Record<string, any>,
  opts?: { minimum?: OwnerMinimum | null; replyTo?: string | null; routed?: string[] | null },
): { payload: Record<string, any>; minimum: OwnerMinimum; repaired: string[]; problems: string[]; mustGo: boolean };
export function eventKey(payload: Record<string, any>): string;
