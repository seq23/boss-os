/** Types for outside-locks.mjs. See that file. */
import type { Reading } from "./lib/duty-kit.mjs";
export const LOCK_SENDERS: readonly string[];
export const LOCK_RE: RegExp;
export const LOCK_QUERY: string;
export function lockReading(m: { from?: string; from_domain?: string; subject?: string; date?: string }, mailbox: string): Reading | null;
