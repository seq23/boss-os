export const VAULT_MANIFEST: string;
export const HANDED_OFF_NAMES: string;
export function vaultNames(manifestPath?: string): Set<string>;
export function vendorPrefixOf(name: string): string;
export function vaultLookup(wanted: string[], names?: Set<string>): { searched: string[]; found: string[]; by_vendor: Record<string, string[]>; missing: string[]; allowed: string[] };
export function envForRepoRun(base: Record<string, string | undefined>, allowed: string[], known?: Set<string>): Record<string, string | undefined>;
export function rememberHandedOff(names: string[], path?: string): string[];
export function handedOffNames(path?: string): Set<string>;
export const FUND_TEAM_KEYS: readonly string[];
export function isWestPeekKey(name: string): boolean;
export function bossOsProcessEnv<T extends Record<string, unknown>>(env: T): Partial<T>;
export function isCloudRun(env?: Record<string, string | undefined>, plat?: string): boolean;
/** What sync:cloudflare uploads, skips (optional and absent) or refuses on (mapped and absent). */
export function syncPlan(
  mapping: { secret_names?: string[]; optional_secret_names?: string[] },
  held: Record<string, unknown>,
): { upload: string[]; skipped: string[]; missing: string[]; strayOptional: string[] };
/** set-many's stdin: one JSON object of NAME → non-empty text, all checked before anything is written. */
export function parseSecretMap(text: string): Record<string, string>;
