/** Types for the Search Readiness audit's pure half (audit.mjs). Loose on purpose: the shapes are JSON. */
export const CHECKLIST_PATH: string;
export const SITES_PATH: string;
export function loadChecklist(raw?: string | null): any;
export function loadSites(raw?: string | null): any;
/** Which definition the audit measures with: origin's, never a stale checkout's. */
export function definitionChoice(a: { local?: string | null; remote?: string | null; path?: string }): {
  text: string | null; source: "origin" | "checkout" | "none"; stale: boolean; unverified?: boolean; why: string;
};
export const STATUS: readonly string[];
export const GSC_TRUTH_NAMES: string[];
export const FRESH_FILE_NAMES: string[];
/** The name shape of an IndexNow key file: 8-128 characters of a-z, A-Z, 0-9 and dashes, or indexnow.txt. */
export const INDEXNOW_KEY_NAME: RegExp;
/**
 * The IndexNow key files in a repository's tree. With `show`, only a file whose body is its own key
 * counts - IndexNow's real contract, and the only test that tells a key from llms-full.txt.
 */
export function indexnowKeyFiles(files: string[], show?: ((path: string) => string | null | undefined) | undefined): string[];
export function applies(item: any, site: any): boolean;
export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number;
export function expandCoverage(site: any, repoCities?: any[] | null): { kind: string; name: string; path: string }[];
export function coverageProblems(site: any): string[];
export function attrs(tag: string): Record<string, string>;
export function tags(html: string, name: string): any[];
export function metaContent(html: string, key: string): string[];
export function titleOf(html: string): string;
export function canonicalOf(html: string): string | null;
export function h1Count(html: string): number;
export function visibleText(html: string): string;
export function wordCount(text: string): number;
export function jsonLd(html: string): { nodes: any[]; errors: string[] };
export function typesOf(n: any): string[];
export function deepNodes(nodes: any, re: RegExp): any[];
export function links(html: string, base: string): { url: string; host: string; rel: string; raw: string }[];
export const CHECKS: Record<string, (ctx: any, params?: any) => any> & { [K in "sitemap_valid" | "robots_ok" | "hyperlocal_coverage" | "canonical_self"]: (ctx: any, params?: any) => any };
export function runChecks(checklist: any, ctx: any): any[];
export function fixBriefs(checklist: any, siteResults: any[], opts?: { now?: number }): any[];
export function morningLines(checklist: any, siteResults: any[], opts?: { previous?: any; queued?: number; lastRepair?: { fixed?: number } | null; max?: number }): string[];
export function summaryLines(siteResults: any[]): string[];
export function workQueue(briefs: unknown[], opts?: { chunkSize?: number }): { total: number; workable: number; protected: number; no_repo: number; repos: { repo: string; n: number }[]; chunks: { repo: string; ids: string[] }[] };
export function queueRunLine(args: { started: number; fixed: number; left: number; protectedLeft?: number; noRepo?: number }): string;
export function repairLine(lastRepair: any, left: number, now?: number): string;
export function repairsThisWeek(status: any, now?: number): number | null;
export function nextFixStatus(prev: any, run: { started: number; fixed: number; left: number; protectedLeft?: number; noRepo?: number; done?: boolean; at?: string }): any;
export declare function passingItems(siteResults: any[]): Array<{ project: string; item: string }>;
/** K · Authority and entity (31 Oct 2026): the Spry Labs entity home and the entity helpers. */
export const SPRY_LABS_ID: string;
export const ENTITY_PARENTS: readonly ("spry-labs" | "client" | "own")[];
export const ENTITY_FILE_RE: RegExp;
export const ENTITY_WATCH_RE: RegExp;
export const JS_WALLED: RegExp;
export const REVIEWER_STOP: string;
export function bare(host: string): string;
export function hostOf(url: string): string;
export function liveSameAs(html: string): string[];
export function entityFor(repo: any, site: any): { path: string; node: any; root: any } | null;
export function namedPeople(nodes: any[]): string[];
export function reviewerRoster(repo: any): Set<string> | null;
/** Client sites (category "client") are audited but never shown on her page or in her email (1 Nov 2026). */
export function shownToOwner(site: any): boolean;
/** F · The search growth loop (1 Nov 2026): the engine's caller workflow, the per-site config and the weekly report. */
export const LOOP_ENGINE_USES: string;
export const LOOP_CONFIG_RE: RegExp;
export const PAID_SEO_RE: RegExp;
export function loopCaller(repo: any): { name: string; text: string } | null;
export function loopConfigFor(repo: any, domain: string): { path: string; raw?: string; cfg?: any; node?: any; error?: string } | null;
export function oneActionOf(cfg: any): string | null;
export function actionMatches(target: string, action: string, base: string): boolean;
export function loopWeek(ctx: any): { week?: any; result?: any };
