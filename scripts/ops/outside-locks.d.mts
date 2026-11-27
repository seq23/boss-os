/** Types for outside-locks.mjs. See that file. */
import type { Reading } from "./lib/duty-kit.mjs";
import type { MailRule } from "./lib/toni-mail.mjs";
export const LOCK_MAIL: MailRule;
export type Notice = { id: string; from?: string; from_domain?: string; subject?: string; date?: string; kind: string };
export function lockReading(m: Notice, mailbox: string, mailboxId: string): (Reading & { domain: string; subject: string }) | null;
import type { DecideItem, Button } from "../../src/shared/boss/mail/plain.mjs";
export function planLocks(moved: Array<{ key: string; state: string; line: string; was?: string | null; domain?: string; subject?: string }>): { decide: Array<DecideItem & { buttons: Button[]; priority?: number }>; lines: string[]; fixes: Array<{ title: string; prompt: string }> };
export function githubNotice(m: { from?: string; from_domain?: string; subject?: string; kind?: string }): { repo: string | null; subject: string } | null;
export function planCiNotices(notices: Array<{ repo: string | null; subject: string }>, live?: Record<string, "red" | "green" | "closed" | "unknown">, opts?: { at?: number; handed?: Record<string, string> }): { fixes: Array<{ repo: string; title: string; prompt: string }>; lines: string[] };
export function ciStateOf(repo: string, run?: (args: string[]) => string): "red" | "green" | "unknown";
