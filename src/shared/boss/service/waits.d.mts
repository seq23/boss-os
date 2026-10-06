/** Types for the three-part waits (R6–R10, R20). See waits.mjs. */
export interface BossWait { waiting: string; why: string; clear: string; selfClearing?: boolean; inBossOs?: boolean }
export interface BossWaitFill {
  what?: string | null; why?: string | null; searched?: string | null; at?: string | null;
  record?: { host: string; type: string; name: string; target: string; txtName?: string | null; txtValue?: string | null; liveAt?: string | null } | null;
}
export type BossWaitKind =
  | "PLAN_APPROVAL" | "PREVIEW_APPROVAL" | "HELD_BY_YOU" | "WHICH_ONE" | "QUESTION_NOT_A_JOB" | "MISSING_SECRET"
  | "MAC_ASLEEP" | "SEAT_RESET" | "DNS_RECORD" | "DRIVE_EMPTY" | "TRIED_AND_STOPPED" | "TIER2_DECISION";
export declare const BOSS_WAITS: Record<BossWaitKind, (f: BossWaitFill) => BossWait>;
export declare const BOSS_WAIT_KINDS: BossWaitKind[];
export declare function bossWait(kind: BossWaitKind, fill?: BossWaitFill): BossWait;
export declare function waitDetail(kind: BossWaitKind, fill?: BossWaitFill): string;
export declare function threeParts(w: { waiting: string; why: string; clear: string }): string;
export declare function waitBullets(kind: BossWaitKind, fill?: BossWaitFill): string[];
export declare const WAIT_SHAPE: RegExp;
export declare function missingSecretLine(name: string, vendorUrl?: string | null, searched?: string | null): string;
export declare const WAIT_TEXT_FORBIDDEN: readonly RegExp[];
export declare function taskTokenIn(text: string | null | undefined): string | null;
export declare function taskToken(id: string): string;
export declare function blockReplyDoor(text: string | null | undefined): "RETRY" | "DROP" | "ANSWER";
