/** Types for the one mirror reader both hunts use — see `book-mirror.mjs` for why it exists. */
import type { BookLot } from "../../../src/shared/boss/intake/liveBook.mjs";

export declare const CAPITAL_DIR: string;
export declare const BOOK_JSON: string;
export declare const BOOK_TEXT: string;
export declare const MIRROR_MAX_AGE_DAYS: number;

export interface MirrorBook {
  positions: BookLot[];
  unparsed: Array<{ line: string; why: string }>;
  /** "book v3 (filed 2026-09-16, mirror pulled 0d ago)" — named in every report header. */
  source: string;
  stale: boolean;
  ageDays: number;
}

export declare function bookFromMirror(file?: string, now?: number): MirrorBook | null;
export declare function mirrorOrStop(): MirrorBook | null;
