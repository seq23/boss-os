/** Types for ownerApproval.mjs: which repairs on an `owner_approval` site wait for her yes. */
export function directRepairPaths(site: any): string[];
export function pagesIn(site: any, texts: unknown[]): string[];
export function isDirectRepairPath(site: any, path: string): boolean;
export function heldForOwner(site: any, opts?: { approved?: boolean; texts?: unknown[] }): boolean;
