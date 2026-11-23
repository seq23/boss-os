export const ENGINES: readonly string[];
export const LANES: readonly string[];
export const NEXT_LANE: Readonly<Record<string, string | null>>;
export const MAX_FIX_ATTEMPTS: number;
export const WEEK_MAX_AGE_DAYS: number;
export const MIN_COMPLETED_SHARE: number;
export const MAX_PROMPTS: number;
export const OVER_PLAN_CREDITS: number;
export const STOPS: Readonly<Record<string, string>>;
export const AI_SITES: Readonly<Record<string, { business: string; repo: string; loop: boolean }>>;
export const NO_LOOP_NOTE: string;
export const ENGINE_LABEL: Readonly<Record<string, string>>;
export function isoWeek(ms: number): string;
export const RUN_DAY_UTC: number;
export const RUN_HOUR_UTC: number;
export function expectedWeek(now: number): string;
export function domainOf(s: unknown): string | null;
export function pageOnHost(url: unknown, host: string, prefix?: string | null): boolean;
export function prefixOk(p: unknown): boolean;
export function missId(host: string, prompt: string): Promise<string>;
export interface AiMissIn {
  prompt_id: string; prompt: string; lane: string | null; why: string | null;
  page_url: string | null; fit_url: string | null; source_domain: string | null; channel: string | null; draft: string | null;
  engines_missed: string[]; rivals: string[]; cited_sources: string[];
}
export interface AiObs { prompt_id: string; prompt: string; engine: string; obs_id: string; status: string; mentioned: boolean | null; cited: boolean | null; rivals: string[]; sources: string[] }
export type SiteRead =
  | { status: "read"; week: string; run_id: string; run_at: number; prompts: number; answered: number; cited: number; mentioned: number;
      engines: Record<string, { answered: number; mentioned: number; cited: number }>; obs: AiObs[]; misses: AiMissIn[]; notes: string[] }
  | { status: "not_read"; stop: string; why: string; week?: string };
export function readSite(block: unknown, opts: { host: string; now?: number; prefix?: string | null; pages?: { engine: Set<string>; all: Set<string> } | null }): SiteRead;
export function creditsProblem(before: number, after: number): string | null;
export function planProblem(perSite: Record<string, number>): { total: number | null; stop: string | null };
export function aiCard(reads: any[], now?: number): any;
