/** Types for the SECRET-line door's pure half (R3). See secretLines.mjs. */
export interface SecretLinesRead {
  found: Array<{ name: string; value: string }>;
  refused: Array<{ name: string; why: string }>;
  scrubbed: string;
  values: string[];
}
export declare const SECRET_REDACTED: string;
export declare const SECRET_HANDOFF_KEY_NAME: string;
export declare const RESERVED_SECRET_NAMES: ReadonlySet<string>;
export declare const RESERVED_SECRET_PREFIXES: readonly string[];
export declare function secretNameProblem(name: string): string | null;
export declare function readSecretLines(text: string): SecretLinesRead;
export declare function nothingButSecrets(scrubbedWritten: string): boolean;
export declare function scrubSecretValues(raw: string, values: readonly string[], marker?: string): string;
export declare function carriesSecretValue(raw: string, values: readonly string[]): boolean;
export declare function secretDoorLine(
  stored: ReadonlyArray<{ name: string; repo: string | null }>,
  refused: ReadonlyArray<{ name: string; why: string }>,
): string;
