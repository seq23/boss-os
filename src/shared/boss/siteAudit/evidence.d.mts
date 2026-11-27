/** Types for the search-evidence and address rules (see evidence.mjs). */

export declare const ADDRESS_RE: RegExp;
export declare function carriesAddress(v: unknown): boolean;
export declare function searchEvidenceGap(searched: unknown): string | null;
export declare function findingItemId(f: { project?: unknown; headline?: unknown } | null | undefined): string | null;
export declare function queueEvidence(input: { scope?: any; repo?: string | null; findings?: any[] }): Record<string, unknown>;
export declare function scopeBriefs(queue: any, repo: string, briefIds?: string[]): { forRepo: any[]; wanted: any[] };
export declare function scopeSnapshot(input: { queue: any; queueFile: string; repo: string; briefIds?: string[]; now?: number }): Record<string, unknown>;
export declare function digestSearched(text: unknown): { mailbox: string; since: string; until: string; messages: number | null; queries: string[]; source: "digest" } | null;
