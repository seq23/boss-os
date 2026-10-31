/**
 * THE TOUGH-LOVE LINE BANK (owner, 31 Oct 2026: "remind me in some clever way that being a A player
 * requires discipline. I need tough love sometimes and reminders to be consistent").
 *
 * Three tiers, one per rung of the lapse ladder (`lapse.ts`): firm at day 2, tough at day 4, a hard
 * truth from day 7. Each email carries ONE of these, chosen by the day, so the same line does not
 * come back two emails running.
 *
 * THE RULES THE BANK IS HELD TO, by `tests/boss/practiceLapse.test.ts`:
 *   - at least 20 lines, at least 6 per tier;
 *   - tough, never cruel: no shaming, no name-calling;
 *   - nothing about body, weight or food, ever (her Spirit and Body rules: gratitude and practice are
 *     never about the body, and a lapse email is not the place a food rule gets enforced);
 *   - no generic hustle clichés ("rise and grind", "no excuses"): the line has to sound like it was
 *     written for her system, not lifted from a poster.
 * `BANNED_WORDS` is the list the test reads; add to it, never take away.
 */

export type LapseTier = "firm" | "tough" | "hard";

export const LINES: Readonly<Record<LapseTier, readonly string[]>> = Object.freeze({
  firm: Object.freeze([
    "A-players are not the ones who never drift. They are the ones who notice by day two.",
    "Discipline is a decision you already made. Today is only the receipt.",
    "The plan did not change. Only your attendance did.",
    "Two quiet days is a pattern starting. One open app ends it.",
    "Momentum is cheap to keep and expensive to restart. Pay the cheap price today.",
    "You do not need motivation. You need the next five minutes.",
    "The version of you who built this system was counting on you to use it.",
    "Day two is where A-players and almost-players part ways.",
  ]),
  tough: Object.freeze([
    "Four days. The system kept showing up. You did not.",
    "Nobody grades a plan they never saw you run.",
    "The deals do not know you are taking a break. Neither does the month.",
    "You built a cockpit and stopped sitting in it.",
    "This is not rest. Rest is chosen. This is drift with a nicer name.",
    "A-players keep the promises they make to themselves first. Four are sitting unkept.",
    "Your standards did not lower themselves. Pick them back up.",
    "Comfort is negotiating with you right now. It does not get a vote.",
  ]),
  hard: Object.freeze([
    "A week. At this point the drift is the plan.",
    "Billion-scale outcomes are built from days exactly like the ones you skipped.",
    "The gap between who you say you are and what the week shows is now a week wide.",
    "Discipline is the bridge between the goal and the money. The bridge has been closed all week.",
    "No one is coming to restart this for you. That was always the deal.",
    "A-player is not a title you hold. It is a thing you do daily, and the daily part stopped.",
    "Every day you are not in the room, somebody else's discipline is compounding.",
    "The hard truth: you already know exactly what to do. You have just not done it.",
  ]),
});

/**
 * Words no line may carry. Body, weight and food are hers to talk about, never ours to use against
 * her; the shaming words are what "never cruel" means in practice; the clichés are what "clever"
 * rules out. Matched as whole words, case-insensitive.
 */
export const BANNED_WORDS: readonly string[] = Object.freeze([
  // body, weight, food
  "keto", "weight", "weigh", "fat", "body", "bodies", "diet", "food", "eat", "eating", "ate", "calorie", "calories",
  "carb", "carbs", "sugar", "pounds", "lbs", "skinny", "thin", "obese", "belly", "waist", "snack",
  // shaming
  "lazy", "pathetic", "worthless", "failure", "loser", "stupid", "disgusting", "ashamed", "shame", "useless", "weak",
  // hustle clichés
  "hustle", "grind", "grinding", "beast", "no excuses", "rise and grind", "no pain", "sleep when", "crush it", "boss babe",
]);
