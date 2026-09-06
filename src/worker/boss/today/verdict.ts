/**
 * THE NIGHT GATE VERDICT — §14, scored against the five floors in §13.
 *
 * §14.2 IS THE WHOLE DESIGN: "Ask what was completed before assigning a verdict. DO NOT GUESS
 * COMPLETION." So nothing here infers a floor from activity in the database. A closed Run of Show
 * block is not evidence she manifested; a logged movement is not evidence she hit ten minutes. The
 * verdict is computed from what SHE reports at the gate, and a floor she does not report is
 * `unknown` — which is neither met nor missed, and is carried into the verdict as the open question
 * it is rather than being rounded to whichever answer is convenient.
 *
 * §13.3 is enforced here too: the flexible items — BP medicine, supplements, skincare, tea — may be
 * recorded and CANNOT create a Miss on their own. They are not in FLOORS, and that absence is the
 * mechanism.
 */

/** §13.1's critical pillars, with §13.2's floors as the words she reads at the gate. */
export const FLOORS = [
  { key: "manifestation", title: "Manifestation", floor: "5 minutes of visualization, minimum, on hard days." },
  { key: "meaningful_work", title: "Meaningful Work", floor: "One concrete asset-advancing action. Brokerage gets right of first refusal." },
  { key: "movement", title: "Movement", floor: "10 minutes, minimum. Bed counts." },
  { key: "hydration", title: "Hydration", floor: "One full Stanley cup, minimum. Two is the target." },
  { key: "diet", title: "Diet Adherence", floor: "Strict keto. No sugar, no off-lane takeout, no rebound spiral." },
] as const;

export type FloorKey = (typeof FLOORS)[number]["key"];
export type FloorState = "met" | "missed" | "unknown";
export type Verdict = "full" | "mvd" | "miss";

export interface VerdictResult {
  verdict: Verdict;
  floors: Record<FloorKey, FloorState>;
  met: FloorKey[];
  missed: FloorKey[];
  unknown: FloorKey[];
  /** A sentence in her own vocabulary. The screen shows this rather than assembling its own. */
  reason: string;
}

function parseFloor(value: unknown): FloorState {
  if (value === true || value === "met") return "met";
  if (value === false || value === "missed") return "missed";
  return "unknown";
}

/**
 * Score the day.
 *
 * THE THREE VERDICTS, IN §14.1's OWN TERMS:
 *   - Full Day: all five at or above floor.
 *   - MVD / Partial: at least one meaningful floor met and continuity preserved.
 *   - Miss: a floor was not met AND continuity broke.
 *
 * WHERE THIS IS DELIBERATELY GENEROUS, AND WHY. A missed floor alone is not a Miss — §14.1 requires
 * that continuity ALSO broke, and Law 5 says zeros are allowed while Law 2 puts continuity above
 * intensity. So a day with one floor met is MVD, not a failure, and the only Miss is a day with
 * nothing met at all. Scoring it the strict way would have made most real days a Miss, and a system
 * that calls a lived day a failure is one she stops opening.
 */
export function scoreDay(reported: Record<string, unknown>): VerdictResult {
  const floors = Object.fromEntries(
    FLOORS.map((f) => [f.key, parseFloor(reported?.[f.key])]),
  ) as Record<FloorKey, FloorState>;

  const met = FLOORS.filter((f) => floors[f.key] === "met").map((f) => f.key);
  const missed = FLOORS.filter((f) => floors[f.key] === "missed").map((f) => f.key);
  const unknown = FLOORS.filter((f) => floors[f.key] === "unknown").map((f) => f.key);

  const label = (keys: FloorKey[]) =>
    keys.map((k) => FLOORS.find((f) => f.key === k)!.title.toLowerCase()).join(", ");

  if (met.length === FLOORS.length) {
    return { verdict: "full", floors, met, missed, unknown, reason: "All five floors met. Full day." };
  }

  if (met.length === 0) {
    /*
     * EVEN HERE IT DOES NOT PRETEND TO KNOW. If nothing was reported met but floors are still
     * unanswered, the day is unscored rather than a Miss — that is §14.2's rule holding at the
     * exact moment it costs something.
     */
    if (unknown.length) {
      return {
        verdict: "mvd", floors, met, missed, unknown,
        reason: `Nothing was reported met and ${label(unknown)} ${unknown.length === 1 ? "was" : "were"} not answered. Continuity is held open rather than scored as a miss.`,
      };
    }
    return {
      verdict: "miss", floors, met, missed, unknown,
      reason: "No floor was met and continuity broke. One miss is data — Law 1 says the next day is the one that matters.",
    };
  }

  return {
    verdict: "mvd", floors, met, missed, unknown,
    reason:
      `${met.length} of ${FLOORS.length} floors met — ${label(met)}. ` +
      (missed.length ? `Below floor: ${label(missed)}. ` : "") +
      (unknown.length ? `Not answered: ${label(unknown)}. ` : "") +
      "Continuity preserved. A minimum viable day is still a day.",
  };
}
