/** Types for `validate:service-rules`, so the test reads the document with the validator's own parser. */
export interface ServiceRule { n: number; tag: "ALL-KINDS" | "REPO-ONLY"; text: string; owner: string; file: string; exportName: string }
export declare const DOC: string;
export declare const LANE_ONLY: RegExp;
export declare const UNIVERSAL_DOORS: string[];
export declare const INCLUSIONS: Array<{ file: string; needle: string; why: string }>;
export declare function stripComments(source: string): string;
export declare function parseRules(markdown: string): { rules: ServiceRule[]; problems: string[] };
export declare function anchorExists(file: string, exportName: string, readText?: (rel: string) => string | null): { ok: boolean; why?: string };
export declare function productSources(): Record<string, string>;
export declare function referencesOf(exportName: string, ownFile: string, sources: Record<string, string>): string[];
export declare function reachOf(rule: ServiceRule, sources: Record<string, string>): { ok: boolean; why?: string; refs: string[] };
export declare function checkWaits(waits?: unknown, kinds?: string[], forbidden?: readonly RegExp[]): string[];
export declare function likePatternsFromData(sources: Record<string, string>): string[];
export declare function runAll(input: {
  markdown: string; sources: Record<string, string>; practices?: Array<{ rule: string; line: string }>;
  waits?: unknown; kinds?: string[]; readText?: (rel: string) => string | null;
}): { rules: ServiceRule[]; allKinds: ServiceRule[]; laneOnly: number; violations: string[] };
