/**
 * HER MORNING MOVEMENT ROUTINE — THE DEFAULT (owner, 2 Nov 2026, "go").
 *
 * Ten minutes, everything every day, no build-up: bed → floor → standing → wall. "Switch it up": on
 * each day 3 or 4 steps swap to their alternate, chosen from the date alone (her Central calendar
 * day), so Today, Spirit and the morning email print the same list for the same day. A swap never
 * adds a step and never changes a step's minute or place, so the total stays 10 minutes.
 *
 * The minimum-viable fallback is steps 1–3: all in bed, about 3 minutes (§6.8: completable without
 * getting out of bed). An alternate keeps its step's place, so a swapped fallback is still in bed.
 *
 * This is the default only. Pure; pinned by tests/morningRoutine.test.ts.
 */

/** [start minute, end minute, place, move, alternate, purpose]. Purpose is one word or pair. */
export const DEFAULT_MORNING_ROUTINE = Object.freeze([
  { from: 0, to: 1, place: "bed", move: "Belly breathing, 4 in / 8 out, humming on the exhale", alt: "Physiological sigh: two short sniffs in, one long sigh out", purpose: "vagus nerve" },
  { from: 1, to: 2, place: "bed", move: "Knee-to-chest, then happy baby", alt: "One knee at a time to the chest, then half happy baby", purpose: "pelvic floor" },
  { from: 2, to: 3, place: "bed", move: "Butterfly, lying down", alt: "Figure-4, lying down", purpose: "hips" },
  { from: 3, to: 4, place: "floor", move: "Cat-cow", alt: "Spine circles on hands and knees", purpose: "spine" },
  { from: 4, to: 5, place: "floor", move: "Child's pose, knees wide", alt: "Gentle frog, resting on the forearms", purpose: "pelvic release" },
  { from: 5, to: 6, place: "floor", move: "90-90 hip switches", alt: "Pigeon", purpose: "hip rotation" },
  { from: 6, to: 7, place: "floor", move: "Slow side-neck stretch, 30 seconds a side", alt: "Thread-the-needle", purpose: "neck" },
  { from: 7, to: 8, place: "standing", move: "Hip circles and rotations", alt: "Leg swings, front-to-back and side-to-side", purpose: "hips" },
  { from: 8, to: 10, place: "wall", move: "Legs up the wall, light taps above the collarbones", alt: null, purpose: "calm finish" },
]);

/** How many opening steps make the hard-day fallback (all in bed). */
export const FALLBACK_STEPS = 3;
export const ROUTINE_MINUTES = 10;

const PLACE_WORDS = { bed: "In bed", floor: "On the floor", standing: "Standing", wall: "At the wall" };

/** A small deterministic hash of the day, so every surface picks the same swaps. */
function seed(ymd) {
  let h = 2166136261;
  for (const ch of String(ymd)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** Her Central calendar day for an instant: "2026-11-02". */
export function centralDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** Minutes into the routine, as a stopwatch reads it: 1 → "1:00". */
const clock = (m) => `${m}:00`;

/**
 * The routine for a day ("YYYY-MM-DD" on her Central calendar): every step, 3–4 of them swapped to
 * their alternate. Each step: `{ n, at, minutes, place, where, move, purpose, swapped, line }`.
 */
export function routineFor(ymd) {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(String(ymd ?? ""))?.[0] ?? centralDay();
  let s = seed(day);
  const next = () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s; };
  const swappable = DEFAULT_MORNING_ROUTINE.map((st, i) => (st.alt ? i : -1)).filter((i) => i >= 0);
  const want = 3 + (next() % 2);
  const pool = [...swappable];
  const swap = new Set();
  while (swap.size < want && pool.length) swap.add(pool.splice(next() % pool.length, 1)[0]);
  return DEFAULT_MORNING_ROUTINE.map((st, i) => {
    const swapped = swap.has(i);
    const move = swapped ? st.alt : st.move;
    const at = `${clock(st.from)}–${clock(st.to)}`;
    return {
      n: i + 1, at, minutes: st.to - st.from, place: st.place, where: PLACE_WORDS[st.place], move, purpose: st.purpose, swapped,
      line: `${at} · ${PLACE_WORDS[st.place]} · ${move} — ${st.purpose}`,
    };
  });
}

/** The hard-day fallback for a day: its first steps, all in bed. */
export function fallbackFor(ymd) {
  return routineFor(ymd).slice(0, FALLBACK_STEPS);
}
