/** Types for the one domain → repository list (see domainRepos.mjs). */

export interface DomainRepo {
  repo: string | null;
  source: "grid_manifest" | "audited_elsewhere";
  why: string | null;
}

export declare const AUDITED_ELSEWHERE: ReadonlyArray<{ domain: string; repo: string | null; why: string }>;
export declare const DOMAIN_REPOS: ReadonlyMap<string, DomainRepo>;
export declare function repoForDomain(domain: string | null | undefined): DomainRepo | null;
export declare function domainForProject(project: string | null | undefined): string | null;
export declare function domainOfRow(row: { domain?: string | null; project?: string | null } | null | undefined): string | null;
