export const TASK_KIND: string;
export const DUTY_ID: string;
export const LOCAL_JOB: string;
export const SEAT_TAG: string;
export const DELIVERS: string;
export const REPLY_TO: string;
export const TOKEN_RE: RegExp;
export const ACTIONS: string[];
export const YOUR_CALL_PHRASES: string[];
export const REPLY_FORMS: string[];

export interface DigestItem {
  n?: number;
  comment_id: string;
  video_id?: string;
  video_title?: string | null;
  author?: string | null;
  text?: string;
  published_at?: string | null;
  class?: string;
  proposed_action?: string | null;
  proposed_reply?: string | null;
  product_note?: string | null;
}
export interface Instruction { n: number; comment_id: string; action: "hide" | "reply" | "ignore"; reply_text: string | null }
export interface ParsedReply { mode: "your_call" | "per_number" | "none"; phrase: string | null; instructions: Instruction[]; unread: string[] }
export interface Digest { new_comments?: number; by_class?: Record<string, number>; items?: DigestItem[] }

export function tokenIn(text: string | null | undefined): string | null;
export function shouldEmail(digest: Digest | null | undefined): boolean;
export function parseReply(text: string | null | undefined, items: DigestItem[]): ParsedReply;
export function digestEmail(digest: Digest, token: string): { subject: string; text: string };
export function confirmationEmail(results: Array<{ n?: number | null; result: string; author?: string | null }>, token: string): { subject: string; text: string };
