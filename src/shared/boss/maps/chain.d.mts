type Row = Record<string, any>;
type Map_ = { rows: Row[]; [k: string]: any };
export interface MapsCtx { repos: Map_; domains: Map_; sites: Map_; accounts: Map_; emails?: Map_; schedule?: Map_; scorecard?: Map_; readiness?: any; social?: Map_ }
export interface RepoLinks { domains: string[]; sites: string[]; accounts: string[]; emails: string[]; social: string[]; schedule: string[]; scorecard: string[]; readiness: string[] }
export const OUTSIDE: string;
export const NOT_LINKED: string;
export const MAP_ORDER: ReadonlyArray<{ tab: string; label: string }>;
export const BUSINESS_KEYS: readonly string[];
export function businessKey(b: string): string;
export function registrable(host: string | null | undefined): string | null;
export function emailRepos(row: Row): string[];
export function scheduleRepos(row: Row | undefined, repos?: Map_): string[];
export function scorecardRepos(row: Row, schedule?: Map_, repos?: Map_): string[];
export function socialRepos(row: Row, sites?: Map_): string[];
export function readinessSite(grid: Row, sites?: Map_): Row | null;
export function scorecardSites(row: Row, ctx: MapsCtx): Row[];
export function linksByRepo(ctx: MapsCtx): Map<string, RepoLinks>;
export function notLinked(ctx: MapsCtx): { emails: string[]; schedule: string[]; scorecard: string[]; social: string[] };
export function shapeProblems(ctx: MapsCtx): string[];
export function chainProblems(ctx: MapsCtx): string[];
export function launchdProblems(ctx: MapsCtx, bossLabels: Set<string>): string[];
export const ADDRESS: RegExp;
export const MASKED_LOCAL: RegExp;
export function unmaskedAddresses(map: unknown): string[];
export function privacyProblems(name: string, map: unknown): string[];
export function countWords(n: number, one: string, many: string): string;
