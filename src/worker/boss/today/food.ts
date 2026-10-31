import type { Env } from "../env";
import { getSettings, setSetting } from "../lib/settings";
import { daysBetween } from "../practice/lapse";

/**
 * THE FOOD GUARDRAIL CHECK (15:00 row): A KETO ORDER AT A RESTAURANT, NEW EVERY DAY (owner, Today v4,
 * 31 Oct 2026).
 *
 * She does not cook, so it is NEVER a recipe: it names a place and exactly what to say when she
 * orders (what to swap, what to leave off), with approximate net carbs. Places rotate between national
 * chains she can get anywhere and local places where she is that day:
 *
 *   where she is   1. "where I am until <date>" (settings `food_away_city` + `food_away_until`), while
 *                     today is on or before that date;
 *                  2. a city named in today's calendar (diary title or location);
 *                  3. her home city (`food_home_city`, editable on the row);
 *                  4. none set: chains only.
 *   no repeats     a place shown in the last `NO_REPEAT_DAYS` days is not shown again (`food_orders`);
 *                  when every place has been used, the one used longest ago comes back.
 *   never empty    the hand-written lists below always answer. A $0 lane may ADD local places for a
 *                  city that has no list (`generateLocalPlaces`, free routes only); it never replaces
 *                  the list and never runs on a paid route.
 *
 * FOOD STAYS ON THIS ROW. Gratitude, coaching and the practice emails never mention it (pinned by
 * tests/boss/todayV4.test.ts against `practice/lines.ts` BANNED_WORDS).
 */

export const NO_REPEAT_DAYS = 60;
export const HOME_CITY_KEY = "food_home_city";
export const AWAY_CITY_KEY = "food_away_city";
export const AWAY_UNTIL_KEY = "food_away_until";

export interface FoodPlace { place: string; order: string; carbs: number; why: string; city?: string }

/** National chains: anywhere, any day. Net carbs are approximate, for the order as written. */
export const CHAINS: readonly FoodPlace[] = [
  { place: "Chipotle", order: "Burrito bowl, no rice, no beans. Double chicken, fajita veggies, cheese, sour cream, guacamole, lettuce", carbs: 10, why: "Protein and fat with the rice and beans left off; the guacamole keeps you full." },
  { place: "Chick-fil-A", order: "12-count grilled nuggets with Garden Herb Ranch, and a side salad with no croutons or crispy toppings", carbs: 6, why: "Grilled, not breaded, and ranch instead of the sweet sauces." },
  { place: "Five Guys", order: "Bacon cheeseburger as a lettuce wrap, no bun. Grilled onions, mushrooms, pickles, mustard; no ketchup, no fries", carbs: 6, why: "The bun and the fries are where the carbs are; the rest is free." },
  { place: "Starbucks", order: "Bacon & Gruyère egg bites, and an Americano or black coffee with a splash of heavy cream; no syrups", carbs: 9, why: "Eggs and cheese, and coffee without the sugar." },
  { place: "Subway", order: "Rotisserie chicken or steak as a No Bread Bowl: cheese, lettuce, spinach, cucumbers, peppers, olives, oil and vinegar; no sweet onion sauce", carbs: 8, why: "Same sandwich, no bread, and a dressing with no sugar." },
  { place: "Jersey Mike's", order: "#13 Original Italian \"in a tub\" (no bread), Mike's Way with oil and vinegar", carbs: 6, why: "The tub is the sandwich without the roll." },
  { place: "Outback Steakhouse", order: "6 oz Victoria's Filet with steamed broccoli instead of the potato, and a Caesar salad with no croutons; skip the bread", carbs: 8, why: "Steak and greens; the swap takes out the potato." },
  { place: "Texas Roadhouse", order: "6 oz sirloin, a house salad with ranch and no croutons, and steamed broccoli; send the rolls back", carbs: 7, why: "The rolls are the trap here; the steak is safe." },
  { place: "Olive Garden", order: "Herb-grilled salmon with broccoli; salad with Italian dressing and no croutons; no breadsticks", carbs: 8, why: "Fish and greens, no pasta, no breadsticks." },
  { place: "The Cheesecake Factory", order: "Grilled salmon with fresh asparagus instead of the mashed potatoes; no bread basket", carbs: 6, why: "One clean plate; ask for the swap when you order." },
  { place: "Wingstop", order: "10 classic (bone-in) wings in Lemon Pepper or Original Hot, ranch and celery; no fries", carbs: 4, why: "Classic wings are not breaded; dry rubs and hot sauce have almost no sugar." },
  { place: "Buffalo Wild Wings", order: "Traditional wings with Desert Heat dry rub or Buffalo sauce, celery and blue cheese; no fries", carbs: 4, why: "Traditional wings, not boneless, and a sauce without honey or teriyaki." },
  { place: "Chili's", order: "6 oz Classic Sirloin with steamed broccoli and a side salad instead of fries and corn", carbs: 8, why: "Steak and greens with both starches swapped out." },
  { place: "Red Lobster", order: "Wood-grilled salmon or shrimp skewers with broccoli and a Caesar with no croutons; no Cheddar Bay Biscuits", carbs: 7, why: "Grilled seafood; the biscuits are the only hard part." },
  { place: "Shake Shack", order: "Double ShackBurger lettuce-wrapped, no bun; no fries, no shake", carbs: 5, why: "Two patties and cheese in lettuce." },
  { place: "Burger King", order: "Whopper with cheese, no bun, no ketchup", carbs: 7, why: "Without the bun and ketchup it is meat, cheese and vegetables." },
  { place: "McDonald's", order: "Two Quarter Pounder with Cheese, no bun and no ketchup (ask for them in a platter)", carbs: 5, why: "The patties and cheese are fine; the bun and ketchup are the carbs." },
  { place: "Cava", order: "Greens bowl (no grains): grilled chicken, tzatziki, feta, cucumber, tomato and onion, kalamata olives, lemon herb tahini; no pita", carbs: 10, why: "All greens, protein and fat; skip the grains and pita." },
  { place: "Sweetgreen", order: "Build your own: arugula and spinach, roasted chicken, avocado, cucumber, parmesan crisps, Caesar dressing; no grains", carbs: 9, why: "A real salad with fat in it, not a grain bowl." },
  { place: "Panera Bread", order: "Greek salad with chicken, no croutons, no bread on the side", carbs: 10, why: "Greens, feta, olives and chicken; say no to the bread." },
  { place: "Taco Bell", order: "Power Menu Bowl with steak, no rice, no beans, extra lettuce and guacamole", carbs: 8, why: "The bowl without rice and beans is meat, cheese and vegetables." },
  { place: "Qdoba", order: "Bowl with no rice and no beans: double chicken, fajita veggies, queso, pico, sour cream, guacamole, lettuce", carbs: 10, why: "The same swap as Chipotle." },
  { place: "LongHorn Steakhouse", order: "Flo's Filet with fresh steamed asparagus; skip the bread", carbs: 4, why: "Filet and asparagus is about as clean as a restaurant gets." },
  { place: "Waffle House", order: "Two eggs, bacon or sausage, and a side of sliced tomatoes; no toast, no hashbrowns", carbs: 4, why: "Breakfast without the bread and potatoes." },
  { place: "Panda Express", order: "Grilled Teriyaki Chicken with the sauce left off, over Super Greens instead of rice or noodles", carbs: 12, why: "Grilled chicken and greens; the sauce and the rice are the sugar." },
];

/** Local places she can walk into, by city. Hand-written; a $0 lane may add more (food_places). */
export const LOCAL: Readonly<Record<string, readonly FoodPlace[]>> = {
  "new york": [
    { place: "Keens Steakhouse", order: "Prime sirloin with creamed spinach; no potatoes, no bread", carbs: 8, why: "A steakhouse plate with the starch left off." },
    { place: "Katz's Delicatessen", order: "Pastrami platter: hand-cut pastrami without the rye, with pickles and mustard", carbs: 3, why: "All of Katz's without the bread." },
    { place: "The Halal Guys", order: "Chicken and gyro platter on lettuce instead of rice and pita, white sauce and a little hot sauce", carbs: 8, why: "The platter on lettuce keeps the protein and the sauce." },
    { place: "Balthazar", order: "Steak frites with a green salad instead of the frites; no bread basket", carbs: 6, why: "Steak and salad, French-style." },
    { place: "Smith & Wollensky", order: "Filet mignon with sautéed spinach; no hash browns", carbs: 5, why: "A clean steakhouse order." },
    { place: "Gallaghers Steakhouse", order: "NY strip with creamed spinach and a wedge salad; no potatoes", carbs: 8, why: "Steak, spinach and a wedge." },
    { place: "Sarabeth's", order: "Omelette with goat cheese and spinach, a side salad instead of potatoes; no toast", carbs: 5, why: "Brunch without the bread and potatoes." },
    { place: "Sugarfish", order: "Sashimi only, no rice: tuna, yellowtail and salmon", carbs: 3, why: "The fish without the rice." },
    { place: "Peter Luger", order: "Steak for one with creamed spinach and sliced tomatoes; no German potatoes, no steak sauce", carbs: 9, why: "The sauce is sweet; the steak is not." },
    { place: "Pastis", order: "Roast chicken with haricots verts; no frites, no bread", carbs: 6, why: "Protein and green beans." },
  ],
  memphis: [
    { place: "Central BBQ", order: "Pulled pork plate, no bun and no sauce (dry rub on the side), with a side salad", carbs: 6, why: "Dry rub instead of sauce, and no bun." },
    { place: "The Rendezvous", order: "Dry-rub ribs with no sauce; skip the beans and slaw", carbs: 6, why: "Memphis dry rub, not sweet sauce." },
    { place: "Corky's BBQ", order: "Dry ribs, no sauce, with a side salad instead of beans and slaw", carbs: 5, why: "Ask for dry; the sauce is the sugar." },
    { place: "Folk's Folly", order: "Filet with sautéed spinach; no potato, no bread", carbs: 6, why: "A steak dinner with the starch left off." },
    { place: "Char Restaurant", order: "Hand-cut steak with grilled asparagus; no potatoes, no rolls", carbs: 6, why: "Steak and asparagus." },
    { place: "Huey's", order: "Burger with no bun (on a plate), cheese, lettuce, tomato; a side salad instead of fries", carbs: 6, why: "The burger on a plate with a salad." },
  ],
};

export const cityKey = (city: string | null | undefined): string | null => {
  const c = String(city ?? "").toLowerCase().split(",")[0]!.trim().replace(/\s+city$/, "").replace(/^nyc$/, "new york");
  return c || null;
};

const CALENDAR_CITIES = ["New York", "NYC", "Memphis", "Chicago", "Los Angeles", "Dallas", "Houston", "Atlanta", "Nashville", "Miami", "San Francisco", "Washington", "Boston", "Austin", "Las Vegas"];

/** Pure: a city named in a calendar line, or null. */
export function cityFromCalendar(lines: string[]): string | null {
  for (const l of lines) for (const c of CALENDAR_CITIES) if (new RegExp(`\\b${c}\\b`, "i").test(l)) return c === "NYC" ? "New York" : c;
  return null;
}

export interface FoodWhere { city: string | null; source: "away" | "calendar" | "home" | "none"; home: string | null; away: string | null; away_until: string | null }

/** Pure: where she is today, by the rule at the top. */
export function whereToday(today: string, s: { home?: string | null; away?: string | null; awayUntil?: string | null }, calendarCity: string | null): FoodWhere {
  const base = { home: s.home || null, away: s.away || null, away_until: s.awayUntil || null };
  if (s.away && s.awayUntil && today <= s.awayUntil) return { ...base, city: s.away, source: "away" };
  if (calendarCity) return { ...base, city: calendarCity, source: "calendar" };
  if (s.home) return { ...base, city: s.home, source: "home" };
  return { ...base, city: null, source: "none" };
}

export const placeKey = (p: FoodPlace) => `${p.place.toLowerCase()}${p.city ? `|${cityKey(p.city)}` : ""}`;

/**
 * Pure: the next place. Local and chain alternate by day (local on even days, when there is a city);
 * "Another place" flips to the other kind first. Never a place used inside `NO_REPEAT_DAYS`; when every
 * candidate has been used, the one used longest ago.
 */
export function choosePlace(opts: {
  today: string; local: FoodPlace[]; chains: readonly FoodPlace[];
  lastUsed: Record<string, string>; shownToday: string[]; preferLocal: boolean;
}): FoodPlace {
  const { today, lastUsed, shownToday } = opts;
  const order = opts.preferLocal && opts.local.length ? [opts.local, [...opts.chains]] : [[...opts.chains], opts.local];
  const dayN = Math.round(Date.parse(`${today}T12:00:00Z`) / 86_400_000);
  const fresh = (p: FoodPlace) => {
    const k = placeKey(p);
    if (shownToday.includes(k)) return false;
    const d = lastUsed[k];
    return !d || daysBetween(d, today) >= NO_REPEAT_DAYS;
  };
  for (const pool of order) {
    const free = pool.filter(fresh);
    if (free.length) return free[dayN % free.length]!;
  }
  const all = [...opts.local, ...opts.chains].filter((p) => !shownToday.includes(placeKey(p)));
  const pick = (all.length ? all : [...opts.chains]).sort((a, b) => (lastUsed[placeKey(a)] ?? "").localeCompare(lastUsed[placeKey(b)] ?? ""))[0]!;
  return pick;
}

export interface FoodToday { place: string; order: string; carbs: number; why: string; local: boolean; where: FoodWhere }

async function readWhere(env: Env, today: string): Promise<FoodWhere> {
  const s = await getSettings(env.DB, [HOME_CITY_KEY, AWAY_CITY_KEY, AWAY_UNTIL_KEY]).catch(() => ({} as Record<string, string>));
  const dayStart = Date.parse(`${today}T05:00:00Z`);
  const cal = await env.DB.prepare(`SELECT title, location FROM diary_entries WHERE cancelled_at IS NULL AND scheduled_at >= ? AND scheduled_at < ?`)
    .bind(dayStart, dayStart + 86_400_000).all<{ title: string; location: string | null }>().catch(() => ({ results: [] as { title: string; location: string | null }[] }));
  const lines = (cal.results ?? []).flatMap((r) => [r.title, r.location ?? ""]);
  return whereToday(today, { home: s[HOME_CITY_KEY], away: s[AWAY_CITY_KEY], awayUntil: s[AWAY_UNTIL_KEY] }, cityFromCalendar(lines));
}

async function localFor(env: Env, city: string | null): Promise<FoodPlace[]> {
  const k = cityKey(city);
  if (!k) return [];
  const listed = (LOCAL[k] ?? []).map((p) => ({ ...p, city: city! }));
  const added = await env.DB.prepare(`SELECT place, order_text, net_carbs, why, city FROM food_places WHERE lower(city) = ?`).bind(k)
    .all<{ place: string; order_text: string; net_carbs: number; why: string | null; city: string }>().catch(() => ({ results: [] as any[] }));
  return [...listed, ...(added.results ?? []).map((r: any) => ({ place: r.place, order: r.order_text, carbs: r.net_carbs, why: r.why ?? "", city: city! }))];
}

/** Today's order; `another` swaps it for a different place (kept, so it does not come back for 60 days). */
export async function foodToday(env: Env, today: string, opts: { another?: boolean; now?: number } = {}): Promise<FoodToday> {
  const now = opts.now ?? Date.now();
  const where = await readWhere(env, today);
  const shownR = await env.DB.prepare(`SELECT place_key, place, city, order_text, net_carbs, why FROM food_orders WHERE day = ? ORDER BY created_at DESC`).bind(today)
    .all<{ place_key: string; place: string; city: string | null; order_text: string; net_carbs: number; why: string | null }>().catch(() => ({ results: [] as any[] }));
  const shown = shownR.results ?? [];
  const current = shown[0];
  // A kept order still stands when she is somewhere it is not (a city she set after it was chosen).
  const stillFits = current && (!current.city || cityKey(current.city) === cityKey(where.city));
  if (current && stillFits && !opts.another) {
    return { place: current.place, order: current.order_text, carbs: current.net_carbs, why: current.why ?? "", local: Boolean(current.city), where };
  }
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - NO_REPEAT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const used = await env.DB.prepare(`SELECT place_key, MAX(day) AS d FROM food_orders WHERE day >= ? AND day < ? GROUP BY place_key`).bind(since, today)
    .all<{ place_key: string; d: string }>().catch(() => ({ results: [] as { place_key: string; d: string }[] }));
  const lastUsed = Object.fromEntries((used.results ?? []).map((r) => [r.place_key, r.d]));
  const local = await localFor(env, where.city);
  const dayN = Math.round(Date.parse(`${today}T12:00:00Z`) / 86_400_000);
  const preferLocal = opts.another && current ? !current.city : dayN % 2 === 0;
  const p = choosePlace({ today, local, chains: CHAINS, lastUsed, shownToday: shown.map((s) => s.place_key), preferLocal });
  await env.DB.prepare(`INSERT INTO food_orders (day, place_key, place, city, order_text, net_carbs, why, source, created_at) VALUES (?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(day, place_key) DO UPDATE SET created_at = excluded.created_at`)
    .bind(today, placeKey(p), p.place, p.city ?? null, p.order, p.carbs, p.why, LOCAL[cityKey(p.city) ?? ""]?.some((x) => x.place === p.place) || !p.city ? "list" : "free_lane", now).run();
  return { place: p.place, order: p.order, carbs: p.carbs, why: p.why, local: Boolean(p.city), where };
}

/** Words a restaurant order never contains: it is never a recipe. */
const RECIPE_RE = /\b(recipe|cook|bake|preheat|oven|stir|simmer|boil|whisk|chop|marinate|skillet|tbsp|tsp)\b/i;

/** Pure: is a generated place usable? A real order, keto-sized, never a recipe. */
export function usablePlace(p: any): FoodPlace | null {
  const place = String(p?.place ?? "").trim().slice(0, 60);
  const order = String(p?.order ?? "").trim().slice(0, 240);
  const carbs = Math.round(Number(p?.net_carbs ?? p?.carbs));
  if (!place || !order || !Number.isFinite(carbs) || carbs < 0 || carbs > 20) return null;
  if (RECIPE_RE.test(order) || RECIPE_RE.test(String(p?.why ?? ""))) return null;
  return { place, order, carbs, why: String(p?.why ?? "").trim().slice(0, 160) };
}

/**
 * Local places for a city with no hand-written list, from a $0 route only (`freeOnly`): routine work.
 * Best effort: a refusal or a bad answer changes nothing, and the chains still answer.
 */
export async function generateLocalPlaces(env: Env, city: string, today: string): Promise<number> {
  const k = cityKey(city);
  if (!k || LOCAL[k]) return 0;
  const tried = `food_places_tried:${k}`;
  const done = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind(tried).first<{ value: string }>().catch(() => null);
  if (done?.value === today) return 0;
  await setSetting(env.DB, tried, today).catch(() => undefined);
  const { routeCompletion } = await import("../router");
  try {
    const r = await routeCompletion(env, {
      routeId: "rt_ops_default", lane: "ops", intakeKind: "drafting", risk: "low", sensitivity: "public", freeOnly: true,
      messages: [
        { role: "system", content: "You list restaurant orders. Answer with JSON only: an array of 8 objects {\"place\", \"order\", \"net_carbs\", \"why\"}. Real, well-known restaurants in the city given. Each order is what to say at the counter for a strict keto meal: what to order, what to swap, what to leave off. net_carbs is an approximate integer under 15. Never a recipe, never cooking." },
        { role: "user", content: `City: ${city}` },
      ],
    });
    const arr = JSON.parse(/\[[\s\S]*\]/.exec(r.text)?.[0] ?? "[]");
    let n = 0;
    for (const raw of Array.isArray(arr) ? arr.slice(0, 12) : []) {
      const p = usablePlace(raw);
      if (!p) continue;
      await env.DB.prepare(`INSERT INTO food_places (place_key, place, city, order_text, net_carbs, why, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(place_key) DO NOTHING`)
        .bind(`${p.place.toLowerCase()}|${k}`, p.place, k, p.order, p.carbs, p.why, Date.now()).run();
      n += 1;
    }
    return n;
  } catch { return 0; }
}

/** Does today's city need a $0 lane to write local places? (No list, nothing kept yet.) */
export async function cityNeedsPlaces(env: Env, city: string | null): Promise<boolean> {
  const k = cityKey(city);
  if (!k || LOCAL[k]) return false;
  const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM food_places WHERE lower(city) = ?`).bind(k).first<{ n: number }>().catch(() => null);
  return (n?.n ?? 0) === 0;
}
