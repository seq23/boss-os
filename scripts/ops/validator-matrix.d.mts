import type { Matrix, Registry } from "../../src/shared/boss/validators/matrix.mjs";
export function reposOnMac(home?: string): Map<string, string>;
export function readRegistry(dir: string, opts?: { fetch?: boolean }): Registry | null;
export function readMatrix(opts?: { home?: string; reviewsDir?: string; repos?: Map<string, string>; read?: (dir: string) => Registry | null }): Matrix & { files: number; repos_read: number };
