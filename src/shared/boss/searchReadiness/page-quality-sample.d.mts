/** Types for quality sampling (page-quality-sample.mjs). */
export const QUALITY: Readonly<{ SAMPLE: number; ITEMS: readonly string[]; SHINGLE: number; NEAR_DUPLICATE: number; PAGE_FAIL_SHARE: number }>;
export function isoWeek(t?: number): string;
export function pickSample(urls: Iterable<string>, opts?: { n?: number; week?: string; exclude?: string[] }): string[];
export function similarity(a: string, b: string, k?: number): number;
import type { readWorkerSource } from "../../../worker/boss/router/freeModel.ts";
export function qualitySample(a: { site: any; pages: any[]; checklist: any; read: (input: Parameters<typeof readWorkerSource>[0]) => ReturnType<typeof readWorkerSource> }): Promise<any>;
