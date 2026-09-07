/**
 * WHAT A TRANSIT MEANS, COMPOSED FROM PARTS RATHER THAN WRITTEN OUT.
 *
 * Ten transiting bodies against twelve natal points across five aspects is six hundred sentences.
 * Nobody writes six hundred sentences well, and a table that large goes stale in one place and stays
 * right in the others. So the meaning is built the way the gratitude sentence is: twenty-seven
 * pieces of text — what the moving body brings, what the natal point is, and what the angle does —
 * assembled into one line.
 *
 * NO MODEL, AND NOTHING LEAVES. Same reasoning as the gratitude composer: this is her chart, spirit
 * is sovereign on both axes, and the interpretation is standard material that needs no inference.
 * A cloud model would also have been shown less than this function can see.
 *
 * §5.2 IS THE HARD CONSTRAINT ON EVERY STRING HERE. "Reality has priority. Nothing on this screen is
 * a reason to act or not act." So every line describes WEATHER, never instruction: "attention lands
 * on" rather than "today is a good day to", and no line promises an outcome. Her §1.5 anti-delusion
 * rules forbid the system treating a sky position as a cause, and copy is where that rule is most
 * easily broken.
 */

/**
 * What the moving body brings.
 *
 * NOUN PHRASES, AND NO DURATION IN HERE. The first draft wrote the Moon as "passing mood and
 * attention — hours, not days", which composed into "...hours, not days meets your identity" and
 * then said "Lasts a few hours" one clause later. Duration belongs to DURATION, and each piece of
 * the sentence has to survive being read next to the other two.
 */
export const TRANSIT_BODY: Record<string, string> = {
  moon: "passing mood and attention",
  sun: "where this month's light is falling",
  mercury: "talking, writing, deciding, moving information",
  venus: "money, taste, and what you are drawn to",
  mars: "drive and friction, and the appetite for a fight",
  jupiter: "expansion, and appetite for more of whatever it touches",
  saturn: "limits, consolidation, and the bill for shortcuts",
  uranus: "disruption and the sudden change of mind",
  neptune: "blur, where inspiration and self-deception wear the same coat",
  pluto: "slow pressure that does not negotiate",
  chiron: "the old sore spot, and the competence built out of it",
};

/** What it is touching in her chart. */
export const NATAL_POINT: Record<string, string> = {
  sun: "your identity and what you are for",
  moon: "your inner weather and what actually settles you",
  mercury: "how you think and say things",
  venus: "what you value and how money comes to you",
  mars: "how you push, and what you push against",
  jupiter: "your growth, luck and appetite for scale",
  saturn: "your discipline and where you carry weight",
  uranus: "your independence and your break points",
  neptune: "your imagination and your blind spot",
  pluto: "your power and what you refuse to be small about",
  chiron: "your old wound and what you can teach from it",
  node: "the direction you are supposed to be walking",
  lilith: "what you will not apologise for",
  ascendant: "how you arrive in a room",
  midheaven: "your work and how it is seen",
  // The Lot of Fortune exists only because the birth time is exact, and it is transited like any
  // other point — so it needs a line, or the composer silently falls back to the raw key and emits
  // "meets fortune". The vocabulary test caught this on its first run.
  fortune: "where things tend to come together for you materially",
};

/** What the angle does. Never a verdict — a texture. */
export const ASPECT_TONE: Record<string, string> = {
  conjunction: "fused — this is loud, and it is the whole point of the day",
  sextile: "available, but only if you reach for it",
  square: "friction; it wants a decision rather than patience",
  trine: "easy, and easy things are the ones that get wasted",
  opposition: "pulling both ways — usually a negotiation with someone else",
};

/**
 * ORBS BY SPEED, because one orb for everything is wrong twice.
 *
 * The Moon moves thirteen degrees a day, so a wide orb keeps it "in aspect" for most of the week
 * and it stops meaning anything. Pluto moves a degree and a half a YEAR, so a tight orb makes a
 * two-year transit invisible on all but a handful of days. These are the standard working numbers,
 * chosen so the fast bodies read as hours and the slow ones as seasons.
 */
export const ORB: Record<string, number> = {
  moon: 3, sun: 2, mercury: 2, venus: 2, mars: 2,
  jupiter: 2, saturn: 2, uranus: 1.5, neptune: 1.5, pluto: 1.5, chiron: 1.5,
};

/** Roughly how long this body stays inside its orb — so a line reads as hours or as months. */
export const DURATION: Record<string, string> = {
  moon: "a few hours", sun: "a couple of days", mercury: "a day or two",
  venus: "a day or two", mars: "several days", jupiter: "a couple of weeks",
  saturn: "weeks", uranus: "months", neptune: "months", pluto: "months",
  chiron: "weeks",
};

/**
 * One transit, in a sentence.
 *
 * WHAT IT DOES NOT DO IS PREDICT. The owner's example was "if the moon crosses my natal Jupiter, is
 * that a good time to receive money?" — and the honest answer this produces is that attention lands
 * on her growth-and-appetite placement for a few hours, not that money arrives. Writing the second
 * version would be the system treating a sky position as a cause, which §1.5 forbids by name and
 * which would also just be false.
 */
export function meaningFor(body: string, point: string, aspect: string): string {
  const b = TRANSIT_BODY[body] ?? body;
  const p = NATAL_POINT[point] ?? point;
  const tone = ASPECT_TONE[aspect] ?? aspect;
  const howLong = DURATION[body] ?? "a while";
  return `${cap(b)} meets ${p}. ${cap(tone)}. Lasts ${howLong}.`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The line that has to sit under every one of these.
 *
 * Canon §5.2 in her own framing, repeated on the transit panel rather than only at the top of the
 * page — a reader scrolling to "Mars square your natal Sun" should not have to remember a caveat
 * from four sections earlier.
 */
export const TRANSIT_CAVEAT =
  "This is weather, not instruction. Nothing here is a reason to do or not do anything, and no " +
  "aspect predicts an outcome — canon §5.2 puts reality first and the sky second, always.";
