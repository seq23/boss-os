type Reader = typeof import("../../src/worker/boss/router/freeModel.ts").readWorkerSource;

export function scanBrokerage(options: {
  directory: string;
  mailbox: string;
  api: (url: string) => Promise<unknown>;
  read: (input: Parameters<Reader>[0]) => ReturnType<Reader>;
  now?: number;
  since?: string;
  backfill?: boolean;
}): Promise<{
  status: "complete" | "unavailable" | "allowance-exhausted";
  window: { start: number; end: number };
  census: number;
  kept: number;
  dropped: number;
  held: number;
  never_read: number;
  held_now: string[];
}>;
