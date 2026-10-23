/** Types for outside-locks.mjs. See that file. */
import type { Reading } from "./lib/duty-kit.mjs";
export const LOCK_SENDERS: readonly string[];
export const LOCK_RE: RegExp;
export const LOCK_QUERY: string;
export function lockReading(m: { from?: string; from_domain?: string; subject?: string; date?: string }, mailbox: string): Reading | null;
import type { DecideItem, Button } from "../../src/shared/boss/mail/plain.mjs";
export function planLocks(moved: Array<{ key: string; state: string; line: string; was?: string | null }>): { decide: Array<DecideItem & { buttons: Button[]; priority?: number }>; lines: string[]; fixes: Array<{ title: string; prompt: string }> };
