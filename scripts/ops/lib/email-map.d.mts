export interface EmailMapRow { id: string; business: string; owner: string; runs: string; launchd?: string[]; code: Array<{ repo: string; paths: string[] }>; [k: string]: unknown }
export interface EmailMapManifest { businesses: Array<{ key: string; label: string; blurb: string }>; runs: Record<string, string>; rows: EmailMapRow[] }
export const SENDING_PATTERNS: RegExp[];
export const BUSINESS_DOMAINS: string[];
export function isScanned(file: string): boolean;
export function sends(source: string): boolean;
export function citedIn(manifest: EmailMapManifest, repo: string): Set<string>;
export function uncovered(files: Array<{ file: string; source: string }>, manifest: EmailMapManifest, repo: string): string[];
export function addressProblems(manifest: { rows: unknown[] }): string[];
export function shapeProblems(manifest: EmailMapManifest): string[];
export function repoDir(repo: string, root: string): string | null;
export function checkOtherRepos(manifest: EmailMapManifest, root: string, opts?: { scanSenders?: boolean }): { checked: string[]; missingRepos: string[]; problems: string[] };
export function checkLaunchd(manifest: EmailMapManifest, dir?: string): { labels: string[]; missing: string[] };
export function readManifest(root: string): EmailMapManifest;
