export interface SocialRow { id: string; business: string; site: string; platform: string; handle: string | null; url: string | null; account_email: string; account_email_note?: string; status: string; decision: string; no_url_why?: string;
  posts: { by: "job" | "hand" | "none"; what: string; code?: Array<{ repo: string; paths: string[] }>; jobs?: string[]; check?: Record<string, any> }; [k: string]: unknown }
export interface SocialManifest { statuses: Record<string, string>; groups: Record<string, string>; businesses: Array<{ key: string; label: string; group: string; blurb: string; grid_business?: string }>; rows: SocialRow[];
  code_exempt?: Array<{ repo: string; path: string; why: string }>; schedule_exempt?: Array<{ id: string; why: string }>; [k: string]: unknown }
export interface SocialCheckResult { status: 0 | 1 | 2; census: string; problems: string[]; personal?: string[] }
export const STATUSES: readonly string[];
export const PAGE_SECTIONS: ReadonlyArray<{ key: string; label: string; groups: string[] }>;
export const POSTING_PATTERNS: RegExp[];
export const PIN_FEED_PATH: RegExp;
export const POSTING_JOB_RE: RegExp;
export const PERSON_PROFILE: RegExp;
export function isScanned(file: string): boolean;
export function posts(file: string, source: string): boolean;
export function citedIn(manifest: SocialManifest, repo: string): Set<string>;
export function uncoveredCode(files: Array<{ file: string; source: string }>, manifest: SocialManifest, repo: string): string[];
export function staleExemptions(files: Array<{ file: string; source: string }>, manifest: SocialManifest, repo: string): string[];
export function uncoveredJobs(schedule: { rows?: Array<{ id: string; name: string; what?: string }> }, manifest: SocialManifest): string[];
export function urlKey(u: string): string;
export function profileUrls(json: unknown): string[];
export function uncoveredSameAs(docs: Array<{ repo: string; path: string; json: unknown }>, manifest: SocialManifest): string[];
export function shapeProblems(manifest: SocialManifest, sites: any): string[];
export const PERSONAL_MOVE: string;
export const THEIRS: string;
export const ROLE_LOCAL: RegExp;
export const MASKED_LOCAL: RegExp;
export function brandDomains(sites: any): Set<string>;
export function accountEmailProblems(manifest: SocialManifest, sites: any): string[];
export function personalMoveRows(manifest: SocialManifest): string[];
export function privacyProblems(manifest: SocialManifest): string[];
export function classifyProbe(status: number, body?: string): "ok" | "dead" | "unverifiable";
export function newestPubDate(xml: string): number | null;
export function checkUrls(manifest: SocialManifest, opts?: { fetchImpl?: typeof fetch }): Promise<{ ok: string[]; unverifiable: string[]; problems: string[] }>;
export function checkJobs(manifest: SocialManifest, opts?: { now?: number; fetchImpl?: typeof fetch; gh?: (repo: string, file: string) => any; home?: string }): Promise<{ checked: string[]; unreadable: string[]; problems: string[] }>;
export function readManifest(root: string): SocialManifest;
export function readSites(root: string): any;
export function runSocialMapCheck(opts?: { root?: string; home?: string; repos?: string[]; fetchImpl?: typeof fetch; gh?: (repo: string, file: string) => any; now?: number; live?: boolean }): Promise<SocialCheckResult>;
export function socialMapFlagWords(result: SocialCheckResult | null): string | null;
