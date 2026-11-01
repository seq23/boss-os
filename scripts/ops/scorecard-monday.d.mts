// Types for scorecard-monday.mjs (the Scorecard's Monday run).
export function readRow(row: any, record: any, ctx: any): Promise<any>;
export function runStop(results: any[]): string | null;
export function pauseOne(api: { post(p: string, b: unknown): Promise<unknown>; put(p: string, b: unknown): Promise<unknown> }, t: any, why: string, run?: (args: string[]) => string): Promise<string>;
export function main(argv?: string[]): Promise<number>;
