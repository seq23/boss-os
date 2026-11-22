import type { TapFailure } from "../../src/shared/boss/shipReview/review.mjs";
export interface TapFlow { app?: string; brand?: string; journeys?: Array<{ name: string; start?: string; storage?: Record<string, unknown>; steps: Array<Record<string, unknown>> }>; promises?: Array<{ text: string; on: string; built?: string; native_only?: string }>; native_only?: Array<{ feature: string; why: string; simulator?: string }>; console_ok?: Array<{ text: string; why: string }>; mocks?: Array<{ url: string; method?: string; status?: number; json?: unknown; why: string }>; sweep_skip?: Array<{ name: string; why: string }>; error_text?: string[]; locale?: string; [k: string]: unknown }
export declare const FAILS: readonly string[];
export declare const STOPS: readonly string[];
export declare const MAX_STEPS: number;
export declare const SWEEP_PER_SCREEN: number;
export declare const SWEEP_PER_RUN: number;
export declare const FRAMEWORK_ERROR_SCREENS: readonly (readonly string[])[];
export declare function matcher(s: string): string | RegExp;
export declare function flowProblems(flow: unknown): string[];
export declare function promiseFailures(flow: TapFlow, reached: Map<string, { ok: boolean; text: string }>): TapFailure[];
export declare function outcome(o: { taps: number; failures: TapFailure[]; stopped?: { code: string; why: string } | null }): { exit: 0 | 1 | 9; line: string };
export declare function run(o: { flow: TapFlow; target: string; out: string; schemes?: string[]; chromium?: unknown }): Promise<{ report: Record<string, any>; exit: number; line: string }>;
export declare function selfTest(o?: { chromium?: unknown; log?: (s: string) => void; keep?: string | null }): Promise<number>;
export declare function main(argv?: string[], o?: { print?: (s: string) => void }): Promise<number>;
