type Reader = typeof import("../../src/worker/boss/router/freeModel.ts").readWorkerSource;
export function extractCandidates(options?: {
  directory?: string;
  read?: (input: Parameters<Reader>[0]) => ReturnType<Reader>;
  loadThread?: (id: string) => Promise<any[]>;
  prompt?: string;
  identity?: any;
  limit?: number;
}): Promise<{ status: "complete" | "unavailable" | "allowance-exhausted"; checked: number; added: number; remaining: boolean; held_now?: string[] }>;
export const loadWrong: any;
export function senderOf(...args: any[]): any;
export function normalise(...args: any[]): any;
export function admissible(...args: any[]): any;
export function reviewSet(...args: any[]): any;

export function reviewBrokerage(options: {
  directory?: string; kind: "daily" | "history"; now?: number;
  list?: (start: number, end: number) => Promise<{ id: string; threadId: string }[]>;
  load?: (threadId: string, id: string) => Promise<any[]>;
  read?: (input: Parameters<Reader>[0]) => ReturnType<Reader>; prompt?: string; identity?: any;
  compare?: (rows: any[]) => Promise<number | null>;
}): Promise<{ status: string; checked: number; added: number; found?: number; missing?: number; held?: number; held_now?: string[] }>;
export function nameHeld(ids: string[] | undefined, what: string, options?: { add?: (section: string, body: { lines: unknown[] }) => unknown }): Promise<void>;
