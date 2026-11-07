export type RepoCategory = "mine" | "friends" | "system";
export type RepoCategories = { mine: string[]; friends: string[]; system: string[]; parked?: string[]; problem?: undefined } | { problem: string; mine?: undefined; friends?: undefined; system?: undefined };
export const CATEGORIES: readonly RepoCategory[];
export function parseRepoCategories(md: string | null | undefined): RepoCategories;
export function categoryOf(repo: string | null | undefined, cats: RepoCategories | null | undefined): RepoCategory | null;
export function isParkedRepo(repo: string | null | undefined, cats: RepoCategories | null | undefined): boolean;
