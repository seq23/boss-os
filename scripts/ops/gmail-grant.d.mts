export const READONLY: string;
export const SIGN_IN_TIMEOUT_MS: number;
export class GrantStop extends Error { code: string; constructor(code: string, message: string); }
export function pickClient(env?: Record<string, string | undefined>): { id: string; secret: string; source: string };
export function ownerAddress(env?: Record<string, string | undefined>): string;
export function authUrl(opts: { clientId: string; redirectUri: string; state: string; challenge: string; hint?: string }): string;
export function waitForCode(opts: { state: string; timeoutMs?: number; onListening?: (redirectUri: string, server: import("node:http").Server) => unknown }): Promise<{ code: string; redirectUri: string }>;
export function exchangeCode(opts: { fetchImpl?: typeof fetch; client: { id: string; secret: string }; code: string; verifier: string; redirectUri: string }): Promise<{ access: string; refresh: string }>;
export function grantedAddress(opts: { fetchImpl?: typeof fetch; access: string }): Promise<string>;
export function vaultSetMany(map: Record<string, string>, opts?: { vault?: string; env?: Record<string, string | undefined> }): Promise<void>;
export function runGrant(opts?: {
  env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; openBrowser?: (url: string) => Promise<unknown>;
  save?: (map: Record<string, string>) => Promise<unknown>; say?: (line: string) => void; timeoutMs?: number;
}): Promise<{ saved: string[] }>;
