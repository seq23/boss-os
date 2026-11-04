import type { CatchUpPlan } from "../../src/shared/boss/mail/morningSections.d.mts";
export function weekdayIn(tz: string, now?: number): string;
export function attemptedNames(missingBefore: Array<{ name: string; label: string }> | null | undefined, plan: CatchUpPlan): string[];
export function catchUpOutcome(opts: {
  missingBefore: Array<{ name: string; label: string }> | null | undefined;
  missingAfter: Array<{ name: string; label: string }> | null | undefined;
  plan: CatchUpPlan;
}): { stop: "MORNING_CATCHUP_STILL_MISSING" | null; names: string[]; reRun: number; stillMissing: number };

export function expectedSections(weekday: string, specs?: ReadonlyArray<{ expect: readonly string[] | null }>): number;
