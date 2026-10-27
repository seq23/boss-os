/** Types for outside-locks.mjs. See that file. */
import type { Reading } from "./lib/duty-kit.mjs";
export const LOCK_SENDERS: readonly string[];
export const LOCK_RE: RegExp;
export const LOCK_QUERY: string;
export function lockReading(m: { from?: string; from_domain?: string; subject?: string; date?: string }, mailbox: string): Reading | null;
import type { DecideItem, Button } from "../../src/shared/boss/mail/plain.mjs";
export function planLocks(moved: Array<{ key: string; state: string; line: string; was?: string | null }>): { decide: Array<DecideItem & { buttons: Button[]; priority?: number }>; lines: string[]; fixes: Array<{ title: string; prompt: string }> };
export const GITHUB_REPO_SUBJECT_RE: RegExp;
export const GITHUB_NOTICE_RE: RegExp;
export const GITHUB_NOTICE_SLUG_RE: RegExp;
export function githubNotice(m: { from?: string; from_domain?: string; subject?: string }): { repo: string | null; subject: string } | null;
export function planCiNotices(notices: Array<{ repo: string | null; subject: string }>, live?: Record<string, "red" | "green" | "closed" | "unknown">, opts?: { at?: number; handed?: Record<string, string> }): { fixes: Array<{ repo: string; title: string; prompt: string }>; lines: string[] };
export function ciStateOf(repo: string, run?: (args: string[]) => string): "red" | "green" | "unknown";
