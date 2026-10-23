/** Types for email-plain.mjs. See that file. */
export const INBOX: Array<{ why: RegExp; e: { subject: string; text: string } }>;
export function morningSample(): unknown;
export function senderSamples(): unknown;
export function check(): { fails: string[]; examined: number };
