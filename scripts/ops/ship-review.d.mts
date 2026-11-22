import type { Shot, Finding, ShipKind } from "../../src/shared/boss/shipReview/review.mjs";
export interface ShipArgs { kind: ShipKind; target: string; builder: string; flags: Set<string>; planned: string[]; surface?: string; [k: string]: unknown }
export declare function parseArgs(argv: string[]): ShipArgs;
export declare function isPrivate(a: ShipArgs): boolean;
export declare function isBlank(m: { words?: number; media?: number } | null | undefined): boolean;
export declare const YOUTUBE_CHANNEL: RegExp;
export declare const MAX_TILES: number;
export declare function tilesFor(fullH: number, width: number): Array<{ y: number; height: number }>;
export declare function changedLines(diff: string, cap?: number): string;
export declare function writeCaptureFile(out: string, c: { shots: Shot[]; facts: string[] }): void;
export declare function readCaptureFile(dir: string): { shots: Shot[]; facts: string[] };
export declare function pageSlug(u: string): string;
export declare function capture(a: ShipArgs, out: string, deps?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<{ shots: Shot[]; facts: string[] }>;
export declare function judge(o: { routes: string[]; base: Record<string, unknown>; shots: Shot[]; out: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; log?: (s: string) => void; run?: (...a: any[]) => any }): Promise<{ verdict: "PASS" | "FAIL" | "UNSEEN"; findings: Finding[]; unseen: string[]; model: string; tier: string } | null>;
export declare function main(argv?: string[], o?: Record<string, unknown>): Promise<number>;
export declare function videoSheet(file: string, sheet: string, width?: number): number;
export declare function readTapThrough(dir: string, o?: { runId?: number | null; sheet?: (file: string, sheet: string, width?: number) => number }): { shots: Shot[]; facts: string[]; report: Record<string, any> };
