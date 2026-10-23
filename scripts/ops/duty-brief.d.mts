import type { DutyBrief } from "../../src/shared/boss/duties/ownerEdits.mjs";
export function plan(
  result: { ok: true; data: DutyBrief | Record<string, unknown> } | { ok: false; why: string },
  opts?: { onlyIfDue?: boolean },
): { code: number; lines: string[]; instructions: string | null };
