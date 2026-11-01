export type Kind = "safety" | "behaviour" | "central-seo";
export interface MatrixRow {
  repo: string; name: string; key: string; protects: string; why: string; kind: Kind; runs: string | null;
  listed?: boolean | null; also?: string[];
}
export interface Review { repo: string | null; rows: MatrixRow[]; problems: string[] }
export interface Registry { entries: { key: string; name: string; where: string }[]; known: Set<string> }
export interface Matrix {
  rows: MatrixRow[]; repos: string[];
  unlisted: { repo: string; name: string }[]; unmatrixed: { repo: string; name: string }[];
  unread: string[]; not_imported: string[];
  duplicates: { key: string; repos: string[] }[]; problems: string[];
  at?: number;
}
export const KINDS: readonly Kind[];
export const KIND_WORDS: Readonly<Record<Kind, string>>;
export const REVIEW_FILE: RegExp;
export function keyOf(name: string): string;
export function runsWords(runs: string | null | undefined): string;
export function parseReviewFile(fileName: string, json: unknown): Review;
export function registryFrom(input?: { scripts?: string[] | Record<string, string>; files?: string[]; steps?: string[] }): Registry;
export function buildMatrix(input?: { reviews?: Review[]; registries?: Record<string, Registry | null>; otherRepos?: string[] }): Matrix;
export function matrixFlagWords(m: Matrix | null | undefined): string | null;
export function matrixSummary(m: Matrix): string;
export function snapshotProblems(s: unknown): string[];
