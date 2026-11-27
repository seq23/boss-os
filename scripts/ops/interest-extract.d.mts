type Reader = typeof import("../../src/worker/boss/router/freeModel.ts").readWorkerSource;
export function extractCandidates(options?: {
  directory?: string;
  read?: (input: Parameters<Reader>[0]) => ReturnType<Reader>;
  loadThread?: (id: string) => Promise<any[]>;
  prompt?: string;
  identity?: any;
  limit?: number;
}): Promise<{ status: "complete" | "unavailable" | "allowance-exhausted"; checked: number; added: number; remaining: boolean }>;
export const loadWrong: any;
export function senderOf(...args: any[]): any;
export function normalise(...args: any[]): any;
export function admissible(...args: any[]): any;
export function reviewSet(...args: any[]): any;
