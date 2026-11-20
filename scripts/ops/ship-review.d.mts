import type { Shot, Finding, ShipKind } from "../../src/shared/boss/shipReview/review.mjs";
export interface ShipArgs { kind: ShipKind; target: string; builder: string; flags: Set<string>; planned: string[]; surface?: string; [k: string]: unknown }
export declare function parseArgs(argv: string[]): ShipArgs;
export declare function isPrivate(a: ShipArgs): boolean;
export declare function isBlank(m: { words?: number; media?: number } | null | undefined): boolean;
export declare const YOUTUBE_CHANNEL: RegExp;
export declare function capture(a: ShipArgs, out: string, deps?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<{ shots: Shot[]; facts: string[] }>;
export declare function judge(o: { routes: string[]; base: Record<string, unknown>; shots: Shot[]; out: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; log?: (s: string) => void; run?: (...a: any[]) => any }): Promise<{ verdict: "PASS" | "FAIL"; findings: Finding[]; model: string; tier: string } | null>;
export declare function main(argv?: string[], o?: Record<string, unknown>): Promise<number>;
