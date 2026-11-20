/**
 * "BUILT FROM SCRATCH TODAY, WOULD IT LOOK LIKE THIS?" (owner ruling, 19 Nov 2026: "would a 20 yr veteran do this?")
 *
 * Every change Danielle plans (a repo change's PLAN phase, an Ahrefs fix) answers the one question of
 * ~/.claude/skills/ship-ready/engineering.md before anything is built:
 *
 *   built_today: { "answer": "yes" | "no", "different": "<what is different, and whether this change does the rebuild
 *                  or names it as a dated Open Loops row>" }
 *
 * "yes" needs one line on why (`different` may say "nothing: …"); "no" needs what is different. A plan without it is a
 * wish, so the runner refuses it before a build (repo-change.mjs) and the Ahrefs report refuses a fix without it
 * (ahrefs-audit-report.mjs). PURE.
 */

/** What is wrong with the answer, or null when it is a real one. */
export function builtTodayProblem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "it has no built_today answer";
  const answer = String(value.answer ?? "").trim().toLowerCase();
  if (answer !== "yes" && answer !== "no") return `built_today.answer is "${String(value.answer ?? "")}", not yes or no`;
  const different = String(value.different ?? "").trim();
  if (different.length < 12) return answer === "no" ? "built_today says no and does not say what is different" : "built_today says yes with no reason";
  return null;
}

/** The answer as one line for the plan and the record. */
export function builtTodayLine(value) {
  return `Built from scratch today, would it look like this? ${String(value.answer).trim().toLowerCase() === "yes" ? "Yes" : "No"}: ${String(value.different).trim()}`;
}
