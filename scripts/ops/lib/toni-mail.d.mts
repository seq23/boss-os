import type { readWorkerSource } from "../../../src/worker/boss/router/freeModel.ts";
import type { Reading } from "./duty-kit.mjs";

export type MailRule = { days: number; kinds: readonly string[]; instruction: string };
type Message = { id: string; internalDate: number; headers: Record<string, string>; body: string };
type Notice = { id: string; at: number; kind: string; from_domain?: string; from?: string; subject?: string; date?: string; vendor?: string; detail?: string };
type Checkpoint = { through?: number; pendingSince?: number; receipts?: Record<string, Notice> };
type Scan = { notices: Notice[]; checkpoint: Checkpoint; count: number; handled: number; why: string | null };
export function personalToken(opts?: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch }): Promise<string>;
export function classifyToniThread(thread: Message[], targets: Iterable<string>, rule: MailRule, read?: typeof readWorkerSource): Promise<Notice[]>;
export function scanToniMailbox(opts: { token: () => Promise<string>; rule: MailRule; previous?: Checkpoint; now?: number; list?: (token: string, query: string) => Promise<[string, Set<string>][]>;
  load?: (id: string, token: string) => Promise<Message[]>; read?: typeof readWorkerSource }): Promise<Scan>;
export function readToniMail(rule: MailRule, previous?: Record<string, Checkpoint>, now?: number): Promise<(Scan & { id: string; label: string })[]>;
export function reconcileToniReadings(readings: Reading[], previous?: Record<string, string>, unreadPrefixes?: string[]): { states: Record<string, string>; moved: (Reading & { was: string | null })[] };
