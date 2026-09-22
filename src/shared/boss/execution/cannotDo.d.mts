export interface CannotDoFinding {
  /** The exact words the model used, whitespace collapsed. */
  matched: string;
  /** Plain language: which kind of incapacity it admitted to. */
  why: string;
  /** Where in the trimmed reply the admission begins. */
  at: number;
  /** How long the whole trimmed reply was. */
  chars: number;
}

export declare const OPENING_CHARS: number;
export declare const NON_ANSWER_MAX_CHARS: number;
export declare const CANNOT_DO_RULES: ReadonlyArray<{ why: string; re: RegExp }>;

export declare function cannotDoIn(text: string | null | undefined): CannotDoFinding | null;
export declare function cannotDoSummary(employeeName: string | null | undefined, finding: CannotDoFinding): string;
export declare function cannotDoHint(handedTo: string | null | undefined): string;
