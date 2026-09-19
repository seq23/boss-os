/** Types for the grid's health-reader registry. See propertyReaders.mjs. */
export type Reader = "uptime" | "github" | "gsc" | "cloudflare";
export type RunsOn = "worker" | "mac";

export interface ReaderCell {
  property_key: string;
  reader: Reader;
  runs_on: RunsOn;
  wired: boolean;
  cannot: string | null;
}

export declare const READERS: readonly Reader[];
export declare const READER_RUNS_ON: Record<Reader, RunsOn>;
export declare const CANNOT: Record<string, Partial<Record<Reader, string>>>;
export declare function readerRegistry(): ReaderCell[];
export declare function cannotReason(propertyKey: string, reader: string): string | null;
