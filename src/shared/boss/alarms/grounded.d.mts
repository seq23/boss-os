/** Types for grounded.mjs: a report says only what was read. */
export interface Claim { kind: "id" | "name" | "task" | "host" | "number"; value: string }
export function claimsIn(text: unknown): Claim[];
export function ungroundedClaims(text: unknown, facts: string | readonly string[] | null | undefined): Claim[];
export function groundedOr<T>(text: unknown, facts: string | readonly string[] | null | undefined, fallback: T): string | T;
