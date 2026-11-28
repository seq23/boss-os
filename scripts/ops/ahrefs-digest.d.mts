import type { readWorkerSource } from "../../src/worker/boss/router/freeModel.ts";

type Message = { id: string; internalDate: number; headers: Record<string, string>; body: string };
export const WINDOW_DAYS: number;
export const AHREFS_QUERIES: readonly string[];
export const NO_MAIL: string;
export function parseAhrefsEmail(text: string): { kind: string; project: string; site: string; crawl_date: string; health_score: number; issues: { name: string; urls: number; severity: string }[] } | null;
export function renderDigest(x: { since: string; until: string; perQuery: { query: string; count: number }[]; messages: number; audits: unknown[]; unread: { subject: string; date: string; link: string }[] }): string;
export function buildAhrefsDigest(opts?: {
  token?: () => Promise<string>; now?: number; env?: Record<string, string | undefined>;
  list?: (access: string, query: string) => Promise<[string, Set<string>][]>;
  load?: (threadId: string, access: string) => Promise<Message[]>;
  read?: (...args: Parameters<typeof readWorkerSource>) => Promise<any>;
}): Promise<string>;
