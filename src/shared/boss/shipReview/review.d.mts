import type { JobClass, RouteTier } from "../aiRoles.mjs";
export type ShipKind = "page" | "email" | "video" | "profile" | "images";
export interface Shot { path?: string; label: string }
export interface Finding { where: string; what: string; feels: string }
export declare const KINDS: readonly ShipKind[];
export declare const HOW_SEEN: Readonly<Record<ShipKind, string>>;
export declare function passLine(a: { reviewer: string; lookedAt: string; launch?: boolean }): string;
export declare const PASS_LINE_RE: RegExp;
export declare function reviewRoutes(a: { firstOfKind: boolean; privateWork: boolean }): { jobClass: JobClass; routes: RouteTier[]; end: string };
export declare function reviewId(now?: number, rand?: () => number): string;
export declare function lookedAtText(a: { kind: ShipKind; target: string; shots: Shot[] }): string;
export type Surface = "public-page" | "operator-doc" | "email" | "app-screen" | "video" | "social-profile";
export declare const SURFACES: Readonly<Record<Surface, string>>;
export declare const DEFAULT_SURFACE: Readonly<Record<ShipKind, Surface>>;
export declare function reviewPrompt(a: { kind: ShipKind; target: string; builder: string; checklist: string; brand?: string | null; facts?: string[]; shots: Shot[]; launch?: boolean; imageHow?: string; surface?: string | null; planned?: string[]; brief?: string | null; change?: string | null }): string;
export declare function lastJson(text: string): Record<string, unknown> | null;
export declare function parseVerdict(text: string, shots: Shot[], o?: { scoped?: boolean }): { verdict: "PASS" | "FAIL" | "UNSEEN"; findings: Finding[]; already: Finding[]; unseen: string[]; error?: undefined } | { error: string; verdict?: undefined; findings?: undefined; already?: undefined; unseen?: undefined };
export declare function findingLines(findings: Finding[]): string[];
export declare const EMAIL_SENDS: (row: { runs?: string }) => boolean;
export declare const SOCIAL_POSTS: (row: { status?: string }) => boolean;
export declare function gateProblems(rows: Array<{ id: string; ship_ready?: { pass?: string; review?: string } } & Record<string, unknown>>, o: { live: (r: any) => boolean; liveBefore: readonly string[]; launch?: boolean; map: string }): string[];
