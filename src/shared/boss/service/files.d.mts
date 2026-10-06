/** Types for the outbound-files plan (R18). See files.mjs. */
export interface OutboundFile { name: string; bytes: number; path?: string | null; drive_url?: string | null }
export declare const OUTBOUND_ATTACHMENTS_MAX_BYTES: number;
export declare function outboundFilesPlan(files: readonly OutboundFile[], cap?: number): { attach: number[]; lines: string[]; bytes: number };
