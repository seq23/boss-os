/**
 * Types for the live-book parser, so the Worker's intake and Monique's node scripts read the book
 * through the SAME function. Hand-written beside the `.mjs` for the reason
 * `scripts/validate/no-cross-repo-coupling.d.mts` is: keep the parser runnable by node with no build
 * step while still being type-checked where a Worker imports it.
 */

export type BookSide = "buy" | "sell";

export interface BookLot {
  asset: string;
  side: BookSide;
  /** The headline size. For a range this is the CEILING — the number that sizes a buyer. */
  size_usd: number | null;
  /** She will not break below this. What disqualifies a buyer who is too small. */
  size_min_usd: number | null;
  size_max_usd: number | null;
  size_shares: number | null;
  /** Her own words for the size, kept verbatim so a reply can quote her back to herself. */
  size_text: string;
  /** The whole line it came from. Evidence, the way every other surface in this repo carries it. */
  source_line: string;
}

export interface UnparsedLine {
  line: string;
  why: string;
}

export interface ParsedBook {
  positions: BookLot[];
  /** Lines that looked like inventory and could not be read. Shown to her, never swallowed. */
  unparsed: UnparsedLine[];
  side: BookSide;
}

export declare const DEFAULT_BOOK_SIDE: BookSide;
export declare function usd(token: string): number | null;
export declare function parseLiveBook(text: string, opts?: { side?: BookSide }): ParsedBook;
export declare function bookFingerprint(positions: readonly Partial<BookLot>[]): string;
export declare function describeLot(lot: Partial<BookLot>): string;
